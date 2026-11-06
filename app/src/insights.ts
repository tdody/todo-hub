// Insights tab. Overview: stat tiles over the charts (client vs dev, approval rate, slipped due
// dates, sweep history). Weekly digest: one week written out (backend digest.py).
import { api, ApiError } from "./api";
import type { ApprovalStats, BalanceStats, Digest, Run, Slips } from "./api";
import { h, link, modal, svg } from "./dom";

type GoTab = (tab: "inbox" | "client" | "dev") => void;

function loadPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* not remembered */ }
}

let mode: "overview" | "digest" = loadPref("todohub.insightsView") === "digest" ? "digest" : "overview";
let digestWeek = 0;                          // 0 = this week, 1 = last week, …
const digests = new Map<number, { at: number; data?: Digest; error?: string }>();
let showAllWins = false;

const REASONS: Record<string, string> = {
  not_mine: "Not mine", already_done: "Already done", noise: "Not a task", duplicate: "Duplicate", other: "Other",
};
const SOURCES: Record<string, string> = {
  slack: "Slack", gmail: "Email", grain: "Grain", calendar: "Calendar", linear: "Linear", github: "GitHub",
  hubspot: "HubSpot", all: "All sources",
};

let cache: { at: number; balance?: BalanceStats; approval?: ApprovalStats; runs?: Run[]; slips?: Slips | null; error?: string } = { at: 0 };

function weekLabel(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" });
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "–" : `${Math.round(v * 100)}%`;
}

// ---- charts -----------------------------------------------------------------------------------
function balanceChart(b: BalanceStats): Node {
  const W = 860, H = 190, top = 22, bottom = 36, left = 38, right = 78;
  const plotH = H - top - bottom;
  const n = b.weeks.length;
  const band = (W - left - right) / n;
  const barW = Math.min(46, band * 0.6);
  const y = (share: number) => top + plotH * (1 - share);
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img",
    "aria-label": "Share of completed issues that were client work, per week" });
  for (const t of [0, 0.5, 1]) {
    g.append(svg("text", { x: left - 6, y: y(t) + 4, class: "axis", "text-anchor": "end" }, `${t * 100}%`));
  }
  b.weeks.forEach((w, i) => {
    const x = left + band * i + (band - barW) / 2;
    const total = w.client + w.dev;
    if (!total) {
      g.append(svg("rect", { x, y: top, width: barW, height: plotH, class: "bar-empty", rx: 3 }));
    } else {
      const share = w.client / total;
      g.append(svg("rect", { x, y: top, width: barW, height: plotH * (1 - share), class: "bar-dev", rx: 3 },
        svg("title", {}, `${weekLabel(w.week)}: ${w.dev} dev`)));
      g.append(svg("rect", { x, y: y(share), width: barW, height: plotH * share, class: "bar-client", rx: 3 },
        svg("title", {}, `${weekLabel(w.week)}: ${w.client} client`)));
      g.append(svg("text", { x: x + barW / 2, y: top - 7, class: "value", "text-anchor": "middle" }, pct(share)));
    }
    g.append(svg("text", { x: x + barW / 2, y: H - bottom + 16, class: "axis", "text-anchor": "middle" }, weekLabel(w.week)));
    g.append(svg("text", { x: x + barW / 2, y: H - bottom + 29, class: "axis faint", "text-anchor": "middle" },
      total ? `${total} done` : "none"));
  });
  // target line drawn last so it sits on top of the bars
  g.append(svg("line", { x1: left, x2: W - right + 6, y1: y(b.target), y2: y(b.target), class: "target" }));
  g.append(svg("text", { x: W - right + 12, y: y(b.target) + 4, class: "axis" }, `target ${pct(b.target)}`));
  return g;
}

function approvalChart(a: ApprovalStats): Node {
  const W = 860, H = 170, top = 16, bottom = 24, left = 38, right = 78;
  const plotH = H - top - bottom;
  const n = a.weeks.length;
  const band = (W - left - right) / n;
  const x = (i: number) => left + band * i + band / 2;   // same columns as the balance chart
  const y = (r: number) => top + plotH * (1 - r);
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Weekly approval rate, all sources" });
  for (const t of [0, 0.5, 1]) {
    g.append(svg("line", { x1: left, x2: W - right + 6, y1: y(t), y2: y(t), class: "grid" }));
    g.append(svg("text", { x: left - 6, y: y(t) + 4, class: "axis", "text-anchor": "end" }, `${t * 100}%`));
  }
  const pts = a.weeks.map((w, i) => ({ i, r: w.sources.all?.rate ?? null, w }));
  let d = "";
  let pen = false;
  for (const p of pts) {
    if (p.r === null) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${x(p.i)},${y(p.r)} `;
    pen = true;
  }
  if (d) g.append(svg("path", { d, class: "line" }));
  for (const p of pts) {
    g.append(svg("text", { x: x(p.i), y: H - 6, class: "axis", "text-anchor": "middle" }, weekLabel(p.w.week)));
    if (p.r === null) continue;
    const all = p.w.sources.all;
    g.append(svg("circle", { cx: x(p.i), cy: y(p.r), r: 4, class: "dot-pt" },
      svg("title", {}, `${weekLabel(p.w.week)}: ${pct(p.r)} (${all.approved} kept, ${all.dropped} dropped)`)));
  }
  return g;
}

function approvalTable(a: ApprovalStats): Node {
  const sources = Object.keys(a.weeks.at(-1)?.sources ?? {}).filter((s) => s !== "all");
  if (!sources.length) return h("p", { class: "muted small" }, "No decisions yet.");
  const recent = a.weeks.slice(-4);
  return h("table", { class: "stats" },
    h("thead", {}, h("tr", {}, h("th", {}, "Source"), ...recent.map((w) => h("th", {}, weekLabel(w.week))))),
    h("tbody", {}, ...[...sources, "all"].map((s) =>
      h("tr", { class: s === "all" ? "total" : "" }, h("td", {}, SOURCES[s] ?? s), ...recent.map((w) => {
        const c = w.sources[s];
        return h("td", { title: c ? `${c.approved} kept, ${c.dropped} dropped` : "" },
          pct(c?.rate), c && c.approved + c.dropped ? h("span", { class: "muted small" }, ` (${c.approved + c.dropped})`) : "");
      })))),
  );
}

function reasonBars(a: ApprovalStats): Node {
  const entries = Object.entries(a.drop_reasons).sort((x, y) => y[1] - x[1]);
  if (!entries.length) return h("p", { class: "muted small" }, "Nothing dropped in this period.");
  const max = Math.max(...entries.map((e) => e[1]));
  return h("div", { class: "reasons" }, ...entries.map(([k, v]) =>
    h("div", { class: "reason" }, h("span", {}, REASONS[k] ?? k),
      h("span", { class: "reason-bar", style: `width:${Math.max(4, (v / max) * 100)}%` }),
      h("span", { class: "muted small" }, String(v)))));
}

// ---- runs ---------------------------------------------------------------------------------------
async function showLog(run: Run) {
  try {
    const log = await api.runLog(run.id!);
    modal(`Log: ${run.trigger} run ${run.id}`,
      log.missing ? h("p", { class: "muted" }, "The log file is gone.")
                  : h("pre", { class: "log" }, (log.truncated ? "…(start cut)\n" : "") + log.text));
  } catch (e) {
    modal("Log", h("p", {}, e instanceof ApiError ? e.message : String(e)));
  }
}

function runsTable(runs: Run[]): Node {
  if (!runs.length) return h("p", { class: "muted small" }, "No runs yet.");
  return h("table", { class: "stats runs" },
    h("thead", {}, h("tr", {}, ...["When", "Kind", "Status", "Added", "Cost", "Turns", "Note", ""].map((t) => h("th", {}, t)))),
    h("tbody", {}, ...runs.map((r) => {
      const failed = (r.sources ?? []).filter((s) => !s.ok).map((s) => SOURCES[s.source] ?? s.source);
      const note = r.error ?? (failed.length ? `Problem: ${failed.join(", ")}` : "");
      return h("tr", {},
        h("td", {}, new Date(r.started_at!).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })),
        h("td", {}, r.trigger === "schedule" ? "Scheduled" : r.trigger === "capture" ? "Capture" : "Run now"),
        h("td", { class: `run-${r.status}` }, r.status === "ok" ? "OK" : r.status === "running" ? "Running" : "Failed"),
        h("td", { class: "num" }, String(r.added ?? 0)),
        h("td", { class: "num" }, r.cost_usd != null ? `$${r.cost_usd.toFixed(2)}` : "–"),
        h("td", { class: "num" }, r.num_turns != null ? String(r.num_turns) : "–"),
        h("td", { class: "note", title: note }, note),
        h("td", {}, h("button", { class: "ghost small-btn", onclick: () => void showLog(r) }, "Log")),
      );
    })),
  );
}

/** Average cost of a sweep (not captures) over the last 7 days against the 7 before. */
function sweepCostTrend(runs: Run[], ageDays: (r: Run) => number): string {
  const sweeps = runs.filter((r) => r.trigger !== "capture" && r.status === "ok" && r.cost_usd != null);
  const avg = (rs: Run[]) => rs.reduce((n, r) => n + r.cost_usd!, 0) / rs.length;
  const now = sweeps.filter((r) => ageDays(r) < 7);
  const before = sweeps.filter((r) => ageDays(r) >= 7 && ageDays(r) < 14);
  if (!now.length) return "";
  const text = ` Average per sweep: $${avg(now).toFixed(2)}`;
  if (!before.length) return `${text}.`;
  const change = avg(now) / avg(before) - 1;
  return `${text}, against $${avg(before).toFixed(2)} the week before (${change <= 0 ? "" : "+"}${Math.round(change * 100)}%).`;
}

// ---- due-date slips -------------------------------------------------------------------------------
function slipsPanel(s: Slips | null): Node | "" {
  if (!s) return "";
  const all = Object.values(s.slips);
  const repeat = all.filter((x) => x.count >= 2).sort((a, b) => b.count - a.count || b.days - a.days);
  const byClient = new Map<string, { issues: number; times: number; days: number }>();
  for (const x of all) {
    const k = x.client ?? "Dev / internal";
    const row = byClient.get(k) ?? { issues: 0, times: 0, days: 0 };
    byClient.set(k, { issues: row.issues + 1, times: row.times + x.count, days: row.days + x.days });
  }
  const clients = [...byClient.entries()].sort((a, b) => b[1].days - a[1].days);
  const day = (d: string | null) => (d ? new Date(d + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" }) : "–");
  return h("section", { class: "panel", id: "panel-slips" },
    h("h2", {}, "Slipped due dates"),
    s.error ? h("p", { class: "muted small" }, `Couldn't read due-date history from Linear: ${s.error}`)
      : h("p", { class: "lead" }, s.checked
        ? `${all.length} of your ${s.checked} open issues with a due date have been pushed at least once; ${repeat.length} of them two or more times.`
        : "None of your open issues has a due date."),
    repeat.length ? h("div", {}, h("h3", {}, "Pushed two or more times"),
      h("table", { class: "stats" },
        h("thead", {}, h("tr", {}, h("th", {}, "Issue"), h("th", {}, "Client"), h("th", { class: "num" }, "Pushed"),
          h("th", { class: "num" }, "Days"), h("th", {}, "Due now"))),
        h("tbody", {}, ...repeat.slice(0, 15).map((x) => h("tr", {},
          h("td", {}, h("span", { class: "muted small" }, x.identifier + " "), x.title),
          h("td", {}, x.client ?? "–"),
          h("td", { class: "num" }, `${x.count}×`),
          h("td", { class: "num" }, String(x.days)),
          h("td", {}, day(x.due_date))))))) : "",
    clients.length ? h("div", {}, h("h3", {}, "By client"),
      h("table", { class: "stats" },
        h("thead", {}, h("tr", {}, h("th", {}, "Client"), h("th", { class: "num" }, "Issues pushed"),
          h("th", { class: "num" }, "Times"), h("th", { class: "num" }, "Days"))),
        h("tbody", {}, ...clients.map(([k, v]) => h("tr", {},
          h("td", {}, k), h("td", { class: "num" }, String(v.issues)), h("td", { class: "num" }, String(v.times)),
          h("td", { class: "num" }, String(v.days))))))) : "",
    h("p", { class: "muted small" },
      "A slip is a change that moved an open issue's due date later. Setting a first date, clearing it, or moving it earlier doesn't count. Days = total pushed."),
  );
}

// ---- view ---------------------------------------------------------------------------------------
async function load(rerender: () => void) {
  try {
    const [balance, approval, runs, slips] = await Promise.all([api.balance(8), api.approval(8), api.runs(150),
      api.slips().catch(() => null)]);       // slips are optional: Insights works without them
    cache = { at: Date.now(), balance, approval, runs, slips };
  } catch (e) {
    cache = { ...cache, at: Date.now(), error: e instanceof ApiError ? e.message : String(e) };
  }
  rerender();
}

function overview(rerender: () => void): HTMLElement {
  if (Date.now() - cache.at > 60_000) {
    if (!cache.balance) cache.at = Date.now();   // avoid a burst of loads while the first one runs
    void load(rerender);
  }
  if (!cache.balance || !cache.approval || !cache.runs) {
    return h("div", { class: "empty" }, h("p", { class: "muted" }, cache.error ?? "Loading…"));
  }
  const b = cache.balance;
  const thisWeek = b.weeks.at(-1)!;
  const done8 = b.weeks.reduce((n, w) => n + w.client + w.dev, 0);
  const client8 = b.weeks.reduce((n, w) => n + w.client, 0);
  const a = cache.approval;
  const allNow = a.weeks.at(-1)?.sources.all;
  const ageDays = (r: Run) => (Date.now() - Date.parse(r.started_at!)) / 864e5;
  const lastWeek = cache.runs.filter((r) => ageDays(r) < 7);
  const cost = lastWeek.reduce((n, r) => n + (r.cost_usd ?? 0), 0);

  const lastWeekDone = b.weeks.at(-2);
  const doneNow = thisWeek.client + thisWeek.dev;
  const shareOff = doneNow >= 3 && thisWeek.client_share !== null && Math.abs(thisWeek.client_share - b.target) >= 0.15;
  const slipped = cache.slips && !cache.slips.error ? Object.values(cache.slips.slips) : null;
  const repeat = slipped?.filter((x) => x.count >= 2).length ?? null;
  const sweepsNow = lastWeek.filter((r) => r.trigger !== "capture");

  return h("div", { class: "insights" },
    cache.error ? h("div", { class: "banner error" }, cache.error) : "",
    h("div", { class: "tiles" },
      tile("Closed this week", String(doneNow),
        lastWeekDone ? `${lastWeekDone.client + lastWeekDone.dev} last week` : "",
        "Your Linear issues moved to a completed status this week, Monday to Sunday (ET). Canceled issues don't count.",
        "panel-balance"),
      tile("Client share", doneNow ? pct(thisWeek.client_share) : "–", `target ${pct(b.target)}`,
        "Closed client-labeled issues ÷ all closed issues, this week. Flagged when it's 15+ points from the target, once you've closed at least 3.",
        "panel-balance", shareOff ? "warn" : ""),
      tile("Approval rate", allNow && allNow.rate !== null ? pct(allNow.rate) : "–",
        allNow && allNow.approved + allNow.dropped ? `${allNow.approved} of ${allNow.approved + allNow.dropped} kept` : "no decisions yet",
        "Inbox suggestions you approved ÷ (approved + dropped), decided this week. Captured notes aren't counted.",
        "panel-approval"),
      tile("Pushed 2+ times", repeat === null ? "–" : String(repeat),
        cache.slips && !cache.slips.error ? `of ${cache.slips.checked} open with a due date` : "history unavailable",
        "Open issues whose due date was moved later at least twice. Setting a first date, clearing it, or moving it earlier doesn't count.",
        "panel-slips", repeat ? "warn" : ""),
      tile("Sweep cost, 7 days", `$${cost.toFixed(2)}`,
        `${sweepsNow.length} sweep${sweepsNow.length === 1 ? "" : "s"}, ${lastWeek.length - sweepsNow.length} capture${lastWeek.length - sweepsNow.length === 1 ? "" : "s"}`,
        "What the sweeps and captures of the last 7 days cost, at list price.",
        "panel-runs"),
    ),
    h("section", { class: "panel", id: "panel-balance" },
      h("h2", {}, "Client vs dev"),
      h("p", { class: "lead" },
        done8 ? `${pct(client8 / done8)} of the ${done8} issues you completed in the last 8 weeks were client work (target ${pct(b.target)}).`
              : "No completed issues in the last 8 weeks yet.",
        thisWeek.client + thisWeek.dev ? ` This week so far: ${pct(thisWeek.client_share)}.` : ""),
      h("div", { class: "legend" },
        h("span", { class: "key key-client" }), "Client", h("span", { class: "key key-dev" }), "Dev",
        h("span", { class: "key key-target" }), "Target"),
      balanceChart(b),
      h("p", { class: "muted small" }, "Share of your completed (not canceled) Linear issues each week, Monday to Sunday. Client = has a client label."),
    ),
    h("section", { class: "panel", id: "panel-approval" },
      h("h2", {}, "Approval rate"),
      h("p", { class: "lead" }, allNow && allNow.rate !== null
        ? `${pct(allNow.rate)} of the candidates you decided this week were kept (${allNow.approved} of ${allNow.approved + allNow.dropped}).`
        : "No decisions this week yet."),
      approvalChart(a),
      h("div", { class: "two-col" },
        h("div", {}, h("h3", {}, "By source, last 4 weeks"), approvalTable(a)),
        h("div", {}, h("h3", {}, "Why you dropped, 8 weeks"), reasonBars(a)),
      ),
      h("p", { class: "muted small" }, "Approved ÷ (approved + dropped), for candidates decided that week. Captured notes aren't counted."),
    ),
    slipsPanel(cache.slips ?? null),
    h("section", { class: "panel", id: "panel-runs" },
      h("h2", {}, "Sweep history"),
      h("p", { class: "lead" }, `Last 7 days: ${lastWeek.length} runs, $${cost.toFixed(2)} at list price.`,
        sweepCostTrend(cache.runs, ageDays)),
      runsTable(cache.runs.slice(0, 30)),
    ),
  );
}

/** A stat tile; clicking it scrolls to the panel with the detail. The tooltip says how it's counted. */
function tile(label: string, value: string, sub: string, definition: string, target: string, tone = ""): HTMLElement {
  return h("button", {
    class: `tile ${tone}`, title: definition,
    onclick: () => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }),
  }, h("span", { class: "tile-label" }, label), h("b", { class: "tile-value" }, value),
    sub ? h("span", { class: "tile-sub" }, sub) : "");
}

// ---- weekly digest --------------------------------------------------------------------------------
function day(iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return new Date(iso + "T12:00:00").toLocaleDateString([], opts);
}

async function loadDigest(week: number, rerender: () => void) {
  digests.set(week, { ...digests.get(week), at: Date.now() });
  try {
    digests.set(week, { at: Date.now(), data: await api.digest(week) });
  } catch (e) {
    digests.set(week, { at: Date.now(), error: e instanceof ApiError ? e.message : String(e) });
  }
  rerender();
}

function digestText(d: Digest): string {
  const c = d.closed;
  const lines = [`Week of ${day(d.week)}${d.current ? " (so far)" : ""}: ${d.headline}`];
  if (c.total) lines.push(`${c.client} client, ${c.dev} dev (${c.client_share !== null ? Math.round(c.client_share * 100) : 0}% client).`);
  if (d.wins.length) {
    lines.push("", "Closed:");
    for (const w of d.wins) lines.push(`• ${w.identifier} ${w.title}${w.client ? ` (${w.client})` : ""}`);
  }
  if (d.slipping.length || d.overdue.length) {
    lines.push("", "Slipping:");
    for (const x of d.slipping) lines.push(`• ${x.identifier} ${x.title}: pushed ${x.count}×`);
    for (const x of d.overdue) if (!d.slipping.some((s) => s.identifier === x.identifier))
      lines.push(`• ${x.identifier} ${x.title}: due ${day(x.due_date!)}`);
  }
  if (d.recommendations.length) {
    lines.push("", "Next:");
    for (const r of d.recommendations) lines.push(`• ${r.text}`);
  }
  return lines.join("\n");
}

function digestView(rerender: () => void, go: GoTab): HTMLElement {
  const entry = digests.get(digestWeek);
  if (!entry || Date.now() - entry.at > 5 * 60_000) void loadDigest(digestWeek, rerender);
  const nav = h("div", { class: "digest-nav" },
    h("button", { class: "ghost small-btn", disabled: digestWeek >= 8,
      onclick: () => { digestWeek += 1; showAllWins = false; rerender(); } }, "← Previous week"),
    h("button", { class: "ghost small-btn", disabled: digestWeek === 0,
      onclick: () => { digestWeek -= 1; showAllWins = false; rerender(); } }, "Next week →"));
  if (!entry?.data) {
    return h("div", { class: "digest" }, nav,
      h("p", { class: "muted" }, entry?.error ?? "Writing the digest…"));
  }
  const d = entry.data;
  const c = d.closed;
  const wins = showAllWins ? d.wins : d.wins.slice(0, 6);
  const overdueOnly = d.overdue.filter((x) => !d.slipping.some((s) => s.identifier === x.identifier));
  const sources = Object.entries(d.inbox.by_source);
  const decided = d.inbox.approved + d.inbox.dropped;

  return h("article", { class: "digest" },
    h("div", { class: "digest-meta" },
      h("span", {}, `Week of ${day(d.week)} – ${day(d.week_end)}${d.current ? " · so far" : ""}`), nav),
    h("h1", {}, d.headline),
    h("p", { class: "digest-lead" },
      c.total
        ? `You closed ${c.total} issue${c.total === 1 ? "" : "s"}, against ${c.prev_total} the week before. ` +
          `${c.client} ${c.client === 1 ? "was" : "were"} client work (${Math.round((c.client_share ?? 0) * 100)}%), ` +
          `against your ${Math.round(c.target * 100)}% target.`
        : `No issues closed${d.current ? " yet" : ""}; ${c.prev_total} the week before.`,
      d.slipping.length ? ` ${d.slipping.length} open issue${d.slipping.length === 1 ? " keeps" : "s keep"} slipping.` : ""),

    h("section", {},
      h("h2", {}, "Closed"),
      d.wins.length ? h("ul", { class: "digest-list" }, ...wins.map((w) => h("li", {},
        h("span", { class: "dmark good" }, "✓"), link(w.identifier, w.url, "ident"),
        h("span", { class: "dtitle" }, w.title), w.client ? h("span", { class: "dclient" }, w.client) : ""))) :
        h("p", { class: "muted" }, "Nothing yet."),
      d.wins.length > 6 ? h("button", { class: "ghost small-btn", onclick: () => { showAllWins = !showAllWins; rerender(); } },
        showAllWins ? "Show fewer" : `+ ${d.wins.length - 6} more`) : ""),

    d.slipping.length || overdueOnly.length || d.slips_error ? h("section", {},
      h("h2", {}, "Slipping"),
      d.slips_error ? h("p", { class: "muted small" }, `Couldn't read due-date history: ${d.slips_error}`) : "",
      h("ul", { class: "digest-list" },
        ...d.slipping.map((x) => h("li", {}, h("span", { class: "dmark warn" }, "↻"), link(x.identifier, x.url, "ident"),
          h("span", { class: "dtitle" }, x.title),
          h("span", { class: "dclient" }, `pushed ${x.count}× · ${x.days} day${x.days === 1 ? "" : "s"}`))),
        ...overdueOnly.map((x) => h("li", {}, h("span", { class: "dmark bad" }, "!"), link(x.identifier, x.url, "ident"),
          h("span", { class: "dtitle" }, x.title), h("span", { class: "dclient bad" }, `due ${day(x.due_date!)}`))))) : "",

    h("section", {},
      h("h2", {}, "Inbox and sweeps"),
      h("p", {}, decided
        ? `${decided} suggestion${decided === 1 ? "" : "s"} decided, ${d.inbox.approved} approved (${Math.round(d.inbox.approved / decided * 100)}%). ` +
          sources.map(([s, r]) => `${s}: ${r.approved} of ${r.approved + r.dropped} kept`).join(" · ") + "."
        : "No suggestions decided.",
        ` ${d.sweeps.runs} sweep${d.sweeps.runs === 1 ? "" : "s"}, $${d.sweeps.cost_usd.toFixed(2)}.`)),

    d.recommendations.length ? h("section", {},
      h("h2", {}, d.current ? "For next week" : "Suggested then"),
      ...d.recommendations.map((r) => h("div", { class: "rec" }, h("span", {}, r.text),
        r.action === "open"
          ? link(r.label, r.url ?? null, "ghost-link")
          : h("button", { class: "ghost small-btn", onclick: () => go(r.tab!) }, r.label)))) : "",

    h("div", { class: "digest-foot" },
      h("button", { class: "ghost", onclick: () => { mode = "overview"; savePref("todohub.insightsView", mode); rerender(); } },
        "Open charts"),
      h("span", { class: "spacer" }),
      h("button", { class: "primary", onclick: async (e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement;
        try { await navigator.clipboard.writeText(digestText(d)); btn.textContent = "Copied"; }
        catch { btn.textContent = "Couldn't copy"; }
        setTimeout(() => { btn.textContent = "Copy as Slack update"; }, 1500);
      } }, "Copy as Slack update")),
    h("p", { class: "muted small digest-def" },
      "Closed: your Linear issues completed that week, Monday to Sunday (ET); canceled ones don't count. " +
      "Client share: closed client-labeled issues ÷ all closed. Inbox: suggestions approved or dropped that week, not captured notes. " +
      "Slipping: open issues whose due date was moved later two or more times (all-time history), and open issues past due."),
  );
}

export function insightsView(rerender: () => void, go: GoTab): HTMLElement {
  const btn = (id: "overview" | "digest", label: string) => h("button", {
    class: mode === id ? "on" : "", "aria-pressed": String(mode === id),
    onclick: () => { mode = id; savePref("todohub.insightsView", id); rerender(); },
  }, label);
  return h("div", { class: "insights-wrap" },
    h("div", { class: "toolbar insights-bar" },
      h("h1", {}, "Insights"),
      h("span", { class: "spacer" }),
      h("div", { class: "seg", role: "group", "aria-label": "Insights view" },
        btn("overview", "Overview"), btn("digest", "Weekly digest"))),
    mode === "digest" ? digestView(rerender, go) : overview(rerender));
}

export function invalidateInsights() {
  cache = { ...cache, at: 0 };
  digests.clear();
}
