import { openUrl } from "@tauri-apps/plugin-opener";
import { api, ApiError, waitForBackend } from "./api";
import { h, link, modal } from "./dom";
import { insightsView, invalidateInsights } from "./insights";
import { notifyNew, onDesktopEvent, setTrayCount } from "./desktop";
import { applyTheme, nextTheme, themeIcon, themeLabel } from "./theme";
import { ensureLogos, taskAvatar } from "./avatars";

applyTheme();
import type { Candidate, CandidateEdit, DropReason, Issue, Meta, Run, Source, Subtask, TodayItem } from "./api";

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
  manual: "Captured",
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
  selected: new Set<number>(),
  focus: null as number | null,
  run: {} as Run,
  drafts: new Map<number, CandidateEdit>(),
  busy: new Set<string>(),
  error: null as string | null,
};

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

function nextSweep(): string {
  const now = new Date();
  for (let add = 0; add < 8; add++) {
    const d = new Date(now);
    d.setDate(now.getDate() + add);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    for (const hour of SCHEDULE_HOURS) {
      d.setHours(hour, 0, 0, 0);
      if (d > now) return add === 0 ? `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}` : when(d.toISOString());
    }
  }
  return "";
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
  const [pending, snoozed] = await Promise.all([api.candidates(), api.candidates("snoozed")]);
  state.candidates = pending;
  state.snoozed = snoozed;
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

async function refresh(all = false) {
  try {
    // Linear may be unreachable (no key yet, offline); the queue still works without it.
    if (!state.meta) state.meta = await api.meta();
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

async function runNow() {
  try {
    await api.runNow();
    state.run = { ...state.run, status: "running", started_at: new Date().toISOString() };
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
function prioritySelect(value: number, onChange: (v: number) => void) {
  return h(
    "select",
    { class: `prio p${value}`, title: "Priority", onchange: (e: Event) => onChange(Number((e.target as HTMLSelectElement).value)) },
    ...PRIORITIES.map((p) => h("option", { value: String(p.value), selected: p.value === value }, p.name)),
  );
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
    ),
  );
  return menu;
}

function candidateCard(c: Candidate): HTMLElement {
  const card = candidateCardBody(c);
  const body = h("div", { class: "card-body" });
  body.append(...Array.from(card.childNodes));
  card.append(taskAvatar(c.client_label, c.category, "lg"), body);
  return card;
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
      !acting && c.possible_duplicate &&
        h("span", { class: "chip warn", title: refIssue ? refIssue.title : "Similar open issue" },
          "Maybe duplicate of ", link(c.possible_duplicate, refIssue?.url ?? null, "")),
    ),
    titleEl,
    c.why && h("p", { class: "why" }, c.why),
    c.excerpt && h("blockquote", {}, c.excerpt),
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
      !acting && prioritySelect(val("priority") ?? 0, (v) => { d.priority = v; }),
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
      snoozedList());
  }
  return h("div", {}, bulkBar(), h("div", { class: "cards" }, ...items.map(candidateCard)), snoozedList());
}

function issueRow(i: Issue, showGroupField: "client" | "project", nested = false): HTMLElement {
  const states = state.meta?.states ?? [i.state];
  const parts = [showGroupField === "client" ? i.project : i.client];
  // A sub-issue whose parent isn't shown above it says which issue it belongs to.
  if (i.parent && !nested) parts.push(`↳ ${i.parent.identifier} ${i.parent.title}`);
  const side = parts.filter(Boolean).join(" · ");
  const picked = state.today.some((t) => t.issue_id === i.id);
  return h(
    "div",
    { class: `row${nested ? " child" : ""}` },
    h("button", {
      class: `star${picked ? " on" : ""}`, title: picked ? "Remove from Today" : "Add to Today",
      "aria-label": picked ? "Remove from Today" : "Add to Today", "aria-pressed": String(picked),
      onclick: () => void toggleToday(i.id),
    }, picked ? "★" : "☆"),
    taskAvatar(i.client, i.category, "sm"),
    link(i.identifier, i.url, "ident"),
    h("div", { class: "row-title" }, h("span", { title: i.title }, i.title), side && h("span", { class: "muted small" }, side)),
    h(
      "select",
      { class: `status st-${i.state.type}`, title: "Status",
        onchange: (e: Event) => void editIssue(i, { state_id: (e.target as HTMLSelectElement).value }) },
      ...states.map((s) => h("option", { value: s.id, selected: s.id === i.state.id }, s.name)),
    ),
    prioritySelect(i.priority, (v) => void editIssue(i, { priority: v })),
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

function moveToday(issueId: string, delta: number) {
  const ids = state.today.map((t) => t.issue_id);
  const from = ids.indexOf(issueId);
  const to = from + delta;
  if (to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  void saveToday(ids);
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

function todayView(): HTMLElement {
  if (!state.today.length) {
    return h("div", { class: "empty" },
      h("p", {}, "Nothing picked for today."),
      h("p", { class: "muted" }, "Star (☆) a few issues in Client or Dev to plan your day."));
  }
  if (!state.issuesLoaded) return h("div", { class: "empty" }, h("p", { class: "muted" }, "Loading from Linear…"));
  return h("div", { class: "today" },
    ...state.today.map((t, idx) => {
      const issue = state.issues.find((i) => i.id === t.issue_id);
      return h("div", { class: "today-item" },
        h("div", { class: "today-order" },
          h("button", { class: "icon", title: "Move up", "aria-label": "Move up", disabled: idx === 0,
            onclick: () => moveToday(t.issue_id, -1) }, "↑"),
          h("span", { class: "muted small" }, String(idx + 1)),
          h("button", { class: "icon", title: "Move down", "aria-label": "Move down", disabled: idx === state.today.length - 1,
            onclick: () => moveToday(t.issue_id, 1) }, "↓"),
        ),
        h("div", { class: "today-main" },
          issue ? issueRow(issue, issue.list === "client" ? "client" : "project", true)
                : h("div", { class: "row" }, h("span", {}), h("span", { class: "muted" }, "Closed, or no longer assigned to you")),
          h("div", { class: "today-extra" },
            issue?.client && h("span", { class: "muted small" }, issue.client),
            h("span", { class: "spacer" }),
            blockControls(t),
          ),
        ),
      );
    }),
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

function matches(x: Candidate | Issue): boolean {
  if (!state.filter) return true;
  const q = state.filter.toLowerCase();
  const hay = "identifier" in x
    ? [x.identifier, x.title, x.client, x.project]
    : [x.title, x.client_label, x.who, x.excerpt];
  return hay.some((s) => s?.toLowerCase().includes(q));
}

// ---- header ---------------------------------------------------------------------------------
function sweepStatus(): HTMLElement {
  const r = state.run;
  const wrap = h("div", { class: "sweep" });
  if (r.status === "running") {
    wrap.append(h("span", { class: "spinner" }), h("span", {}, "Sweeping…"));
  } else if (r.started_at) {
    wrap.append(h("span", { class: "muted", title: r.error ?? "" },
      `${r.status === "error" ? "Last sweep failed" : "Last sweep"} ${when(r.finished_at ?? r.started_at)}`));
  } else {
    wrap.append(h("span", { class: "muted" }, "No sweeps yet"));
  }
  for (const s of r.sources ?? []) {
    wrap.append(h("span", {
      class: `dot ${s.ok ? "ok" : "bad"}`,
      title: `${SOURCE_NAME[s.source]}: ${s.ok ? "OK" : "problem"}${s.detail ? ` — ${s.detail}` : ""}`,
    }, SOURCE_NAME[s.source]));
  }
  wrap.append(h("button", { class: "secondary", disabled: r.status === "running", onclick: () => void runNow() }, "Run now"));
  return wrap;
}

function themeButton(): HTMLElement {
  const { choice, label } = themeLabel();
  return h("button", {
    class: "icon theme", title: `${label} (click to change, or press t)`, "aria-label": label,
    onclick: () => { nextTheme(); renderHeader(); },
  }, themeIcon(choice));
}

function renderHeader() {
  const header = document.querySelector("header")!;
  const counts: Record<Tab, number> = {
    inbox: state.candidates.length,
    today: state.today.length,
    insights: 0,
    client: state.issues.filter((i) => i.list === "client").length,
    dev: state.issues.filter((i) => i.list === "dev").length,
  };
  const tab = (id: Tab, label: string) =>
    h("button", {
      class: `tab${state.tab === id ? " active" : ""}`,
      onclick: () => { state.tab = id; render(); if (id !== "inbox" && !state.issuesLoaded) void refresh(true); },
    }, label, id !== "insights" && (id === "inbox" || id === "today" || state.issuesLoaded) &&
      h("span", { class: "count" }, String(counts[id])));
  header.replaceChildren(
    h("div", { class: "brand" }, "TodoHub"),
    h("nav", { class: "tabs" }, tab("inbox", "Inbox"), tab("today", "Today"), tab("client", "Client"), tab("dev", "Dev"), tab("insights", "Insights")),
    sweepStatus(),
    themeButton(),
    h("button", { class: "icon help", title: "Keyboard shortcuts (?)", "aria-label": "Keyboard shortcuts", onclick: showShortcuts }, "?"),
  );
}

function render() {
  ensureLogos([...state.candidates.map((c) => c.client_label), ...state.issues.map((i) => i.client)]);
  renderHeader();
  const main = document.querySelector("main")!;
  const problems = (state.run.sources ?? []).filter((s) => !s.ok);
  const toolbar = h(
    "div",
    { class: "toolbar" },
    h("input", {
      class: "filter", type: "search", placeholder: "Filter", value: state.filter,
      oninput: (e: Event) => {
        state.filter = (e.target as HTMLInputElement).value;
        const f = focusedCandidate();
        if (f && !matches(f)) state.focus = null;
        const content = document.querySelector(".content");
        content?.replaceChildren(view());
      },
    }),
    h("button", { class: "ghost", onclick: () => void refresh(true), title: "Reload from Linear and the queue" }, "Refresh"),
  );
  const view = () =>
    state.tab === "inbox" ? inboxView()
      : state.tab === "today" ? todayView()
      : state.tab === "insights" ? insightsView(() => { if (state.tab === "insights") render(); })
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
  ["x", "Select for bulk actions"],
  ["⌘Z", "Undo the last action (approve, drop, snooze, issue edit)"],
  ["e", "Edit the title"],
  ["c", "Capture a task"],
  ["/", "Filter"],
  ["⌘1 – ⌘5", "Inbox, Today, Client, Dev, Insights"],
  ["⌥⌘T", "Capture from anywhere (when TodoHub is running)"],
  ["t", "Theme: follow the Mac → light → dark"],
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
document.addEventListener("pointerdown", (e) => {
  document.querySelectorAll<HTMLDetailsElement>("details.drop-menu[open]").forEach((d) => {
    if (!d.contains(e.target as Node)) d.open = false;
  });
}, true);

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  if ((e.metaKey || e.ctrlKey) && /^[1-5]$/.test(e.key)) {
    e.preventDefault();
    state.tab = TAB_ORDER[Number(e.key) - 1];
    render();
    if (state.tab !== "inbox" && !state.issuesLoaded) void refresh(true);
    return;
  }
  // ⌘Z undoes the last action, except in a text field, where it undoes typing as usual.
  const textField = target.tagName === "TEXTAREA"
    || (target.tagName === "INPUT" && ["text", "search", "url", "email", ""].includes((target as HTMLInputElement).type));
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z"
      && !textField && !document.querySelector(".overlay")) {
    e.preventDefault();
    void undo();
    return;
  }
  if (typing) {
    if (e.key === "Escape") target.blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".overlay")) return;

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
    case "/": e.preventDefault(); document.querySelector<HTMLInputElement>(".filter")?.focus(); break;
    case "c": e.preventDefault(); state.tab = "inbox"; render(); captureInput.focus(); break;
    case "j": if (state.tab === "inbox") moveFocus(1); break;
    case "k": if (state.tab === "inbox") moveFocus(-1); break;
    case "a": if (c) void approve(c); break;
    case "x": if (c) toggleSelect(c.id); break;
    case "e": if (c) { e.preventDefault(); focusedCard()?.querySelector<HTMLInputElement>(".title-input")?.focus(); } break;
    case "d": if (c) { closeMenus(); const m = focusedCard()?.querySelector<HTMLDetailsElement>("details.drop-menu:not(.snooze-menu)"); if (m) m.open = true; } break;
    case "s": if (c) { closeMenus(); const m = focusedCard()?.querySelector<HTMLDetailsElement>("details.snooze-menu"); if (m) m.open = true; } break;
    default: return;
  }
});

// ---- start ----------------------------------------------------------------------------------
async function start() {
  document.querySelector("#app")!.replaceChildren(h("header", {}), h("main", {}), h("div", { class: "toasts" }));
  render();
  try {
    await waitForBackend();
  } catch (e) {
    state.error = e instanceof ApiError ? e.message : String(e);
    render();
    return;
  }
  onDesktopEvent("capture", () => { state.tab = "inbox"; render(); captureInput.focus(); });
  onDesktopEvent("run-now", () => void runNow());
  await refresh(true);
  pollWhileRunning();
  setInterval(() => void refresh(state.tab !== "inbox").then(pollWhileRunning), 60_000);
  window.addEventListener("focus", () => void refresh(state.tab !== "inbox").then(pollWhileRunning));
}

void start();
