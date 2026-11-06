import { openUrl } from "@tauri-apps/plugin-opener";
import { api, ApiError, waitForBackend } from "./api";
import { h, link, modal, svg } from "./dom";
import { insightsView, invalidateInsights } from "./insights";
import { notifyNew, notifyOnce, onDesktopEvent, setTrayCount } from "./desktop";
import { applyTheme, currentTheme, nextTheme, onDaylightPhase, setTheme, themeIcon, themeLabel, themeOptions } from "./theme";
import { setDaylightLocation } from "./daylight";
import { CATEGORIES, CATEGORY_NAME, categoryIcon, clientLogo, ensureLogos, taskAvatar } from "./avatars";
import type { Category } from "./avatars";

applyTheme();
import type { BalanceStats, Brief, Candidate, Handled, SourceOverview, Slip, Slips, CandidateEdit, DropReason, Issue, MuteKey, MuteRule, IssuePreview, Meta, Run, Source, Subtask, TodayItem } from "./api";

type Tab = "inbox" | "today" | "client" | "dev" | "insights";

const PRIORITIES = [
  { value: 1, name: "Urgent" },
  { value: 2, name: "High" },
  { value: 3, name: "Medium" },
  { value: 4, name: "Low" },
  { value: 0, name: "No priority" },
];
const SOURCE_NAME: Record<Source, string> = {
  slack: "Slack", gmail: "Email", grain: "Grain", calendar: "Calendar", linear: "Linear", github: "GitHub",
  hubspot: "HubSpot", manual: "Captured",
};
const SIGNAL_NAME = {
  ask: "Asked of you", commitment: "You committed", action_item: "Action item", deadline: "Deadline", manual: "Your note",
  waiting_on: "Waiting on", done: "Looks done", update: "Issue update", meeting_prep: "Meeting prep",
  review_request: "Review requested", mention: "Mentioned you",
};
const SCHEDULE_HOURS = [8, 10, 12, 14, 16];
const KIND_NAME: Record<string, string | undefined> = {
  waiting: "Waiting on", close: "Looks done", comment: "Issue update",
};

const state = {
  tab: "inbox" as Tab,
  filter: "",
  meta: null as Meta | null,
  candidates: [] as Candidate[],
  issues: [] as Issue[],
  issuesLoaded: false,
  today: [] as TodayItem[],
  snoozed: [] as Candidate[],
  showSnoozed: false,
  mutes: [] as MuteRule[],
  showMutes: false,
  selected: new Set<number>(),
  focus: null as number | null,
  run: {} as Run,
  drafts: new Map<number, CandidateEdit>(),
  busy: new Set<string>(),
  error: null as string | null,
  brief: null as Brief | null,
  balance: null as BalanceStats | null,
  slips: null as Slips | null,
  slipsAt: 0,
  briefAt: 0,
  briefMode: null as "morning" | "evening" | null,   // null: by time of day
  /** By client/project or by status, chosen separately for Client and Dev and remembered on this Mac. */
  listLayout: {
    client: layoutPref("todohub.clientView"),
    dev: layoutPref("todohub.devView"),
  } as Record<"client" | "dev", "group" | "status">,
  showBacklog: false,
  fullBrief: false,
  balanceOpen: false,                 // the "work behind this week" popover on the brief tiles
  carriedTo: null as string | null,
  todaySel: null as string | null,     // Today list: the issue open in the reading pane    // wrap-up: the day "Move N to …" last moved items to                    // morning brief: show the four sections under the summary
  todayLayout: (loadPref("todohub.todayView") === "checklist" ? "checklist" : "brief") as "brief" | "checklist",
  allClients: false,                  // sidebar: list every client, not just the first few
  pickedClient: null as string | null, // the client the sidebar filtered the Client tab to
};

/** Per-machine UI choices. Storage can be unavailable; the app then just uses the defaults. */
function loadPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
/** "board" is the old name for the by-status layout. */
function layoutPref(key: string): "group" | "status" {
  const v = loadPref(key);
  return v === "status" || v === "board" ? "status" : "group";
}
function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* not remembered */ }
}

// ---- formatting -----------------------------------------------------------------------------
function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + ` ${time}`;
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dueClass(due: string | null): string {
  if (!due) return "";
  const today = localToday();
  return due < today ? "overdue" : due === today ? "due-today" : "";
}

/** The next scheduled sweep, short enough for the sidebar: "4pm" today, else "Fri 8am". */
function nextSweep(): string {
  const d = nextSweepAt();
  if (!d) return "";
  const hour = `${d.getHours() % 12 || 12}${d.getHours() < 12 ? "am" : "pm"}`;
  return d.toDateString() === new Date().toDateString() ? hour
    : `${d.toLocaleDateString([], { weekday: "short" })} ${hour}`;
}

function nextSweepAt(): Date | null {
  const now = new Date();
  for (let add = 0; add < 8; add++) {
    const d = new Date(now);
    d.setDate(now.getDate() + add);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    for (const hour of SCHEDULE_HOURS) {
      d.setHours(hour, 0, 0, 0);
      if (d > now) return d;
    }
  }
  return null;
}

// ---- toasts ---------------------------------------------------------------------------------
interface ToastAction { label: string; run: () => void; kbd?: string }

function toast(message: string, action?: ToastAction | ToastAction[], error = false, ms?: number): HTMLElement {
  const box = document.querySelector(".toasts")!;
  const t = h("div", { class: `toast${error ? " error" : ""}` }, h("span", {}, message));
  for (const a of action ? [action].flat() : []) {
    t.append(h("button", { class: "ghost", onclick: () => { a.run(); t.remove(); } },
      a.label, a.kbd ? h("kbd", {}, a.kbd) : ""));
  }
  box.append(t);
  setTimeout(() => t.remove(), ms ?? (error ? 9000 : 6000));
  return t;
}

// ---- undo -----------------------------------------------------------------------------------
// Every action that changes Linear or takes a card out of the Inbox offers Undo in its banner,
// and ⌘Z undoes the most recent ones, one at a time, for 10 minutes.
interface UndoEntry { done: string; run: () => Promise<void>; at: number; banner?: HTMLElement }
const undoStack: UndoEntry[] = [];
const UNDO_FOR_MS = 10 * 60_000;
let undoing = false;

/** Show the banner for an action and remember how to reverse it. */
function offerUndo(message: string, done: string, run: () => Promise<void>, extra?: ToastAction) {
  const entry: UndoEntry = { done, run, at: Date.now() };
  undoStack.push(entry);
  if (undoStack.length > 20) undoStack.shift();
  entry.banner = toast(message, [...(extra ? [extra] : []), { label: "Undo", kbd: "⌘Z", run: () => void undo(entry) }],
    false, 9000);
}

async function undo(entry?: UndoEntry) {
  if (undoing) return;
  const fresh = (e: UndoEntry) => Date.now() - e.at < UNDO_FOR_MS;
  entry = entry ?? [...undoStack].reverse().find(fresh);
  if (!entry || !fresh(entry)) { toast("Nothing to undo"); return; }
  undoStack.splice(undoStack.indexOf(entry), 1);
  entry.banner?.remove();
  undoing = true;
  try {
    await entry.run();
    toast(`Undone: ${entry.done}`);
  } catch (e) {
    undoStack.push(entry);        // keep it so ⌘Z can retry
    fail(e);
  } finally {
    undoing = false;
    render();
  }
}

/** Undo approvals and drops: each candidate goes back to the Inbox. */
async function undoDecisions(ids: number[], reloadIssues: boolean) {
  const problems: string[] = [];
  for (const id of ids) {
    try {
      const { warnings } = await api.undo(id);
      problems.push(...warnings);
    } catch (e) {
      problems.push(e instanceof ApiError ? e.message : String(e));
    }
  }
  await loadCandidates();
  if (reloadIssues && state.issuesLoaded) await loadIssues().catch(() => undefined);
  for (const w of problems) toast(w, undefined, true);
}

function fail(e: unknown) {
  toast(e instanceof ApiError ? e.message : String(e), undefined, true);
}

// ---- data -----------------------------------------------------------------------------------
async function loadCandidates() {
  const [pending, snoozed, mutes] = await Promise.all([api.candidates(), api.candidates("snoozed"),
    api.mutes().catch(() => state.mutes)]);
  state.candidates = pending;
  state.snoozed = snoozed;
  state.mutes = mutes;
  const ids = new Set(pending.map((c) => c.id));
  for (const id of state.selected) if (!ids.has(id)) state.selected.delete(id);
  if (state.focus !== null && !ids.has(state.focus)) state.focus = null;
  setTrayCount(pending.length);
  void notifyNew(pending);
}

async function loadIssues() {
  state.issues = await api.issues();
  state.issuesLoaded = true;
}

async function loadToday() {
  state.today = (await api.today()).items;
}

async function loadRun() {
  const before = state.run.status;
  state.run = await api.latestRun();
  if (before === "running" && state.run.status !== "running") {
    invalidateInsights();
    await loadCandidates();
    const n = state.candidates.length;
    if (state.run.status === "ok") toast(`Sweep finished. ${n} task${n === 1 ? "" : "s"} to review.`);
    else toast(`Sweep failed: ${state.run.error ?? "unknown error"}`, undefined, true);
  }
}

function editing(): boolean {
  const a = document.activeElement;
  return !!a && a.closest("main") !== null && ["INPUT", "SELECT", "TEXTAREA"].includes(a.tagName);
}

/** ``meta``: "keep" uses what's loaded; "reload" asks the backend again (its copy is at most
 *  10 minutes old); "force" re-reads labels, projects and statuses from Linear, and re-checks
 *  the Inbox against Linear for suggestions handled there by hand. */
async function refresh(all = false, meta: "keep" | "reload" | "force" = "keep") {
  try {
    // Linear may be unreachable (no key yet, offline); the queue still works without it.
    if (!state.meta || meta !== "keep") state.meta = await api.meta(meta === "force");
    if (meta === "force") await api.recheck().catch(() => undefined);
    await Promise.all([loadCandidates(), loadRun(), loadToday(), all || state.tab !== "inbox" ? loadIssues() : null]);
    state.error = null;
  } catch (e) {
    state.error = e instanceof ApiError ? e.message : String(e);
    await Promise.allSettled([loadCandidates(), loadRun()]);
  }
  if (!editing()) render();
}

let pollTimer: number | undefined;
function pollWhileRunning() {
  clearTimeout(pollTimer);
  if (state.run.status !== "running") return;
  pollTimer = window.setTimeout(async () => {
    try {
      await loadRun();
    } catch {
      /* keep polling */
    }
    renderHeader();
    if (state.run.status !== "running") render();
    pollWhileRunning();
  }, 3000);
}

// ---- actions --------------------------------------------------------------------------------
function draft(c: Candidate): CandidateEdit {
  if (!state.drafts.has(c.id)) state.drafts.set(c.id, {});
  return state.drafts.get(c.id)!;
}

async function approve(c: Candidate, opts: { quiet?: boolean } = {}) {
  const key = `c${c.id}`;
  if (state.busy.has(key)) return;
  state.busy.add(key);
  render();
  try {
    const edit = { ...(state.drafts.get(c.id) ?? {}) };
    if (edit.subtasks) edit.subtasks = edit.subtasks.filter((s) => s.title.trim());
    const { candidate, issue, subtasks, warnings } = await api.approve(c.id, edit);
    state.drafts.delete(c.id);
    state.candidates = state.candidates.filter((x) => x.id !== c.id);
    // Bulk approvals skip the swipe so a batch doesn't take seconds.
    if (!opts.quiet) await swipeAway(c.id);
    const added = new Set([issue.id, ...subtasks.map((s) => s.id)]);
    state.issues = [issue, ...subtasks, ...state.issues.filter((i) => !added.has(i.id))];
    const extra = subtasks.length ? ` with ${subtasks.length} subtask${subtasks.length === 1 ? "" : "s"}` : "";
    const verb = c.kind === "close" ? "Closed" : c.kind === "comment" ? "Updated" : "Created";
    if (c.kind === "close") state.issues = state.issues.filter((i) => i.id !== issue.id);
    const ident = candidate.linear_identifier;
    const done = c.kind === "close" ? `${ident} reopened and back in the Inbox`
      : c.kind === "comment" ? `update removed from ${ident}, back in the Inbox`
      : `${ident} moved to Linear's trash, task back in the Inbox`;
    if (!opts.quiet) offerUndo(`${verb} ${ident}${extra}`, done, () => undoDecisions([c.id], true),
      { label: "Open", run: () => void openUrl(candidate.linear_url!) });
    for (const w of warnings) toast(w, undefined, true);
  } catch (e) {
    if (opts.quiet) throw e;
    fail(e);
  } finally {
    state.busy.delete(key);
    render();
  }
}

/** Add a possible duplicate to the issue it duplicates: a comment, its links and its subtasks. */
async function merge(c: Candidate) {
  const key = `c${c.id}`;
  if (state.busy.has(key) || !c.possible_duplicate) return;
  state.busy.add(key);
  render();
  try {
    const edit = { ...(state.drafts.get(c.id) ?? {}) };
    if (edit.subtasks) edit.subtasks = edit.subtasks.filter((s) => s.title.trim());
    const { issue, subtasks, warnings } = await api.merge(c.id, edit);
    state.drafts.delete(c.id);
    state.candidates = state.candidates.filter((x) => x.id !== c.id);
    await swipeAway(c.id);
    const added = new Set(subtasks.map((s) => s.id));
    state.issues = [...subtasks, ...state.issues.filter((i) => !added.has(i.id))];
    previews.delete(issue.identifier);     // it has a new comment now
    const extra = subtasks.length ? ` with ${subtasks.length} subtask${subtasks.length === 1 ? "" : "s"}` : "";
    offerUndo(`Merged into ${issue.identifier}${extra}`,
      `merge into ${issue.identifier} removed, task back in the Inbox`, () => undoDecisions([c.id], true),
      { label: "Open", run: () => void openUrl(issue.url) });
    for (const w of warnings) toast(w, undefined, true);
  } catch (e) {
    fail(e);
  } finally {
    state.busy.delete(key);
    render();
  }
}

/** The card swipes off with a slight tilt, then the list closes the gap: green and to the right
 *  when approved, red and to the left when dropped. */
async function swipeAway(id: number, way: "approve" | "drop" = "approve") {
  const card = document.querySelector<HTMLElement>(`.cards > .card[data-id="${id}"]`);
  if (!card) return;
  card.classList.remove("busy", "focused");
  card.classList.add(way === "approve" ? "approved" : "dropped");
  if (way === "approve") {
    const button = card.querySelector<HTMLElement>(".card-actions button.primary");
    if (button) button.textContent = "✓ Done";
  }
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    if (calm) {
      await card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }).finished;
    } else {
      await new Promise((r) => setTimeout(r, 140));   // let the green state register
      // Slide off the window's edge, tilting as it goes: right for approve, left for drop.
      const box = card.getBoundingClientRect();
      const sign = way === "approve" ? 1 : -1;
      const distance = sign * (way === "approve" ? window.innerWidth - box.left : box.right) + sign * 40;
      card.style.transformOrigin = "50% 100%";
      await card.animate(
        [
          { transform: "translateX(0) rotate(0deg)", opacity: 1 },
          { transform: `translateX(${Math.round(distance * 0.6)}px) rotate(${5 * sign}deg)`, opacity: 1, offset: 0.6 },
          { transform: `translateX(${Math.round(distance)}px) rotate(${9 * sign}deg)`, opacity: 0 },
        ],
        { duration: 420, easing: "cubic-bezier(0.5, 0, 0.85, 0.45)", fill: "forwards" },
      ).finished;
    }
    const height = card.offsetHeight;
    card.style.overflow = "hidden";
    await card.animate(
      [
        { height: `${height}px`, marginBottom: "0px", paddingTop: "12px", paddingBottom: "12px", borderWidth: "1px" },
        { height: "0px", marginBottom: "-10px", paddingTop: "0px", paddingBottom: "0px", borderWidth: "0px" },
      ],
      { duration: calm ? 1 : 200, easing: "ease-out", fill: "forwards" },
    ).finished;
  } catch {
    /* the list was redrawn mid-animation; nothing to finish */
  }
}

const DROP_REASONS: { value: DropReason; label: string; hint: string }[] = [
  { value: "not_mine", label: "Not mine", hint: "Someone else's task" },
  { value: "already_done", label: "Already done", hint: "Handled before it was proposed" },
  { value: "noise", label: "Not a task", hint: "FYI, thanks, notification" },
  { value: "duplicate", label: "Duplicate", hint: "Already in Linear or the Inbox" },
  { value: "other", label: "Other", hint: "" },
];

async function drop(c: Candidate, reason: DropReason = "other") {
  try {
    await api.drop(c.id, reason);
    state.candidates = state.candidates.filter((x) => x.id !== c.id);
    await swipeAway(c.id, "drop");
    render();
    offerUndo(`Dropped "${c.title}"`, `"${c.title}" is back in the Inbox`, () => undoDecisions([c.id], false));
    void suggestMute(c);
  } catch (e) {
    fail(e);
  }
}

async function editIssue(issue: Issue, change: Parameters<typeof api.editIssue>[1]) {
  try {
    const updated = await api.editIssue(issue.id, change);
    const status = state.meta?.states.find((s) => s.id === updated.state.id);
    const closed = !!status && (status.type === "completed" || status.type === "canceled");
    state.issues = closed ? state.issues.filter((i) => i.id !== issue.id)
      : state.issues.map((i) => (i.id === issue.id ? updated : i));
    // The reverse change: put back whatever this edit replaced.
    const before: Parameters<typeof api.editIssue>[1] = {};
    if ("state_id" in change) before.state_id = issue.state.id;
    if ("priority" in change) before.priority = issue.priority;
    if ("due_date" in change) before.due_date = issue.due_date;
    const what = "state_id" in change ? `moved to ${status?.name ?? updated.state.name}`
      : "priority" in change ? `priority set to ${priorityName(updated.priority)}`
      : updated.due_date ? `due ${updated.due_date}` : "due date cleared";
    offerUndo(`${issue.identifier} ${what}`, `${issue.identifier} change reverted`, async () => {
      const restored = await api.editIssue(issue.id, before);
      state.issues = state.issues.some((i) => i.id === issue.id)
        ? state.issues.map((i) => (i.id === issue.id ? restored : i))
        : [restored, ...state.issues];
    });
  } catch (e) {
    fail(e);
  }
  render();
}

function priorityName(value: number): string {
  return state.meta?.priorities.find((p) => p.value === value)?.name ?? String(value);
}

async function runNow(source?: Source) {
  try {
    await api.runNow(source);
    state.run = { ...state.run, status: "running", started_at: new Date().toISOString(), scope: source ?? null };
    renderHeader();
    setTimeout(async () => {
      await loadRun().catch(() => undefined);
      renderHeader();
      pollWhileRunning();
    }, 1500);
  } catch (e) {
    fail(e);
  }
}

// ---- controls -------------------------------------------------------------------------------
// ---- status and priority pills --------------------------------------------------------------
const PRIO_CLASS: Record<number, string> = { 1: "p-urgent", 2: "p-high", 3: "p-med", 4: "p-low", 0: "p-none" };

function statusClass(st: { name: string; type: string }): string {
  if (st.type === "backlog") return "s-backlog";
  if (st.type === "started") return "s-prog";
  if (st.type === "completed") return "s-done";
  if (st.type === "canceled") return "s-cancel";
  const waiting = state.brief?.waiting_state ?? "Pending";
  return st.name === waiting || /^(pending|waiting|blocked)/i.test(st.name) ? "s-pend" : "s-todo";
}

type PillOption<T> = { value: T; label: string; cls: string };

/** A colored pill that opens a small menu (number keys pick). It updates itself on a choice, so
 *  it works inside cards that aren't re-rendered. */
function pillMenu<T>(title: string, options: PillOption<T>[], value: T, onChange: (v: T) => void, dot: boolean): HTMLElement {
  let cur = options.find((o) => o.value === value) ?? options[0];
  const face = (o: PillOption<T>) => [dot && o.cls !== "s-backlog" && o.cls !== "s-done" && o.cls !== "s-cancel" ? h("span", { class: "pdot" }) : "",
    o.cls === "s-done" ? "✓ " : "", o.label] as (Node | string)[];
  const summary = h("summary", { class: `pill ${cur.cls}`, title, "aria-label": `${title}: ${cur.label}` });
  const paint = () => {
    summary.className = `pill ${cur.cls}`;
    summary.setAttribute("aria-label", `${title}: ${cur.label}`);
    summary.replaceChildren(...face(cur).filter((x) => x !== ""), h("span", { class: "caret" }, "▾"));
  };
  paint();
  const menu = h("details", { class: "drop-menu pill-menu" }, summary,
    h("div", { class: "menu", role: "menu" }, ...options.map((o, n) => h("button", {
      type: "button", role: "menuitemradio", "aria-checked": String(o.value === cur.value),
      class: o.value === cur.value ? "on" : "",
      onclick: (e: Event) => {
        e.preventDefault();
        (menu as HTMLDetailsElement).open = false;
        if (o.value === cur.value) return;
        cur = o;
        paint();
        onChange(o.value);
      },
    }, h("span", { class: `pill ${o.cls}` }, ...face(o).filter((x) => x !== "")), n < 9 ? h("kbd", {}, String(n + 1)) : ""))));
  return menu;
}

function priorityPill(value: number, onChange: (v: number) => void): HTMLElement {
  return pillMenu("Priority", PRIORITIES.map((p) => ({ value: p.value, label: p.value === 0 ? "No priority" : p.name, cls: PRIO_CLASS[p.value] })),
    value, onChange, false);
}

function statusPill(i: Issue, onChange: (stateId: string) => void): HTMLElement {
  const states = (state.meta?.states ?? [i.state]).filter((st) => st.type !== "canceled" || st.id === i.state.id);
  return pillMenu("Status", states.map((st) => ({ value: st.id, label: st.name, cls: statusClass(st) })), i.state.id, onChange, true);
}

/** A small read-only pill: priority in a meta line, only for Urgent and High. */
function priorityTag(p: number): HTMLElement | "" {
  return p === 1 || p === 2 ? h("span", { class: `pill ${PRIO_CLASS[p]}` }, p === 1 ? "Urgent" : "High") : "";
}


function clientSelect(value: string | null, onChange: (v: string | null) => void) {
  const labels = state.meta?.client_labels ?? [];
  return h(
    "select",
    { class: "client", title: "Client label", onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value || null) },
    h("option", { value: "", selected: !value }, "Dev / internal"),
    ...labels.map((l) => h("option", { value: l, selected: l === value }, l)),
  );
}

function projectSelect(value: string | null, onChange: (v: string | null) => void) {
  const projects = state.meta?.projects ?? [];
  return h(
    "select",
    { class: "project", title: "Linear project", onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value || null) },
    h("option", { value: "", selected: !value }, "No project"),
    ...projects.map((p) => h("option", { value: p, selected: p === value }, p)),
  );
}

function dateInput(value: string | null, onChange: (v: string | null) => void, cls = "") {
  return h("input", {
    type: "date",
    class: `date ${cls}`,
    value: value ?? "",
    title: "Due date",
    onchange: (e: Event) => onChange((e.target as HTMLInputElement).value || null),
  });
}

// ---- views ----------------------------------------------------------------------------------
function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function linksRow(c: Candidate): HTMLElement | null {
  if (!c.source_url && !c.links.length) return null;
  return h(
    "div",
    { class: "links" },
    c.source_url && link(c.source === "manual" ? "Open link ↗" : `Open in ${SOURCE_NAME[c.source]} ↗`,
      c.source_url, "link source-link"),
    ...c.links.map((l) =>
      h("span", { class: "res" }, link(l.title, l.url, "link"), h("span", { class: "muted small" }, host(l.url))),
    ),
  );
}

/** Editable subtask list. Edits live in the card's draft until Approve. */
function subtaskEditor(c: Candidate, d: CandidateEdit): HTMLElement {
  const box = h("div", { class: "subtasks" });
  const items = (): Subtask[] => (d.subtasks ??= c.subtasks.map((s) => ({ ...s })));
  const draw = () => {
    const list = d.subtasks ?? c.subtasks;
    box.replaceChildren(
      list.length ? h("div", { class: "sub-head muted small" }, `Subtasks (${list.length}), created as sub-issues`) : "",
      ...list.map((s, idx) =>
        h("div", { class: "sub-row" },
          h("span", { class: "sub-bullet" }),
          h("input", {
            class: "sub-title", value: s.title, placeholder: "Subtask", "aria-label": `Subtask ${idx + 1}`,
            oninput: (e: Event) => { items()[idx].title = (e.target as HTMLInputElement).value; },
          }),
          dateInput(s.due_date, (v) => { items()[idx].due_date = v; }),
          h("button", {
            class: "icon", title: "Remove subtask", "aria-label": "Remove subtask",
            onclick: () => { items().splice(idx, 1); draw(); },
          }, "×"),
        ),
      ),
      h("button", {
        class: "add-sub", onclick: () => {
          items().push({ title: "", due_date: null });
          draw();
          (box.querySelectorAll<HTMLInputElement>(".sub-title")[items().length - 1])?.focus();
        },
      }, "+ Add subtask"),
    );
  };
  draw();
  return box;
}

// ---- snooze, selection, bulk -------------------------------------------------------------------
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function snoozeChoices(): { label: string; until: string }[] {
  const d = new Date();
  const tomorrow = new Date(d); tomorrow.setDate(d.getDate() + 1);
  const monday = new Date(d); monday.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  const week = new Date(d); week.setDate(d.getDate() + 7);
  return [
    { label: "Tomorrow", until: isoDay(tomorrow) },
    { label: "Next Monday", until: isoDay(monday) },
    { label: "In a week", until: isoDay(week) },
  ];
}

async function snooze(c: Candidate, until: string | null) {
  try {
    await api.snooze(c.id, until);
    await loadCandidates();
    render();
    if (until) {
      offerUndo(`Snoozed until ${new Date(until + "T12:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}`,
        `"${c.title}" is back in the Inbox`, async () => { await api.snooze(c.id, null); await loadCandidates(); });
    }
  } catch (e) {
    fail(e);
  }
}

function snoozeMenu(c: Candidate, busy: boolean): HTMLElement {
  const pick = h("input", { type: "date", class: "date", min: isoDay(new Date(Date.now() + 864e5)), "aria-label": "Snooze until" });
  const menu = h("details", { class: "drop-menu snooze-menu" },
    h("summary", { class: `ghost-btn${busy ? " disabled" : ""}`, title: "Hide until a later day" }, "Snooze ▾"),
    h("div", { class: "menu", role: "menu" },
      ...snoozeChoices().map((o, i) =>
        h("button", { role: "menuitem", onclick: () => { menu.open = false; void snooze(c, o.until); } },
          h("span", {}, o.label), h("kbd", {}, String(i + 1)))),
      h("div", { class: "menu-pick" }, pick,
        h("button", { class: "ghost small-btn", onclick: () => { if (pick.value) { menu.open = false; void snooze(c, pick.value); } } }, "Snooze")),
    ),
  );
  return menu;
}

function toggleSelect(id: number) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  render();
}

async function bulk(action: "approve" | "drop", reason: DropReason = "other") {
  const picked = state.candidates.filter((c) => state.selected.has(c.id));
  const done: number[] = [];
  for (const c of picked) {
    try {
      if (action === "approve") await approve(c, { quiet: true });
      else await api.drop(c.id, reason);
      done.push(c.id);
    } catch (e) {
      fail(e);
    }
  }
  state.selected.clear();
  await loadCandidates();
  render();
  const message = `${action === "approve" ? "Approved" : "Dropped"} ${done.length} of ${picked.length}`;
  if (!done.length) { toast(message); return; }
  offerUndo(message, `${done.length} task${done.length === 1 ? "" : "s"} back in the Inbox`,
    () => undoDecisions(done, action === "approve"));
}

function bulkBar(): HTMLElement | "" {
  if (!state.selected.size) return "";
  const drop = h("details", { class: "drop-menu" },
    h("summary", { class: "ghost-btn" }, "Drop all ▾"),
    h("div", { class: "menu" }, ...DROP_REASONS.map((r) =>
      h("button", { onclick: () => { drop.open = false; void bulk("drop", r.value); } }, h("span", {}, r.label)))));
  return h("div", { class: "bulk" },
    h("span", {}, `${state.selected.size} selected`),
    h("span", { class: "spacer" }),
    h("button", { class: "ghost", onclick: () => { state.selected.clear(); render(); } }, "Clear"),
    drop,
    h("button", { class: "primary", onclick: () => void bulk("approve") }, `Approve ${state.selected.size}`),
  );
}

function snoozedList(): HTMLElement | "" {
  if (!state.snoozed.length) return "";
  const toggle = h("button", { class: "link-btn", onclick: () => { state.showSnoozed = !state.showSnoozed; render(); } },
    state.showSnoozed ? "Hide" : "Show");
  return h("div", { class: "snoozed" },
    h("div", { class: "muted small" }, `${state.snoozed.length} snoozed `, toggle),
    state.showSnoozed && h("div", { class: "snoozed-list" }, ...state.snoozed.map((c) =>
      h("div", { class: "snoozed-row" },
        h("span", {}, c.title),
        h("span", { class: "muted small" }, `until ${c.snooze_until}`),
        h("button", { class: "ghost small-btn", onclick: () => void snooze(c, null) }, "Bring back")))),
  );
}

// ---- mute rules ---------------------------------------------------------------------------------
const MUTE_KIND = { sender: "Sender", channel: "Slack channel", repo: "GitHub repo" } as const;

/** After a drop: if this sender, channel or repo keeps getting dropped, offer to mute it. */
async function suggestMute(c: Candidate) {
  try {
    const { suggestion: s } = await api.muteSuggestion(c.id);
    if (!s) return;
    toast(`You've dropped ${s.drops} from ${s.label} in the last 30 days. Stop proposing them?`, [
      { label: `Mute ${s.label}`, run: () => void mute(s) },
      { label: "Not now", run: () => void api.declineMute(s).catch(() => undefined) },
    ], false, 15000);
  } catch {
    /* a suggestion is a nicety; never get in the way of the drop */
  }
}

/** Mute a key, and drop what's already waiting from it. Undo brings both back. */
async function mute(key: MuteKey, alsoDrop: Candidate | null = null) {
  try {
    if (alsoDrop) {
      await api.drop(alsoDrop.id, "noise");
      state.candidates = state.candidates.filter((x) => x.id !== alsoDrop.id);
      await swipeAway(alsoDrop.id, "drop");
    }
    const { rule, dropped_ids } = await api.addMute(key);
    await loadCandidates();
    render();
    const back = [...(alsoDrop ? [alsoDrop.id] : []), ...dropped_ids];
    const more = dropped_ids.length ? ` and dropped ${dropped_ids.length} more from it` : "";
    offerUndo(`${alsoDrop ? "Dropped and muted" : "Muted"} ${key.label}${more}`,
      `${key.label} unmuted${back.length ? `, ${back.length} card${back.length === 1 ? "" : "s"} back in the Inbox` : ""}`,
      async () => {
        await api.deleteMute(rule.id);
        if (back.length) await undoDecisions(back, false);
        else await loadCandidates();
      });
  } catch (e) {
    fail(e);
  }
}

async function unmute(rule: MuteRule) {
  try {
    await api.deleteMute(rule.id);
    state.mutes = state.mutes.filter((r) => r.id !== rule.id);
    render();
    offerUndo(`Unmuted ${rule.label}`, `${rule.label} muted again`, async () => {
      await api.addMute(rule, false);
      await loadCandidates();
    });
  } catch (e) {
    fail(e);
  }
}

function mutedList(): HTMLElement | "" {
  if (!state.mutes.length) return "";
  const toggle = h("button", { class: "link-btn", onclick: () => { state.showMutes = !state.showMutes; render(); } },
    state.showMutes ? "Hide" : "Show");
  return h("div", { class: "snoozed" },
    h("div", { class: "muted small" }, `${state.mutes.length} muted `, toggle),
    state.showMutes && h("div", { class: "snoozed-list" }, ...state.mutes.map((r) =>
      h("div", { class: "snoozed-row" },
        h("span", {}, r.label),
        h("span", { class: "muted small" }, `${MUTE_KIND[r.kind]}${r.kind === "sender" ? ` (${SOURCE_NAME[r.source]})` : ""}`),
        h("span", { class: "muted small" }, r.blocked ? `blocked ${r.blocked}` : "nothing blocked yet"),
        h("button", { class: "ghost small-btn", onclick: () => void unmute(r) }, "Unmute")))),
  );
}

/** Drop asks why, so the sweep can learn what to stop proposing. */
function dropMenu(c: Candidate, busy: boolean): HTMLElement {
  const menu = h("details", { class: "drop-menu" },
    h("summary", { class: `ghost-btn${busy ? " disabled" : ""}`, title: "Drop, and say why" }, "Drop ▾"),
    h("div", { class: "menu", role: "menu" },
      ...DROP_REASONS.map((r, i) =>
        h("button", {
          role: "menuitem", title: r.hint,
          onclick: () => { menu.open = false; void drop(c, r.value); },
        }, h("span", {}, r.label), h("kbd", {}, String(i + 1)))),
      ...(c.mute_keys ?? []).map((k, i) => h("button", {
        role: "menuitem", class: `mute-item${i === 0 ? " first" : ""}`,
        title: `Drop this and stop proposing anything from ${k.label} (${MUTE_KIND[k.kind].toLowerCase()})`,
        onclick: () => { menu.open = false; void mute(k, c); },
      }, h("span", {}, `Drop and mute ${k.label}`))),
    ),
  );
  return menu;
}

/** The card's icon doubles as a menu: pick the right task type when the sweep guessed wrong. */
function typeMenu(c: Candidate): HTMLElement {
  const current = (c.category && c.category in CATEGORY_NAME ? c.category : "admin") as Category;
  const menu = h("details", { class: "drop-menu type-menu" },
    h("summary", { title: `${CATEGORY_NAME[current]}. Click to change the type`, "aria-label": "Change the task type" },
      taskAvatar(c.client_label, current, "lg")),
    h("div", { class: "menu", role: "menu" },
      h("div", { class: "menu-head muted small" }, "Task type"),
      ...CATEGORIES.map((cat) => h("button", {
        role: "menuitemradio", "aria-checked": String(cat === current), class: cat === current ? "on" : "",
        onclick: () => { menu.open = false; if (cat !== current) void setCategory(c, cat); },
      }, h("span", { class: `type-swatch cat-${cat}` }, categoryIcon(cat, 13)), h("span", {}, CATEGORY_NAME[cat]),
        cat === current ? h("span", { class: "check" }, "✓") : ""))));
  return menu;
}

async function setCategory(c: Candidate, category: Category) {
  const before = c.category;
  try {
    const updated = await api.editCandidate(c.id, { category });
    state.candidates = state.candidates.map((x) => (x.id === c.id ? { ...x, category: updated.category } : x));
    render();
    offerUndo(`Type set to ${CATEGORY_NAME[category]}`, "type change reverted", async () => {
      const back = await api.editCandidate(c.id, { category: (before as Category) ?? null });
      state.candidates = state.candidates.map((x) => (x.id === c.id ? { ...x, category: back.category } : x));
    });
  } catch (e) {
    fail(e);
  }
}

function candidateCard(c: Candidate): HTMLElement {
  const card = candidateCardBody(c);
  const body = h("div", { class: "card-body" });
  body.append(...Array.from(card.childNodes));
  card.append(typeMenu(c), body);
  return card;
}

// ---- reply drafts -------------------------------------------------------------------------------
const openReplies = new Set<number>();

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h("textarea", { value: text, style: "position:fixed;opacity:0" });
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** The reply the sweep drafted for an ask: edit it, then copy it or save it as a Gmail draft. */
function replyBox(c: Candidate, d: CandidateEdit): HTMLElement {
  const text = () => (d.reply_draft ?? c.reply_draft ?? "").trim();
  const busyKey = `r${c.id}`;
  const saving = state.busy.has(busyKey);
  const area = h("textarea", {
    class: "reply-input", rows: 3, value: d.reply_draft ?? c.reply_draft ?? "", "aria-label": "Draft reply",
    oninput: (e: Event) => { d.reply_draft = (e.target as HTMLTextAreaElement).value; },
  });
  const copy = async (thenOpen: boolean) => {
    if (!text()) return;
    if (await copyText(text())) toast(thenOpen ? "Reply copied. Paste it in Slack." : "Reply copied");
    else toast("Couldn't copy the reply", undefined, true);
    if (thenOpen && c.source_url) void openUrl(c.source_url);
  };
  const saveDraft = async () => {
    if (!text() || saving) return;
    state.busy.add(busyKey);
    render();
    try {
      const { url } = await api.replyDraft(c.id, text());
      toast("Saved as a Gmail draft. Nothing was sent.", url ? { label: "Open", run: () => void openUrl(url) } : undefined);
    } catch (e) {
      fail(e);
    } finally {
      state.busy.delete(busyKey);
      render();
    }
  };
  const first = (c.reply_draft ?? "").split("\n")[0];
  return h("details", {
    class: "reply", open: openReplies.has(c.id),
    ontoggle: (e: Event) => { if ((e.target as HTMLDetailsElement).open) openReplies.add(c.id); else openReplies.delete(c.id); },
  },
    h("summary", {}, h("span", { class: "reply-label" }, "Draft reply"),
      h("span", { class: "reply-snippet muted" }, first.length > 90 ? first.slice(0, 90) + "…" : first)),
    area,
    h("div", { class: "reply-actions" },
      h("button", { class: "ghost-btn", onclick: (e: Event) => { e.stopPropagation(); void copy(false); } }, "Copy"),
      c.source === "slack" && h("button", { class: "ghost-btn", onclick: (e: Event) => { e.stopPropagation(); void copy(true); } },
        "Copy and open in Slack"),
      c.source === "gmail" && h("button", { class: "rec", disabled: saving, onclick: (e: Event) => { e.stopPropagation(); void saveDraft(); } },
        saving ? "Saving…" : "Save as Gmail draft"),
      h("span", { class: "muted small" }, "Edits are kept when you approve.")));
}

// ---- possible duplicates ----------------------------------------------------------------------
type PreviewState = { loading: true } | { error: string } | { issue: IssuePreview };
const previews = new Map<string, PreviewState>();      // by identifier, for this session
const openPreviews = new Set<number>();                // cards whose preview is expanded

function loadPreview(ident: string) {
  const known = previews.get(ident);
  if (known && !("error" in known)) return;
  previews.set(ident, { loading: true });
  api.issuePreview(ident)
    .then((issue) => previews.set(ident, { issue }))
    .catch((e) => previews.set(ident, { error: e instanceof ApiError ? e.message : String(e) }))
    .finally(() => {
      // Swap the body in place, so typing elsewhere on the page isn't interrupted.
      document.querySelectorAll(`.dup-preview[data-ident="${ident}"] > .dup-body`)
        .forEach((el) => el.replaceWith(previewBody(ident)));
    });
}

function previewBody(ident: string): HTMLElement {
  const p = previews.get(ident);
  if (!p || "loading" in p) return h("div", { class: "dup-body muted small" }, "Loading…");
  if ("error" in p) return h("div", { class: "dup-body muted small" }, `Couldn't load ${ident}: ${p.error}`);
  const i = p.issue;
  const facts = [
    i.priority ? `${priorityName(i.priority)} priority` : "",
    i.due_date ? `due ${i.due_date}` : "",
    i.assignee ?? "Unassigned",
    i.client ?? i.project ?? "",
    i.updated_at ? `updated ${when(i.updated_at).replace(/^(Today|Yesterday)/, (w) => w.toLowerCase())}` : "",
  ].filter(Boolean);
  return h("div", { class: "dup-body" },
    h("div", { class: "dup-facts" },
      h("span", { class: `chip st-${i.state.type}` }, i.state.name),
      h("span", { class: "muted small" }, facts.join(" · "))),
    i.description
      ? h("div", { class: "dup-desc" }, i.description + (i.description_truncated ? " …" : ""))
      : h("p", { class: "muted small" }, "No description."),
    i.comments.length > 0 && h("div", { class: "dup-comments" },
      h("div", { class: "muted small" },
        `${i.comment_count} comment${i.comment_count === 1 ? "" : "s"}${i.comment_count > 3 ? ", latest 3" : ""}`),
      ...i.comments.map((cm) => h("div", { class: "dup-comment" },
        h("div", { class: "muted small" }, `${cm.author} · ${when(cm.created_at)}`),
        h("div", {}, cm.body)))),
    link(`Open ${i.identifier} in Linear ↗`, i.url, "link small"));
}

const ADVICE_LABEL = { drop: "Drop it", merge: "Merge", new: "Create a new issue" } as const;

/** What to do about a possible duplicate: a recommendation, the three choices, and a look at the issue. */
// ---- suggestions handled in Linear by hand ----------------------------------------------------
function handledWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const days = Math.round((Date.parse(isoDay(new Date()) + "T12:00:00") - Date.parse(isoDay(new Date(iso)) + "T12:00:00")) / 864e5);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 7 ? `${days} days ago` : `on ${shortDay(isoDay(new Date(iso)))}`;
}

function handledLine(hd: Handled): string {
  const verb = hd.how === "opened" ? "was opened" : hd.how === "canceled" ? "was canceled" : "was closed";
  return `${hd.identifier} ${verb} ${handledWhen(hd.at)}`.trim();
}

function handledReason(hd: Handled): DropReason {
  return hd.how === "opened" ? "duplicate" : "already_done";
}

async function keepCandidate(c: Candidate) {
  try {
    const updated = await api.keep(c.id);
    state.candidates = state.candidates.map((x) => (x.id === c.id ? updated : x));
  } catch (e) {
    fail(e);
  }
  render();
}

function handledPanel(c: Candidate, busy: boolean): HTMLElement {
  const hd = c.handled!;
  return h("div", { class: "handled" },
    h("div", { class: "handled-text" },
      h("strong", {}, "Looks handled in Linear. "),
      `${handledLine(hd)}: `, link(hd.title ?? "", hd.url ?? null, "link"),
      hd.why && hd.why !== "similar title" ? h("span", { class: "muted small" }, ` (${hd.why})`) : ""),
    h("div", { class: "handled-actions" },
      h("button", { class: "ghost small-btn", disabled: busy, onclick: () => void drop(c, handledReason(hd)) },
        hd.how === "opened" ? "Drop as duplicate" : "Drop as already done"),
      h("button", { class: "ghost-btn small-btn", disabled: busy, title: `${hd.identifier} doesn't cover this; don't suggest it again`,
        onclick: () => void keepCandidate(c) }, "Keep")));
}

/** Above the Inbox cards: how many look handled in Linear, with one click to drop them all. */
function handledBanner(): HTMLElement | "" {
  const hits = state.candidates.filter((c) => c.handled?.identifier);
  if (!hits.length) return "";
  const dropAll = async () => {
    const done: number[] = [];
    for (const c of hits) {
      try { await api.drop(c.id, handledReason(c.handled!)); done.push(c.id); } catch (e) { fail(e); }
    }
    await loadCandidates();
    render();
    if (done.length) offerUndo(`Dropped ${done.length} handled in Linear`, `${done.length} back in the Inbox`,
      () => undoDecisions(done, false));
  };
  return h("div", { class: "banner handled-banner" },
    h("span", {}, `${hits.length} suggestion${hits.length === 1 ? " looks" : "s look"} handled in Linear already: `,
      hits.slice(0, 3).map((c) => c.handled!.identifier).join(", "), hits.length > 3 ? "…" : ""),
    h("span", { class: "spacer" }),
    h("button", { class: "ghost small-btn", onclick: () => void dropAll() }, `Drop ${hits.length === 1 ? "it" : `all ${hits.length}`}`));
}

function duplicatePanel(c: Candidate, busy: boolean): HTMLElement {
  const ident = c.possible_duplicate!;
  const known = state.issues.find((i) => i.identifier === ident);
  const cached = previews.get(ident);
  const fetched = cached && "issue" in cached ? cached.issue : undefined;
  const title = known?.title ?? fetched?.title;
  const url = known?.url ?? fetched?.url ?? null;
  const advice = c.duplicate_advice ?? "merge";
  const choices: { key: "drop" | "merge" | "new"; label: string; title: string; run: () => void }[] = [
    { key: "drop", label: "Drop as duplicate", title: `${ident} already covers it`, run: () => void drop(c, "duplicate") },
    { key: "merge", label: `Merge into ${ident}`, title: `Add this to ${ident}: a comment, its links and subtasks (m)`,
      run: () => void merge(c) },
    { key: "new", label: "Create new", title: "Make its own Linear issue", run: () => void approve(c) },
  ];
  const preview = h("details", {
    class: "dup-preview", "data-ident": ident, open: openPreviews.has(c.id),
    ontoggle: (e: Event) => {
      if ((e.target as HTMLDetailsElement).open) { openPreviews.add(c.id); loadPreview(ident); }
      else openPreviews.delete(c.id);
    },
  }, h("summary", {}, `Show ${ident}`), previewBody(ident));
  return h("div", { class: `dup advice-${advice}` },
    h("div", { class: "dup-head" },
      h("span", { class: "dup-label" }, "Possible duplicate"),
      link(ident, url, "link"), title ? h("span", { class: "dup-title" }, title) : ""),
    h("div", { class: "dup-advice" },
      h("strong", {}, `Recommended: ${advice === "merge" ? `merge into ${ident}` : ADVICE_LABEL[advice].toLowerCase()}.`),
      c.duplicate_reason ? ` ${c.duplicate_reason}` : ""),
    h("div", { class: "dup-actions" },
      ...choices.map((ch) => h("button", {
        class: ch.key === advice ? "rec" : "ghost-btn", disabled: busy, title: ch.title,
        onclick: (e: Event) => { e.stopPropagation(); ch.run(); },
      }, ch.label))),
    preview);
}

function candidateCardBody(c: Candidate): HTMLElement {
  const d = draft(c);
  const val = <K extends keyof CandidateEdit>(k: K) => (k in d ? d[k] : (c as unknown as CandidateEdit)[k]);
  const busy = state.busy.has(`c${c.id}`);
  const acting = c.kind === "close" || c.kind === "comment";
  const ref = acting ? c.target_issue : c.possible_duplicate;
  const refIssue = ref ? state.issues.find((i) => i.identifier === ref) : undefined;
  const label = { task: "Approve", waiting: "Track", close: `Close ${c.target_issue}`, comment: "Post update" }[c.kind];

  const titleEl = acting
    ? h("div", { class: "title-static" },
        c.kind === "close" ? "Close " : "Update ", link(c.target_issue ?? "", refIssue?.url ?? null, "link"),
        refIssue ? `: ${refIssue.title}` : c.title.replace(/^(Close|Update) [A-Z]+-\d+/, ""))
    : h("input", {
        class: "title-input",
        value: val("title") ?? "",
        "aria-label": "Task title",
        oninput: (e: Event) => { d.title = (e.target as HTMLInputElement).value; },
        onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void approve(c); },
      });

  return h(
    "article",
    {
      class: `card kind-${c.kind}${busy ? " busy" : ""}${state.focus === c.id ? " focused" : ""}${state.selected.has(c.id) ? " selected" : ""}`,
      "data-id": String(c.id),
      onclick: () => {
        state.focus = c.id;
        markFocus();
      },
    },
    h(
      "div",
      { class: "card-meta" },
      h("input", {
        type: "checkbox", class: "select", checked: state.selected.has(c.id), "aria-label": "Select for bulk actions",
        onclick: (e: Event) => { e.stopPropagation(); toggleSelect(c.id); },
      }),
      h("span", { class: `chip src-${c.source}` }, SOURCE_NAME[c.source]),
      h("span", { class: `chip${c.kind !== "task" ? " kind" : ""}` }, KIND_NAME[c.kind] ?? SIGNAL_NAME[c.signal]),
      c.who && h("span", { class: "muted" }, c.who),
      h("span", { class: "muted" }, when(c.created_at)),
      h("span", { class: "spacer" }),
    ),
    titleEl,
    c.why && h("p", { class: "why" }, c.why),
    c.excerpt && h("blockquote", {}, c.excerpt),
    !acting && c.handled?.identifier ? handledPanel(c, busy) : "",
    !acting && c.possible_duplicate && duplicatePanel(c, busy),
    !acting && c.reply_draft && replyBox(c, d),
    c.kind === "comment" && h("textarea", {
      class: "comment-input", rows: 3, value: val("comment") ?? "", "aria-label": "Comment to post on the issue",
      oninput: (e: Event) => { d.comment = (e.target as HTMLTextAreaElement).value; },
    }),
    linksRow(c),
    !acting && subtaskEditor(c, d),
    h(
      "div",
      { class: "card-actions" },
      !acting && clientSelect(val("client_label") ?? null, (v) => { d.client_label = v; }),
      !acting && projectSelect(val("project") ?? null, (v) => { d.project = v; }),
      !acting && priorityPill(val("priority") ?? 0, (v) => { d.priority = v; }),
      !acting && c.kind === "waiting" && h("span", { class: "muted small" }, "Follow up"),
      !acting && dateInput(val("due_date") ?? null, (v) => { d.due_date = v; }),
      h("span", { class: "spacer" }),
      snoozeMenu(c, busy),
      dropMenu(c, busy),
      h("button", { class: "primary", disabled: busy, title: "⌘↩", onclick: () => void approve(c) },
        busy ? "Working…" : label),
    ),
  );
}

function inboxView(): HTMLElement {
  const items = state.candidates.filter(matches);
  if (!items.length) {
    const next = nextSweep();
    return h("div", {},
      h("div", { class: "empty" },
        h("p", {}, state.filter ? "No tasks match the filter." : "Nothing to review."),
        !state.filter && next && h("p", { class: "muted" }, `Next sweep: ${next}.`)),
      snoozedList(), mutedList());
  }
  return h("div", {}, handledBanner(), bulkBar(), h("div", { class: "cards" }, ...items.map(candidateCard)), snoozedList(), mutedList());
}

function issueRow(i: Issue, showGroupField: "client" | "project", nested = false): HTMLElement {
  const parts = [showGroupField === "client" ? i.project : i.client];
  // A sub-issue whose parent isn't shown above it says which issue it belongs to.
  if (i.parent && !nested) parts.push(`↳ ${i.parent.identifier} ${i.parent.title}`);
  const side = parts.filter(Boolean).join(" · ");
  const picked = state.today.some((t) => t.issue_id === i.id);
  return h(
    "div",
    { class: `row${nested ? " child" : ""}${i.priority === 1 || i.priority === 2 ? ` prio-${i.priority}` : ""}` },
    h("button", {
      class: `star${picked ? " on" : ""}`, title: picked ? "Remove from Today" : "Add to Today",
      "aria-label": picked ? "Remove from Today" : "Add to Today", "aria-pressed": String(picked),
      onclick: () => void toggleToday(i.id),
    }, picked ? "★" : "☆"),
    taskAvatar(i.client, i.category, "sm"),
    link(i.identifier, i.url, "ident"),
    h("div", { class: "row-title" }, h("span", { title: i.title }, i.title),
      (side || state.slips?.slips[i.id]) && h("span", { class: "muted small row-sub" }, side, slipTag(state.slips?.slips[i.id]))),
    h("div", { class: "cell" }, statusPill(i, (id) => void editIssue(i, { state_id: id }))),
    h("div", { class: "cell" }, priorityPill(i.priority, (v) => void editIssue(i, { priority: v }))),
    dateInput(i.due_date, (v) => void editIssue(i, { due_date: v }), dueClass(i.due_date)),
  );
}

// ---- today ----------------------------------------------------------------------------------
async function saveToday(ids: string[]) {
  try {
    state.today = (await api.setToday(ids)).items;
  } catch (e) {
    fail(e);
  }
  render();
}

function toggleToday(issueId: string) {
  const ids = state.today.map((t) => t.issue_id);
  void saveToday(ids.includes(issueId) ? ids.filter((x) => x !== issueId) : [...ids, issueId]);
}

function nextHalfHour(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function blockControls(t: TodayItem): HTMLElement {
  if (t.event_start && t.event_minutes) {
    const start = new Date(t.event_start);
    const end = new Date(start.getTime() + t.event_minutes * 60_000);
    const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return h("div", { class: "block done" }, link(`Blocked ${fmt(start)}–${fmt(end)} ↗`, t.event_link, "link small"));
  }
  const time = h("input", { type: "time", class: "date", value: nextHalfHour(), "aria-label": "Start time" });
  const len = h("select", { "aria-label": "Duration" },
    ...[30, 60, 90, 120].map((m) => h("option", { value: String(m), selected: m === 60 }, m < 60 ? `${m} min` : `${m / 60} h`)));
  const btn = h("button", {
    class: "ghost small-btn",
    onclick: async () => {
      btn.disabled = true;
      btn.textContent = "Blocking…";
      try {
        state.today = (await api.block(t.issue_id, time.value, Number(len.value))).items;
        toast("Time blocked on your calendar");
        render();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Block time";
        fail(e);
      }
    },
  }, "Block time");
  return h("div", { class: "block" }, time, len, btn);
}

// ---- morning brief and wrap-up ----------------------------------------------------------------
function ensureBrief() {
  if (Date.now() - state.briefAt < 5 * 60_000) return;
  state.briefAt = Date.now();
  api.brief()
    .then((b) => { state.brief = b; renderHeader(); if (state.tab === "today" && !editing()) render(); })
    .catch(() => { state.briefAt = 0; });
  api.balance(1)
    .then((bal) => { state.balance = bal; if (state.tab === "today" && !editing()) render(); })
    .catch(() => undefined);      // the nudge is optional; the brief works without it
}

function addDays(day: string, n: number): string {
  const d = new Date(day + "T12:00:00");
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

function clock(hhmm: string): string {
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, hh, mm).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function weekday(day: string): string {
  return new Date(day + "T12:00:00").toLocaleDateString([], { weekday: "long" });
}

function isOpen(i: Issue): boolean {
  return i.state.type !== "completed" && i.state.type !== "canceled";
}

/** A day's plan: overdue and due-soon work first, then urgent and high priority, up to six. */
function suggestPlan(today: string, waiting: string): Issue[] {
  const soon = addDays(today, 2);
  const score = (i: Issue) =>
    (i.due_date && i.due_date < today ? 100 : i.due_date === today ? 80 : i.due_date && i.due_date <= soon ? 40 : 0)
    + (i.priority === 1 ? 50 : i.priority === 2 ? 25 : 0)
    + (i.state.type === "started" ? 10 : 0);
  return state.issues
    .filter((i) => isOpen(i) && i.state.name !== waiting)
    .map((i) => [score(i), i] as const)
    .filter(([s]) => s >= 25)
    .sort((a, b) => b[0] - a[0] || (a[1].due_date ?? "9").localeCompare(b[1].due_date ?? "9"))
    .slice(0, 6)
    .map(([, i]) => i);
}

function dueLabel(due: string, today: string): string {
  if (due === today) return "due today";
  const days = Math.round((Date.parse(today) - Date.parse(due)) / 864e5);
  return days > 0 ? `${days} day${days === 1 ? "" : "s"} overdue` : `due ${due}`;
}

function briefLine(i: Issue, note: string): HTMLElement {
  return h("li", {}, taskAvatar(i.client, i.category, "sm"), link(i.identifier, i.url, "ident"),
    h("span", { class: "brief-title" }, i.title), note ? h("span", { class: "muted small" }, note) : "");
}

function briefSection(title: string, items: Node[], empty: string, count = items.length): HTMLElement {
  return h("section", { class: "brief-section" },
    h("h3", {}, title, count ? h("span", { class: "count" }, String(count)) : ""),
    items.length ? h("ul", { class: "brief-list" }, ...items) : h("p", { class: "muted small" }, empty));
}

function morningBrief(b: Brief): HTMLElement[] {
  const today = b.day;
  const open = state.issues.filter(isOpen);
  const waiting = open.filter((i) => i.state.name === b.waiting_state);
  const due = open.filter((i) => i.state.name !== b.waiting_state && i.due_date && i.due_date <= today)
    .sort((x, y) => x.due_date!.localeCompare(y.due_date!));
  const chase = waiting.filter((i) => i.due_date && i.due_date <= today);
  const picked = new Set(state.today.map((t) => t.issue_id));
  const plan = suggestPlan(today, b.waiting_state);
  const missing = plan.filter((i) => !picked.has(i.id));
  return [
    briefSection("Meetings today",
      (b.agenda ?? []).map((e) => h("li", {},
        h("span", { class: "brief-time" }, clock(e.start) + (e.end ? `–${clock(e.end)}` : "")),
        link(e.title, e.link, "brief-title link"),
        e.external ? h("span", { class: "chip" }, "external") : "")),
      b.agenda === null ? "Today's calendar comes in with the first sweep of the day." : "No meetings today."),
    briefSection("Due or overdue", due.map((i) => briefLine(i, dueLabel(i.due_date!, today))), "Nothing due today."),
    briefSection("Waiting on someone: time to follow up",
      chase.map((i) => briefLine({ ...i, title: i.title.replace(/^Waiting on /i, "") }, i.due_date === today ? "follow up today" : dueLabel(i.due_date!, today).replace("overdue", "past follow-up"))),
      "No follow-ups due."),
    h("section", { class: "brief-section" },
      h("h3", {}, "Suggested plan"),
      plan.length
        ? h("ol", { class: "brief-list" }, ...plan.map((i) => briefLine(i, picked.has(i.id) ? "in Today" : "")))
        : h("p", { class: "muted small" }, "Nothing urgent or due soon. Pick from Client and Dev."),
      missing.length ? h("button", { class: "primary small-btn", onclick: () => void saveToday([...state.today.map((t) => t.issue_id), ...missing.map((i) => i.id)]) },
        `Add ${missing.length} to Today`) : ""),
  ];
}

function wrapUp(b: Brief): HTMLElement[] {
  const doneIds = new Set(b.completed_today.map((i) => i.id));
  const openIds = new Set(state.issues.filter((i) => isOpen(i) && !doneIds.has(i.id)).map((i) => i.id));
  const left = state.today.filter((t) => openIds.has(t.issue_id));
  const shown = b.completed_today.slice(0, 8);
  const more = b.completed_today.length - shown.length;
  const carry = async () => {
    try {
      await api.carryOver(left.map((t) => t.issue_id));
      toast(`Moved ${left.length} to ${weekday(b.next_day)}'s Today list`);
    } catch (e) {
      fail(e);
    }
  };
  return [
    briefSection("Done today",
      [...shown.map((i) => briefLine(i, "")), ...(more > 0 ? [h("li", { class: "muted small" }, `and ${more} more`)] : [])],
      b.error ? `Couldn't load from Linear: ${b.error}` : "Nothing completed in Linear yet today.",
      b.completed_today.length),
    h("section", { class: "brief-section" },
      h("h3", {}, "Still open from Today", left.length ? h("span", { class: "count" }, String(left.length)) : ""),
      left.length
        ? h("ul", { class: "brief-list" }, ...left.map((t) => briefLine(state.issues.find((i) => i.id === t.issue_id)!, "")))
        : h("p", { class: "muted small" }, state.today.length ? "Everything on Today is done." : "Nothing was planned for today."),
      left.length ? h("button", { class: "primary small-btn", onclick: () => void carry() },
        `Move ${left.length} to ${weekday(b.next_day)}`) : ""),
  ];
}

/** Client share = client-labeled issues completed this week (Mon–Sun) ÷ all issues completed this
 *  week, as in Insights. Shown when at least NUDGE_MIN_DONE are done and the share is NUDGE_GAP or
 *  more away from the target, with up to three open issues from the side that's behind. */
const NUDGE_MIN_DONE = 3;
const NUDGE_GAP = 0.15;

function balanceNudge(waiting: string): HTMLElement | "" {
  const bal = state.balance;
  const w = bal?.weeks.at(-1);
  if (!bal || !w || w.client_share === null || w.client + w.dev < NUDGE_MIN_DONE) return "";
  const gap = w.client_share - bal.target;
  if (Math.abs(gap) < NUDGE_GAP) return "";
  const behind: "client" | "dev" = gap < 0 ? "client" : "dev";
  const weekEnd = addDays(w.week, 6);
  const picked = new Set(state.today.map((t) => t.issue_id));
  const pool = state.issues
    .filter((i) => isOpen(i) && i.list === behind && i.state.name !== waiting)
    .sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9") || (a.priority || 9) - (b.priority || 9));
  const dueThisWeek = pool.filter((i) => i.due_date && i.due_date <= weekEnd);
  const picks = (dueThisWeek.length ? dueThisWeek : pool).slice(0, 3);
  const share = behind === "client" ? w.client_share : 1 - w.client_share;
  const done = w.client + w.dev;
  const word = behind === "client" ? "Client" : "Dev";
  const lead = `${word} work is ${pct(share)} of what you've completed this week ` +
    `(${behind === "client" ? w.client : w.dev} of ${done}; target ${pct(behind === "client" ? bal.target : 1 - bal.target)}).`;
  const next = dueThisWeek.length
    ? ` ${dueThisWeek.length} ${word.toLowerCase()} task${dueThisWeek.length === 1 ? " is" : "s are"} due this week:`
    : picks.length ? ` Some ${word.toLowerCase()} work to pick from:` : "";
  return h("div", { class: `nudge nudge-${behind}` },
    h("p", {}, h("strong", {}, "Balance. "), lead + next),
    picks.length ? h("ul", { class: "brief-list" }, ...picks.map((i) => h("li", {},
      taskAvatar(i.client, i.category, "sm"), link(i.identifier, i.url, "ident"),
      h("span", { class: "brief-title" }, i.title),
      i.due_date ? h("span", { class: "muted small" }, dueLabel(i.due_date, state.brief?.day ?? isoDay(new Date()))) : "",
      picked.has(i.id) ? h("span", { class: "muted small" }, "in Today")
        : h("button", { class: "ghost-btn small-btn", onclick: () => void saveToday([...state.today.map((t) => t.issue_id), i.id]) },
          "Add to Today")))) : "");
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** "Hi Jordan, just following up on the lead export with SignupChannel. Any update?" for a
 *  "Waiting on Jordan: lead export with SignupChannel" issue. Copied, never sent. */
function nudgeText(i: Issue): string {
  const m = i.title.match(/^Waiting on ([^:]+):\s*(.+)$/i);
  return m ? `Hi ${m[1].trim()}, just following up on the ${m[2].trim()}. Any update?`
    : `Hi, just following up on ${i.title}. Any update?`;
}

/** Is client or dev work behind this week? Same rule as the balance nudge. */
function behindSide(): { side: "client" | "dev"; share: number; done: number; target: number } | null {
  const bal = state.balance;
  const w = bal?.weeks.at(-1);
  if (!bal || !w || w.client_share === null || w.client + w.dev < NUDGE_MIN_DONE) return null;
  if (Math.abs(w.client_share - bal.target) < NUDGE_GAP) return null;
  const side = w.client_share < bal.target ? "client" : "dev";
  return { side, share: side === "client" ? w.client_share : 1 - w.client_share, done: w.client + w.dev,
           target: side === "client" ? bal.target : 1 - bal.target };
}

/** "Hide this week" on the popover: the pill stays away until next Monday. */
const BALANCE_HIDE = "todohub.balanceHidden";

/** The "Client work behind this week" pill and, when open, its popover: how many issues from the
 *  side that's behind get you back to the target by Sunday, the math behind that number, and up
 *  to three open issues from that side to put on Today. Same definition as the nudge: client
 *  share = client-labeled issues you completed Mon–Sun ÷ all issues you completed that week. */
function balancePill(waiting: string): HTMLElement | "" {
  const behind = behindSide();
  const bal = state.balance;
  const w = bal?.weeks.at(-1);
  if (!behind || !bal || !w || loadPref(BALANCE_HIDE) === w.week) return "";
  const Word = behind.side === "client" ? "Client" : "Dev";
  const pill = h("button", {
    class: "mtile-pill", "aria-expanded": String(state.balanceOpen), "aria-haspopup": "dialog",
    title: `${Word} work is ${pct(behind.share)} of the ${behind.done} issues you've completed this week; target ${pct(behind.target)}.`,
    onclick: () => { state.balanceOpen = !state.balanceOpen; render(); },
  }, `${Word} work behind this week`);
  return h("span", { class: "bal-anchor" }, pill, state.balanceOpen ? balancePopover(behind, w, waiting) : "");
}

/** Smallest n with (x + n) / (total + n) ≥ target: issues from the behind side still needed. */
function neededToTarget(x: number, total: number, target: number): number {
  if (target >= 1) return Infinity;
  return Math.max(0, Math.ceil((target * total - x) / (1 - target) - 1e-9));
}

function balancePopover(behind: NonNullable<ReturnType<typeof behindSide>>,
                        w: { week: string; client: number; dev: number }, waiting: string): HTMLElement {
  const side = behind.side;
  const other = side === "client" ? "dev" : "client";
  const word = side;
  const Word = side === "client" ? "Client" : "Dev";
  const x = side === "client" ? w.client : w.dev;
  const total = w.client + w.dev;
  const need = neededToTarget(x, total, behind.target);
  const targetWord = Math.abs(behind.target - 0.5) < 1e-9 ? "half" : pct(behind.target);
  const today = state.brief?.day ?? isoDay(new Date());
  const sunday = addDays(w.week, 6);
  const friday = addDays(w.week, 4);
  const daysLeft = (end: string) => Math.max(0, daysBetween(today, end) + 1);
  const [paceDays, paceEnd] = today <= friday ? [daysLeft(friday), "Friday"] : [daysLeft(sunday), "Sunday"];
  const perDay = paceDays ? Math.ceil(need / paceDays) : need;

  const picked = new Set(state.today.map((t) => t.issue_id));
  const pool = state.issues
    .filter((i) => isOpen(i) && i.list === side && i.state.name !== waiting)
    .sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9") || (a.priority || 9) - (b.priority || 9));
  const picks = pool.slice(0, 3);
  const toAdd = picks.filter((i) => !picked.has(i.id));
  const close = () => { state.balanceOpen = false; render(); };
  const dueNote = (i: Issue) => {
    if (!i.due_date) return i.priority === 1 ? h("span", { class: "bal-due late" }, "urgent") : "";
    if (i.due_date < today) return h("span", { class: "bal-due late" }, `${daysBetween(i.due_date, today)}d late`);
    if (i.due_date === today) return h("span", { class: "bal-due soon" }, "due today");
    if (i.due_date <= sunday) return h("span", { class: "bal-due soon" }, `due ${new Date(i.due_date + "T12:00:00").toLocaleDateString([], { weekday: "short" })}`);
    return h("span", { class: "bal-due" }, `due ${shortDay(i.due_date)}`);
  };
  const after = x + need, afterTotal = total + need;

  return h("div", { class: "bal-pop", role: "dialog", "aria-label": `${Word} work this week` },
    h("div", {},
      h("div", { class: "bal-big" }, need === 1 ? `1 ${word} issue by Sunday gets you to ${targetWord}`
        : `${need} ${word} issues by Sunday get you to ${targetWord}`),
      h("div", { class: "bal-sub" }, `${x} of the ${total} issues you closed this week ${x === 1 ? "was" : "were"} ${word} work. Target: ${targetWord}.`)),
    h("div", { class: "bal-bar", role: "img", "aria-label": `${pct(behind.share)} ${word} now, target ${pct(behind.target)}` },
      h("span", { class: "bal-fill", style: `width: ${Math.round(behind.share * 100)}%` }),
      h("span", { class: "bal-mark", style: `left: ${Math.round(behind.target * 100)}%` })),
    h("div", { class: "bal-math" },
      `So far: ${w.client} client, ${w.dev} dev. ${need} more ${word} and no more ${other} makes ${after} of ${afterTotal} = ${pct(after / afterTotal)}.`
      + (paceDays > 1 && need > 0 ? ` That's about ${perDay} a day through ${paceEnd}.` : "")
      + ` Each extra ${other} issue raises the number.`),
    h("div", {},
      h("div", { class: "bal-k" }, `${Word} work to pick from`),
      picks.length ? h("ul", { class: "bal-list" }, ...picks.map((i) => h("li", {},
        taskAvatar(i.client, i.category, "sm"),
        link(i.identifier, i.url, "ident"),
        h("span", { class: "bal-title", title: i.title }, i.title),
        dueNote(i),
        picked.has(i.id) ? h("span", { class: "bal-in" }, "✓ Today")
          : h("button", { class: "ghost small-btn", onclick: () => void saveToday([...state.today.map((t) => t.issue_id), i.id]) }, "+ Today"))))
        : h("p", { class: "bal-sub" }, `No open ${word} issues assigned to you.`)),
    h("div", { class: "bal-foot" },
      toAdd.length > 1 ? h("button", { class: "primary small-btn",
        onclick: () => void saveToday([...state.today.map((t) => t.issue_id), ...toAdd.map((i) => i.id)]) }, `Add ${toAdd.length} to Today`) : "",
      h("button", { class: "link-btn", onclick: () => { state.balanceOpen = false; goTab(side); } }, `All ${word} work →`),
      h("span", { class: "spacer" }),
      h("button", { class: "link-btn bal-hide", title: "The pill comes back next Monday",
        onclick: () => { savePref(BALANCE_HIDE, w.week); toast("Hidden until Monday"); close(); } }, "Hide this week")),
    h("div", { class: "bal-def" }, `${Word} share: ${word}-labeled issues you closed Mon–Sun ÷ all issues you closed that week. The pill shows once you've closed ${NUDGE_MIN_DONE}+ and you're ${Math.round(NUDGE_GAP * 100)}+ points off.`),
  );
}

async function blockFirst(i: Issue, btn: HTMLButtonElement) {
  const start = nextHalfHour();
  btn.disabled = true;
  btn.textContent = "Blocking…";
  try {
    if (!state.today.some((t) => t.issue_id === i.id)) {
      state.today = (await api.setToday([...state.today.map((t) => t.issue_id), i.id])).items;
    }
    state.today = (await api.block(i.id, start, 60)).items;
    toast(`Blocked ${clock(start)} on your calendar`);
  } catch (e) {
    fail(e);
  }
  render();
}

/** The morning tile: one sentence, what to do first, the next meeting, who to chase, and the
 *  suggested plan in one line. The four full sections open with "See the full brief". */
function morningTile(b: Brief): HTMLElement {
  const today = b.day;
  const open = state.issues.filter(isOpen);
  const due = open.filter((i) => i.state.name !== b.waiting_state && i.due_date && i.due_date <= today);
  const chase = open.filter((i) => i.state.name === b.waiting_state && i.due_date && i.due_date <= today)
    .sort((x, y) => x.due_date!.localeCompare(y.due_date!));
  const meetings = b.agenda ?? [];
  const now = nowHM();
  const ahead = meetings.filter((m) => (m.end ?? m.start) >= now);
  const next = ahead[0];
  const picked = new Set(state.today.map((t) => t.issue_id));
  const plan = suggestPlan(today, b.waiting_state);
  const first = plan[0];
  const missing = plan.filter((i) => !picked.has(i.id));

  const parts = [b.agenda ? plural(meetings.length, "meeting") : "", `${due.length} ${due.length === 1 ? "thing" : "things"} due`,
    chase.length ? `${chase.length} to chase` : ""].filter(Boolean);
  const headline = !meetings.length && !due.length && !chase.length ? "A clear morning: nothing due, no meetings."
    : `${listWords(parts)}.`;
  const minsTo = (hm: string) => {
    const [hh, mm] = hm.split(":").map(Number);
    const d = new Date(); d.setHours(hh, mm, 0, 0);
    return Math.round((d.getTime() - Date.now()) / 60000);
  };
  const when = next ? (minsTo(next.start) <= 0 ? "now" : minsTo(next.start) < 60 ? `in ${minsTo(next.start)} min`
    : `in ${Math.floor(minsTo(next.start) / 60)} h ${minsTo(next.start) % 60 ? `${minsTo(next.start) % 60} min` : ""}`.trim()) : "";
  const firstNote = first?.due_date ? dueLabel(first.due_date, today).replace("overdue", "late") : first?.priority === 1 ? "urgent" : "";
  const c = chase[0];

  return h("div", { class: "mtile" },
    h("div", { class: "mtile-hero" },
      h("div", { class: "mtile-top" },
        h("span", { class: "mtile-hello" }, new Date().getHours() < 12 ? "Good morning" : "Your day"),
        h("span", { class: "muted small" }, new Date(today + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })),
        h("span", { class: "spacer" }),
        balancePill(b.waiting_state)),
      h("h2", { class: "mtile-headline" }, headline),
      first ? h("div", { class: "mtile-first" },
        h("span", { class: "mtile-k" }, "Do first"),
        h("div", { class: "mtile-first-title" }, first.title),
        h("span", { class: "mtile-meta" }, `${first.identifier} · ${first.client ?? first.project ?? "Dev"}`,
          firstNote ? h("span", { class: `mtile-due${first.due_date && first.due_date < today ? " late" : ""}` }, ` · ${firstNote}`) : ""),
        h("div", { class: "mtile-actions" },
          state.today.find((t) => t.issue_id === first.id)?.event_start
            ? h("span", { class: "muted small" }, "Time blocked ✓")
            : h("button", { class: "primary", onclick: (e: Event) => void blockFirst(first, e.currentTarget as HTMLButtonElement) },
                `Block 1 h at ${clock(nextHalfHour())}`),
          link("Open in Linear", first.url, "ghost-link"),
          !picked.has(first.id) ? h("button", { class: "ghost", onclick: () => void saveToday([...state.today.map((t) => t.issue_id), first.id]) },
            "Add to Today") : ""))
        : h("p", { class: "muted" }, "Nothing urgent or due soon. Pick from Client and Dev.")),
    h("div", { class: "mtile-cols" },
      h("div", { class: "mtile-cell" },
        h("span", { class: "mtile-k" }, "Next meeting"),
        next ? h("div", { class: "mtile-big" }, `${clock(next.start)} · `, link(next.title, next.link, "link")) :
          h("div", { class: "mtile-big muted" }, b.agenda === null ? "Calendar comes in with the first sweep" : "No more meetings today"),
        next ? h("span", { class: "mtile-meta" }, when, next.external ? " · external" : "") : "",
        ahead.length > 1 ? h("span", { class: "muted small" },
          "Then " + ahead.slice(1).map((m) => `${clock(m.start)} ${m.title}`).join(" · ")) : ""),
      h("div", { class: "mtile-cell" },
        h("span", { class: "mtile-k" }, "Chase"),
        c ? h("div", { class: "mtile-big" }, c.title.replace(/^Waiting on /i, ""))
          : h("div", { class: "mtile-big muted" }, "No follow-ups due"),
        c ? h("span", { class: "mtile-meta" }, `${c.identifier}${c.client ? ` · ${c.client}` : ""} · ${c.due_date === today ? "follow up today" : dueLabel(c.due_date!, today).replace("overdue", "past follow-up")}`) : "",
        c ? h("div", { class: "mtile-actions" },
          h("button", { class: "ghost small-btn", title: nudgeText(c),
            onclick: async () => { if (await copyText(nudgeText(c))) toast("Nudge copied. Paste it where you talk to them."); } }, "Copy nudge"),
          chase.length > 1 ? h("span", { class: "muted small" }, `+ ${chase.length - 1} more`) : "") : "")),
    h("div", { class: "mtile-foot" },
      h("span", {}, missing.length
        ? `Suggested plan: ${missing.length} more${missing.filter((i) => i.list === "client").length ? `, ${missing.filter((i) => i.list === "client").length} of them client` : ""}`
        : plan.length ? "Everything suggested is on Today." : "No suggestions today."),
      h("span", { class: "spacer" }),
      h("button", { class: "ghost", "aria-expanded": String(state.fullBrief), onclick: () => { state.fullBrief = !state.fullBrief; render(); } },
        state.fullBrief ? "Hide the full brief" : "See the full brief"),
      missing.length ? h("button", { class: "primary", onclick: () => void saveToday([...state.today.map((t) => t.issue_id), ...missing.map((i) => i.id)]) },
        `Add ${missing.length} to Today`) : ""),
  );
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / 864e5);
}

function wrapText(b: Brief, left: Issue[]): string {
  const day = new Date(b.day + "T12:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const lines = [`Wrap-up ${day}: ${b.completed_today.length} done, ${left.length} still open.`];
  if (b.completed_today.length) {
    lines.push("", "Done:", ...b.completed_today.map((i) => `• ${i.identifier} ${i.title}${i.client ? ` (${i.client})` : ""}`));
  }
  if (left.length) lines.push("", "Still open:", ...left.map((i) => `• ${i.identifier} ${i.title}`));
  return lines.join("\n");
}

/** The evening tile: what got done, what's left, and how tomorrow starts. Same layout as the
 *  morning tile, in dusk colors. The full wrap-up opens below it. */
function eveningTile(b: Brief): HTMLElement {
  const doneIds = new Set(b.completed_today.map((i) => i.id));
  const leftItems = state.today.map((t) => state.issues.find((i) => i.id === t.issue_id))
    .filter((i): i is Issue => !!i && isOpen(i) && !doneIds.has(i.id));
  const done = b.completed_today;
  const tomorrow = b.next_day;
  const tomorrowName = weekday(tomorrow);
  const plan = suggestPlan(tomorrow, b.waiting_state);
  const leftIds = new Set(leftItems.map((i) => i.id));
  const first = plan.find((i) => leftIds.has(i.id)) ?? leftItems[0] ?? plan[0];
  const week = state.balance?.weeks.at(-1);
  const carried = state.carriedTo === tomorrow;
  const hour = new Date().getHours();

  const headline = !done.length && !leftItems.length ? (state.today.length ? "Everything on Today is done." : "A quiet day: nothing planned, nothing closed.")
    : !leftItems.length ? `${done.length} done today. Everything on Today is finished.`
    : `${done.length} done today, ${leftItems.length} still open.`;
  const firstNote = !first?.due_date ? (first?.priority === 1 ? "urgent" : "")
    : first.due_date < tomorrow ? `${plural(daysBetween(first.due_date, tomorrow), "day")} late by ${tomorrowName}`
    : first.due_date === tomorrow ? `due ${tomorrowName}` : `due ${shortDay(first.due_date)}`;
  const carry = async (ids: string[], btn: HTMLButtonElement) => {
    btn.disabled = true;
    try {
      await api.carryOver(ids);
      state.carriedTo = tomorrow;
      toast(`Moved ${plural(ids.length, "item")} to ${tomorrowName}'s Today list`);
    } catch (e) {
      btn.disabled = false;
      fail(e);
    }
    render();
  };
  const dueTomorrow = state.issues.filter((i) => isOpen(i) && i.state.name !== b.waiting_state && i.due_date === tomorrow);
  const waitingOn = state.issues.filter((i) => isOpen(i) && i.state.name === b.waiting_state && i.due_date && i.due_date <= tomorrow)
    .sort((x, y) => x.due_date!.localeCompare(y.due_date!));
  const firstMeeting = b.next_agenda?.[0];
  const doneClient = done.filter((i) => i.list === "client").length;

  return h("div", { class: "mtile dusk" },
    h("div", { class: "mtile-hero" },
      h("span", { class: "dusk-stars", "aria-hidden": "true" }),
      h("div", { class: "mtile-top" },
        h("span", { class: "mtile-hello" }, hour >= 17 ? "Good evening" : hour >= 12 ? "Good afternoon" : "Wrap-up"),
        h("span", { class: "dusk-date" }, new Date(b.day + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })),
        h("span", { class: "spacer" }),
        balancePill(b.waiting_state)),
      h("h2", { class: "mtile-headline" }, headline),
      first ? h("div", { class: "mtile-first" },
        h("span", { class: "mtile-k" }, "Tomorrow starts with"),
        h("div", { class: "mtile-first-title" }, first.title),
        h("span", { class: "mtile-meta" }, `${first.identifier} · ${first.client ?? first.project ?? "Dev"}`,
          firstNote ? h("span", { class: `mtile-due${first.due_date && first.due_date < tomorrow ? " late" : ""}` }, ` · ${firstNote}`) : ""))
        : h("p", { class: "mtile-meta" }, "Nothing pressing for tomorrow yet."),
      h("div", { class: "mtile-actions" },
        carried ? h("span", { class: "dusk-done" }, `Moved to ${tomorrowName} ✓`)
          : leftItems.length ? h("button", { class: "dusk-btn",
              onclick: (e: Event) => void carry(leftItems.map((i) => i.id), e.currentTarget as HTMLButtonElement) },
              `Move ${leftItems.length} to ${tomorrowName}`)
          : first ? h("button", { class: "dusk-btn",
              onclick: (e: Event) => void carry([first.id], e.currentTarget as HTMLButtonElement) },
              `Put it on ${tomorrowName}'s Today`) : "",
        first ? link("Open in Linear", first.url, "glass-link") : "")),
    h("div", { class: "mtile-cols" },
      h("div", { class: "mtile-cell" },
        h("span", { class: "mtile-k" }, `Done today${done.length ? ` · ${done.length}` : ""}`),
        done.length ? h("ul", { class: "dusk-list" }, ...done.slice(0, 3).map((i) => h("li", {},
          h("span", { class: "dmark good" }, "✓"), link(i.identifier, i.url, "ident"), h("span", { class: "dtitle" }, i.title))))
          : h("span", { class: "muted small" }, b.error ? `Couldn't load from Linear: ${b.error}` : "Nothing closed in Linear today."),
        done.length ? h("span", { class: "muted small" },
          `${done.length > 3 ? `+ ${done.length - 3} more · ` : ""}${doneClient} client, ${done.length - doneClient} dev`) : ""),
      h("div", { class: "mtile-cell" },
        h("span", { class: "mtile-k" }, `Tomorrow · ${tomorrowName}`),
        h("ul", { class: "dusk-list" },
          firstMeeting ? h("li", {}, h("span", { class: "dwhen" }, clock(firstMeeting.start)),
            h("span", { class: "dtitle" }, firstMeeting.title, h("span", { class: "muted small" }, "  first meeting"))) : "",
          ...dueTomorrow.slice(0, 3).map((i) => h("li", {}, h("span", { class: "dwhen" }, "due"),
            link(i.identifier, i.url, "ident"), h("span", { class: "dtitle" }, i.title)))),
        !firstMeeting && !dueTomorrow.length ? h("span", { class: "muted small" },
          b.next_agenda === null ? "Tomorrow's calendar comes in with the first sweep of the day." : "No meetings and nothing due.") : "",
        waitingOn.length ? h("span", { class: "muted small" },
          `Still waiting on ${waitingOn[0].title.replace(/^Waiting on /i, "")} (${waitingOn[0].identifier})${waitingOn.length > 1 ? ` + ${waitingOn.length - 1} more` : ""}`) : "")),
    h("div", { class: "mtile-foot" },
      h("span", {}, week ? `Week so far: ${week.client + week.dev} closed, ${week.client} client` : ""),
      h("span", { class: "spacer" }),
      h("button", { class: "ghost", "aria-expanded": String(state.fullBrief), onclick: () => { state.fullBrief = !state.fullBrief; render(); } },
        state.fullBrief ? "Hide the full wrap-up" : "See the full wrap-up"),
      h("button", { class: "primary dusk-primary", onclick: async () => {
        if (await copyText(wrapText(b, leftItems))) toast("Wrap-up copied. Paste it in Slack.");
      } }, "Copy as Slack update")),
  );
}

function briefPanel(): HTMLElement {
  ensureBrief();
  const mode = state.briefMode ?? (new Date().getHours() < 14 ? "morning" : "evening");
  const b = state.brief;
  const pick = (m: "morning" | "evening", label: string) => h("button", {
    class: `seg${mode === m ? " on" : ""}`, "aria-pressed": String(mode === m),
    onclick: () => { state.briefMode = m; render(); },
  }, label);
  const switcher = h("div", { class: "segmented" }, pick("morning", "Morning"), pick("evening", "Wrap-up"));
  if (!b || !state.issuesLoaded) {
    return h("div", { class: "panel brief" }, h("div", { class: "brief-head" }, h("h2", {}, "Morning brief"),
      h("span", { class: "spacer" }), switcher), h("p", { class: "muted small" }, "Loading…"));
  }
  if (mode === "morning") {
    return h("div", { class: "brief-wrap" },
      h("div", { class: "brief-switch" }, switcher),
      morningTile(b),
      state.fullBrief ? h("div", { class: "panel brief full-brief" }, balanceNudge(b.waiting_state),
        h("div", { class: "brief-grid" }, ...morningBrief(b))) : "");
  }
  return h("div", { class: "brief-wrap" },
    h("div", { class: "brief-switch" }, switcher),
    eveningTile(b),
    state.fullBrief ? h("div", { class: "panel brief full-brief" }, balanceNudge(b.waiting_state),
      h("div", { class: "brief-grid" }, ...wrapUp(b))) : "");
}

/** Weekdays: a nudge at 8am for the morning brief and at 5pm for the wrap-up. */
function briefReminders() {
  const now = new Date();
  const day = isoDay(now);
  const hour = now.getHours();
  if (now.getDay() === 0 || now.getDay() === 6) return;
  if (hour >= 8 && hour < 11) {
    void notifyOnce(`brief-morning-${day}`, "TodoHub: morning brief",
      "Today's meetings, what's due, and a suggested plan are in the Today tab.");
  } else if (hour >= 17 && hour < 20) {
    void notifyOnce(`brief-evening-${day}`, "TodoHub: wrap up your day",
      "See what got done and move the rest to tomorrow in the Today tab.");
  }
}

function setTodayLayout(layout: "brief" | "checklist") {
  state.todayLayout = layout;
  savePref("todohub.todayView", layout);
  render();
}

function todayView(): HTMLElement {
  const btn = (id: "brief" | "checklist", label: string) => h("button", {
    class: state.todayLayout === id ? "on" : "", "aria-pressed": String(state.todayLayout === id),
    onclick: () => setTodayLayout(id),
  }, label);
  const bar = h("div", { class: "toolbar page-bar" },
    h("h1", {}, "Today"),
    h("span", { class: "spacer" }),
    h("div", { class: "seg", role: "group", "aria-label": "Today view" }, btn("brief", "Brief"), btn("checklist", "Checklist")));
  return state.todayLayout === "checklist"
    ? h("div", {}, bar, todayChecklist())
    : h("div", {}, bar, briefPanel(), todayList());
}

// ---- Today as a checklist -------------------------------------------------------------------------
function nowHM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function listWords(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** Check it off: moves the issue to the team's first completed status in Linear, with undo. */
async function completeIssue(i: Issue) {
  const done = state.meta?.states.find((s) => s.type === "completed");
  if (!done) { toast("Couldn't find a done status for this team"); return; }
  goneIssues.delete(i.id);
  state.briefAt = 0;                 // the wrap-up's "done today" should include it
  await editIssue(i, { state_id: done.id });
}

/** One column: a sentence about the day, a progress bar, the Today items to check off, with
 *  meetings still ahead and time blocks placed by time, then what's done. */
function todayChecklist(): HTMLElement {
  ensureBrief();
  if (!state.issuesLoaded) return h("div", { class: "empty" }, h("p", { class: "muted" }, "Loading from Linear…"));
  const b = state.brief;
  const today = b?.day ?? isoDay(new Date());
  const waiting = b?.waiting_state ?? "Pending";
  const { open, gone } = todaySplit();
  const issueOf = (t: TodayItem) => state.issues.find((i) => i.id === t.issue_id)!;
  const finished = gone.flatMap((t) => {
    const g = goneIssue(t.issue_id);
    return "issue" in g && (g.doneToday || g.issue.state.type === "completed") ? [{ t, i: g.issue }] : [];
  });
  const total = open.length + finished.length;
  const now = nowHM();
  const meetings = (b?.agenda ?? []).filter((m) => (m.end ?? m.start) >= now);
  const inToday = new Set(state.today.map((t) => t.issue_id));
  const followUps = state.issues.filter((i) => isOpen(i) && i.state.name === waiting && i.due_date && i.due_date <= today);

  // The sentence at the top.
  const parts = [open.length ? `${plural(open.length, "thing")} today` : "", meetings.length ? plural(meetings.length, "meeting") : "",
    followUps.length ? plural(followUps.length, "follow-up") : ""].filter(Boolean);
  const headline = !total && !parts.length ? "Nothing planned yet."
    : !open.length && total ? `All ${plural(total, "thing")} done.${meetings.length ? ` ${plural(meetings.length, "meeting")} left.` : ""}`
    : `${listWords(parts)}.`;
  const late = open.map(issueOf).filter((i) => i.due_date && i.due_date < today)
    .sort((x, y) => x.due_date!.localeCompare(y.due_date!))[0];
  const lead: string[] = [];
  if (late) lead.push(`${late.title} is ${dueLabel(late.due_date!, today).replace("overdue", "late")}; do it first.`);
  const w = state.balance?.weeks.at(-1);
  if (state.balance && w && w.client_share !== null && w.client + w.dev >= NUDGE_MIN_DONE
      && Math.abs(w.client_share - state.balance.target) >= NUDGE_GAP) {
    const behind = w.client_share < state.balance.target ? "client" : "dev";
    const share = behind === "client" ? w.client_share : 1 - w.client_share;
    lead.push(`${behind === "client" ? "Client" : "Dev"} work is behind this week (${pct(share)} of what you've completed), so lean ${behind}.`);
  }

  // Items without a time first, in Today order; then meetings and time blocks by time.
  const blockedAt = (t: TodayItem) => {
    if (!t.event_start) return null;
    const d = new Date(t.event_start);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const row = (t: TodayItem) => {
    const i = issueOf(t);
    const meta = [i.identifier, i.client ?? i.project ?? (i.list === "dev" ? "Dev" : ""),
      i.state.name === waiting ? "waiting" : "",
      i.due_date ? (i.due_date <= today ? dueLabel(i.due_date, today).replace("overdue", "late") : `due ${shortDay(i.due_date)}`) : "",
      blockedAt(t) ? `blocked ${clock(blockedAt(t)!)}` : ""].filter(Boolean).join(" · ");
    return h("label", { class: `check-item${i.due_date && i.due_date < today ? " late" : ""}` },
      h("input", { type: "checkbox", "aria-label": `Mark ${i.identifier} done`,
        onchange: (e: Event) => { (e.target as HTMLInputElement).disabled = true; void completeIssue(i); } }),
      h("span", { class: "check-body" }, h("span", { class: "check-title" }, i.title), h("span", { class: "check-meta" }, meta)),
      taskAvatar(i.client, i.category, "sm"));
  };
  const timed = [
    ...open.filter((t) => blockedAt(t)).map((t) => ({ at: blockedAt(t)!, node: row(t) })),
    ...meetings.map((m) => ({ at: m.start, node: h("div", { class: "check-mtg" },
      h("strong", {}, clock(m.start)), link(m.title, m.link, "link"), m.external ? h("span", { class: "chip" }, "external") : "") })),
  ].sort((x, y) => x.at.localeCompare(y.at));

  const weekEnd = addDays(today, 6 - ((new Date(today + "T12:00:00").getDay() + 6) % 7));
  const later = state.issues.filter((i) => isOpen(i) && !inToday.has(i.id) && i.due_date && i.due_date > today && i.due_date <= weekEnd)
    .sort((x, y) => x.due_date!.localeCompare(y.due_date!));
  const chase = followUps.filter((i) => !inToday.has(i.id));
  const missing = b ? suggestPlan(today, waiting).filter((i) => !inToday.has(i.id)) : [];
  const add = (i: Issue) => h("button", { class: "ghost small-btn", onclick: () => void saveToday([...state.today.map((t) => t.issue_id), i.id]) }, "Add");

  return h("div", { class: "checklist" },
    h("div", { class: "check-head" },
      h("span", { class: "muted" }, new Date(today + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })),
      h("h2", {}, headline),
      lead.length ? h("p", {}, lead.join(" ")) : ""),
    total ? h("div", { class: "check-progress", title: `${finished.length} of ${total} done` },
      h("div", { style: `width:${Math.round((finished.length / total) * 100)}%` })) : "",
    h("section", { class: "check-list", "aria-label": "Today's checklist" },
      ...open.filter((t) => !blockedAt(t)).map(row),
      ...timed.map((x) => x.node),
      ...finished.map(({ i }) => h("div", { class: "check-item done" },
        h("input", { type: "checkbox", checked: true, disabled: true, "aria-label": `${i.identifier} done` }),
        h("span", { class: "check-body" }, h("span", { class: "check-title" }, i.title),
          h("span", { class: "check-meta" }, `${i.identifier} · done`)),
        taskAvatar(i.client, i.category, "sm"))),
      !total ? h("p", { class: "muted" }, "Star (☆) issues in Client or Dev, or add the suggested ones below.") : ""),
    chase.length ? h("div", { class: "check-extra" }, h("h3", {}, "Follow up today"),
      ...chase.map((i) => h("div", { class: "check-line" }, link(i.identifier, i.url, "ident"),
        h("span", { class: "dtitle" }, i.title.replace(/^Waiting on /i, "")), add(i)))) : "",
    h("div", { class: "check-actions" },
      missing.length ? h("button", { class: "ghost", onclick: () => void saveToday([...state.today.map((t) => t.issue_id), ...missing.map((i) => i.id)]) },
        `+ Add ${missing.length} suggested`) : "",
      h("button", { class: "ghost", onclick: () => goTab("client") }, "Pick from Client or Dev"),
      h("span", { class: "spacer" }),
      h("button", { class: "primary", onclick: () => { state.briefMode = "evening"; setTodayLayout("brief"); } }, "Wrap up the day")),
    later.length ? h("details", { class: "check-later" },
      h("summary", {}, `Later this week · ${later.length}`),
      ...later.map((i) => h("div", { class: "check-line" }, link(i.identifier, i.url, "ident"),
        h("span", { class: "dtitle" }, i.title), h("span", { class: "muted small" }, weekday(i.due_date!).slice(0, 3)), add(i)))) : "",
  );
}

// Today items whose issue isn't in the open list: done, canceled, or reassigned since.
type Gone = { loading: true } | { error: string } | { issue: Issue; doneToday?: boolean };
const goneIssues = new Map<string, Gone>();

/** Split Today into open items and the rest. Only meaningful once the open issues have loaded. */
function todaySplit(): { open: TodayItem[]; gone: TodayItem[] } {
  const openIds = new Set(state.issues.filter(isOpen).map((i) => i.id));
  return {
    open: state.today.filter((t) => openIds.has(t.issue_id)),
    gone: state.today.filter((t) => !openIds.has(t.issue_id)),
  };
}

function goneIssue(issueId: string): Gone {
  const done = state.brief?.completed_today.find((i) => i.id === issueId);
  if (done) return { issue: done, doneToday: true };
  const known = goneIssues.get(issueId);
  if (known) return known;
  goneIssues.set(issueId, { loading: true });
  api.issuePreview(issueId)
    .then((issue) => goneIssues.set(issueId, { issue }))
    .catch((e) => goneIssues.set(issueId, { error: e instanceof ApiError ? e.message : String(e) }))
    .finally(() => { if (state.tab === "today" && !editing()) render(); });
  return { loading: true };
}

// ---- Today list: tasks on the left, the selected one in a reading pane ----------------------------
type Detail = { at: number; loading?: true; error?: string; issue?: IssuePreview };
const details = new Map<string, Detail>();           // reading pane content, by issue id

function loadDetail(id: string, force = false) {
  const d = details.get(id);
  if (!force && d && (d.loading || Date.now() - d.at < 2 * 60_000)) return;
  details.set(id, { ...d, at: Date.now(), loading: true });
  api.issuePreview(id)
    .then((issue) => details.set(id, { at: Date.now(), issue }))
    .catch((e) => details.set(id, { at: Date.now(), error: e instanceof ApiError ? e.message : String(e) }))
    .finally(() => {
      document.querySelectorAll<HTMLElement>(`.tl-detail[data-id="${id}"]`).forEach((el) => el.replaceWith(detailBody(id)));
    });
}

/** Plain text, split into paragraphs; never parsed as HTML. */
function paragraphs(text: string): HTMLElement[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).slice(0, 8)
    .map((p) => h("p", {}, p.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "")));
}

function detailBody(id: string): HTMLElement {
  const d = details.get(id);
  const i = d?.issue;
  if (!i) return h("div", { class: "tl-detail", "data-id": id },
    h("p", { class: "muted small" }, d?.error ? `Couldn't load the details: ${d.error}` : "Loading…"));
  const shown = [...i.comments].sort((x, y) => (y.created_at ?? "").localeCompare(x.created_at ?? ""));
  const older = i.comment_count - shown.length;
  return h("div", { class: "tl-detail", "data-id": id },
    h("section", {}, h("h4", {}, "Description"),
      i.description.trim() ? h("div", { class: "tl-desc" }, ...paragraphs(i.description),
        i.description_truncated ? link("More in Linear ↗", i.url, "link small") : "")
        : h("p", { class: "muted small" }, "No description.")),
    h("section", {}, h("h4", {}, `Comments${i.comment_count ? ` · ${i.comment_count}` : ""}`),
      shown.length ? h("div", {}, ...shown.map((c) => h("div", { class: "tl-comment" },
        h("span", {}, h("b", {}, c.author), " ", h("span", { class: "muted small" }, c.created_at ? when(c.created_at) : "")),
        h("span", { class: "tl-comment-body" }, c.body)))) : h("p", { class: "muted small" }, "No comments."),
      older > 0 ? link(`${older} older in Linear ↗`, i.url, "link small") : ""),
  );
}

function moveToday(issueId: string, delta: number) {
  const { open, gone } = todaySplit();
  const ids = open.map((t) => t.issue_id);
  const from = ids.indexOf(issueId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  void saveToday([...ids, ...gone.map((t) => t.issue_id)]);
}

function dropToday(dragged: string, before: string) {
  const { open, gone } = todaySplit();
  const ids = open.map((t) => t.issue_id).filter((x) => x !== dragged);
  const at = ids.indexOf(before);
  ids.splice(at < 0 ? ids.length : at, 0, dragged);
  void saveToday([...ids, ...gone.map((t) => t.issue_id)]);
}

/** ↑/↓ (or j/k) select in the Today list; ⌥↑/⌥↓ move the selected task. */
function stepToday(delta: number, move: boolean) {
  const { open } = todaySplit();
  if (!open.length) return;
  const ids = open.map((t) => t.issue_id);
  const cur = ids.indexOf(state.todaySel ?? "");
  if (move && cur >= 0) { moveToday(ids[cur], delta); return; }
  state.todaySel = ids[Math.max(0, Math.min(ids.length - 1, (cur < 0 ? 0 : cur + delta)))];
  render();
  document.querySelector(".tl-item.sel")?.scrollIntoView({ block: "nearest" });
}

let draggingToday: string | null = null;

function todayList(): HTMLElement {
  if (!state.today.length) {
    return h("div", { class: "empty" },
      h("p", {}, "Nothing picked for today."),
      h("p", { class: "muted" }, "Star (☆) a few issues in Client or Dev, or use the suggested plan above."));
  }
  if (!state.issuesLoaded) return h("div", { class: "empty" }, h("p", { class: "muted" }, "Loading from Linear…"));
  const today = state.brief?.day ?? isoDay(new Date());
  const waiting = state.brief?.waiting_state ?? "Pending";
  const { open, gone } = todaySplit();
  const issueOf = (t: TodayItem) => state.issues.find((i) => i.id === t.issue_id)!;
  if (!open.some((t) => t.issue_id === state.todaySel)) state.todaySel = open[0]?.issue_id ?? null;
  const sel = open.find((t) => t.issue_id === state.todaySel);
  const doneCount = gone.filter((t) => { const g = goneIssue(t.issue_id); return "issue" in g; }).length;

  const metaLine = (t: TodayItem, i: Issue) => {
    const due = i.due_date ? (i.due_date < today ? h("span", { class: "late" }, dueLabel(i.due_date, today).replace("overdue", "late"))
      : i.due_date === today ? h("span", { class: "due-today" }, "due today") : `due ${shortDay(i.due_date)}`) : "";
    const slip = state.slips?.slips[i.id];
    const bits: (string | Node)[] = [i.identifier, i.client ?? i.project ?? (i.list === "dev" ? "Dev" : "")];
    const tag = priorityTag(i.priority);
    if (tag) bits.push(tag);
    if (due) bits.push(due);
    if (slip && slip.count >= 2) bits.push(`pushed ${slip.count}×`);
    if (i.state.type === "started") bits.push("in progress");
    if (i.state.name === waiting) bits.push("waiting");
    if (t.event_start && t.event_minutes) {
      const s0 = new Date(t.event_start);
      const s1 = new Date(s0.getTime() + t.event_minutes * 60_000);
      const f = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      bits.push(h("span", { class: "blocked" }, `blocked ${f(s0)}–${f(s1)}`));
    }
    const out = h("span", { class: "tl-meta" });
    bits.filter((x) => x !== "").forEach((b, n) => { if (n) out.append(" · "); out.append(b); });
    return out;
  };

  const item = (t: TodayItem, n: number) => {
    const i = issueOf(t);
    const on = t.issue_id === state.todaySel;
    return h("div", {
      class: `tl-item${on ? " sel" : ""}${i.priority === 1 || i.priority === 2 ? ` prio-${i.priority}` : ""}`, draggable: "true", tabindex: "0", "data-id": i.id,
      "aria-selected": String(on), role: "option",
      onclick: (e: Event) => {
        if ((e.target as HTMLElement).closest("input, a, button")) return;
        state.todaySel = i.id; render();
      },
      ondragstart: (e: DragEvent) => { draggingToday = i.id; e.dataTransfer?.setData("text/plain", i.identifier); },
      ondragover: (e: DragEvent) => { if (draggingToday && draggingToday !== i.id) { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add("drop-before"); } },
      ondragleave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove("drop-before"),
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).classList.remove("drop-before");
        if (draggingToday && draggingToday !== i.id) dropToday(draggingToday, i.id);
        draggingToday = null;
      },
      ondragend: () => { draggingToday = null; },
    },
      h("span", { class: "tl-n" }, String(n + 1)),
      h("input", { type: "checkbox", class: "tl-box", title: "Mark done in Linear", "aria-label": `Mark ${i.identifier} done`,
        onchange: (e: Event) => { (e.target as HTMLInputElement).disabled = true; void completeIssue(i); } }),
      taskAvatar(i.client, i.category, "sm"),
      h("div", { class: "tl-body" }, h("span", { class: "tl-title" }, i.title), metaLine(t, i)));
  };

  const goneItem = (t: TodayItem) => {
    const g = goneIssue(t.issue_id);
    const i = "issue" in g ? g.issue : undefined;
    const finished = "issue" in g && (!!g.doneToday || g.issue.state.type === "completed" || g.issue.state.type === "canceled");
    return h("div", { class: `tl-item gone${finished ? " finished" : ""}` },
      h("span", { class: "tl-n" }),
      finished ? h("span", { class: "tl-check", "aria-hidden": "true" }, "✓") : h("span", { class: "tl-check muted" }, "–"),
      i ? taskAvatar(i.client, i.category, "sm") : h("span", { class: "avatar sm" }),
      h("div", { class: "tl-body" },
        h("span", { class: "tl-title" }, i?.title ?? ("error" in g ? "Not found in Linear" : "Loading…")),
        h("span", { class: "tl-meta" }, i ? `${i.identifier} · ${finished ? ("doneToday" in g && g.doneToday ? "done today" : i.state.name.toLowerCase()) : "no longer assigned to you"}` : "")),
      h("button", { class: "ghost small-btn", title: "Take it off Today",
        onclick: () => void saveToday(state.today.map((x) => x.issue_id).filter((x) => x !== t.issue_id)) }, "Remove"));
  };

  const pane = () => {
    if (!sel) return h("section", { class: "tl-pane" }, h("p", { class: "muted" }, "Everything on Today is done."));
    const i = issueOf(sel);
    loadDetail(i.id);
    const subs = state.issues.filter((x) => x.parent?.id === i.id);
    return h("section", { class: "tl-pane", "aria-label": i.identifier },
      h("span", { class: "tl-meta" }, [i.identifier, i.client ?? i.project].filter(Boolean).join(" · ")),
      h("h3", {}, i.title),
      h("div", { class: "tl-fields" },
        statusPill(i, (id) => { details.delete(i.id); void editIssue(i, { state_id: id }); }),
        priorityPill(i.priority, (v) => void editIssue(i, { priority: v })),
        dateInput(i.due_date, (v) => void editIssue(i, { due_date: v }), dueClass(i.due_date)),
        slipTag(state.slips?.slips[i.id])),
      h("div", { class: "tl-actions" },
        blockControls(sel),
        h("span", { class: "spacer" }),
        link("Open in Linear ↗", i.url, "ghost-link"),
        h("button", { class: "ghost small-btn", onclick: () => void saveToday(state.today.map((x) => x.issue_id).filter((x) => x !== i.id)) },
          "Remove from Today")),
      subs.length ? h("section", {}, h("h4", {}, `Sub-issues · ${subs.length}`),
        h("ul", { class: "tl-subs" }, ...subs.map((x) => h("li", {}, link(x.identifier, x.url, "ident"),
          h("span", { class: "dtitle" }, x.title),
          x.due_date && x.due_date < today ? h("span", { class: "late small" }, dueLabel(x.due_date, today).replace("overdue", "late")) : "",
          h("span", { class: "muted small" }, x.state.name))))) : "",
      detailBody(i.id),
    );
  };

  return h("div", { class: "tl" },
    h("div", { class: "tl-head" },
      h("h2", {}, "Today"),
      h("span", { class: "muted small" }, `${open.length} open${doneCount ? ` · ${doneCount} done` : ""} · ↑↓ to select, ⌥↑↓ or drag to reorder`)),
    h("div", { class: "tl-grid" },
      h("div", { class: "tl-list", role: "listbox", "aria-label": "Today" }, ...open.map(item), ...gone.map(goneItem)),
      pane()),
  );
}

async function showSummary(client: string) {
  try {
    const { text } = await api.clientSummary(client);
    const area = h("textarea", { class: "summary-text", rows: 16, value: text, "aria-label": "Summary draft" });
    const copy = h("button", {
      class: "primary",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(area.value);
          copy.textContent = "Copied";
        } catch {
          area.select();
          copy.textContent = "Press ⌘C";
        }
      },
    }, "Copy");
    modal(`${client}: weekly summary (draft)`, h("div", {},
      h("p", { class: "muted small" }, "Edit it, copy it, and send it yourself. Nothing is sent from here."), area), [copy]);
  } catch (e) {
    fail(e);
  }
}

function sortIssues(a: Issue, b: Issue): number {
  const pa = a.priority || 9;
  const pb = b.priority || 9;
  if (pa !== pb) return pa - pb;
  if (a.due_date !== b.due_date) return (a.due_date ?? "9999") < (b.due_date ?? "9999") ? -1 : 1;
  return b.updated_at.localeCompare(a.updated_at);
}

function listView(kind: "client" | "dev"): HTMLElement {
  if (!state.issuesLoaded) return h("div", { class: "empty" }, h("p", { class: "muted" }, "Loading from Linear…"));
  const items = state.issues.filter((i) => i.list === kind && matches(i));
  if (!items.length) return h("div", { class: "empty" }, h("p", {}, state.filter ? "No issues match the filter." : "No open issues."));
  // Sub-issues sit under their parent when the parent is in this list too.
  const shown = new Set(items.map((i) => i.id));
  const children = new Map<string, Issue[]>();
  const top: Issue[] = [];
  for (const i of items) {
    if (i.parent && shown.has(i.parent.id)) children.set(i.parent.id, [...(children.get(i.parent.id) ?? []), i]);
    else top.push(i);
  }
  const groups = new Map<string, Issue[]>();
  for (const i of top) {
    const key = (kind === "client" ? i.client : i.project) ?? "No project";
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const names = [...groups.keys()].sort((a, b) =>
    a === "No project" ? 1 : b === "No project" ? -1 : a.localeCompare(b));
  const field = kind === "client" ? "client" : "project";
  const withChildren = (i: Issue): HTMLElement[] => [
    issueRow(i, field),
    ...(children.get(i.id) ?? []).sort(sortIssues).map((c) => issueRow(c, field, true)),
  ];
  return h(
    "div",
    { class: "groups" },
    ...names.map((name) => {
      const list = groups.get(name)!.sort(sortIssues);
      const total = list.reduce((n, i) => n + 1 + (children.get(i.id)?.length ?? 0), 0);
      return h("section", { class: "group" },
        h("h2", {}, name, h("span", { class: "count" }, String(total)),
          kind === "client" && name !== "No project" &&
            h("button", { class: "ghost small-btn group-action", onclick: () => void showSummary(name) }, "Weekly summary")),
        ...list.flatMap(withChildren),
      );
    }),
  );
}

// ---- by status ------------------------------------------------------------------------------
/** In progress first, then the not-started statuses in Linear's order, then backlog. */
const STATUS_RANK: Record<string, number> = { started: 0, unstarted: 1, backlog: 2 };

/** Client or Dev issues as one table per open Linear status, in the same rows as the grouped
 *  view. Change a row's status with its status menu and it moves to that group. */
function statusView(kind: "client" | "dev"): HTMLElement {
  if (!state.issuesLoaded) return h("div", { class: "empty" }, h("p", { class: "muted" }, "Loading from Linear…"));
  const items = state.issues.filter((i) => i.list === kind && matches(i));
  if (!items.length) return h("div", { class: "empty" }, h("p", {}, state.filter ? "No issues match the filter." : "No open issues."));
  const states = (state.meta?.states ?? []).filter((s) => s.type in STATUS_RANK);
  // Statuses the issues use but the team list doesn't have (stale meta) still get a group.
  for (const i of items) if (!states.some((s) => s.id === i.state.id)) states.push(i.state);
  const order = states.map((s, n) => ({ s, n }))
    .sort((a, b) => (STATUS_RANK[a.s.type] ?? 3) - (STATUS_RANK[b.s.type] ?? 3) || a.n - b.n)
    .map((x) => x.s);
  const backlog = items.filter((i) => i.state.type === "backlog");
  // The row shows the other field: the client on Client, the project on Dev.
  const other = kind === "client" ? "project" : "client";
  const groups = order
    .filter((s) => s.type !== "backlog" || state.showBacklog)
    .map((s) => ({ s, list: items.filter((i) => i.state.id === s.id).sort(sortIssues) }))
    .filter((g) => g.list.length);
  return h("div", { class: "groups" },
    ...groups.map(({ s, list }) => h("section", { class: `group st-group st-${s.type}` },
      h("h2", {}, h("span", { class: "sdot" }), s.name, h("span", { class: "count" }, String(list.length))),
      ...list.map((i) => issueRow(i, other)),
    )),
    backlog.length > 0 && h("button", {
      class: "ghost small-btn backlog-toggle", "aria-pressed": String(state.showBacklog),
      onclick: () => { state.showBacklog = !state.showBacklog; render(); },
    }, state.showBacklog ? "Hide backlog" : `Show backlog (${backlog.length})`),
  );
}

function setLayout(kind: "client" | "dev", layout: "group" | "status") {
  state.listLayout[kind] = layout;
  savePref(kind === "client" ? "todohub.clientView" : "todohub.devView", layout);
  render();
}

function layoutToggle(kind: "client" | "dev"): HTMLElement {
  const current = state.listLayout[kind];
  const by = kind === "client" ? "client" : "project";
  const btn = (id: "group" | "status", label: string) => h("button", {
    class: current === id ? "on" : "", "aria-pressed": String(current === id),
    title: `${label} (press v to switch)`, onclick: () => setLayout(kind, id),
  }, label);
  return h("div", { class: "seg", role: "group", "aria-label": "Group by" },
    btn("group", `By ${by}`), btn("status", "By status"));
}

function matches(x: Candidate | Issue): boolean {
  if (!state.filter) return true;
  const q = state.filter.toLowerCase();
  const hay = "identifier" in x
    ? [x.identifier, x.title, x.client, x.project]
    : [x.title, x.client_label, x.who, x.excerpt];
  return hay.some((s) => s?.toLowerCase().includes(q));
}

// ---- sidebar --------------------------------------------------------------------------------
const NAV_ICON: Record<Tab, string[]> = {
  inbox: ["M3 11.5 5.2 4.6A1.5 1.5 0 0 1 6.6 3.6h6.8a1.5 1.5 0 0 1 1.4 1L17 11.5V15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15z",
          "M3 11.5h4l1 2h4l1-2h4"],
  today: ["M10 6.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z",
          "M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1"],
  client: ["M4.5 6.5h11A1.5 1.5 0 0 1 17 8v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15V8a1.5 1.5 0 0 1 1.5-1.5z",
           "M7.5 6.5V5A1.5 1.5 0 0 1 9 3.5h2A1.5 1.5 0 0 1 12.5 5v1.5M3 11h14"],
  dev: ["M7 6 3 10l4 4M13 6l4 4-4 4M11.2 4.5 8.8 15.5"],
  insights: ["M4.5 16.5v-5M8.5 16.5v-9M12.5 16.5v-6.5M16.5 16.5v-11"],
};

function navIcon(tab: Tab): SVGElement {
  return svg("svg", { viewBox: "0 0 20 20", width: 18, height: 18, fill: "none", stroke: "currentColor",
    "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
    ...NAV_ICON[tab].map((d) => svg("path", { d })));
}

function goTab(id: Tab) {
  // Leaving a client the sidebar picked drops that filter, so the next tab starts unfiltered.
  if (state.pickedClient && state.filter === state.pickedClient) state.filter = "";
  state.pickedClient = null;
  state.tab = id;
  render();
  if (id !== "inbox" && !state.issuesLoaded) void refresh(true);
}

function pickClient(name: string) {
  state.tab = "client";
  state.filter = name;
  state.pickedClient = name;
  render();
  if (!state.issuesLoaded) void refresh(true);
}

/** Clients with open client issues, the ones that need you first: overdue, then a meeting
 *  still ahead today, then the most open issues. */
function sidebarClients(): { name: string; open: number; late: number; meeting: string | null }[] {
  const today = localToday();
  const now = new Date();
  const nowHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const meetings = state.brief?.day === today ? state.brief.agenda ?? [] : [];
  const by = new Map<string, { open: number; late: number }>();
  for (const i of state.issues) {
    if (i.list !== "client" || !i.client) continue;
    const c = by.get(i.client) ?? { open: 0, late: 0 };
    c.open += 1;
    if (i.due_date && i.due_date < today) c.late += 1;
    by.set(i.client, c);
  }
  return [...by.entries()].map(([name, c]) => {
    const words = name.toLowerCase().split(/[\s&]+/).filter((w) => w.length > 2);
    const next = meetings.find((m) => (m.end ?? m.start) >= nowHM &&
      (m.title.toLowerCase().includes(name.toLowerCase()) || (words[0] && m.title.toLowerCase().includes(words[0]))));
    return { name, ...c, meeting: next ? hm12(next.start) : null };
  }).sort((a, b) => (b.late - a.late) || (Number(!!b.meeting) - Number(!!a.meeting)) || (b.open - a.open)
    || a.name.localeCompare(b.name));
}

function hm12(hm: string): string {
  const [hh, mm] = hm.split(":").map(Number);
  return `${hh % 12 || 12}:${String(mm).padStart(2, "0")}`;
}

/** "10:02" today, "Wed 4:00 PM" this week, "Nov 3" before. */
function shortWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
  if (now.getTime() - d.getTime() < 6 * 864e5) return d.toLocaleDateString([], { weekday: "short" }) + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function problemWord(detail: string | null): string {
  return detail && /sign.?in|auth|log ?in|connect/i.test(detail) ? "sign-in" : "failed";
}

/** Bottom of the sidebar: each source, when it last worked, and ↻ to check just that one. */
function sweepStatus(): HTMLElement {
  const r = state.run;
  const running = r.status === "running";
  const overview: SourceOverview[] = r.source_overview?.length ? r.source_overview
    : (r.sources ?? []).map((s) => ({ source: s.source, ok: s.ok, detail: s.detail, at: r.started_at ?? null,
        last_ok_at: s.ok ? r.started_at ?? null : null }));
  const row = (o: SourceOverview) => {
    const name = SOURCE_NAME[o.source];
    const busy = running && (!r.scope || r.scope === o.source);
    const failed = o.ok === false;
    const timeText = busy ? "checking…" : failed ? problemWord(o.detail) : o.last_ok_at ? shortWhen(o.last_ok_at) : "not yet";
    const tip = failed
      ? `${name}: ${o.detail ?? "problem"} (${shortWhen(o.at)}).${o.last_ok_at ? ` Last worked ${shortWhen(o.last_ok_at)}; the next check catches up from there.` : ""}`
      : o.last_ok_at ? `${name}: last checked ${shortWhen(o.last_ok_at)}.` : `${name}: not checked yet.`;
    return h("div", { class: `src-row${failed ? " bad" : ""}${busy ? " busy" : ""}`, title: tip },
      h("span", { class: `src-dot${o.ok === null ? " none" : ""}` }),
      h("span", { class: "src-name" }, name),
      h("span", { class: "src-time" }, timeText),
      busy ? h("span", { class: "src-act" }, h("span", { class: "spinner" }))
        : h("button", {
            class: "src-act", disabled: running, "aria-label": `Check ${name} now`,
            title: `Check ${name} now${o.last_ok_at ? `: reads what's new since ${shortWhen(o.last_ok_at)}` : ""}${o.source === "github" ? " (no Claude run)" : ""}`,
            onclick: () => void runNow(o.source),
          }, "↻"));
  };
  return h("div", { class: "sweep" },
    h("div", { class: "src-head" }, h("span", {}, "Sources"),
      nextSweep() ? h("span", { class: "sweep-next", title: `Next scheduled sweep: ${nextSweepAt()!.toLocaleString([],
        { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` }, `next ${nextSweep()}`) : ""),
    overview.length ? h("div", { class: "src-list" }, ...overview.map(row))
      : h("div", { class: "sweep-line" }, h("span", { class: "sdot" }), "No sweeps yet"),
    h("div", { class: "sweep-actions" },
      h("button", { class: "secondary small-btn", disabled: running, title: "Sweep every source now", onclick: () => void runNow() },
        running && !r.scope ? "Sweeping…" : "Run all"),
      h("span", { class: "spacer" }),
      themeButton(),
      h("button", { class: "icon help", title: "Keyboard shortcuts (?)", "aria-label": "Keyboard shortcuts", onclick: showShortcuts }, "?")),
  );
}

/** The theme button: opens a menu of System, Light, Dark and Daylight (t still cycles them). */
function themeButton(): HTMLElement {
  const { choice, label } = themeLabel();
  const menu = h("details", { class: "drop-menu theme-menu" },
    h("summary", { class: `theme tm-face tm-${choice}`, title: `${label} (or press t to cycle)`, "aria-label": label }, themeIcon(choice)),
    h("div", { class: "menu", role: "menu" }, ...themeOptions().map((o) => h("button", {
      type: "button", role: "menuitemradio", "aria-checked": String(o.choice === choice),
      class: o.choice === choice ? "on" : "",
      onclick: (e: Event) => {
        e.preventDefault();
        (menu as HTMLDetailsElement).open = false;
        if (o.choice !== choice) { setTheme(o.choice); renderHeader(); }
      },
    }, h("span", { class: `tm-ico tm-${o.choice}` }, themeIcon(o.choice)),
      h("span", { class: "tm-text" }, h("span", { class: "tm-name" }, o.name),
        o.note ? h("span", { class: "tm-note" }, o.note) : "")))));
  return menu;
}

const SIDEBAR_CLIENTS = 6;

/** The left sidebar: sections, clients that need you, and the sweep. (Named for the top bar it
 *  replaced; everything that changes a count calls it.) */
function renderHeader() {
  const side = document.querySelector("aside.sidebar");
  if (!side) return;
  if (state.issuesLoaded) ensureBrief();     // for "meeting at 2:30" next to a client
  const counts: Record<Tab, number> = {
    inbox: state.candidates.length,
    today: state.issuesLoaded ? todaySplit().open.length : state.today.length,
    insights: 0,
    client: state.issues.filter((i) => i.list === "client").length,
    dev: state.issues.filter((i) => i.list === "dev").length,
  };
  const item = (id: Tab, label: string, key: number) => {
    const showCount = id !== "insights" && (id === "inbox" || id === "today" || state.issuesLoaded);
    const on = state.tab === id && !(id === "client" && state.pickedClient);
    return h("button", {
      class: `nav${on ? " active" : ""}`, title: `${label} (⌘${key})`, "aria-current": on ? "page" : undefined,
      onclick: () => goTab(id),
    }, navIcon(id), h("span", { class: "nav-label" }, label),
      showCount && h("span", { class: `count${id === "inbox" && counts.inbox > 0 ? " hot" : ""}` }, String(counts[id])));
  };
  const clients = state.issuesLoaded ? sidebarClients() : [];
  const shown = state.allClients ? clients : clients.slice(0, SIDEBAR_CLIENTS);
  side.replaceChildren(
    h("div", { class: "side-brand" },
      h("img", { class: "brand-logo", src: "/logo.svg", alt: "" }),
      h("strong", { class: "nav-label" }, "TodoHub"),
      h("button", {
        class: "icon add", title: "Capture a task (c)", "aria-label": "Capture a task",
        onclick: () => { goTab("inbox"); captureInput.focus(); },
      }, "+")),
    h("nav", { class: "side-nav", "aria-label": "Sections" },
      item("inbox", "Inbox", 1), item("today", "Today", 2), item("client", "Client", 3), item("dev", "Dev", 4),
      item("insights", "Insights", 5)),
    clients.length > 0 ? h("div", { class: "side-group" }, "Clients") : "",
    clients.length > 0 ? h("div", { class: "side-clients" },
      ...shown.map((c) => h("button", {
        class: `client-link${state.tab === "client" && state.pickedClient === c.name ? " active" : ""}`,
        title: `${c.name}: ${c.open} open${c.late ? `, ${c.late} overdue` : ""}${c.meeting ? `, meeting at ${c.meeting}` : ""}`,
        onclick: () => pickClient(c.name),
      }, clientLogo(c.name), h("span", { class: "client-name" }, c.name),
        c.late ? h("span", { class: "client-hint late" }, `${c.late} late`)
          : c.meeting ? h("span", { class: "client-hint" }, c.meeting)
          : h("span", { class: "client-hint" }, String(c.open)))),
      clients.length > SIDEBAR_CLIENTS && h("button", {
        class: "client-link more", onclick: () => { state.allClients = !state.allClients; renderHeader(); },
      }, state.allClients ? "Show fewer" : `+ ${clients.length - SIDEBAR_CLIENTS} more`)) : "",
    h("div", { class: "side-fill" }),
    sweepStatus(),
  );
}

// ---- due-date slips -------------------------------------------------------------------------------
function ensureSlips() {
  if (Date.now() - state.slipsAt < 10 * 60_000) return;
  state.slipsAt = Date.now();
  api.slips()
    .then((s) => { state.slips = s; if ((state.tab === "client" || state.tab === "dev" || state.tab === "today") && !editing()) render(); })
    .catch(() => { state.slipsAt = 0; });
}

function shortDay(day: string): string {
  return new Date(day + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" });
}

/** "pushed 2×" on an issue whose due date was moved later; the dates are in the tooltip. */
function slipTag(s: Slip | undefined): HTMLElement | "" {
  if (!s) return "";
  const steps = s.changes.map((c) => `${shortDay(c.from)} → ${shortDay(c.to)}${c.by ? ` (${c.by})` : ""}`).join("\n");
  return h("span", {
    class: `slip${s.count >= 2 ? " repeat" : ""}`,
    title: `Due date pushed ${s.count} time${s.count === 1 ? "" : "s"}, ${s.days} day${s.days === 1 ? "" : "s"} in all:\n${steps}`,
  }, `pushed ${s.count}×`);
}

function render() {
  if (state.tab === "client" || state.tab === "dev" || state.tab === "today") ensureSlips();
  ensureLogos([...state.candidates.map((c) => c.client_label), ...state.issues.map((i) => i.client)]);
  renderHeader();
  const main = document.querySelector("main")!;
  const problems = (state.run.source_overview?.length ? state.run.source_overview : state.run.sources ?? [])
    .filter((s) => s.ok === false);
  const toolbar = h(
    "div",
    { class: "toolbar" },
    h("input", {
      class: "filter", type: "search", placeholder: "Filter", value: state.filter,
      oninput: (e: Event) => {
        state.filter = (e.target as HTMLInputElement).value;
        if (state.pickedClient) { state.pickedClient = null; renderHeader(); }
        const f = focusedCandidate();
        if (f && !matches(f)) state.focus = null;
        const content = document.querySelector(".content");
        content?.replaceChildren(view());
      },
    }),
    h("button", { class: "ghost", title: "Reload from Linear: issues, labels, projects and statuses; re-check the Inbox",
      onclick: async (e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = "Refreshing…";
        await refresh(true, "force");
        btn.disabled = false;
        btn.textContent = "Refresh";
      } }, "Refresh"),
    (state.tab === "client" || state.tab === "dev") && layoutToggle(state.tab),
  );
  const byStatus = (state.tab === "client" || state.tab === "dev") && state.listLayout[state.tab] === "status";
  const view = () =>
    state.tab === "inbox" ? inboxView()
      : state.tab === "today" ? todayView()
      : state.tab === "insights" ? insightsView(() => { if (state.tab === "insights") render(); }, (t) => goTab(t))
      : byStatus ? statusView(state.tab as "client" | "dev")
      : listView(state.tab as "client" | "dev");
  main.replaceChildren(
    state.error ? h("div", { class: "banner error" }, state.error) : "",
    state.tab === "inbox" && state.run.status !== "running" && problems.length
      ? h("div", { class: "banner warn" },
          ...problems.map((p) => h("div", {}, `${SOURCE_NAME[p.source]}: ${p.detail ?? "problem during the last sweep"}`)))
      : "",
    state.tab === "inbox" ? captureBar : "",
    state.tab === "insights" || state.tab === "today" ? "" : toolbar,
    h("div", { class: "content" }, view()),
  );
}

// ---- on-demand capture ----------------------------------------------------------------------
// Built once and reused, so what you've typed survives re-renders.
const captureInput = h("input", {
  class: "capture-input",
  placeholder: "Capture a task: type a note, or paste a Slack, Gmail or Grain link",
  "aria-label": "Capture a task",
  onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") void submitCapture(); },
});
const captureStatus = h("span", { class: "muted small capture-status" });
const captureBtn = h("button", { class: "secondary", onclick: () => void submitCapture() }, "Add");
const captureBar = h("div", { class: "capture" }, captureInput, captureBtn, captureStatus);

function setCapturing(on: boolean, message = "") {
  captureBtn.disabled = on;
  captureInput.disabled = on;
  captureStatus.replaceChildren(on ? h("span", { class: "spinner" }) : "", message);
}

async function submitCapture() {
  const text = captureInput.value.trim();
  if (!text) return;
  try {
    const r = await api.capture(text);
    if (r.mode === "note") {
      captureInput.value = "";
      await loadCandidates();
      render();
      toast(r.status === "added" ? "Added to the Inbox" : "Already in the Inbox");
      return;
    }
    setCapturing(true, "Reading the link with Claude…");
    const started = Date.now();
    await new Promise((r) => setTimeout(r, 1500));
    for (;;) {
      const run = await api.latestRun("capture");
      const fresh = run.started_at && Date.parse(run.started_at) >= started - 5000;
      if (fresh && run.status !== "running") {
        setCapturing(false);
        if (run.status === "ok") {
          captureInput.value = "";
          await loadCandidates();
          render();
          toast(`Added ${run.added} task${run.added === 1 ? "" : "s"} from the link`);
        } else {
          toast(`Capture failed: ${run.error ?? "unknown error"}`, undefined, true);
        }
        return;
      }
      if (Date.now() - started > 5 * 60_000) throw new ApiError("Capture is taking too long; check logs/capture-*.log");
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (e) {
    setCapturing(false);
    fail(e);
  }
}

// ---- keyboard -----------------------------------------------------------------------------------
const SHORTCUTS: [string, string][] = [
  ["j / k", "Next / previous task"],
  ["a", "Approve (or close / post / track)"],
  ["d, then 1–5", "Drop, with a reason"],
  ["s, then 1–3", "Snooze: tomorrow / next Monday / in a week"],
  ["m", "Merge a possible duplicate into the existing issue"],
  ["x", "Select for bulk actions"],
  ["⌘Z", "Undo the last action (approve, drop, snooze, issue edit)"],
  ["⇧⌘R", "Reload: restart the backend and the window after a code change"],
  ["e", "Edit the title"],
  ["c", "Capture a task"],
  ["/", "Filter"],
  ["⌘1 – ⌘5", "Inbox, Today, Client, Dev, Insights"],
  ["⌥⌘T", "Capture from anywhere (when TodoHub is running)"],
  ["↑ ↓", "Today: select a task (⌥↑ ⌥↓ moves it)"],
  ["v", "Client / Dev: group by client or project ↔ by status · Today: brief ↔ checklist"],
  ["t", "Theme: follow the Mac → light → dark → daylight (follows the time of day)"],
  ["?", "This list"],
];
const TAB_ORDER: Tab[] = ["inbox", "today", "client", "dev", "insights"];

function markFocus() {
  document.querySelectorAll<HTMLElement>(".card").forEach((el) => {
    el.classList.toggle("focused", Number(el.dataset.id) === state.focus);
  });
}

function focusedCandidate(): Candidate | undefined {
  return state.candidates.find((c) => c.id === state.focus);
}

function closeMenus() {
  document.querySelectorAll<HTMLDetailsElement>("details.drop-menu[open]").forEach((d) => { d.open = false; });
}

function moveFocus(delta: number) {
  closeMenus();
  const ids = state.candidates.filter(matches).map((c) => c.id);
  if (!ids.length) return;
  const at = state.focus === null ? -1 : ids.indexOf(state.focus);
  state.focus = ids[Math.min(ids.length - 1, Math.max(0, at + delta))];
  markFocus();
  document.querySelector(`.card[data-id="${state.focus}"]`)?.scrollIntoView({ block: "nearest" });
}

function focusedCard(): HTMLElement | null {
  return document.querySelector(`.card[data-id="${state.focus}"]`);
}

function showShortcuts() {
  modal("Keyboard shortcuts", h("table", { class: "stats" },
    h("tbody", {}, ...SHORTCUTS.map(([k, v]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, v))))));
}

// A click anywhere outside an open Snooze or Drop menu closes it (including opening the other one).
// Same for the balance popover.
document.addEventListener("pointerdown", (e) => {
  // (Removed in place, not re-rendered, so the click that closed it still lands on its target.)
  if (state.balanceOpen && !(e.target as Element).closest?.(".bal-anchor")) {
    state.balanceOpen = false;
    document.querySelector(".bal-pop")?.remove();
    document.querySelector(".bal-anchor .mtile-pill")?.setAttribute("aria-expanded", "false");
  }
  document.querySelectorAll<HTMLDetailsElement>("details.drop-menu[open]").forEach((d) => {
    if (!d.contains(e.target as Node)) d.open = false;
  });
}, true);

const inApp = "__TAURI_INTERNALS__" in window;

function isTextField(el: Element | null): boolean {
  return !!el && (el.tagName === "TEXTAREA"
    || (el.tagName === "INPUT" && ["text", "search", "url", "email", ""].includes((el as HTMLInputElement).type)));
}

/** Called by the app's Edit → Undo (⌘Z): undo typing in a text field, else the last action. */
(window as unknown as { todohubUndo: () => void }).todohubUndo = () => {
  if (isTextField(document.activeElement)) {
    document.execCommand("undo");
    return;
  }
  if (!document.querySelector(".overlay")) void undo();
};

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  if ((e.metaKey || e.ctrlKey) && /^[1-5]$/.test(e.key)) {
    e.preventDefault();
    goTab(TAB_ORDER[Number(e.key) - 1]);
    return;
  }
  // ⌘Z undoes the last action, except in a text field, where it undoes typing as usual.
  // In the app, Edit → Undo owns ⌘Z and calls todohubUndo(); this is for a plain browser.
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z"
      && !inApp && !isTextField(target) && !document.querySelector(".overlay")) {
    e.preventDefault();
    void undo();
    return;
  }
  if (e.key === "Escape" && state.balanceOpen) { state.balanceOpen = false; render(); return; }
  if (typing) {
    if (e.key === "Escape") target.blur();
    return;
  }
  const todayList = state.tab === "today" && state.todayLayout === "brief" && !document.querySelector(".overlay");
  if (todayList && !e.metaKey && !e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    stepToday(e.key === "ArrowUp" ? -1 : 1, e.altKey);
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".overlay")) return;

  // An open status or priority menu takes the next digit.
  const pill = document.querySelector<HTMLDetailsElement>("details.pill-menu[open]");
  if (pill && /^[1-9]$/.test(e.key)) {
    pill.querySelectorAll<HTMLButtonElement>(".menu > button")[Number(e.key) - 1]?.click();
    e.preventDefault();
    return;
  }
  if (pill && e.key === "Escape") { pill.open = false; return; }
  // A menu opened with d or s takes the next digit: only the focused card's menu.
  const open = focusedCard()?.querySelector<HTMLDetailsElement>("details.drop-menu[open]") ?? null;
  if (open && /^[1-9]$/.test(e.key)) {
    const items = open.querySelectorAll<HTMLButtonElement>(".menu > button");
    items[Number(e.key) - 1]?.click();
    e.preventDefault();
    return;
  }
  if (e.key === "Escape" && document.querySelector("details.drop-menu[open]")) { closeMenus(); return; }

  // Only act on a card you can see (a filter may have hidden the focused one).
  const c = focusedCard() ? focusedCandidate() : undefined;
  switch (e.key) {
    case "?": showShortcuts(); break;
    case "t": nextTheme(); renderHeader(); break;
    case "v":
      if (state.tab === "client" || state.tab === "dev") {
        setLayout(state.tab, state.listLayout[state.tab] === "status" ? "group" : "status");
      } else if (state.tab === "today") {
        setTodayLayout(state.todayLayout === "checklist" ? "brief" : "checklist");
      }
      break;
    case "/": e.preventDefault(); document.querySelector<HTMLInputElement>(".filter")?.focus(); break;
    case "c": e.preventDefault(); goTab("inbox"); captureInput.focus(); break;
    case "j": if (state.tab === "inbox") moveFocus(1); else if (todayList) stepToday(1, false); break;
    case "k": if (state.tab === "inbox") moveFocus(-1); else if (todayList) stepToday(-1, false); break;
    case "a": if (c) void approve(c); break;
    case "m": if (c?.possible_duplicate && (c.kind === "task" || c.kind === "waiting")) void merge(c); break;
    case "x": if (c) toggleSelect(c.id); break;
    case "e": if (c) { e.preventDefault(); focusedCard()?.querySelector<HTMLInputElement>(".title-input")?.focus(); } break;
    case "d": if (c) { closeMenus(); const m = focusedCard()?.querySelector<HTMLDetailsElement>("details.drop-menu:not(.snooze-menu)"); if (m) m.open = true; } break;
    case "s": if (c) { closeMenus(); const m = focusedCard()?.querySelector<HTMLDetailsElement>("details.snooze-menu"); if (m) m.open = true; } break;
    default: return;
  }
});

// ---- start ----------------------------------------------------------------------------------
async function start() {
  document.querySelector("#app")!.replaceChildren(h("aside", { class: "sidebar" }), h("main", {}), h("div", { class: "toasts" }));
  render();
  try {
    await waitForBackend();
  } catch (e) {
    state.error = e instanceof ApiError ? e.message : String(e);
    render();
    return;
  }
  // Daylight theme: a location from config.toml, if set; otherwise it stays on the time zone.
  onDaylightPhase(() => renderHeader());
  api.daylight().then(({ location }) => {
    setDaylightLocation(location);
    if (currentTheme() === "daylight") { applyTheme(); renderHeader(); }
  }).catch(() => undefined);
  onDesktopEvent("capture", () => { state.tab = "inbox"; render(); captureInput.focus(); });
  onDesktopEvent("run-now", () => void runNow());
  await refresh(true);
  pollWhileRunning();
  setInterval(() => void refresh(state.tab !== "inbox").then(pollWhileRunning), 60_000);
  setInterval(briefReminders, 60_000);
  briefReminders();
  window.addEventListener("focus", () => void refresh(state.tab !== "inbox", "reload").then(pollWhileRunning));
}

void start();
