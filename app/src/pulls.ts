// Pull requests tab: your open pull requests (Mine) and the ones that ask for your review (To
// review), read from GitHub by the backend (pulls.py). Each of yours gets one next step, worked out
// from GitHub data only. A stack (pull requests built on each other) sorts and shows as one unit.
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, ApiError } from "./api";
import type { Issue, PullRequest, Pulls } from "./api";
import { h, pageHead, svg } from "./dom";

export interface PullsCtx {
  /** Render the page again when this tab shows, else only the sidebar (for its count). */
  rerender: () => void;
  toast: (message: string) => void;
  /** Your open Linear issues: the one a branch or title names shows with its status and due date. */
  issues: () => Issue[];
}
let ctx: PullsCtx;
export function setupPulls(c: PullsCtx) { ctx = c; }

type Side = "mine" | "review";
type Tone = "red" | "amb" | "ok" | "mute";
interface Step { label: string; tone: Tone; rank: number; needs: boolean }
interface View {
  id: string; label: string; has: (p: PullRequest) => boolean; none: () => string;
  /** A part of the view, named under its count; clicking it filters the table to that part. */
  note?: { text: (n: number) => string; tone: Tone; has: (p: PullRequest) => boolean };
}
/** A stack, or a pull request on its own. ``shown``: the members the view and the filter keep; the
 *  others stay in grey, so a stack never splits. */
interface Unit { id: string; all: PullRequest[]; shown: Set<PullRequest> }
interface Col {
  id: string; label: string; key: (p: PullRequest) => number | string; first: 1 | -1;
  /** How a stack gets its one value: its base's, its lowest, its highest or the sum. */
  unit: "base" | "min" | "max" | "sum"; cls?: string; tip?: string;
}

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const READ_EVERY = 5 * MIN;          // the backend reads GitHub at most this often, unless asked
const STAGE: Record<PullRequest["stage"], [string, string]> = {
  draft: ["Draft", "pr-draft"], in_review: ["In review", "s-prog"],
  changes_requested: ["Changes requested", "pr-chg"], approved: ["Approved", "s-done"],
};
const CI_RANK: Record<PullRequest["ci"]["state"], number> = { failing: 0, running: 1, none: 2, passing: 3 };

const st = {
  data: null as Pulls | null,
  loading: false,
  unreachable: null as string | null,  // the backend did not answer (gh's own errors come in data.error)
  askedAt: 0,
  side: "mine" as Side,
  view: { mine: "needs", review: "all" } as Record<Side, string>,
  note: false,                          // the view's note filters the table
  sorts: { mine: { id: "step", dir: 1 }, review: { id: "step", dir: 1 } } as Record<Side, { id: string; dir: number }>,
  open: new Set<string>(),
  sel: null as string | null,
  filter: "",
  fold: false,                          // drafts in no stack
};

// ---- small helpers ------------------------------------------------------------------------------
const keyOf = (p: PullRequest) => `${p.repo}#${p.number}`;
const domId = (key: string) => `pr-${key.replace(/[^A-Za-z0-9]/g, "-")}`;
const since = (iso: string | null) => (iso ? Math.max(0, Date.now() - Date.parse(iso)) : 0);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const num = (x: number) => x.toLocaleString("en-US");
const ago = (ms: number) => (ms < HOUR ? `${Math.max(1, Math.round(ms / MIN))}m` : ms < DAY ? `${Math.round(ms / HOUR)}h` : `${Math.round(ms / DAY)}d`);
const long = (ms: number) => (ms < HOUR ? plural(Math.max(1, Math.round(ms / MIN)), "minute")
  : ms < DAY ? plural(Math.round(ms / HOUR), "hour") : plural(Math.round(ms / DAY), "day"));
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dur = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

const PATHS: Record<string, string> = {
  ok: "M3.5 8.5l3 3 6-7",
  no: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  msg: "M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7.5L4.5 14v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z",
  rt: "M6 4l4 4-4 4",
  alert: "M8 4.5v4.2M8 11.2v.1M8 1.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4z",
  dn: "M4 6l4 4 4-4",
  up: "M4 10l4-4 4 4",
  ud: "M4.7 6.7 8 3.3l3.3 3.4M4.7 9.3 8 12.7l3.3-3.4",
};
function icon(name: string, cls = "i"): SVGElement {
  const g = svg("svg", { class: cls, viewBox: "0 0 16 16", "aria-hidden": "true" });
  g.append(name === "run" ? svg("circle", { cx: 8, cy: 8, r: 5.5, "stroke-dasharray": "3 2.4" }) : svg("path", { d: PATHS[name] }));
  return g;
}

// ---- stacks: a pull request whose base branch is another one of yours is built on it ------------
let index = { data: null as Pulls | null, byKey: new Map<string, PullRequest>(), kids: new Map<string, PullRequest[]>() };
function stacks() {
  if (index.data !== st.data) {
    const mine = st.data?.mine ?? [];
    const byKey = new Map(mine.map((p) => [keyOf(p), p]));
    const kids = new Map<string, PullRequest[]>();
    for (const p of mine) {
      const up = p.stacked_on ? byKey.get(`${p.repo}#${p.stacked_on}`) : undefined;
      if (up && up !== p) kids.set(keyOf(up), [...(kids.get(keyOf(up)) ?? []), p].sort((a, b) => a.number - b.number));
    }
    index = { data: st.data, byKey, kids };
  }
  return index;
}
const under = (p: PullRequest) => (p.stacked_on ? stacks().byKey.get(`${p.repo}#${p.stacked_on}`) : undefined);
function rootOf(p: PullRequest): PullRequest {
  const seen = new Set<PullRequest>();
  let r = p;
  for (let up = under(r); up && !seen.has(up); up = under(r)) { seen.add(r); r = up; }
  return r;
}
/** The stack from its base: each pull request, then the ones built on it. */
function membersOf(root: PullRequest): PullRequest[] {
  const out: PullRequest[] = [];
  const walk = (p: PullRequest) => {
    if (out.includes(p)) return;
    out.push(p);
    for (const k of stacks().kids.get(keyOf(p)) ?? []) walk(k);
  };
  walk(root);
  return out;
}

// ---- the next step: one per pull request, from GitHub data only --------------------------------
const STEP = (label: string, tone: Tone, rank: number, needs: boolean): Step => ({ label, tone, rank, needs });
const waiting = (p: PullRequest) => p.reviewers.filter((r) => r.state === "waiting");
const waitDays = (p: PullRequest) => Math.floor(Math.max(0, ...waiting(p).map((r) => since(r.at))) / DAY);
/** Rank orders the Next step column; ``needs`` puts the pull request under Needs you. */
function stepOf(p: PullRequest): Step {
  const ci = p.ci.state;
  if (p.stage === "draft") {
    return STEP(ci === "running" ? "Waiting for CI" : ci === "failing" ? "Fix CI" : "Mark ready for review", "mute", 10, false);
  }
  if (ci === "failing") return STEP("Fix CI", "red", 0, true);
  if (p.conflicts) return STEP("Resolve conflicts", "red", 1, true);
  if (p.open_threads) return STEP(`Resolve ${plural(p.open_threads, "thread")}`, "amb", 2, true);
  const asked = waiting(p);
  if (p.stage === "changes_requested" && !asked.length) return STEP("Re-request review", "amb", 3, true);
  if (p.stage === "approved") {
    const base = under(p);
    return base ? STEP(`Merge after #${base.number}`, "mute", 7, false) : STEP("Merge", "ok", 6, true);
  }
  if (ci === "running") return STEP("Waiting for CI", "mute", 8, false);
  if (!asked.length) return p.reviewers.length ? STEP("Re-request review", "amb", 3, true) : STEP("Find a reviewer", "amb", 4, true);
  const who = asked.map((r) => r.login).join(", "), days = waitDays(p);
  return days >= 2 ? STEP(`Waiting on ${who} · ${days} days`, "amb", 5, true) : STEP(`Waiting on ${who}`, "mute", 9, false);
}
const needsYou = (p: PullRequest) => stepOf(p).needs;
const isReady = (p: PullRequest) => p.stage === "approved" && p.ci.state === "passing" && !p.conflicts && !under(p);

/** The Linear issue a branch or title names, when its team key is one your issues use. */
function linearOf(p: PullRequest): { ident: string; issue?: Issue; url: string | null } | null {
  const issues = ctx.issues();
  const teams = new Set(issues.map((i) => i.identifier.split("-")[0]));
  const ident = p.refs.find((r) => teams.has(r.split("-")[0]));
  if (!ident) return null;
  const issue = issues.find((i) => i.identifier === ident);
  const workspace = issues[0]?.url.match(/^https:\/\/linear\.app\/[^/]+\/issue\//)?.[0];
  return { ident, issue, url: issue?.url ?? (workspace ? workspace + ident : null) };
}

// ---- views and columns --------------------------------------------------------------------------
const mine = () => st.data?.mine ?? [];
const VIEWS: Record<Side, View[]> = {
  mine: [
    { id: "needs", label: "Needs you", has: needsYou,
      note: { text: (n) => `${n} CI failing`, tone: "red", has: (p) => p.ci.state === "failing" },
      none: () => {
        const n = mine().filter((p) => p.stage !== "draft" && !needsYou(p)).length;
        return `Nothing needs you. ${n === 1 ? "1 pull request waits" : `${n} pull requests wait`} on others.`;
      } },
    { id: "in_review", label: "In review", has: (p) => p.stage === "in_review",
      note: { text: (n) => `${n} waiting 2+ days`, tone: "amb", has: (p) => waitDays(p) >= 2 },
      none: () => "No pull request is in review." },
    { id: "changes_requested", label: "Changes requested", has: (p) => p.stage === "changes_requested",
      note: { text: (n) => `${n} with open threads`, tone: "amb", has: (p) => p.open_threads > 0 },
      none: () => "No pull request has changes requested." },
    { id: "approved", label: "Approved", has: (p) => p.stage === "approved",
      note: { text: (n) => `${n} ready to merge`, tone: "ok", has: isReady },
      none: () => "No pull request is approved." },
    { id: "all", label: "All open", has: () => true,
      note: { text: (n) => `${n} with conflicts`, tone: "red", has: (p) => p.conflicts },
      none: () => "No open pull requests." },
  ],
  review: [
    { id: "all", label: "Waiting on you", has: () => true,
      note: { text: (n) => `${n} CI failing`, tone: "red", has: (p) => p.ci.state === "failing" },
      none: () => "Nobody is waiting on your review." },
    { id: "old", label: "Waiting 3+ days", has: (p) => since(p.asked_at) >= 3 * DAY,
      none: () => "No review has waited 3 days or more." },
    { id: "again", label: "Asked again", has: (p) => p.reviewed_before, none: () => "Nobody asked you again." },
  ],
};
const viewOf = () => VIEWS[st.side].find((v) => v.id === st.view[st.side]) ?? VIEWS[st.side][0];

// A header's first click sorts the way you most often want.
const COLS: Col[] = [
  { id: "title", label: "Pull request", key: (p) => p.title.toLowerCase(), first: 1, unit: "base" },
  { id: "step", label: "Next step", first: 1, cls: "c-st", unit: "min",
    key: (p) => (st.side === "mine" ? stepOf(p).rank * 1e13 + Date.parse(p.updated_at) : Date.parse(p.asked_at)) },
  { id: "ci", label: "CI", key: (p) => CI_RANK[p.ci.state], first: 1, cls: "c-ci", unit: "min" },
  { id: "comments", label: "Comments", key: (p) => p.open_threads * 1000 + p.comments, first: -1, cls: "c-cm", unit: "sum",
    tip: "Sorts by open threads, then by comments" },
  { id: "size", label: "Size", key: (p) => p.additions + p.deletions, first: -1, cls: "c-size r", unit: "sum" },
  { id: "updated", label: "Updated", key: (p) => Date.parse(p.updated_at), first: -1, cls: "c-up r", unit: "max" },
];

function units(shown: PullRequest[]): Unit[] {
  const sort = st.sorts[st.side];
  const col = COLS.find((c) => c.id === sort.id) ?? COLS[1];
  const seen = new Map<string, Unit>();
  for (const p of shown) {
    const root = st.side === "mine" ? rootOf(p) : p;
    const id = keyOf(root);
    if (!seen.has(id)) seen.set(id, { id, all: st.side === "mine" ? membersOf(root) : [p], shown: new Set() });
    seen.get(id)!.shown.add(p);
  }
  const value = (u: Unit) => {
    const ks = u.all.map(col.key);
    if (col.unit === "base" || typeof ks[0] === "string") return ks[0];
    const ns = ks as number[];
    return col.unit === "min" ? Math.min(...ns) : col.unit === "max" ? Math.max(...ns) : ns.reduce((a, b) => a + b, 0);
  };
  return [...seen.values()].sort((a, b) => { const x = value(a), y = value(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
}

// ---- cells and rows -------------------------------------------------------------------------------
function ciCell(p: PullRequest): Node {
  const c = p.ci;
  if (c.state === "failing") return h("span", { class: "no" }, icon("no"), c.failing.length ? `${c.failing.length} failing` : "Failing");
  if (c.state === "running") return h("span", { class: "mute" }, icon("run"), `${c.done} of ${c.total}`);
  if (c.state === "passing") return h("span", { class: "ok" }, icon("ok"), "Passing");
  return h("span", { class: "mute" }, "No checks");
}

function commentsCell(comments: number, open: number): Node {
  if (!comments && !open) return h("span", { class: "mute" }, "–");
  return h("span", {}, icon("msg", "i mute"), String(comments), open > 0 && " · ", open > 0 && h("span", { class: "open-n" }, `${open} open`));
}

function stepCell(p: PullRequest): Node {
  if (st.side === "review") {
    const ms = since(p.asked_at);
    return h("span", { class: ms >= 3 * DAY ? "step amb" : "mute" }, long(ms));
  }
  const s = stepOf(p);
  return h("span", { class: `step ${s.tone}`, title: s.label }, s.label);
}

function stagePill(stage: PullRequest["stage"]): HTMLElement {
  return h("span", { class: `pill ${STAGE[stage][1]}` }, h("span", { class: "pdot" }), STAGE[stage][0]);
}

/** The line under a title. The stage, "Conflicts" and the repo and number always show (the repo name
 *  shortens); when the line is full, the rest drops out whole, from the end: "N of M" first, as the rail
 *  shows the place in the stack. */
function metaLine(p: PullRequest, u: Unit): HTMLElement {
  const keep = h("span", { class: "keep" }, st.side === "mine" && stagePill(p.stage),
    p.conflicts && h("span", { class: "b red" }, "Conflicts"),
    // the number first: drawn right to left, so a repo name that does not fit drops out whole
    h("span", { class: "b id", title: p.repo }, h("span", {}, `#${p.number}`), h("span", {}, p.repo.split("/")[1])));
  const rest: (Node | string)[] = [];
  if (st.side === "review") {
    rest.push(`by ${p.author}`);
    if (p.reviewed_before) rest.push(h("span", { class: "amb" }, "asked again"));
  }
  const lin = linearOf(p);
  if (lin) rest.push(h("span", { class: "ref" }, h("span", { class: "k" }, lin.ident)));
  if (u.all.length > 1) rest.push(`${u.all.indexOf(p) + 1} of ${u.all.length}`);
  return h("span", { class: "m" }, keep, ...rest.map((b) => h("span", { class: "b" }, b)));
}

function rail(u: Unit, p: PullRequest, detail = false): HTMLElement {
  const td = h("td", { class: "rail", "aria-hidden": "true" });
  if (u.all.length < 2) return td;
  const last = u.all.indexOf(p) === u.all.length - 1;
  if (detail) {
    if (!last) td.append(h("span", { class: "ln thru" }));
  } else {
    td.append(h("span", { class: "ln up" }), h("span", { class: "knot" }), last ? "" : h("span", { class: "ln dn" }));
  }
  return td;
}

/** A stack's first row: it shows the value the table sorts the stack by. */
function stackRow(u: Unit): HTMLElement {
  const ms = u.all, step = COLS[1];
  const top = ms.reduce((a, b) => (step.key(b) < step.key(a) ? b : a));
  const s = stepOf(top);
  const fail = ms.filter((p) => p.ci.state === "failing").length, run = ms.filter((p) => p.ci.state === "running").length;
  const ci = fail ? h("span", { class: "no" }, icon("no"), `${plural(fail, "PR")} failing`)
    : run ? h("span", { class: "mute" }, icon("run"), `${run} running`)
    : ms.some((p) => p.ci.state === "passing") ? h("span", { class: "ok" }, icon("ok"), "Passing")
    : h("span", { class: "mute" }, "No checks");
  const sum = (f: (p: PullRequest) => number) => ms.reduce((n, p) => n + f(p), 0);
  return h("tr", { class: "sum", "data-stack": u.id },
    h("td", { class: "rail", "aria-hidden": "true" }, h("span", { class: "knot head" }), h("span", { class: "ln dn" })),
    h("td", { class: "x" }),
    h("td", { class: "t" }, h("span", { class: "sk" }, `Stack of ${ms.length}`),
      h("span", { class: "m" }, h("span", { class: "b" }, ms[0].repo.split("/")[1]),
        h("span", { class: "b" }, `merge order ${ms.map((p) => `#${p.number}`).join(" → ")}`))),
    h("td", { class: "st" }, h("span", { class: `step ${s.tone}`, title: s.label }, s.label), " ", h("span", { class: "mute" }, `#${top.number}`)),
    h("td", { class: "ci" }, ci),
    h("td", { class: "cm" }, commentsCell(sum((p) => p.comments), sum((p) => p.open_threads))),
    h("td", { class: "sz r c-size" }, `+${num(sum((p) => p.additions))} −${num(sum((p) => p.deletions))}`),
    h("td", { class: "up r" }, ago(Math.min(...ms.map((p) => since(p.updated_at))))));
}

function prRow(p: PullRequest, u: Unit): HTMLElement[] {
  const key = keyOf(p), stacked = u.all.length > 1, open = st.open.has(key);
  const cls = ["pr-row", stacked && "stk", stacked && u.all.indexOf(p) === u.all.length - 1 && "last", open && "open",
    st.sel === key && "sel", !u.shown.has(p) && "ctx"].filter(Boolean).join(" ");
  const row = h("tr", { class: cls, "data-key": key, "data-stack": stacked ? u.id : undefined },
    rail(u, p),
    h("td", { class: "x" }, icon("rt")),
    h("td", { class: "t" },
      h("button", { class: "tt", id: domId(key), tabindex: st.sel === key ? "0" : "-1", "aria-expanded": String(open),
        "aria-controls": open ? `${domId(key)}-d` : undefined }, p.title),
      metaLine(p, u)),
    h("td", { class: "st" }, stepCell(p)),
    h("td", { class: "ci" }, ciCell(p)),
    h("td", { class: "cm" }, commentsCell(p.comments, p.open_threads)),
    h("td", { class: "sz r c-size" }, `+${num(p.additions)} −${num(p.deletions)}`),
    h("td", { class: "up r", title: new Date(p.updated_at).toLocaleString() }, ago(since(p.updated_at))));
  return open ? [row, detailRow(p, u)] : [row];
}

const lbl = (text: string) => h("h3", { class: "lbl" }, text);
const note = (text: string) => h("p", { class: "note" }, text);
const li = (cls: string, ...kids: (Node | string)[]) => h("div", { class: `li ${cls}`.trim() }, ...kids);

function checksBox(p: PullRequest): Node[] {
  const c = p.ci, failN = c.failing.length, passed = c.done - failN, running = c.total - c.done;
  if (c.state === "none") return [lbl("Checks"), note("No checks ran.")];
  if (c.state === "passing") return [lbl("Checks"), li("ok", icon("ok"), h("span", {}, `All ${c.total} passed`))];
  if (c.state === "running") return [lbl("Checks"), li("mute", icon("run"), h("span", {}, `${c.done} of ${c.total} done, none failed so far`))];
  const out: Node[] = [
    lbl(failN ? `Checks · ${failN} of ${c.total} failing` : "Checks · failing"),
    ...c.failing.map((f) => li("", icon("no", "i no"),
      h("span", {}, f.url ? h("button", { class: "chk", "data-act": "run", "data-url": f.url, title: "Open the run's log in GitHub" }, f.name)
        : h("b", {}, f.name), f.seconds !== null && h("span", { class: "m" }, ` ${dur(f.seconds)}`)))),
  ];
  if (passed > 0) out.push(li("mute", icon("ok", "i ok"), h("span", {}, `${passed} passed`)));
  if (running > 0) out.push(li("mute", icon("run"), h("span", {}, `${running} still running`)));
  return out;
}

function threadsBox(p: PullRequest): Node[] {
  const open = p.open_threads;
  const out: Node[] = [lbl(`Open threads${open ? ` · ${open}` : ""}`)];
  if (!open) out.push(note(!p.comments ? "No comments yet." : "No open thread."));
  for (const t of p.threads) {
    out.push(h("div", { class: "thr" }, h("b", {}, t.author), " ",
      h("span", { class: "m" }, `${t.path}${t.line ? `:${t.line}` : ""} · ${ago(since(t.at))}`), h("br"), t.text));
  }
  if (open > p.threads.length) out.push(h("button", { class: "link-btn", "data-act": "gh" }, `${open - p.threads.length} more on GitHub`));
  if (p.threads_unread) out.push(note(`Read the 30 newest threads; ${plural(p.threads_unread, "older one")} not read.`));
  return out;
}

const REVIEW_WORD = { waiting: "waiting", approved: "approved", changes_requested: "requested changes", commented: "commented" };
function sideBox(p: PullRequest): Node[] {
  if (st.side === "review") {
    return [lbl("Review"), li("", h("span", {}, `${p.author} asked you ${long(since(p.asked_at))} ago.`)),
      p.reviewed_before ? li("amb", h("span", {}, "You reviewed it before; this asks again.")) : ""].filter(Boolean) as Node[];
  }
  const lin = linearOf(p);
  const due = lin?.issue?.due_date
    ? ` · due ${new Date(lin.issue.due_date + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" })}` : "";
  return [
    lbl("Linear"),
    lin ? li("", h("span", { class: "ref" }, h("span", { class: "k" }, lin.ident)),
      h("span", {}, lin.issue ? lin.issue.state.name : "", h("span", { class: "m" }, lin.issue ? due : "not one of your open issues")))
      : note("No Linear issue in the branch name or title."),
    lbl("Reviews"),
    ...(p.reviewers.length
      ? p.reviewers.map((r) => li("", h("span", {}, h("b", {}, r.login), " ",
          h("span", { class: "m" }, r.state === "waiting" && r.at ? `waiting, ${long(since(r.at))}` : REVIEW_WORD[r.state]))))
      : [note(p.stage === "draft" ? "Drafts ask nobody yet." : "No reviewer yet.")]),
  ];
}

function detailRow(p: PullRequest, u: Unit): HTMLElement {
  const key = keyOf(p), lin = st.side === "mine" ? linearOf(p) : null;
  return h("tr", { class: `detail${st.sel === key ? " sel" : ""}`, "data-key": key, "data-stack": u.all.length > 1 ? u.id : undefined },
    rail(u, p, true),
    h("td", { colspan: "7", id: `${domId(key)}-d` },
      h("h2", { class: "vh" }, `#${p.number} ${p.title}`),
      h("div", { class: "dgrid" },
        h("section", { class: "box" }, ...checksBox(p),
          p.conflicts && li("red", icon("no"), h("span", {}, `Conflicts with ${p.base}`))),
        h("section", { class: "box" }, ...threadsBox(p)),
        h("section", { class: "box" }, ...sideBox(p))),
      h("div", { class: "acts" },
        h("button", { class: "secondary pr-main", "data-act": "gh" }, "Open in GitHub", h("kbd", {}, "o")),
        lin?.url && h("button", { class: "secondary", "data-act": "lin" }, `Open ${lin.ident}`, h("kbd", {}, "l")),
        h("button", { class: "secondary", "data-act": "copy" }, "Copy branch name"))));
}

// ---- the page -------------------------------------------------------------------------------------
const filterInput = h("input", {
  class: "filter", type: "search", "aria-label": "Filter pull requests",
  oninput: () => { st.filter = filterInput.value; paint(); },
  // Esc empties the filter first; the app's own Esc then leaves it.
  onkeydown: (e: KeyboardEvent) => {
    if (e.key === "Escape" && filterInput.value) { e.stopPropagation(); filterInput.value = ""; st.filter = ""; paint(); }
  },
});
let root: HTMLElement | null = null;

function subtitle(): string {
  const d = st.data;
  if (!d?.read_at) return st.loading ? "Reading GitHub…" : "";
  const read = st.loading ? "Reading GitHub…"
    : d.error ? `Read from GitHub at ${clock(d.read_at)}`
    : since(d.read_at) < MIN ? "Read from GitHub just now" : `Read from GitHub ${long(since(d.read_at))} ago`;
  const total = st.side === "mine" ? d.mine_total : d.review_total, shown = d[st.side].length;
  return total > shown ? `${read} · the ${shown} updated last of ${total}` : read;
}

function head(): HTMLElement {
  const d = st.data?.read_at ? st.data : null;
  const team = ctx.issues()[0]?.identifier.split("-")[0];
  filterInput.placeholder = `Filter by title, repo or ${team ? `${team}-` : "issue"}`;
  return pageHead("Pull requests", {
    sub: subtitle(), label: "Pull requests", right: filterInput,
    tabs: [
      { id: "mine", label: "Mine", count: d?.mine.length, controls: "pr-panel", on: st.side === "mine", select: () => switchSide("mine") },
      { id: "review", label: "To review", count: d?.review.length, controls: "pr-panel", on: st.side === "review", select: () => switchSide("review") },
    ],
  });
}

function banner(): Node | string {
  const d = st.data, err = st.unreachable ?? d?.error;
  if (!err) return "";
  const when = !st.unreachable && d?.error_at ? ` at ${clock(d.error_at)}` : "";
  return h("div", { class: "banner error pr-banner", role: "alert" }, icon("alert"),
    h("span", {}, `Could not read GitHub${when}: ${err}`, d?.read_at ? ` This page shows what was read at ${clock(d.read_at)}.` : ""),
    h("button", { class: "secondary", "data-act": "reread", disabled: st.loading }, st.loading ? "Reading…" : "Read again"));
}

function strip(base: PullRequest[], have: boolean): HTMLElement {
  const v = viewOf();
  return h("div", { class: "pr-strip", role: "group", "aria-label": "Show" }, ...VIEWS[st.side].map((w, i) => {
    const on = w.id === v.id, ps = base.filter(w.has);
    const k = w.note && have ? ps.filter(w.note.has).length : 0;
    const pressed = on && st.note;
    return h("div", { class: `seg${on ? " on" : ""}` },
      h("button", { class: "seg-b", "data-view": w.id, "aria-pressed": String(on), "aria-keyshortcuts": String(i + 1) },
        h("b", {}, have ? String(ps.length) : "–"), h("span", {}, w.label)),
      k && w.note ? h("button", { class: `seg-n ${w.note.tone}`, "data-note": w.id, "aria-pressed": String(pressed) },
          w.note.text(k), pressed && icon("no"))
        : h("span", { class: "seg-n plain", "aria-hidden": "true" }, " "));
  }));
}

function table(us: Unit[], folded: PullRequest[]): HTMLElement {
  const sort = st.sorts[st.side], v = viewOf();
  const col = COLS.find((c) => c.id === sort.id) ?? COLS[1];
  const label = (c: Col) => (st.side === "review" && c.id === "step" ? "Waiting" : c.label);
  return h("table", { class: "pr-table" },
    h("caption", { class: "vh" }, `${v.label}, sorted by ${label(col)}`),
    h("thead", {}, h("tr", {}, h("th", {}, h("span", { class: "vh" }, "Stack")), h("th", {}, h("span", { class: "vh" }, "Open")),
      ...COLS.map((c) => {
        const on = sort.id === c.id;
        return h("th", { class: c.cls, "aria-sort": on ? (sort.dir > 0 ? "ascending" : "descending") : undefined },
          h("button", { "data-sort": c.id, title: c.tip }, label(c), icon(on ? (sort.dir > 0 ? "up" : "dn") : "ud")));
      }))),
    h("tbody", {}, ...us.flatMap((u) => [...(u.all.length > 1 ? [stackRow(u)] : []), ...u.all.flatMap((p) => prRow(p, u))])),
    h("tbody", {}, ...(folded.length ? [
      h("tr", { class: "fold-h" }, h("td", { colspan: "8" },
        h("button", { class: "fold-b", "data-fold": "", "aria-expanded": String(st.fold) },
          h("span", {}, plural(folded.length, "draft")), icon("rt")))),
      ...(st.fold ? folded.flatMap((p) => prRow(p, { id: keyOf(p), all: [p], shown: new Set([p]) })) : []),
    ] : [])));
}

function panel(): HTMLElement {
  const d = st.data?.read_at ? st.data : null;
  const side = st.side, v = viewOf();
  const q = st.filter.trim().toLowerCase();
  const base = (d?.[side] ?? []).filter((p) => !q || [p.title, p.repo, `#${p.number}`, p.head, ...p.refs].some((s) => s.toLowerCase().includes(q)));
  if (st.note && !base.filter(v.has).some((p) => v.note?.has(p))) st.note = false;
  const shown = base.filter((p) => v.has(p) && (!st.note || v.note!.has(p)));
  // Drafts in no stack wait under a fold, like Today's "not on Today".
  const loose = (p: PullRequest) => side === "mine" && p.stage === "draft" && membersOf(rootOf(p)).length < 2;
  const us = units(shown.filter((p) => !loose(p)));
  const folded = side === "mine" && !st.note && (v.id === "needs" || v.id === "all") ? base.filter(loose) : [];
  const order = [...us.flatMap((u) => u.all), ...(st.fold ? folded : [])].map(keyOf);
  if (!st.sel || !order.includes(st.sel)) st.sel = order[0] ?? null;

  const rows = us.length > 0 || folded.length > 0;
  const empty = !d ? (st.loading ? [h("span", { class: "spinner" }), "Reading your pull requests from GitHub…"] : [])
    : q ? [`No pull request matches “${st.filter.trim()}”.`, h("br"), h("button", { class: "secondary", "data-clear": "" }, "Clear the filter")]
    : !d[side].length ? [side === "mine" ? "No open pull requests." : "Nobody is waiting on your review."]
    : [v.none()];
  const kbd = (k: string) => h("kbd", {}, k);
  return h("div", { id: "pr-panel", role: "tabpanel", "aria-labelledby": `tab-${side}` },
    banner(),
    strip(base, !!d),
    rows ? table(us, folded) : h("div", { class: "empty pr-empty" }, ...empty),
    rows && h("p", { class: "pr-hint" }, kbd("j"), kbd("k"), " move · ", kbd("Space"), " opens or closes · ", kbd("o"), " GitHub · ",
      kbd("l"), " Linear · ", kbd("1"), "–", kbd(String(VIEWS[side].length)), " pick a view · ", kbd("?"), " all keys"));
}

type Focus = { on: "filter"; from: number | null; to: number | null } | { on: "table" } | { on: "tab" } | null;
function focusNow(): Focus {
  const a = document.activeElement;
  if (a === filterInput) return { on: "filter", from: filterInput.selectionStart, to: filterInput.selectionEnd };
  if (a?.closest(".pr-table")) return { on: "table" };
  if (a?.closest(".prs [role=tab]")) return { on: "tab" };
  return null;
}
function refocus(f: Focus) {
  if (f?.on === "filter") {
    filterInput.focus();
    if (f.from !== null) filterInput.setSelectionRange(f.from, f.to);
  } else if (f?.on === "table") focusSel(false);
  else if (f?.on === "tab") document.getElementById(`tab-${st.side}`)?.focus();
}

/** The tab's page. It asks the backend again once the last answer is 5 minutes old. */
export function pullsView(): HTMLElement {
  if (!st.loading && Date.now() - st.askedAt > READ_EVERY) void loadPulls();
  const f = focusNow();
  root = h("div", { class: "prs", onclick: onClick, onmouseover: onHover, onmouseleave: onHover, onfocusin: onFocusIn }, head(), panel());
  queueMicrotask(() => refocus(f));           // once the page is in the window
  return root;
}

/** Draw the tab again in place, keeping the focus where it was. */
function paint() {
  if (!root?.isConnected) return;
  const f = focusNow();
  root.replaceChildren(head(), panel());
  refocus(f);
}

/** Needs you plus To review, for the sidebar; null until GitHub was read. */
export function pullsCount(): number | null {
  const d = st.data;
  return d?.read_at ? d.mine.filter(needsYou).length + d.review.length : null;
}

export async function loadPulls(force = false): Promise<void> {
  if (st.loading) return;
  st.loading = true;
  st.askedAt = Date.now();
  paint();
  try {
    st.data = await api.pulls(force);
    st.unreachable = null;
  } catch (e) {
    st.unreachable = e instanceof ApiError ? e.message : String(e);
  } finally {
    st.loading = false;
    paint();                 // in place, so a filter being typed keeps its focus
    ctx.rerender();
  }
}

// ---- selection, actions and keys ------------------------------------------------------------------
/** Move the selection without drawing the table again, so focus and scroll stay where they are. */
function markSel() {
  root?.querySelectorAll<HTMLElement>("tr[data-key]").forEach((r) => r.classList.toggle("sel", r.dataset.key === st.sel));
  root?.querySelectorAll<HTMLElement>(".tt").forEach((b) => { b.tabIndex = b.closest<HTMLElement>("tr")?.dataset.key === st.sel ? 0 : -1; });
}
function focusSel(scroll = true) {
  const b = st.sel ? document.getElementById(domId(st.sel)) : null;
  if (!b) return;
  b.focus({ preventScroll: true });
  if (scroll) b.closest("tr")?.scrollIntoView({ block: "nearest" });
}
const rowKeys = () => [...(root?.querySelectorAll<HTMLElement>("tr.pr-row") ?? [])].map((r) => r.dataset.key!);
const prOf = (key: string | null | undefined) => (key ? st.data?.[st.side].find((p) => keyOf(p) === key) : undefined);
function toggle(key: string) {
  if (!st.open.delete(key)) st.open.add(key);
  st.sel = key;
  paint();
}
function pickView(id: string) { st.view[st.side] = id; st.note = false; paint(); }
function switchSide(side: Side) {
  if (side === st.side) return;
  st.side = side;
  st.note = false;
  st.open.clear();
  st.sel = null;
  paint();
}

function act(kind: string, p: PullRequest | undefined) {
  if (!p) return;
  if (kind === "gh") void openUrl(p.url);
  else if (kind === "lin") {
    const lin = linearOf(p);
    if (lin?.url) void openUrl(lin.url);
    else ctx.toast("No Linear issue in the branch name or title.");
  } else if (kind === "copy") {
    navigator.clipboard.writeText(p.head).then(() => ctx.toast(`Copied ${p.head}`), () => ctx.toast("Could not copy the branch name."));
  }
}

function onClick(e: MouseEvent) {
  const t = (e.target as Element).closest<HTMLElement>("[data-view],[data-note],[data-sort],[data-fold],[data-act],[data-clear],tr.pr-row");
  if (!t) return;
  const d = t.dataset;
  if (d.view) return pickView(d.view);
  if (d.note) {
    const same = st.view[st.side] === d.note && st.note;
    st.view[st.side] = d.note;
    st.note = !same;
    return paint();
  }
  if (d.sort) {
    const c = COLS.find((x) => x.id === d.sort)!, s = st.sorts[st.side];
    st.sorts[st.side] = s.id === c.id ? { id: c.id, dir: -s.dir } : { id: c.id, dir: c.first };
    return paint();
  }
  if (d.fold !== undefined) { st.fold = !st.fold; return paint(); }
  if (d.clear !== undefined) { filterInput.value = ""; st.filter = ""; return paint(); }
  if (d.act === "reread") return void loadPulls(true);
  if (d.act === "run" && d.url) return void openUrl(d.url);
  if (d.act) return act(d.act, prOf(t.closest<HTMLElement>("tr")?.dataset.key));
  if (String(getSelection())) return;        // the click ended a text selection
  toggle(d.key!);
}

// Point at one pull request of a stack and the whole stack lights up (until the pointer leaves the tab).
function onHover(e: MouseEvent) {
  const id = e.type === "mouseleave" ? "" : (e.target as Element).closest<HTMLElement>("tr[data-stack]")?.dataset.stack ?? "";
  root?.querySelectorAll<HTMLElement>("tr.hl").forEach((r) => { if (r.dataset.stack !== id) r.classList.remove("hl"); });
  if (id) root?.querySelectorAll<HTMLElement>(`tr[data-stack="${CSS.escape(id)}"]`).forEach((r) => r.classList.add("hl"));
}

function onFocusIn(e: FocusEvent) {
  const key = (e.target as Element).closest?.(".tt")?.closest<HTMLElement>("tr")?.dataset.key;
  if (key && key !== st.sel) { st.sel = key; markSel(); }
}

/** The tab's keys; true when it used the key. The app's keys (/, ?, ⌘1 – ⌘7) stay with the app. */
export function pullsKey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const el = e.target as HTMLElement;
  if (el.matches?.(".prs [role=tab]") && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    switchSide(st.side === "mine" ? "review" : "mine");
    document.getElementById(`tab-${st.side}`)?.focus();
    return true;
  }
  if (/^[1-9]$/.test(e.key)) {
    const v = VIEWS[st.side][Number(e.key) - 1];
    if (v) pickView(v.id);
    return true;
  }
  const keys = rowKeys();
  if (!keys.length) return false;
  const at = st.sel ? keys.indexOf(st.sel) : -1;
  const move = (d: number) => {
    st.sel = keys[Math.max(0, Math.min(keys.length - 1, at + d))];
    markSel();
    focusSel();
    e.preventDefault();
    return true;
  };
  switch (e.key) {
    case "j": case "ArrowDown": return move(1);
    case "k": case "ArrowUp": return move(-1);
    case " ": case "Enter":
      if (el.matches?.("button, a, input")) return false;       // the button does it
      if (!st.sel) return false;
      e.preventDefault();
      toggle(st.sel);
      return true;
    case "Escape":
      if (st.sel && st.open.has(st.sel)) st.open.delete(st.sel);
      else if (st.open.size) st.open.clear();
      else return false;
      paint();
      return true;
    case "o": act("gh", prOf(st.sel)); return true;
    case "l": act("lin", prOf(st.sel)); return true;
    default: return false;
  }
}
