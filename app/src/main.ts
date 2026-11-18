import { openUrl } from "@tauri-apps/plugin-opener";
import { api, ApiError, waitForBackend } from "./api";
import { h, link, loadPref, modal, pageHead, savePref, svg } from "./dom";
import type { Child } from "./dom";
import { insightsView, invalidateInsights, showSweepHistory } from "./insights";
import { loadPulls, pullsCount, pullsKey, pullsView, setupPulls } from "./pulls";
import { notifyOnce, notifySweep, onDesktopEvent, setTrayCount } from "./desktop";
import { applyTheme, currentTheme, nextTheme, onDaylightPhase, setTheme, themeIcon, themeLabel, themeOptions } from "./theme";
import { daylightLocation, setDaylightLocation, sunTimes } from "./daylight";
import { currentSchedule, loadSettings, settingsView } from "./settings";
import type { SettingsCtx } from "./settings";
import { CATEGORIES, CATEGORY_NAME, categoryIcon, clientLogo, ensureLogos, groupMark, taskAvatar } from "./avatars";
import type { Category } from "./avatars";
import { closedType, dueLabel, isoDay, isOpen, localToday, when } from "./issues";
import { detailBody, details, loadDetail, paneKey, postToUndoIn, rebuildKeepingPane, setDescription, setupPane, titleField } from "./pane";
import { closePeriscope, dismissPeriscope, forgetPeriscope, isPeriscopeOpen, periscopeItem, periscopePopover, setupPeriscope } from "./periscope";
import { renderMarkdown } from "./markdown";

applyTheme();
import type { AgendaEvent, BalanceStats, Brief, Candidate, Checkin, DecidedItem, Handled, SourceOverview, Slip, Slips, CandidateEdit, DropReason, Issue, MuteKey, MuteRule, IssueEdit, IssuePreview, Meta, Run, Source, Subtask, TodayItem } from "./api";

type Tab = "inbox" | "today" | "client" | "dev" | "pulls" | "insights" | "settings";

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
const DECIDED_PAGE = 50;                          // "Recently decided" rows shown at a time
const SCHEDULE_HOURS = [8, 10, 12, 14, 16];     // until the settings load
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
  showDecided: false,
  decided: null as { days: number; more: boolean; items: DecidedItem[] } | null,
  decidedShown: DECIDED_PAGE,
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
  /** By client/project or by status, chosen separately for Client and Dev and remembered on this Mac. */
  listLayout: {
    client: layoutPref("todohub.clientView"),
    dev: layoutPref("todohub.devView"),
  } as Record<"client" | "dev", "group" | "status">,
  showBacklog: false,
  listSel: { client: null, dev: null } as Record<"client" | "dev", string | null>,   // Client/Dev: the issue in the reading pane
  highlight: new Set<string>(),       // identifiers to point out on the Client/Dev tab (from the digest)
  sourcesOpen: false,
  balanceOpen: false,                 // Today: the "behind this week" popover under a section's balance line
  planRiseAt: 0,                      // when the sunrise started (ms), so a re-render mid-way doesn't restart it
  todaySel: null as string | null,    // Today: the issue in the reading pane
  todayOffOpen: false,                // Today: the "not on Today" fold (Claude's picks and late issues left out)
  todayDoneOpen: false,               // Today: the "done today" fold
  coverChecked: null as Set<string> | null, // the morning cover's checks, until Start my day
  copied: new Set<string>(),          // Today: issues whose message was copied (a wrap-up or late-issue step)
  allClients: false,                  // sidebar: list every client, not just the first few
  allProjects: false,                 // sidebar: list every Dev project, not just the first few
  pickedClient: null as string | null, // the client (Client tab) or project (Dev tab) the sidebar filtered to
  pickedProject: null as string | null, // a project from the sidebar: its Client and Dev issues together
};

/** "board" is the old name for the by-status layout. */
function layoutPref(key: string): "group" | "status" {
  const v = loadPref(key);
  return v === "status" || v === "board" ? "status" : "group";
}

// ---- formatting -----------------------------------------------------------------------------
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
  const sched = currentSchedule();
  if (sched && !sched.installed) return null;
  for (let add = 0; add < 8; add++) {
    const d = new Date(now);
    d.setDate(now.getDate() + add);
    if ((d.getDay() === 0 || d.getDay() === 6) && sched?.days !== "every day") continue;
    for (const hour of sched?.hours ?? SCHEDULE_HOURS) {
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
  const t = h("div", { class: `toast${error ? " error" : ""}`, role: error ? "alert" : null }, h("span", {}, message));
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
export interface UndoEntry { done: string; run: () => Promise<void>; at: number; banner?: HTMLElement }
const undoStack: UndoEntry[] = [];
const UNDO_FOR_MS = 10 * 60_000;
let undoing = false;

/** Show the banner for an action and remember how to reverse it. */
function offerUndo(message: string, done: string, run: () => Promise<void>, extra?: ToastAction): UndoEntry {
  const entry: UndoEntry = { done, run, at: Date.now() };
  undoStack.push(entry);
  if (undoStack.length > 20) undoStack.shift();
  entry.banner = toast(message, [...(extra ? [extra] : []), { label: "Undo", kbd: "⌘Z", run: () => void undo(entry) }],
    false, 9000);
  return entry;
}

/** ⌘Z or its banner can still undo ``entry``: it's on the stack and less than 10 minutes old. */
function canUndo(entry: UndoEntry): boolean {
  return undoStack.includes(entry) && Date.now() - entry.at < UNDO_FOR_MS;
}

async function undo(entry?: UndoEntry) {
  if (undoing) return;
  entry = entry ?? [...undoStack].reverse().find(canUndo);
  if (!entry || !canUndo(entry)) { toast("Nothing to undo"); return; }
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
  const [pending, snoozed, mutes, decided] = await Promise.all([api.candidates(), api.candidates("snoozed"),
    api.mutes().catch(() => state.mutes), api.decided().catch(() => state.decided)]);
  state.decided = decided;
  state.candidates = pending;
  state.snoozed = snoozed;
  state.mutes = mutes;
  const ids = new Set(pending.map((c) => c.id));
  for (const id of state.selected) if (!ids.has(id)) state.selected.delete(id);
  if (state.focus !== null && !ids.has(state.focus)) state.focus = null;
  setTrayCount(pending.length);
  void notifySweep(state.run, pending);
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
  sourceAlerts();
  if (before === "running" && state.run.status !== "running") {
    invalidateInsights();
    await loadCandidates();
    const n = state.candidates.length;
    if (state.run.status === "ok") toast(`Sweep finished. ${n} task${n === 1 ? "" : "s"} to review.`);
    else toast(`Sweep failed: ${state.run.error ?? "unknown error"}`, undefined, true);
  }
}

/** A Mac notification when a source has failed in two sweeps in a row, at most once a day each, after the sweep finishes.
 *  (A sweep can finish "ok" with one source down, e.g. an expired sign-in; the red dot is easy to miss.) */
const FAIL_STREAK_ALERT = 2;
function sourceAlerts() {
  if (state.run.status === "running") return;     // a running sweep may still replace a source's detail
  const day = localToday();
  for (const o of state.run.source_overview ?? []) {
    if ((o.fail_streak ?? 0) < FAIL_STREAK_ALERT) continue;
    const name = SOURCE_NAME[o.source] ?? o.source;
    void notifyOnce(`source-fail-${o.source}-${day}`, `TodoHub: ${name} keeps failing`,
      `${(o.detail ?? "It reported a problem").replace(/\.$/, "")}. Failed ${o.fail_streak} sweeps in a row`
      + `${o.failing_since ? `, since ${shortWhen(o.failing_since)}` : ""}. Check it in Settings → Sources.`);
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
  if (meta === "force" && state.tab === "pulls") void loadPulls(true);     // GitHub too, alongside Linear
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
    if (state.run.status !== "running") {
      if (state.tab === "settings") await loadSettings();      // each source's new status
      render();
    }
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

/** Merge a linked card into its open issue: the comment, the links, the subtasks as sub-issues,
 *  and the due date and priority when their boxes are ticked. */
async function merge(c: Candidate) {
  const key = `c${c.id}`;
  if (state.busy.has(key) || !isLinked(c)) return;
  state.busy.add(key);
  render();
  try {
    const d = state.drafts.get(c.id) ?? {};
    const edit = { ...d, comment: commentToPost(c, d) };
    if (!edit.title?.trim()) delete edit.title;     // an emptied title box keeps the card's title
    if (edit.subtasks) edit.subtasks = edit.subtasks.filter((s) => s.title.trim());
    const ch = linkChoice(c);
    const before = linkedIssue(c.possible_duplicate!);
    const change = before ? mergeChanges(c, before) : { due: null, priority: null };
    const flags = { move_due_date: !!change.due && ch.moveDue, raise_priority: !!change.priority && ch.raisePriority };
    const { issue, subtasks, warnings } = await api.merge(c.id, edit, flags);
    state.drafts.delete(c.id);
    state.candidates = state.candidates.filter((x) => x.id !== c.id);
    await swipeAway(c.id);
    const added = new Set(subtasks.map((s) => s.id));
    state.issues = [...subtasks, ...state.issues.filter((i) => !added.has(i.id)).map((i) => (i.id === issue.id ? issue : i))];
    previews.delete(issue.identifier);     // it has a new comment now
    const did = [
      "comment",
      subtasks.length ? `${subtasks.length} sub-issue${subtasks.length === 1 ? "" : "s"}` : "",
      flags.move_due_date && issue.due_date === change.due ? `due ${dateText(issue.due_date)}` : "",
      flags.raise_priority && issue.priority === change.priority ? `${priorityName(issue.priority)} priority` : "",
    ].filter(Boolean).join(", ");
    offerUndo(`Merged into ${issue.identifier}: ${did}`,
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
  const card = document.querySelector<HTMLElement>(`.ib-pane .card[data-id="${id}"]`);
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
  const key = `c${c.id}`;
  if (state.busy.has(key)) return;
  state.busy.add(key);
  try {
    await api.drop(c.id, reason);
    state.candidates = state.candidates.filter((x) => x.id !== c.id);
    await swipeAway(c.id, "drop");
    offerUndo(`Dropped "${c.title}"`, `"${c.title}" is back in the Inbox`, () => undoDecisions([c.id], false));
    void suggestMute(c);
  } catch (e) {
    fail(e);
  } finally {
    state.busy.delete(key);
    render();
  }
}

/** Change an issue in Linear, with Undo. For a description edit ``issue`` is the pane's preview:
 *  its text is what Undo puts back. Returns whether Linear took the change. ``rerender`` is false
 *  when the caller shows the result itself. */
function editIssue(issue: IssuePreview, change: IssueEdit, rerender?: boolean): Promise<boolean>;
function editIssue(issue: Issue, change: Omit<IssueEdit, "description">, rerender?: boolean): Promise<boolean>;
async function editIssue(issue: Issue | IssuePreview, change: IssueEdit, rerender = true): Promise<boolean> {
  try {
    const updated = await api.editIssue(issue.id, change);
    const status = state.meta?.states.find((s) => s.id === updated.state.id);
    const closed = closedType(status?.type ?? updated.state.type);
    state.issues = closed ? state.issues.filter((i) => i.id !== issue.id)
      : state.issues.map((i) => (i.id === issue.id ? updated : i));
    if (change.description !== undefined) setDescription(issue.id, change.description);
    // The reverse change: put back whatever this edit replaced.
    const before: IssueEdit = {};
    if ("state_id" in change) before.state_id = issue.state.id;
    if ("priority" in change) before.priority = issue.priority;
    if ("due_date" in change) before.due_date = issue.due_date;
    if ("title" in change) before.title = issue.title;
    if ("client" in change) before.client = issue.client;
    if ("project" in change) before.project = issue.project;
    if ("description" in change && "description" in issue) before.description = issue.description;
    const what = "state_id" in change ? `moved to ${status?.name ?? updated.state.name}`
      : "priority" in change ? `priority set to ${priorityName(updated.priority)}`
      : "title" in change ? "renamed"
      : "description" in change ? "description saved"
      : "client" in change ? `moved to ${updated.client ?? "Dev"}`
      : "project" in change ? (updated.project ? `project set to ${updated.project}` : "project cleared")
      : updated.due_date ? `due ${updated.due_date}` : "due date cleared";
    offerUndo(`${issue.identifier} ${what}`, `${issue.identifier} change reverted`, async () => {
      const restored = await api.editIssue(issue.id, before);
      state.issues = state.issues.some((i) => i.id === issue.id)
        ? state.issues.map((i) => (i.id === issue.id ? restored : i))
        : [restored, ...state.issues];
      if (before.description !== undefined) setDescription(issue.id, before.description);
    });
    return true;
  } catch (e) {
    fail(e);
    return false;
  } finally {
    if (rerender) render();
  }
}

/** Delete an issue after a confirm: Linear moves it to its trash (restorable for 30 days there),
 *  it leaves the lists and Today here, and Undo / ⌘Z brings it back. */
function confirmDelete(i: Issue) {
  // The pane's list from Linear: every open sub-issue, not only yours.
  const preview = details.get(i.id)?.issue;
  const subs = preview?.sub_issues.filter(isOpen).length ?? 0;
  const note = !preview ? "Its sub-issues haven't loaded here; check them in Linear afterwards."
    : subs ? `It has ${subs} open sub-issue${subs === 1 ? "" : "s"}; check ${subs === 1 ? "it" : "them"} in Linear afterwards.` : "";
  const go = h("button", { class: "primary danger", onclick: () => { close(); void deleteIssue(i); } }, "Delete");
  const close = modal(`Delete ${i.identifier}?`, h("div", { class: "confirm-body" },
    h("p", {}, h("strong", {}, i.title)),
    h("p", { class: "muted small" }, "Linear moves it to its trash, where you can restore it for 30 days. "
      + "Undo here brings it back too."),
    note ? h("p", { class: "muted small" }, note) : ""),
    [h("button", { class: "ghost", onclick: () => close() }, "Cancel"), go]);
  go.focus();
}

async function deleteIssue(i: Issue) {
  try {
    const { today_position } = await api.deleteIssue(i.id);
    state.issues = state.issues.filter((x) => x.id !== i.id);
    state.today = state.today.filter((t) => t.issue_id !== i.id);
    details.delete(i.id);
    state.briefAt = 0;                 // the plan and wrap-up shouldn't count it any more
    offerUndo(`${i.identifier} deleted (in Linear's trash)`, `${i.identifier} restored`, async () => {
      const back = await api.restoreIssue(i.id, today_position);
      state.issues = [back, ...state.issues.filter((x) => x.id !== i.id)];
      state.today = (await api.today()).items;
      state.briefAt = 0;
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

/** Linear's order for statuses: by kind (backlog, not started, started, done, canceled,
 *  duplicate), then the team's own order within each kind. */
const STATE_ORDER: Record<string, number> = { triage: 0, backlog: 1, unstarted: 2, started: 3, completed: 4, canceled: 5, duplicate: 6 };

function statusClass(st: { name: string; type: string }): string {
  if (st.type === "backlog") return "s-backlog";
  if (st.type === "started") return "s-prog";
  if (st.type === "completed") return "s-done";
  if (st.type === "canceled" || st.type === "duplicate") return "s-cancel";
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

/** No priority stays quiet: the pill shows on hover of its row or card, or on focus. */
function priorityPill(value: number, onChange: (v: number) => void): HTMLElement {
  const el: HTMLElement = pillMenu("Priority", PRIORITIES.map((p) => ({ value: p.value, label: p.value === 0 ? "No priority" : p.name, cls: PRIO_CLASS[p.value] })),
    value, (v) => { el.classList.toggle("quiet-empty", v === 0); onChange(v); }, false);
  el.classList.toggle("quiet-empty", value === 0);
  return el;
}

/** An empty choice (no client, no project) stays quiet until hover or focus. */
function quietSelect(el: HTMLSelectElement): HTMLSelectElement {
  const sync = () => el.classList.toggle("quiet-empty", !el.value);
  el.addEventListener("change", sync);
  sync();
  return el;
}

function statusPill(i: Issue, onChange: (stateId: string) => void): HTMLElement {
  // Every status the team has, as in Linear's menu; Canceled and Duplicate take the issue off the
  // open lists (with undo).
  const states = (state.meta?.states ?? [i.state]).map((st, n) => ({ st, n }))
    .sort((a, b) => (STATE_ORDER[a.st.type] ?? 9) - (STATE_ORDER[b.st.type] ?? 9) || a.n - b.n).map((x) => x.st);
  if (!states.some((st) => st.id === i.state.id)) states.push(i.state);
  return pillMenu("Status", states.map((st) => ({ value: st.id, label: st.name, cls: statusClass(st) })), i.state.id, onChange, true);
}

/** A small read-only pill: priority in a meta line, only for Urgent and High. */
function priorityTag(p: number): HTMLElement | "" {
  return p === 1 || p === 2 ? h("span", { class: `pill ${PRIO_CLASS[p]}` }, p === 1 ? "Urgent" : "High") : "";
}


function clientSelect(value: string | null, onChange: (v: string | null) => void) {
  // A label newer than the loaded list (or none loaded) still shows as the issue's client.
  const known = state.meta?.client_labels ?? [];
  const labels = value && !known.includes(value) ? [value, ...known] : known;
  return quietSelect(h(
    "select",
    { class: "client", title: "Client label", onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value || null) },
    h("option", { value: "", selected: !value }, "Dev / internal"),
    ...labels.map((l) => h("option", { value: l, selected: l === value }, l)),
  ));
}

function projectSelect(value: string | null, onChange: (v: string | null) => void) {
  // The list holds open projects only; an issue in a completed or canceled one still shows it.
  const open = state.meta?.projects ?? [];
  const projects = value && !open.includes(value) ? [value, ...open] : open;
  return quietSelect(h(
    "select",
    { class: "project", title: "Linear project", onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value || null) },
    h("option", { value: "", selected: !value }, "No project"),
    ...projects.map((p) => h("option", { value: p, selected: p === value }, p)),
  ));
}

/** "Nov 9" ("Today" for today), the quiet face of a date field. */
function dateText(value: string | null): string {
  if (!value) return "";
  if (value === localToday()) return "Today";
  return new Date(value + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A due date that stays quiet: plain text ("Nov 9", red when late) or nothing when empty. The
 *  date field shows on hover of its row or card, or on focus; the Today pane always shows it. */
function dateInput(value: string | null, onChange: (v: string | null) => void, cls = "") {
  const text = h("span", { class: "qdate-text", "aria-hidden": "true" }, dateText(value));
  const wrap = h("span", { class: `qdate${value ? "" : " is-empty"} ${cls}`.trim() },
    text,
    h("input", {
      type: "date",
      class: `date ${cls}`,
      value: value ?? "",
      title: "Due date",
      "aria-label": "Due date",
      onchange: (e: Event) => {
        const v = (e.target as HTMLInputElement).value || null;
        text.textContent = dateText(v);
        wrap.classList.toggle("is-empty", !v);
        onChange(v);
      },
    }));
  return wrap;
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

/** The ticked cards still in the Inbox. */
function selectedCandidates(): Candidate[] {
  return state.candidates.filter((c) => state.selected.has(c.id));
}

async function bulk(action: "approve" | "drop", reason: DropReason = "other") {
  // A linked card's merge plan needs a look, so bulk Approve leaves it out.
  const picked = selectedCandidates().filter((c) => !(action === "approve" && isLinked(c)));
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
  const picked = selectedCandidates();
  if (!picked.length) return "";
  const drop = h("details", { class: "drop-menu" },
    h("summary", { class: "ghost-btn" }, "Drop all ▾"),
    h("div", { class: "menu" }, ...DROP_REASONS.map((r) =>
      h("button", { onclick: () => { drop.open = false; void bulk("drop", r.value); } }, h("span", {}, r.label)))));
  const linked = picked.filter(isLinked).length;
  const approvable = picked.length - linked;
  return h("div", { class: "bulk" },
    h("span", {}, `${picked.length} selected`),
    linked ? h("span", { class: "muted small" }, approvable
      ? `${linked} linked card${linked === 1 ? "" : "s"} left out`
      : "Decide linked cards one at a time") : "",
    h("span", { class: "spacer" }),
    h("button", { class: "ghost", onclick: () => { state.selected.clear(); render(); } }, "Clear"),
    drop,
    approvable ? h("button", { class: "primary", onclick: () => void bulk("approve") }, `Approve ${approvable}`) : "",
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

// ---- recently decided -------------------------------------------------------------------------------
// Approved and dropped cards of the last 30 days, after ⌘Z's 10 minutes are up: a dropped one can
// come back to the Inbox, an approved one links to what it became in Linear.
function decidedTag(i: DecidedItem): string {
  if (i.status === "dropped") return `Dropped · ${DROP_REASONS.find((r) => r.value === i.drop_reason)?.label ?? "Other"}`;
  return i.kind === "close" ? "Closed" : i.kind === "comment" ? "Commented" : "Approved";
}

function decidedMatches(i: DecidedItem): boolean {
  const q = state.filter.toLowerCase();
  return !q || [i.title, i.client_label, i.who, i.linear_identifier, i.target_issue].some((s) => s?.toLowerCase().includes(q));
}

async function restoreDecided(i: DecidedItem) {
  try {
    await api.restore(i.id);
    await loadCandidates();
    goTab("inbox");
    state.focus = i.id;
    render();
    offerUndo(`"${i.title}" is back in the Inbox`, `"${i.title}" dropped again`, async () => {
      await api.drop(i.id, i.drop_reason ?? "other");
      await loadCandidates();
    });
  } catch (e) {
    fail(e);
  }
}

function decidedList(): HTMLElement | "" {
  const d = state.decided;
  if (!d?.items.length) return "";
  const rows = d.items.filter(decidedMatches);
  const toggle = h("button", { class: "link-btn", onclick: () => {
    state.showDecided = !state.showDecided;
    state.decidedShown = DECIDED_PAGE;
    render();
  } }, state.showDecided ? "Hide" : "Show");
  const shown = rows.slice(0, state.decidedShown);
  return h("div", { class: "snoozed decided" },
    h("div", { class: "muted small" },
      `${d.items.length}${d.more ? "+" : ""} decided in the last ${d.days} days`,
      state.filter && state.showDecided ? `, ${rows.length} matching` : "", " ", toggle),
    state.showDecided && h("div", { class: "snoozed-list" },
      ...shown.map((i) => {
        const ident = i.linear_identifier ?? i.target_issue;
        return h("div", { class: "decided-row" },
          h("span", { class: `dec-tag ${i.status}` }, decidedTag(i)),
          h("span", { class: "dec-title", title: i.title }, i.title),
          h("span", { class: "muted small dec-from" }, [SOURCE_NAME[i.source] ?? i.source, i.who].filter(Boolean).join(" · ")),
          h("span", { class: "muted small dec-when" }, shortWhen(i.decided_at)),
          i.status === "dropped"
            ? h("button", { class: "link-btn", title: "Put it back in the Inbox", onclick: () => void restoreDecided(i) }, "Restore")
            : i.linear_url ? link(`${ident} ↗`, i.linear_url, "link small")
            : h("span", { class: "muted small" }, ident ?? ""));
      }),
      !rows.length ? h("p", { class: "muted small" }, "None match the filter.") : "",
      rows.length > shown.length ? h("button", { class: "link-btn", onclick: () => {
        state.decidedShown += DECIDED_PAGE;
        render();
      } }, `Show ${Math.min(DECIDED_PAGE, rows.length - shown.length)} more`) : ""),
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

// ---- issue previews ---------------------------------------------------------------------------
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
      // Re-draw, for the linked issue's facts and the merge plan. While typing, swap only the
      // preview bodies in place, so the typing isn't interrupted.
      if (!editing()) { render(); return; }
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

// ---- suggestions handled in Linear by hand ----------------------------------------------------
function handledWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const days = Math.round((Date.parse(localToday() + "T12:00:00") - Date.parse(isoDay(new Date(iso)) + "T12:00:00")) / 864e5);
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

// ---- linked issues: Merge, Create new or Drop ---------------------------------------------------
type LinkPick = NonNullable<Candidate["duplicate_advice"]>;
const PICKS: { value: LinkPick; label: string }[] = [
  { value: "merge", label: "Merge" }, { value: "new", label: "Create new" }, { value: "drop", label: "Drop" },
];
/** Claude's advice in words: the list chip ("Adds to ENG-123") and the box heading. */
const ADVICE_WORDS: Record<LinkPick, string> = { merge: "Adds to", drop: "Same as", new: "Related to" };

/** A linked card's pick, its 2 merge boxes and its drop reason, until the app restarts. */
type LinkChoice = { pick: LinkPick; moveDue: boolean; raisePriority: boolean; reason: DropReason };
const linkChoices = new Map<number, LinkChoice>();
const openComments = new Set<number>();        // linked cards whose merge comment is in a text box

/** A Task or Waiting card the sweep linked to one of your open issues. */
function isLinked(c: Candidate): boolean {
  return !!c.possible_duplicate && (c.kind === "task" || c.kind === "waiting");
}

function linkChoice(c: Candidate): LinkChoice {
  let ch = linkChoices.get(c.id);
  if (!ch) {
    ch = { pick: c.duplicate_advice ?? "merge", moveDue: true, raisePriority: true, reason: "duplicate" };
    linkChoices.set(c.id, ch);
  }
  return ch;
}

/** The linked issue: from the issue list, else from its preview, loaded on first use. A preview
 *  that failed is not loaded again here (opening "Show description and comments" retries). */
function linkedIssue(ident: string): Issue | undefined {
  const known = state.issues.find((i) => i.identifier === ident);
  if (known) return known;
  const p = previews.get(ident);
  if (!p) loadPreview(ident);
  return p && "issue" in p ? p.issue : undefined;
}

/** What a merge can change on the issue: the card's due date when it is sooner, and its priority
 *  when it is higher (a smaller number that is not 0). Null when it can't. */
function mergeChanges(c: Candidate, issue: Issue): { due: string | null; priority: number | null } {
  const d = state.drafts.get(c.id) ?? {};
  const due = "due_date" in d ? d.due_date ?? null : c.due_date;
  const priority = "priority" in d ? d.priority ?? 0 : c.priority;
  return {
    due: due && (!issue.due_date || due < issue.due_date) ? due : null,
    priority: priority > 0 && (issue.priority === 0 || priority < issue.priority) ? priority : null,
  };
}

/** The default merge comment, from what the card shows. The backend adds the source line. */
function mergeComment(c: Candidate, d: CandidateEdit): string {
  const title = ("title" in d ? d.title : c.title) || c.title;
  const due = "due_date" in d ? d.due_date : c.due_date;
  return [
    `**More from ${c.source === "manual" ? "a capture" : SOURCE_NAME[c.source]}${c.who ? ` · ${c.who}` : ""}:** ${title}`,
    c.why ?? "",
    c.excerpt ? c.excerpt.split("\n").map((line) => `> ${line}`).join("\n") : "",
    due ? `**Due:** ${due}` : "",
  ].filter(Boolean).join("\n\n");
}

/** The comment a merge posts: the text edited in the draft, else the default. */
function commentToPost(c: Candidate, d: CandidateEdit): string {
  return (d.comment ?? "").trim() || mergeComment(c, d);
}

/** The open issue a card is linked to, and the switch: Merge, Create new or Drop. */
function linkBox(c: Candidate, busy: boolean): HTMLElement {
  const ident = c.possible_duplicate!;
  const advice = c.duplicate_advice ?? "merge";
  const ch = linkChoice(c);
  const issue = linkedIssue(ident);
  if (openPreviews.has(c.id) && !previews.has(ident)) loadPreview(ident);
  const loaded = previews.get(ident);
  const preview = h("details", {
    class: "dup-preview", "data-ident": ident, open: openPreviews.has(c.id),
    ontoggle: (e: Event) => {
      const open = (e.currentTarget as HTMLDetailsElement).open;
      if (open === openPreviews.has(c.id)) return;      // re-created open by a render, not a click
      if (open) { openPreviews.add(c.id); loadPreview(ident); } else openPreviews.delete(c.id);
    },
  }, h("summary", {}, "Show description and comments"), previewBody(ident));
  return h("div", { class: "link-box" },
    h("div", { class: "link-head" }, `${ADVICE_WORDS[advice]} an open issue`),
    h("div", { class: "link-issue" }, link(ident, issue?.url ?? null, "link"), issue ? ` ${issue.title}` : ""),
    issue
      ? h("div", { class: "link-facts" },
          h("span", { class: `pill ${statusClass(issue.state)}` }, issue.state.name),
          issue.priority ? h("span", { class: `pill ${PRIO_CLASS[issue.priority]}` }, priorityName(issue.priority)) : "",
          issue.due_date ? h("span", {}, `due ${dateText(issue.due_date)}`) : "")
      : h("div", { class: "link-facts" },
          loaded && "error" in loaded ? `Couldn't load ${ident}: ${loaded.error}` : "Loading…"),
    preview,
    h("div", { class: "segmented link-switch", role: "group", "aria-label": `What to do with ${ident}` },
      ...PICKS.map((p) => h("button", {
        class: `seg${ch.pick === p.value ? " on" : ""}`, "aria-pressed": String(ch.pick === p.value), disabled: busy,
        onclick: () => { ch.pick = p.value; render(); },
      }, p.label, p.value === advice ? h("span", { class: "rec-dot", title: "Claude's recommendation" }) : ""))),
    h("div", { class: "link-reason" },
      h("strong", {}, `Claude recommends ${PICKS.find((p) => p.value === advice)!.label}`),
      c.duplicate_reason ? `: ${c.duplicate_reason}` : "."));
}

/** Merge picked: each change the merge will make to the linked issue. */
function mergePlan(c: Candidate, d: CandidateEdit, busy: boolean): HTMLElement {
  const ident = c.possible_duplicate!;
  const ch = linkChoice(c);
  const issue = linkedIssue(ident);
  const change = issue ? mergeChanges(c, issue) : { due: null, priority: null };
  const links = (c.source_url ? 1 : 0) + c.links.length;
  const box = (checked: boolean, set: (v: boolean) => void, ...label: Child[]) => h("label", { class: "plan-step" },
    h("input", { type: "checkbox", checked, disabled: busy,
      onchange: (e: Event) => { set((e.target as HTMLInputElement).checked); render(); } }),
    h("span", {}, ...label));
  const editComment = () => {
    openComments.add(c.id);
    render();
    document.querySelector<HTMLTextAreaElement>(`.card[data-id="${c.id}"] .merge-plan textarea`)?.focus();
  };
  return h("div", { class: "merge-plan" },
    h("div", { class: "plan-head" }, `Merge will change ${ident}`),
    h("div", { class: "plan-step" }, h("span", { class: "plan-ic" }, "✎"), h("span", {}, "Post this comment"),
      !openComments.has(c.id) && h("button", { class: "link-btn", onclick: editComment }, "Edit")),
    openComments.has(c.id)
      ? h("textarea", { class: "comment-input", rows: 6, value: commentToPost(c, d), "aria-label": `Comment to post on ${ident}`,
          maxLength: 4000,
          oninput: (e: Event) => {
            const text = (e.target as HTMLTextAreaElement).value;
            if (text.trim()) d.comment = text; else delete d.comment;
          } })
      : h("div", { class: "plan-comment md" }, ...renderMarkdown(commentToPost(c, d))),
    issue && change.due ? box(ch.moveDue, (v) => { ch.moveDue = v; }, "Move the due date ",
      h("s", {}, issue.due_date ? dateText(issue.due_date) : "none"), " → ",
      h("b", { class: "plan-new" }, dateText(change.due))) : "",
    issue && change.priority ? box(ch.raisePriority, (v) => { ch.raisePriority = v; }, "Raise the priority ",
      h("s", {}, priorityName(issue.priority)), " → ",
      h("b", { class: "plan-new" }, priorityName(change.priority))) : "",
    c.subtasks.length || d.subtasks?.length ? subtaskEditor(c, d) : "",
    links ? h("div", { class: "plan-step" }, h("span", { class: "plan-ic" }, "+"),
      h("span", {}, `Attach ${links} link${links === 1 ? "" : "s"}`)) : "",
  );
}

/** Drop picked: the reasons, with Duplicate picked first; 1–5 pick one. */
function dropPlan(c: Candidate): HTMLElement {
  const ch = linkChoice(c);
  return h("div", { class: "drop-plan", role: "radiogroup", "aria-label": "Why drop it" },
    ...DROP_REASONS.map((r, i) => h("label", { class: "plan-step", title: r.hint },
      h("input", { type: "radio", name: `drop-${c.id}`, checked: ch.reason === r.value,
        onchange: () => { ch.reason = r.value; render(); } }),
      h("span", {}, r.label), h("kbd", {}, String(i + 1)))));
}

/** The card's main button, a and ⌘↩: a linked card does its pick; any other card is approved. */
function decide(c: Candidate) {
  if (!isLinked(c)) { void approve(c); return; }
  const ch = linkChoice(c);
  if (ch.pick === "merge") void merge(c);
  else if (ch.pick === "drop") void drop(c, ch.reason);
  else void approve(c);
}

function candidateCardBody(c: Candidate): HTMLElement {
  const d = draft(c);
  const val = <K extends keyof CandidateEdit>(k: K) => (k in d ? d[k] : (c as unknown as CandidateEdit)[k]);
  const busy = state.busy.has(`c${c.id}`);
  const acting = c.kind === "close" || c.kind === "comment";
  const refIssue = acting ? state.issues.find((i) => i.identifier === c.target_issue) : undefined;
  const linked = isLinked(c);
  const pick = linked ? linkChoice(c).pick : null;
  const hasPlan = linked && pick !== "new";         // Merge or Drop picked: a plan in place of the title box and the fields
  const showFields = !acting && !hasPlan;
  const label = pick === "merge" ? `Merge into ${c.possible_duplicate}` : pick === "drop" ? "Drop"
    : pick === "new" && c.kind === "task" ? "Create issue"
    : { task: "Approve", waiting: "Track", close: `Close ${c.target_issue}`, comment: "Post update" }[c.kind];

  const titleEl = acting
    ? h("div", { class: "title-static" },
        c.kind === "close" ? "Close " : "Update ", link(c.target_issue ?? "", refIssue?.url ?? null, "link"),
        refIssue ? `: ${refIssue.title}` : c.title.replace(/^(Close|Update) [A-Z]+-\d+/, ""))
    : hasPlan
      ? h("div", { class: "title-static" }, val("title") || c.title)
      : h("input", {
          class: "title-input",
          value: val("title") ?? "",
          "aria-label": "Task title",
          oninput: (e: Event) => { d.title = (e.target as HTMLInputElement).value; },
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
    linked && linkBox(c, busy),
    pick === "merge" && mergePlan(c, d, busy),
    pick === "drop" && dropPlan(c),
    !acting && c.reply_draft && replyBox(c, d),
    c.kind === "comment" && h("textarea", {
      class: "comment-input", rows: 3, value: val("comment") ?? "", "aria-label": "Comment to post on the issue",
      oninput: (e: Event) => { d.comment = (e.target as HTMLTextAreaElement).value; },
    }),
    linksRow(c),
    showFields && subtaskEditor(c, d),
    h(
      "div",
      { class: "card-actions" },
      showFields && clientSelect(val("client_label") ?? null, (v) => { d.client_label = v; }),
      showFields && projectSelect(val("project") ?? null, (v) => { d.project = v; }),
      showFields && priorityPill(val("priority") ?? 0, (v) => { d.priority = v; }),
      showFields && c.kind === "waiting" && h("span", { class: "muted small" }, "Follow up"),
      showFields && dateInput(val("due_date") ?? null, (v) => { d.due_date = v; }),
      h("span", { class: "spacer" }),
      snoozeMenu(c, busy),
      !linked && dropMenu(c, busy),
      h("button", { class: "primary", disabled: busy, title: "⌘↩", onclick: () => decide(c) },
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
      snoozedList(), mutedList(), decidedList());
  }
  // List on the left, the selected candidate in full on the right (like the Today list). After a
  // decision the next one in the list is selected.
  let at = items.findIndex((c) => c.id === state.focus);
  if (at < 0) {
    at = Math.min(inboxLastIdx, items.length - 1);
    state.focus = items[at].id;
  }
  inboxLastIdx = at;
  const sel = items[at];
  return h("div", {}, handledBanner(), bulkBar(),
    h("div", { class: "ib" },
      h("div", { class: `ib-list${state.selected.size ? " selecting" : ""}`, role: "listbox", "aria-label": "Inbox" },
        ...items.map((c) => inboxItem(c, c.id === sel.id))),
      h("div", { class: "ib-pane" }, candidateCard(sel))),
    snoozedList(), mutedList(), decidedList());
}

let inboxLastIdx = 0;

/** One candidate in the Inbox list: avatar, title, then source · who and chips for what's set. */
function inboxItem(c: Candidate, on: boolean): HTMLElement {
  const d = state.drafts.get(c.id) ?? {};
  const today = localToday();
  const client = "client_label" in d ? d.client_label : c.client_label;
  const priority = "priority" in d ? d.priority ?? 0 : c.priority;
  const due = "due_date" in d ? d.due_date ?? null : c.due_date;
  const chips: (HTMLElement | "")[] = [];
  if (c.handled?.identifier) chips.push(h("span", { class: "ib-chip ok" }, "Looks handled"));
  else if (c.possible_duplicate) chips.push(h("span", { class: "ib-chip dup" },
    `${ADVICE_WORDS[c.duplicate_advice ?? "merge"]} ${c.possible_duplicate}`));
  if (client) chips.push(h("span", { class: "ib-chip client" }, client));
  if (priority === 1 || priority === 2) chips.push(priorityTag(priority));
  if (due) chips.push(h("span", { class: `ib-chip${due < today ? " late" : due === today ? " soon" : ""}` },
    `${c.kind === "waiting" ? "Follow up " : ""}${dateText(due)}`));
  return h("div", {
    class: `ib-item${on ? " sel" : ""}${state.selected.has(c.id) ? " picked" : ""}${state.busy.has(`c${c.id}`) ? " busy" : ""}`,
    "data-id": String(c.id), role: "option", "aria-selected": String(on), tabindex: "-1",
    onclick: (e: Event) => {
      if ((e.target as HTMLElement).closest("input")) return;
      state.focus = c.id;
      render();
    },
  },
    h("input", { type: "checkbox", class: "select", checked: state.selected.has(c.id), "aria-label": "Select for bulk actions",
      onclick: (e: Event) => { e.stopPropagation(); toggleSelect(c.id); } }),
    taskAvatar(client ?? null, c.category, "sm"),
    h("div", { class: "ib-body" },
      h("span", { class: "ib-title" }, ("title" in d ? d.title : c.title) || c.title),
      h("span", { class: "ib-meta" },
        h("span", { class: `src-${c.source}` }, SOURCE_NAME[c.source]),
        c.who ? ` · ${c.who}` : ` · ${KIND_NAME[c.kind] ?? SIGNAL_NAME[c.signal]}`,
        ...chips),
      (c.why || c.excerpt) && h("span", { class: "ib-why", title: c.why || c.excerpt || "" }, c.why || c.excerpt)));
}

/** One issue in the Client or Dev list: star, avatar, the full title, then one quiet line with
 *  status, ID, the other field (project on Client, client on Dev), priority, due date and slips.
 *  Click to read it in the pane; the star adds it to Today. */
function listItem(kind: "client" | "dev", i: Issue, showGroupField: "client" | "project" | null, nested = false): HTMLElement {
  const today = localToday();
  const on = state.listSel[kind] === i.id;
  const picked = state.today.some((t) => t.issue_id === i.id);
  const slip = state.slips?.slips[i.id];
  const bits: (string | Node)[] = [
    h("span", { class: "ll-status" }, h("span", { class: `sdot ${statusClass(i.state)}` }), i.state.name), i.identifier];
  // The field the list isn't grouped by; none in a project's view (grouped by client, one project).
  const other = showGroupField === "client" ? i.project : showGroupField === "project" ? i.client : null;
  if (other) bits.push(other);
  const tag = priorityTag(i.priority);
  if (tag) bits.push(tag);
  if (i.due_date) bits.push(i.due_date < today ? h("span", { class: "late" }, dueLabel(i.due_date, today).replace("overdue", "late"))
    : i.due_date === today ? h("span", { class: "due-today" }, "due today") : `due ${shortDay(i.due_date)}`);
  if (slip && slip.count) bits.push(slipTag(slip));
  // A sub-issue whose parent isn't shown above it says which issue it belongs to.
  if (i.parent && !nested) bits.push(`↳ ${i.parent.identifier} ${i.parent.title}`);
  const meta = h("span", { class: "tl-meta" });
  bits.filter((x) => x !== "").forEach((b, n) => { if (n) meta.append(" · "); meta.append(b); });
  return h("div", {
    class: `tl-item ll-item${on ? " sel" : ""}${nested ? " child" : ""}${i.priority === 1 || i.priority === 2 ? ` prio-${i.priority}` : ""}${state.highlight.has(i.identifier) ? " hl" : ""}`,
    tabindex: "0", "data-id": i.id, role: "option", "aria-selected": String(on),
    onclick: (e: Event) => {
      if ((e.target as HTMLElement).closest("a, button")) return;
      state.listSel[kind] = i.id; render();
    },
  },
    h("button", {
      class: `star${picked ? " on" : ""}`, title: picked ? "Remove from Today" : "Add to Today",
      "aria-label": picked ? "Remove from Today" : "Add to Today", "aria-pressed": String(picked),
      onclick: () => void toggleToday(i.id),
    }, picked ? "★" : "☆"),
    taskAvatar(i.client, i.category, "sm"),
    h("div", { class: "tl-body" }, h("span", { class: "tl-title" }, i.title), meta));
}

/** The list on the left and the selected issue in the reading pane, for Client and Dev (both
 *  groupings). ``order`` is the issues as shown, for j/k and for picking the first one. */
function listWithPane(kind: "client" | "dev", groups: (Node | string)[], order: Issue[]): HTMLElement {
  const view = `${kind}|${state.listLayout[kind]}|${state.showBacklog}|${state.pickedProject ?? ""}|${state.pickedClient ?? ""}|${state.filter}`;
  // The selected issue left this list (moved, closed, deleted): select the one after it. In another
  // view (a project, a client, a filter) start from the top.
  if (!order.some((i) => i.id === state.listSel[kind])) {
    const shown = new Set(order.map((i) => i.id));
    const at = listOrder.view === view ? listOrder.ids.indexOf(state.listSel[kind] ?? "") : -1;
    const next = at < 0 ? undefined
      : [...listOrder.ids.slice(at + 1), ...listOrder.ids.slice(0, at).reverse()].find((id) => shown.has(id));
    state.listSel[kind] = next ?? order[0]?.id ?? null;
  }
  listOrder = { view, ids: order.map((i) => i.id) };
  const sel = order.find((i) => i.id === state.listSel[kind]);
  // The rows were built before the first one was picked: mark it now, so the list shows what the pane does.
  for (const g of groups) {
    if (!(g instanceof HTMLElement)) continue;
    g.querySelectorAll<HTMLElement>(".ll-item").forEach((el) => {
      const on = el.dataset.id === sel?.id;
      el.classList.toggle("sel", on);
      el.setAttribute("aria-selected", String(on));
    });
  }
  return h("div", { class: "tl-grid ll-grid" },
    h("div", { class: "tl-list ll-list", role: "listbox", "aria-label": kind === "client" ? "Client issues" : "Dev issues" }, ...groups),
    sel ? issuePane(sel) : h("section", { class: "tl-pane" }, h("p", { class: "muted" }, "Pick an issue to read it here.")));
}

let listOrder = { view: "", ids: [] as string[] };   // the list as last shown, for j/k and the next row

/** A group's heading in Client, Dev and Today: the client's logo (a project initial, a status dot,
 *  or nothing on Today), the name in bold, a short summary ("8 open · 2 late · 1 due today"), then
 *  a rule running to the group's action (Weekly summary on a client, the balance meter on Today). */
function groupHead(name: string, lead: Node | "", issues: Issue[], action: Node | "" = ""): HTMLElement {
  const today = localToday();
  const late = issues.filter((i) => i.due_date && i.due_date < today).length;
  const dueToday = issues.filter((i) => i.due_date === today).length;
  const summary = h("span", { class: "ll-sum" }, `${issues.length} open`);
  if (late) summary.append(" · ", h("span", { class: "late" }, `${late} late`));
  if (dueToday) summary.append(` · ${dueToday} due today`);
  return h("h2", {}, lead, h("span", { class: "ll-name" }, name), summary, h("span", { class: "ll-rule", "aria-hidden": "true" }), action);
}

/** ↑/↓ (or j/k) in Client and Dev. */
function stepList(delta: number) {
  const kind = state.tab as "client" | "dev";
  if (!listOrder.ids.length) return;
  const cur = listOrder.ids.indexOf(state.listSel[kind] ?? "");
  state.listSel[kind] = listOrder.ids[Math.max(0, Math.min(listOrder.ids.length - 1, cur < 0 ? 0 : cur + delta))];
  render();
  document.querySelector(".ll-item.sel")?.scrollIntoView({ block: "nearest" });
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

/** "Block time ▾" in the Today pane: start time and length in its menu; once blocked, the
 *  event's time as a link to it. */
function blockControls(t: TodayItem): HTMLElement {
  if (t.event_start && t.event_minutes) {
    const start = new Date(t.event_start);
    const end = new Date(start.getTime() + t.event_minutes * 60_000);
    const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return h("span", { class: "block done" }, link(`Blocked ${fmt(start)}–${fmt(end)} ↗`, t.event_link, "link small"));
  }
  const time = h("input", { type: "time", class: "date", value: nextHalfHour(), "aria-label": "Start time" });
  const len = h("select", { "aria-label": "Duration" },
    ...[30, 60, 90, 120].map((m) => h("option", { value: String(m), selected: m === 60 }, m < 60 ? `${m} min` : `${m / 60} h`)));
  const btn = h("button", {
    class: "primary small-btn",
    onclick: async (e: Event) => {
      e.preventDefault();
      btn.disabled = true;
      btn.textContent = "Blocking…";
      try {
        state.today = (await api.block(t.issue_id, time.value, Number(len.value))).items;
        toast("Time blocked on your calendar");
        render();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Block";
        fail(err);
      }
    },
  }, "Block");
  return h("details", { class: "drop-menu pane-menu block-menu" },
    h("summary", { class: "ghost-btn small-btn", title: "Put a focus block on your calendar" }, "Block time ▾"),
    h("div", { class: "menu block-pop" },
      h("label", {}, h("span", { class: "muted small" }, "Start"), time),
      h("label", {}, h("span", { class: "muted small" }, "Length"), len),
      btn));
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

/** The balance rule (pill, popover, checklist): client share = client-labeled issues completed this
 *  week (Mon–Sun) ÷ all issues completed this week, as in Insights. It speaks up once at least
 *  NUDGE_MIN_DONE are done and the share is NUDGE_GAP or more away from the target. */
const NUDGE_MIN_DONE = 3;
const NUDGE_GAP = 0.15;

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

/** Is client or dev work behind this week? NUDGE_MIN_DONE and NUDGE_GAP decide. */
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

/** Smallest n with (x + n) / (total + n) ≥ target: issues from the behind side still needed. */
function neededToTarget(x: number, total: number, target: number): number {
  if (target >= 1) return Infinity;
  return Math.max(0, Math.ceil((target * total - x) / (1 - target) - 1e-9));
}

/** Under Today's "Behind the target" line: how many issues from the side that's behind get you back
 *  to the target by Sunday, the math behind that number, and up to three open issues from that side
 *  to put on Today. Client share = client-labeled issues you completed Mon–Sun ÷ all you completed. */
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
  const today = state.brief?.day ?? localToday();
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

async function blockFirst(i: Issue, btn: HTMLButtonElement, minutes: number, start = nextHalfHour()) {
  btn.disabled = true;
  btn.textContent = "Blocking…";
  try {
    if (!state.today.some((t) => t.issue_id === i.id)) {
      state.today = (await api.setToday([...state.today.map((t) => t.issue_id), i.id])).items;
    }
    state.today = (await api.block(i.id, start, minutes)).items;
    toast(`Blocked ${fmtMinutes(minutes)} at ${clock(start)} on your calendar`);
  } catch (e) {
    fail(e);
  }
  render();
}

/** A block for Claude's estimate, rounded up to 15 minutes (15 min to 3 h); an hour without one. */
function blockLength(minutes: number | null): number {
  return minutes ? Math.min(180, Math.max(15, Math.ceil(minutes / 15) * 15)) : 60;
}

/** "3 meetings, 3 things due and 1 to chase." The tile's headline when Claude's plan isn't in. */
function dayHeadline(b: Brief): string {
  const open = state.issues.filter(isOpen);
  const due = open.filter((i) => i.state.name !== b.waiting_state && i.due_date && i.due_date <= b.day);
  const chase = open.filter((i) => i.state.name === b.waiting_state && i.due_date && i.due_date <= b.day);
  const meetings = b.agenda ?? [];
  if (!meetings.length && !due.length && !chase.length) return "A clear day: nothing due, no meetings.";
  return `${listWords([b.agenda ? plural(meetings.length, "meeting") : "", `${due.length} ${due.length === 1 ? "thing" : "things"} due`,
    chase.length ? `${chase.length} to chase` : ""].filter(Boolean))}.`;
}

function minutesUntil(hm: string): number {
  const [hh, mm] = hm.split(":").map(Number);
  const d = new Date(); d.setHours(hh, mm, 0, 0);
  return Math.round((d.getTime() - Date.now()) / 60000);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / 864e5);
}

async function rewrap(btn?: HTMLButtonElement) {
  if (btn) { btn.disabled = true; btn.textContent = "Asking Claude…"; }
  try {
    await api.rewrap();
    toast("Claude is wrapping up your day. About a minute.");
    if (state.brief) state.brief.wrapup_run = { id: 0, status: "running", error: null, started_at: new Date().toISOString(), finished_at: null };
    pollPlan();
  } catch (e) {
    fail(e);
  }
  render();
}

// ---- the weekly mission check-in ---------------------------------------------------------------
// Each wrap-up rebuilds the week's check-in draft. The dialog shows it as text to edit, with four
// short fields only he can answer (how the week went, help, highlights, shoutouts). Copy puts it
// all on the clipboard, in the order /mission-checkin asks; empty fields are left out. Edits stay
// in this browser for the week, until Claude writes a newer draft (his four answers are kept).
const CHECKIN_PREF = "todohub.checkin";
const HEALTH_WORD = { on_track: "on track", at_risk: "at risk", off_track: "off track" } as const;
type CheckinDraft = { week: string; base: string; text: string; how: string; help: string; highlights: string; shoutouts: string };

function checkinText(c: Checkin): string {
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  return [
    c.work.length ? "Mission work this week:\n\n" + c.work.map((g) => `${g.mission}\n${list(g.items)}`).join("\n\n") : "",
    c.next_week.length ? `Plan for next week:\n${list(c.next_week)}` : "",
    c.review.length ? `Deliverables to review:\n${list(c.review)}` : "",
    c.health.length ? "Health of the missions I lead:\n" + c.health.map((x) => `- ${x.mission}: ${HEALTH_WORD[x.status]}. ${x.why}`.trim()).join("\n") : "",
  ].filter(Boolean).join("\n\n");
}

function showCheckin(c: Checkin) {
  let saved: Partial<CheckinDraft> = {};
  try { saved = JSON.parse(loadPref(CHECKIN_PREF) ?? "{}"); } catch { /* start fresh */ }
  if (saved.week !== c.week) saved = {};
  const draft: CheckinDraft = {
    week: c.week, base: c.made_at,
    text: saved.base === c.made_at && saved.text !== undefined ? saved.text : checkinText(c),
    how: saved.how ?? "", help: saved.help ?? "", highlights: saved.highlights ?? "", shoutouts: saved.shoutouts ?? "",
  };
  const save = () => savePref(CHECKIN_PREF, JSON.stringify(draft));
  const compose = () => [
    draft.how.trim() ? `How was my week: ${draft.how.trim()}` : "",
    draft.text.trim(),
    draft.help.trim() ? `Help needed: ${draft.help.trim()}` : "",
    draft.highlights.trim() ? `Highlights: ${draft.highlights.trim()}` : "",
    draft.shoutouts.trim() ? `Shoutouts: ${draft.shoutouts.trim()}` : "",
  ].filter(Boolean).join("\n\n");
  const missing = h("p", { class: "muted small ck-missing" });
  const showMissing = () => {
    const left = [["how", "how your week went"], ["help", "help needed"], ["highlights", "highlights"], ["shoutouts", "shoutouts"]]
      .filter(([k]) => !draft[k as keyof CheckinDraft].trim()).map(([, w]) => w);
    missing.textContent = left.length ? `Still yours to write: ${listWords(left)}. Empty ones are left out.` : "";
  };
  const field = (key: "how" | "help" | "highlights" | "shoutouts", label: string, hint: string) =>
    h("label", { class: "ck-field" }, h("span", {}, label),
      h("input", { type: "text", value: draft[key], placeholder: hint,
        oninput: (e: Event) => { draft[key] = (e.target as HTMLInputElement).value; save(); showMissing(); } }));
  const area = h("textarea", { class: "ck-text", rows: 16, spellcheck: true,
    oninput: (e: Event) => { draft.text = (e.target as HTMLTextAreaElement).value; save(); } }) as HTMLTextAreaElement;
  area.value = draft.text;
  showMissing();
  const through = weekday(c.through);
  const made = new Date(c.made_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  const close = modal("Weekly check-in", h("div", { class: "checkin" },
    h("p", { class: "muted small" }, `Your mission work, Monday to ${through}, drafted by Claude (${made}) from what you closed in Linear `
      + "and what the sweeps read. Edit it, then Copy and paste it when /mission-checkin asks. The check-in posts your words as they are."),
    field("how", "How was your week?", "A sentence or two"),
    area,
    field("help", "Help needed", "From whom, and can you set up the meeting?"),
    field("highlights", "Highlights", "Anything you want recognized"),
    field("shoutouts", "Shoutouts", "Good collaborators this week"),
    missing),
    [h("button", { class: "link-btn", title: "Throw away your edits to the draft (your four answers stay)",
        onclick: () => { draft.text = checkinText(c); area.value = draft.text; save(); } }, "Back to Claude's draft"),
     h("span", { class: "spacer" }),
     h("button", { class: "primary", onclick: async () => {
       if (await copyText(compose())) { toast("Check-in copied. Paste it into /mission-checkin."); close(); }
     } }, "Copy")],
    "wide");
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r === 0 ? `${h} h` : r === 30 ? `${h}½ h` : `${h} h ${r} min`;
}

/** Free minutes 8:30–18:00 (from now, if later) not taken by meetings, minus an hour for lunch. */
function freeMinutesToday(agenda: Brief["agenda"]): number | null {
  if (!agenda) return null;
  const toM = (hm: string) => { const [a, b] = hm.split(":").map(Number); return a * 60 + b; };
  const lo = Math.max(8 * 60 + 30, toM(nowHM())), hi = 18 * 60;
  if (lo >= hi) return 0;
  const busy = agenda.map((e) => [Math.max(lo, toM(e.start)), Math.min(hi, e.end ? toM(e.end) : toM(e.start) + 30)])
    .filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let taken = 0, cur: number[] | null = null;
  for (const [a, b] of busy) {
    if (!cur || a > cur[1]) { if (cur) taken += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) taken += cur[1] - cur[0];
  const lunch = lo < 13 * 60 ? 60 : 0;
  return Math.max(0, hi - lo - taken - lunch);
}

type PlanPick = { issue: Issue; why: string; minutes: number | null; done: boolean };

/** Claude's picks matched to open issues and to what you closed today (checked off), or the
 *  counted suggestions when there's no plan. */
function planPicks(b: Brief): { picks: PlanPick[]; fromClaude: boolean } {
  const byIdent = new Map(state.issues.filter(isOpen).map((i) => [i.identifier, i]));
  const doneByIdent = new Map(b.completed_today.map((i) => [i.identifier, i]));
  if (b.plan) {
    const picks = b.plan.picks.map((p) => {
      const done = doneByIdent.get(p.identifier);
      return { issue: done ?? byIdent.get(p.identifier), why: p.why, minutes: p.minutes as number | null, done: !!done };
    }).filter((p): p is PlanPick => !!p.issue);
    if (picks.length) return { picks, fromClaude: true };
  }
  const reason = (i: Issue) => {
    if (i.due_date && i.due_date < b.day) return `${plural(daysBetween(i.due_date, b.day), "day")} late.`;
    if (i.due_date === b.day) return "Due today.";
    if (i.priority === 1) return "Marked urgent.";
    if (i.priority === 2) return "High priority.";
    return i.state.type === "started" ? "Already in progress." : "Due soon.";
  };
  return { picks: suggestPlan(b.day, b.waiting_state).map((i) => ({ issue: i, why: reason(i), minutes: null, done: false })), fromClaude: false };
}

let planPoll: number | undefined;
function pollPlan() {
  window.clearTimeout(planPoll);
  planPoll = window.setTimeout(() => { state.briefAt = 0; ensureBrief(); }, 6000);
}

async function replan(btn?: HTMLButtonElement) {
  if (btn) { btn.disabled = true; btn.textContent = "Asking Claude…"; }
  try {
    await api.replan();
    toast("Claude is planning your day. About a minute.");
    if (state.brief) state.brief.plan_run = { id: 0, status: "running", error: null, started_at: new Date().toISOString(), finished_at: null };
    pollPlan();
  } catch (e) {
    fail(e);
  }
  render();
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

// ---- Today helpers -----------------------------------------------------------------------------
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

/** The status Mark done and a ticked sub-issue use: Done, as the backend works it out. */
function doneStatus() {
  const m = state.meta;
  return m?.states.find((s) => s.name === m.done_state);
}

/** The status an unticked sub-issue goes back to, as a new one gets: Todo, as the backend works it out. */
function todoStatus() {
  const m = state.meta;
  return m?.states.find((s) => s.name === m.todo_state);
}

/** Check it off: moves the issue to Done (doneStatus) in Linear, with undo. */
async function completeIssue(i: Issue) {
  const done = doneStatus();
  if (!done) { toast("Couldn't find a done status for this team"); return; }
  state.briefAt = 0;                 // the wrap-up's "done today" should include it
  await editIssue(i, { state_id: done.id });
}

/** Split Today into open items and the rest. Only meaningful once the open issues have loaded. */
function todaySplit(): { open: TodayItem[]; gone: TodayItem[] } {
  const openIds = new Set(state.issues.filter(isOpen).map((i) => i.id));
  return {
    open: state.today.filter((t) => openIds.has(t.issue_id)),
    gone: state.today.filter((t) => !openIds.has(t.issue_id)),
  };
}

// ---- the reading pane's fields row (the rest of the pane is in pane.ts) --------------------------
/** Status, priority, due date, client and project: the fields both reading panes edit in place. */
function issueFields(i: Issue): HTMLElement[] {
  return [
    statusPill(i, (id) => { details.delete(i.id); void editIssue(i, { state_id: id }); }),
    priorityPill(i.priority, (v) => void editIssue(i, { priority: v })),
    dateInput(i.due_date, (v) => void editIssue(i, { due_date: v }), dueClass(i.due_date)),
    clientSelect(i.client, (v) => void editIssue(i, { client: v })),
    projectSelect(i.project, (v) => void editIssue(i, { project: v })),
  ];
}

// ---- Today: one list, read in three moments ----------------------------------------------------
// The morning, until you start the day: a night sky with yesterday's recap, Claude's suggestion and
// its picks to check; "Start my day" puts what you checked on Today, and the sun rises. Through the
// day: a band with the time and the next meeting, Claude's note, and the Today list (Client and Dev)
// beside the selected issue. The wrap-up, once the 4 PM sweep writes it (or from 5 PM): a dusk sky
// with the score and tomorrow, and Claude's next step for each open item. Claude only suggests.
const COVER_FROM = 6, COVER_UNTIL = 12;   // hours: the morning cover waits for Start my day until noon
const WRAPUP_FROM = 17;                   // without Claude's wrap-up, the dusk view still comes at 5 PM
const PLAN_SEEN = "todohub.planSeen";     // the day Start my day was last pressed
const RISE_MS = 2400;                     // the sunrise, from night to the band

type Moment = "cover" | "day" | "wrapup";

interface TodayCtx {
  b: Brief;
  moment: Moment;
  list: Issue[];                          // on Today: open, and at wrap-up also the ones done today
  off: Issue[];                           // through the day: Claude's picks and late issues not on Today
  sections: { side: "client" | "dev"; rows: Issue[] }[];
  order: Issue[];                         // j / k order: the sections, then the open "not on Today" fold
  sel: Issue | null;
}

function isWorkday(day: string): boolean {
  const d = new Date(day + "T12:00:00").getDay();
  return d !== 0 && d !== 6;
}

function todayMoment(b: Brief): Moment {
  const hour = new Date().getHours();
  if (b.wrapup || b.wrapup_run?.status === "running" || (isWorkday(b.day) && hour >= WRAPUP_FROM)) return "wrapup";
  if (isWorkday(b.day) && hour >= COVER_FROM && hour < COVER_UNTIL && loadPref(PLAN_SEEN) !== b.day) return "cover";
  return "day";
}

const planPick = (b: Brief, i: Issue) => b.plan?.picks.find((p) => p.identifier === i.identifier);
const planAside = (b: Brief, i: Issue) => b.plan?.set_aside.find((a) => a.identifier === i.identifier);
const wrapAdvice = (b: Brief, i: Issue) => b.wrapup?.items.find((a) => a.identifier === i.identifier);
const dayShort = (day: string) => weekday(day).slice(0, 3);
const isWaiting = (i: Issue, b: Brief) => i.state.name === b.waiting_state;

/** Attention order: late, due today, a follow-up that's due, due later, no date. */
function urgency(i: Issue, b: Brief): number {
  if (isWaiting(i, b)) return i.due_date && i.due_date <= b.day ? 2 : 4;
  if (i.due_date && i.due_date < b.day) return 0;
  if (i.due_date === b.day) return 1;
  return i.due_date ? 3 : 4;
}

/** Client and Dev, each in attention order; the side holding the most urgent item comes first,
 *  then the side that's behind its balance target. */
function todaySections(list: Issue[], b: Brief): TodayCtx["sections"] {
  const pos = new Map(state.today.map((t) => [t.issue_id, t.position]));
  const sides = (["client", "dev"] as const).map((side) => ({
    side,
    rows: list.filter((i) => i.list === side)
      .sort((x, y) => urgency(x, b) - urgency(y, b) || (pos.get(x.id) ?? 0) - (pos.get(y.id) ?? 0)),
  }));
  const top = (s: { rows: Issue[] }) => (s.rows.length ? urgency(s.rows[0], b) : 9);
  const behind = behindSide()?.side;
  return sides.sort((x, y) => top(x) - top(y) || (x.side === behind ? -1 : y.side === behind ? 1 : 0));
}

function todayCtx(b: Brief): TodayCtx {
  const moment = todayMoment(b);
  const openById = new Map(state.issues.filter(isOpen).map((i) => [i.id, i]));
  const doneById = new Map(b.completed_today.filter((i) => !openById.has(i.id)).map((i) => [i.id, i]));
  const list = state.today
    .map((t) => openById.get(t.issue_id) ?? (moment === "wrapup" ? doneById.get(t.issue_id) : undefined))
    .filter((i): i is Issue => !!i);
  const on = new Set(list.map((i) => i.id));
  const byIdent = new Map([...openById.values()].map((i) => [i.identifier, i]));
  const off = moment === "day"
    ? [...new Set([...(b.plan?.picks ?? []), ...(b.plan?.set_aside ?? [])].map((p) => byIdent.get(p.identifier)))]
        .filter((i): i is Issue => !!i && !on.has(i.id))
    : [];
  const sections = todaySections(list, b);
  const order = [...sections.flatMap((s) => s.rows), ...(state.todayOffOpen ? off : [])];
  let sel = order.find((i) => i.id === state.todaySel) ?? null;
  if (!sel) {
    sel = (moment === "wrapup" ? order.find((i) => !outcome(i, b, wrapAdvice(b, i))) : order[0]) ?? null;
    state.todaySel = sel?.id ?? null;
  }
  return { b, moment, list, off, sections, order, sel };
}

/** What's been decided for an item, read back from Linear and tomorrow's list: done, moved to
 *  tomorrow, re-dated or cleared as Claude suggested, or its message copied. */
function outcome(i: Issue, b: Brief, step?: { action: string; move_to?: string }): string | null {
  if (!isOpen(i)) return "Done";
  if (b.next_today.includes(i.id)) return `Moved to ${dayShort(b.next_day)}`;
  if (step?.action === "move" && step.move_to && i.due_date === step.move_to) return `Due ${dueWord(b, step.move_to)}`;
  if (step?.action === "clear_date" && !i.due_date) return "Date cleared";
  if (state.copied.has(i.id)) return "Message copied";
  return null;
}

function dueWord(b: Brief, day: string): string {
  return daysBetween(b.day, day) < 7 ? weekday(day).slice(0, 3) : shortDay(day);
}

// ---- Claude's text: issues it names become chips -------------------------------------------------
const ISSUE_REF = /\[([^\]\n]+)\]\(([A-Za-z][A-Za-z0-9]*-\d+)\)/g;

/** Claude writes `[short label](ENG-123)` for each issue it names. An open issue becomes a chip that
 *  goes to it, one done today a struck chip, any other just its label. Text stays text. */
function claudeText(text: string, go: (i: Issue) => void): Node[] {
  const out: Node[] = [];
  let at = 0;
  for (const m of text.matchAll(ISSUE_REF)) {
    out.push(document.createTextNode(text.slice(at, m.index)));
    const [, label, ident] = m;
    const open = state.issues.find((i) => i.identifier === ident && isOpen(i));
    const done = !open && state.brief?.completed_today.some((i) => i.identifier === ident);
    out.push(open ? h("button", { class: "ref", title: `${ident} ${open.title}`, onclick: () => go(open) }, h("span", { class: "k" }, ident), label)
      : done ? h("span", { class: "ref struck", title: `${ident} is done` }, h("span", { class: "k" }, ident), label)
      : document.createTextNode(label));
    at = (m.index ?? 0) + m[0].length;
  }
  out.push(document.createTextNode(text.slice(at)));
  return out;
}

function redoIcon(): SVGElement {
  return svg("svg", { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 1.8,
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, svg("path", { d: "M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.9h-2.9" }));
}
function checkIcon(): SVGElement {
  return svg("svg", { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 2,
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, svg("path", { d: "M3 8.5l3 3 7-7" }));
}

/** "Claude 2:58 PM · ↻ Redo · about 1 min", or the run in progress, or why it didn't finish. */
function claudeBy(madeAt: string | null, run: Brief["plan_run"], label: string, redo: (btn: HTMLButtonElement) => void): HTMLElement {
  const running = run?.status === "running";
  if (running) pollPlan();
  return h("div", { class: "td-by" },
    madeAt ? h("span", { class: "who" }, "Claude") : "",
    madeAt ? h("span", { class: "n" }, new Date(madeAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) : "",
    running ? h("span", { class: "td-running" }, h("span", { class: "spinner" }), " Claude is on it…")
      : h("button", { class: "td-redo", title: "Claude reads your day again and writes this again (about a minute and a few cents)",
          onclick: (e: Event) => redo(e.currentTarget as HTMLButtonElement) }, redoIcon(), label),
    running ? "" : h("span", {}, "about 1 min"),
    run?.status === "error" && !running ? h("span", { class: "td-err" }, `The last run didn't finish: ${run.error ?? "see the sweep log"}`) : "");
}

async function renote(btn?: HTMLButtonElement) {
  if (btn) { btn.disabled = true; btn.textContent = "Asking Claude…"; }
  try {
    await api.renote();
    toast("Claude is writing a fresh note. About a minute.");
    if (state.brief) state.brief.note_run = { id: 0, status: "running", error: null, started_at: new Date().toISOString(), finished_at: null };
    pollPlan();
  } catch (e) {
    fail(e);
  }
  render();
}

// ---- the sky ---------------------------------------------------------------------------------------
/** Where the sun is in the band now, from today's sunrise and sunset where you are (the Daylight
 *  theme's location): low on the left at sunrise, highest at solar noon, low on the right at sunset;
 *  the sky turns pale around midday and dark with stars from sunset, over 45 minutes. */
function sunState(now = new Date()): { vars: string; night: boolean; x: number } {
  const loc = daylightLocation();
  const st = sunTimes(now, loc.lat, loc.lon) ?? { rise: 6 * 60, set: 18 * 60 };
  const m = now.getHours() * 60 + now.getMinutes();
  const c = Math.min(1, Math.max(0, (m - st.rise) / (st.set - st.rise)));
  const lift = Math.sin(Math.PI * c);
  const outside = m < st.rise ? st.rise - m : m > st.set ? m - st.set : 0;
  const dark = Math.min(1, outside / 45);
  const x = 24 + 70 * c;
  return {
    vars: `--sun-x: ${x.toFixed(1)}%; --sun-b: ${(-4 + 22 * lift - 20 * dark).toFixed(1)}px; `
      + `--sky-noon: ${Math.max(0, (lift - 0.45) / 0.55).toFixed(2)}; --sky-night: ${dark.toFixed(2)}`,
    night: dark > 0.5,
    x,
  };
}

/** Move the sun in the band every minute, so it drifts without a re-render. */
function tickSun() {
  const s = sunState();
  for (const sky of document.querySelectorAll<HTMLElement>(".td-sky.band")) {
    sky.setAttribute("style", s.vars);
    sky.classList.toggle("night", s.night);
  }
}
window.setInterval(tickSun, 60_000);

function skyLayers(): Node[] {
  return [h("span", { class: "s-night" }), h("span", { class: "s-dawn" }), h("span", { class: "s-noon" }), h("span", { class: "s-stars" }),
    h("span", { class: "s-sun" }),
    svg("svg", { class: "s-hill", viewBox: "0 0 852 16", preserveAspectRatio: "none", "aria-hidden": "true" },
      svg("path", { d: "M-1 11C120 4 240 5 360 10S560 15 680 10S800 11 853 12V18H-1Z", fill: "#e9dcc4", stroke: "#dcc9a8",
        "vector-effect": "non-scaling-stroke" }))];
}

/** The band through the day: the time, the next meeting and the one after. */
function bandText(b: Brief, sunLeft: boolean): HTMLElement {
  const now = nowHM();
  const ahead = (b.agenda ?? []).filter((m) => (m.end ?? m.start) > now);
  const next = ahead[0], then = ahead[1];
  const mins = next ? minutesUntil(next.start) : 0;
  const when = !next ? "" : mins <= 0 ? "now" : mins < 60 ? `in ${mins} min`
    : `in ${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
  return h("div", { class: `td-bt${sunLeft ? " right" : ""}` },
    h("time", { class: "n" }, new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })),
    next ? h("span", {}, "Next ", h("b", {}, `${hm12(next.start)} `, link(next.title, next.link, "td-mtg")), ` · ${when}${next.external ? " · external" : ""}`)
      : h("span", {}, b.agenda === null ? "Your calendar comes in with the first sweep of the day." : "No more meetings today."),
    then ? h("span", { class: "td-then n" }, `then ${hm12(then.start)} ${then.title}${ahead.length > 2 ? ` + ${ahead.length - 2} more` : ""}`) : "");
}

// ---- the morning cover -------------------------------------------------------------------------
/** The cover's checklist: Claude's picks (or, until its plan is in, suggestions counted from due dates
 *  and priority), none on Today until you check them; then what's on Today already, checked. */
function coverRows(b: Brief): { picks: PlanPick[]; fromClaude: boolean; already: Issue[] } {
  const { picks, fromClaude } = planPicks(b);
  const open = picks.filter((p) => !p.done);
  const picked = new Set(open.map((p) => p.issue.id));
  const already = state.today.map((t) => state.issues.find((i) => i.id === t.issue_id && isOpen(i)))
    .filter((i): i is Issue => !!i && !picked.has(i.id));
  if (!state.coverChecked) state.coverChecked = new Set(state.today.map((t) => t.issue_id));
  return { picks: open, fromClaude, already };
}

function coverDue(i: Issue, b: Brief): HTMLElement | "" {
  if (isWaiting(i, b)) return i.due_date && i.due_date <= b.day ? h("span", { class: "soon" }, "follow up today") : "";
  if (i.due_date && i.due_date < b.day) return h("span", { class: "late" }, `${daysBetween(i.due_date, b.day)}d late`);
  if (i.due_date === b.day) return h("span", { class: "soon" }, "due today");
  const slip = state.slips?.slips[i.id];
  if (i.due_date) return h("span", {}, `due ${dueWord(b, i.due_date)}`);
  return slip && slip.count >= 2 ? h("span", { class: "soon" }, `pushed ${slip.count}×`) : "";
}

function coverView(b: Brief, rising: boolean): HTMLElement {
  const { picks, fromClaude, already } = coverRows(b);
  const checked = state.coverChecked!;
  const sun = sunState();
  const row = (i: Issue, why: string, minutes: number | null) => h("button", {
    class: "pk", role: "checkbox", "aria-checked": String(checked.has(i.id)), "data-id": i.id,
    onclick: () => toggleCover(i.id),
  },
    h("span", { class: "box" }, checkIcon()),
    taskAvatar(i.client, i.category, "sm"),
    h("span", { class: "pt" }, h("span", { class: "pn" }, i.title), why ? h("span", { class: "pw", title: why }, why) : ""),
    h("span", { class: "pd n" }, coverDue(i, b), minutes ? h("span", {}, `~${fmtMinutes(minutes)}`) : ""));
  const focusRow = (i: Issue) => {
    const el = document.querySelector<HTMLElement>(`.pk[data-id="${i.id}"]`);
    el?.scrollIntoView({ block: "nearest" });
    el?.focus({ preventScroll: true });
  };
  const plan = b.plan;
  const brief = plan
    ? h("div", { class: "cv-brief" },
        plan.recap ? h("p", {}, h("b", {}, "Yesterday"), ...claudeText(plan.recap, focusRow)) : "",
        h("p", {}, h("b", {}, "Today"), ...claudeText(plan.summary || plan.headline, focusRow)))
    : h("div", { class: "cv-brief" }, h("p", {}, `${dayHeadline(b)} `,
        b.plan_run?.status === "running" ? "Claude is planning your day…" : "Claude's plan comes in with the first sweep of the morning."));
  const group = (label: string, rows: Node[], extra: Node | "" = "") => rows.length
    ? h("div", { class: "pg" }, h("div", { class: "pl" }, h("span", { class: "n" }, `${label} · ${rows.length}`), extra), ...rows) : "";
  const by = h("span", { class: "plby" }, claudeBy(plan?.made_at ?? null, b.plan_run, fromClaude ? "Re-plan" : "Ask Claude to plan", (btn) => void replan(btn)));
  return h("section", {
    class: `td-sky cover${rising ? " rising" : ""}`, "aria-label": "Plan your day",
    style: `${sun.vars}; --elapsed: ${rising ? Math.min(Date.now() - state.planRiseAt, RISE_MS) : 0}ms`,
  },
    ...skyLayers(),
    h("div", { class: "cv" },
      h("h2", {}, "Good morning."),
      brief,
      picks.length || already.length ? h("div", { class: "pks", role: "group", "aria-label": "What you'll take on today" },
        group(fromClaude ? "Claude suggests" : "Suggested from due dates", picks.map((p) => row(p.issue, p.why, p.minutes)), by),
        group("Already on Today", already.map((i) => row(i, planAside(b, i)?.why ?? "", null)))) : "",
      h("div", { class: "cf" }, h("button", { class: "start", onclick: () => void startDay(b) }, ...coverFooter(b).label),
        h("span", { class: "tally n" }, ...coverFooter(b).tally))),
    bandText(b, sun.x < 50));
}

/** "Start my day with 3" and "About 1 h 35 min of your 6 h free", from what's checked. */
function coverFooter(b: Brief): { label: Child[]; tally: Child[] } {
  const checked = state.coverChecked ?? new Set<string>();
  const { picks, already } = coverRows(b);
  const on = [...picks.map((p) => ({ id: p.issue.id, minutes: p.minutes })), ...already.map((i) => ({ id: i.id, minutes: null }))]
    .filter((x) => checked.has(x.id));
  const mins = on.reduce((n, x) => n + (x.minutes ?? 0), 0);
  const free = freeMinutesToday(b.agenda);
  const rows = picks.length + already.length;
  return {
    label: [on.length ? `Start my day with ${on.length}` : "Start my day", h("kbd", {}, "↵")],
    tally: rows ? [mins && free !== null ? `About ${fmtMinutes(mins)} of your ${fmtMinutes(free)} free · ` : on.length ? "" : "Nothing checked yet · ",
      h("kbd", {}, "x"), " check · ", h("kbd", {}, "j"), " ", h("kbd", {}, "k"), " move"] : [],
  };
}

/** Update the cover after a check, without rebuilding it (which would lose the focused row). */
function updateCover(b: Brief) {
  const checked = state.coverChecked;
  if (!checked) return;
  document.querySelectorAll<HTMLElement>(".pk").forEach((el) => el.setAttribute("aria-checked", String(checked.has(el.dataset.id ?? ""))));
  const { label, tally } = coverFooter(b);
  document.querySelector(".td-sky.cover .start")?.replaceChildren(...label.filter((x): x is Node | string => !!x));
  document.querySelector(".td-sky.cover .tally")?.replaceChildren(...tally.filter((x): x is Node | string => !!x));
}

function toggleCover(id: string) {
  const checked = state.coverChecked;
  if (!checked || !state.brief) return;
  if (checked.has(id)) checked.delete(id); else checked.add(id);
  updateCover(state.brief);
}

function moveCoverFocus(delta: number) {
  const rows = [...document.querySelectorAll<HTMLElement>(".pk")];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  rows[at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + delta))]?.focus();
}

/** Start my day: what's checked becomes Today (what you unchecked comes off), and the sun rises. */
async function startDay(b: Brief) {
  const checked = state.coverChecked ?? new Set<string>();
  const { picks } = coverRows(b);
  const ids = [...state.today.map((t) => t.issue_id).filter((id) => checked.has(id)),
    ...picks.map((p) => p.issue.id).filter((id) => checked.has(id) && !state.today.some((t) => t.issue_id === id))];
  savePref(PLAN_SEEN, b.day);
  state.coverChecked = null;
  state.todaySel = null;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  state.planRiseAt = reduce ? 0 : Date.now();
  if (!reduce) window.setTimeout(() => { if (state.tab === "today") render(); }, RISE_MS + 50);
  render();                             // the sun starts rising now; the list below follows the save
  state.todaySel = null;                // then the most urgent item of the new list
  await saveToday(ids);
}

// ---- the wrap-up's dusk ------------------------------------------------------------------------
function duskView(ctx: TodayCtx): HTMLElement {
  const { b } = ctx;
  const w = b.wrapup;
  const planned = b.plan?.picks.map((p) => p.identifier) ?? [];
  const doneIdents = new Set(b.completed_today.map((i) => i.identifier));
  const plannedDone = planned.filter((x) => doneIdents.has(x)).length;
  const doneN = b.completed_today.length;
  const left = ctx.list.filter((i) => isOpen(i)).length;
  const headline = planned.length
    ? `${plannedDone} of ${planned.length} planned done${doneN > plannedDone ? `, plus ${doneN - plannedDone} more` : ""}.`
    : doneN || left ? `${doneN} done today, ${left} still open.` : "A quiet day: nothing planned, nothing closed.";
  const go = (i: Issue) => selectToday(i.id);
  const tomorrow = b.next_day;
  const firstMeeting = b.next_agenda?.[0];
  const dueTomorrow = state.issues.filter((i) => isOpen(i) && !isWaiting(i, b) && i.due_date === tomorrow).length;
  const startWith = w?.start_with ? state.issues.find((i) => i.identifier === w.start_with!.identifier && isOpen(i)) : undefined;
  const bits = [firstMeeting ? `${hm12(firstMeeting.start)} ${firstMeeting.title}` : "", dueTomorrow ? `${dueTomorrow} due` : ""].filter(Boolean);
  return h("section", { class: "td-sky dusk", "aria-label": "Wrap-up" },
    h("span", { class: "s-stars" }), ...skyLayers().slice(-1),
    h("div", { class: "dk" },
      h("div", { class: "l1" }, h("time", { class: "n" }, new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })),
        h("h2", {}, headline)),
      w?.summary ? h("p", { class: "sum" }, ...claudeText(w.summary, go))
        : h("p", { class: "sum" }, b.wrapup_run?.status === "running" ? "" : "Claude's wrap-up comes in with the 4 PM sweep."),
      h("div", { class: "td-by-row" },
        claudeBy(w?.made_at ?? null, b.wrapup_run, w ? "Redo" : "Ask Claude to wrap up", (btn) => void rewrap(btn)),
        h("span", { class: "spacer" }),
        b.checkin ? h("button", { class: "td-redo", title: "Your mission check-in for this week, drafted by Claude, to paste into /mission-checkin",
          onclick: () => showCheckin(b.checkin!) }, "Weekly check-in") : ""),
      h("div", { class: "tmr" }, h("b", {}, weekday(tomorrow)),
        startWith ? h("span", {}, "start with ", h("button", { class: "ref", onclick: () => void openUrl(startWith.url), title: w!.start_with!.why },
          h("span", { class: "k" }, startWith.identifier), startWith.title)) : "",
        bits.length ? h("span", { class: "n" }, `${startWith ? "· " : ""}${bits.join(" · ")}`)
          : !startWith ? h("span", {}, b.next_agenda === null ? "Calendar comes in with the first sweep of the day." : "No meetings and nothing due.") : "")));
}

// ---- the list ------------------------------------------------------------------------------------
function rowMeta(i: Issue, ctx: TodayCtx): Child[] {
  const { b } = ctx;
  const bits: Child[] = [];
  const done = ctx.moment === "wrapup" ? outcome(i, b, wrapAdvice(b, i)) : ctx.off.includes(i) ? outcome(i, b, planAside(b, i)) : null;
  if (done) return [h("span", { class: "ok" }, checkIcon(), done)];
  if (ctx.moment === "wrapup") bits.push(h("span", { class: "sg" }, stepLabel(i, b)));
  else if (ctx.off.includes(i)) {
    const a = planAside(b, i);
    bits.push(a ? h("span", {}, "Claude: ", a.action === "move" ? `set due ${dueWord(b, a.move_to!)}` : a.action === "ask" ? "ask" : "clear the date")
      : h("span", { class: "sg" }, "Suggested"));
  }
  const due = coverDue(i, b);
  if (isWaiting(i, b)) bits.push(h("span", {}, "waiting", due ? " · " : "", due));
  else if (due) bits.push(due);
  const t = state.today.find((x) => x.issue_id === i.id);
  if (t?.event_start && t.event_minutes) {
    const s0 = new Date(t.event_start), s1 = new Date(s0.getTime() + t.event_minutes * 60_000);
    const f = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    bits.push(h("span", { class: "blocked" }, `blocked ${f(s0)}–${f(s1)}`));
  } else if (ctx.moment !== "wrapup" && !isWaiting(i, b) && planPick(b, i)?.minutes) {
    bits.push(`~${fmtMinutes(planPick(b, i)!.minutes)}`);
  }
  return bits.flatMap((x, n) => (n ? [" · ", x] : [x]));
}

function todayRow(i: Issue, ctx: TodayCtx): HTMLElement {
  const decided = ctx.moment === "wrapup" && !!outcome(i, ctx.b, wrapAdvice(ctx.b, i));
  const on = ctx.sel?.id === i.id;
  // Client's row (.tl-item); a decided row drops its priority edge.
  const edge = !decided && (i.priority === 1 || i.priority === 2) ? ` prio-${i.priority}` : "";
  return h("button", {
    class: `tl-item td-row${on ? " sel" : ""}${edge}${decided ? " dec" : ""}`,
    "aria-current": String(on), "data-id": i.id,
    onclick: () => selectToday(i.id),
  },
    taskAvatar(i.client, i.category, "sm"),
    h("span", { class: "tl-body" }, h("span", { class: "tl-title" }, i.title), h("span", { class: "tl-meta" }, ...rowMeta(i, ctx))));
}

function balanceMeter(share: number, target: number): HTMLElement {
  return h("span", { class: "td-meter", role: "img", "aria-label": `${pct(share)} of what you closed this week; target ${pct(target)}` },
    h("i", { style: `width: ${Math.round(share * 100)}%` }), h("b", { style: `left: calc(${Math.round(target * 100)}% - 1px)` }));
}

function todaySection(s: TodayCtx["sections"][number], ctx: TodayCtx): HTMLElement | "" {
  if (!s.rows.length) return "";
  const w = state.balance?.weeks.at(-1);
  const share = w && w.client_share !== null ? (s.side === "client" ? w.client_share : 1 - w.client_share) : null;
  const target = state.balance ? (s.side === "client" ? state.balance.target : 1 - state.balance.target) : 0.5;
  const behind = behindSide();
  const lean = behind?.side === s.side && w && loadPref(BALANCE_HIDE) !== w.week;
  return h("section", { class: "ll-group" },
    groupHead(s.side === "client" ? "Client" : "Dev", "", s.rows.filter(isOpen),
      share !== null ? h("span", { class: "group-action td-share" }, `${pct(share)} of done`, balanceMeter(share, target)) : ""),
    lean && behind && w ? h("span", { class: "bal-anchor td-behind" },
      h("button", { class: "link-btn", "aria-expanded": String(state.balanceOpen), "aria-haspopup": "dialog",
        onclick: () => { state.balanceOpen = !state.balanceOpen; render(); } },
        `Behind the ${pct(behind.target)} target this week, so lean ${s.side}${ctx.moment === "wrapup" ? " tomorrow" : ""}.`),
      state.balanceOpen ? balancePopover(behind, w, ctx.b.waiting_state) : "") : "",
    ...s.rows.map((i) => todayRow(i, ctx)));
}

function todayQueue(ctx: TodayCtx): HTMLElement {
  const { b } = ctx;
  const done = b.completed_today.filter((i) => !state.issues.some((x) => x.id === i.id && isOpen(x)) && !ctx.list.some((x) => x.id === i.id));
  const doneClient = done.filter((i) => i.list === "client").length;
  const lateN = ctx.off.filter((i) => planAside(b, i)).length;
  const offLabel = lateN === ctx.off.length ? [h("span", { class: "late n" }, `${lateN} late`), ", not on Today"]
    : [h("span", { class: "n" }, String(ctx.off.length)), " not on Today", lateN ? " · " : "", lateN ? h("span", { class: "late n" }, `${lateN} late`) : ""];
  const anyRows = ctx.sections.some((s) => s.rows.length);
  return h("div", { class: "td-q" },
    h("div", { class: "td-qp", "aria-label": "Today" },
      ...ctx.sections.map((s) => todaySection(s, ctx)),
      anyRows ? "" : h("p", { class: "td-none" }, ctx.moment === "wrapup" ? "Nothing was on Today." : "Nothing open on Today."),
      ctx.off.length ? h("details", { class: "td-fold", open: state.todayOffOpen,
        ontoggle: (e: Event) => { const open = (e.currentTarget as HTMLDetailsElement).open; if (open !== state.todayOffOpen) { state.todayOffOpen = open; render(); } } },
        h("summary", {}, h("span", {}, ...offLabel)),
        h("p", { class: "td-foldnote" }, lateN === ctx.off.length ? "Claude left these out of today's plan. Each has a next step."
          : lateN ? "Suggestions you didn't take, and late issues Claude left out." : "Suggestions you didn't take."),
        ...ctx.off.map((i) => todayRow(i, ctx))) : "",
      done.length ? h("details", { class: "td-fold done", open: state.todayDoneOpen,
        ontoggle: (e: Event) => { state.todayDoneOpen = (e.currentTarget as HTMLDetailsElement).open; } },
        h("summary", {}, h("span", { class: "ok" }, checkIcon()), h("span", { class: "n" }, `${done.length} ${ctx.moment === "wrapup" ? "more " : ""}done today (${doneClient} client, ${done.length - doneClient} dev)`)),
        h("div", { class: "td-dl" }, ...done.map((i) => h("div", {}, link(i.identifier, i.url, "ident"), h("span", {}, i.title))))) : ""),
    h("div", { class: "td-hint" }, h("kbd", {}, "j"), " / ", h("kbd", {}, "k"), " to move · ", h("kbd", {}, "⌘Z"), " undo"));
}

// ---- the stage: the selected issue ---------------------------------------------------------------
type FreeWindow = { from: number; to: number; before: string | null };
const minOf = (hm: string) => { const [a, c] = hm.split(":").map(Number); return a * 60 + c; };
const hmOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Free stretches of 15 minutes or more from now to 6 PM, between meetings and lunch. */
function freeWindows(agenda: AgendaEvent[]): FreeWindow[] {
  const now = new Date();
  const hi = 18 * 60;
  let at = Math.max(8 * 60 + 30, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5);
  const busy = [...agenda.map((e) => ({ from: minOf(e.start), to: e.end ? minOf(e.end) : minOf(e.start) + 30, title: e.title })),
    { from: 12 * 60, to: 13 * 60, title: "lunch" }].sort((x, y) => x.from - y.from);
  const out: FreeWindow[] = [];
  for (const m of busy) {
    if (at >= hi) break;
    if (m.to <= at) continue;
    if (Math.min(m.from, hi) - at >= 15) out.push({ from: at, to: Math.min(m.from, hi), before: m.from < hi ? m.title : null });
    at = Math.max(at, m.to);
  }
  if (hi - at >= 15) out.push({ from: at, to: hi, before: null });
  return out;
}

/** Where Claude's estimate fits: in the stretch you're in now, or the next one long enough. */
function fitFor(minutes: number, agenda: AgendaEvent[] | null): { text: string; over: boolean; pct: number; start: string } | null {
  if (!agenda) return null;
  const ws = freeWindows(agenda);
  const w = ws.find((x) => x.to - x.from >= minutes);
  const nowM = minOf(nowHM());
  const before = (x: FreeWindow) => (x.before ? `before ${x.before}` : "before the end of the day");
  if (!w) return { text: `~${fmtMinutes(minutes)} · no free stretch that long today`, over: true, pct: 100, start: nextHalfHour() };
  const now = w === ws[0] && w.from <= nowM + 5;
  return {
    text: now ? `~${fmtMinutes(minutes)} · fits the ${fmtMinutes(w.to - w.from)} ${before(w)}`
      : `~${fmtMinutes(minutes)} · ${ws[0] && ws[0].from <= nowM + 5 ? "too long for now; " : ""}fits ${hm12(hmOf(w.from))}–${hm12(hmOf(w.to))}, ${before(w)}`,
    over: !now, pct: Math.min(100, Math.round((minutes / (w.to - w.from)) * 100)), start: hmOf(w.from),
  };
}

function actButton(label: string, key: string, run: (btn: HTMLButtonElement) => void, primary = false): HTMLElement {
  return h("button", { class: primary ? "primary td-btn" : "td-btn", onclick: (e: Event) => run(e.currentTarget as HTMLButtonElement) },
    label, h("kbd", {}, key));
}

function stageTop(i: Issue, note: Node | string): HTMLElement {
  const where = i.client ?? i.project ?? (i.list === "dev" ? "Dev" : "");
  return h("div", { class: "td-top" }, link(i.identifier, i.url, "ident"),
    where ? h("span", {}, "· ", where) : "", note ? h("span", {}, "· ", note) : "",
    slipTag(state.slips?.slips[i.id]),
    h("button", { class: "td-open", onclick: () => void openUrl(i.url) }, "Open in Linear", h("kbd", {}, "o")));
}

function stageBody(i: Issue, onToday: boolean): Node[] {
  loadDetail(i.id);
  const more = h("details", { class: "drop-menu pane-menu" },
    h("summary", { class: "ghost-btn small-btn icon-more", title: "More", "aria-label": "More actions" }, "⋯"),
    h("div", { class: "menu" },
      state.meta?.periscope ? periscopeItem(i) : "",
      onToday ? h("button", { type: "button", onclick: () => void toggleToday(i.id) }, "Remove from Today") : "",
      h("button", { type: "button", class: "menu-danger", onclick: (e: Event) => {
        (e.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
        confirmDelete(i);
      } }, "Delete…")));
  return [
    h("div", { class: "tl-fields" }, ...issueFields(i),
      h("span", { class: "tl-actions" }, more, periscopePopover(i))),
    detailBody(i.id),
  ];
}

function draftBox(text: string, by: string): HTMLElement {
  return h("blockquote", { class: "td-msg" }, h("span", {}, `${by} · copied, never sent`), text);
}

function upNext(i: Issue, ctx: TodayCtx): HTMLElement | "" {
  const at = ctx.order.indexOf(i);
  const n = ctx.order.slice(at + 1).find((x) => !ctx.off.includes(x) && (ctx.moment !== "wrapup" || !outcome(x, ctx.b, wrapAdvice(ctx.b, x))));
  if (!n) return "";
  return h("button", { class: "td-upn", onclick: () => selectToday(n.id) },
    "Up next · ", h("span", { class: "ident" }, n.identifier), " · ", h("span", { class: "tt" }, n.title),
    ctx.moment === "wrapup" ? h("span", { class: "sg" }, ` · ${stepLabel(n, ctx.b)}`) : "", h("kbd", {}, "j"));
}

/** Through the day: what to do now, whether it fits before the next meeting, the keys. */
function focusStage(i: Issue, ctx: TodayCtx): Child[] {
  const { b } = ctx;
  const pick = planPick(b, i);
  const t = state.today.find((x) => x.issue_id === i.id);
  const fit = pick?.minutes ? fitFor(pick.minutes, b.agenda) : null;
  const waiting = isWaiting(i, b);
  const len = blockLength(pick?.minutes ?? null);
  const start = (fit ?? fitFor(len, b.agenda))?.start ?? nextHalfHour();   // the first free stretch long enough
  const block = t?.event_start && t.event_minutes ? blockControls(t)
    : actButton(`Block ${fmtMinutes(len)} at ${hm12(start)}`, "b", (btn) => void blockFirst(i, btn, len, start));
  return [
    stageTop(i, pick ? "Claude's pick" : ""),
    titleField(i, "h2"),
    pick?.why ? h("p", { class: "td-why" }, pick.why) : "",
    waiting ? draftBox(nudgeText(i), "A nudge to send") : "",
    fit ? h("div", { class: `td-fit n${fit.over ? " over" : ""}` }, fit.text,
      h("span", { class: "bar", role: "img", "aria-label": `${pick!.minutes} of the free minutes` }, h("i", { style: `width: ${fit.pct}%` }))) : "",
    h("div", { class: "td-acts" },
      waiting ? actButton("Copy nudge", "n", () => void copyDraft(i, nudgeText(i), false), true) : "",
      actButton("Mark done", "⌘↵", () => void markDone(i, ctx), !waiting),
      block,
      actButton(`Move to ${dayShort(b.next_day)}`, "m", () => void moveToTomorrow(i, false))),
    ...stageBody(i, true),
    upNext(i, ctx),
  ];
}

function stepLabel(i: Issue, b: Brief): string {
  const a = wrapAdvice(b, i);
  return !a || a.action === "carry" ? `Move to ${dayShort(b.next_day)}` : a.action === "close" ? "Close?"
    : a.action === "ask" ? "Copy message" : `Set due ${dueWord(b, a.move_to!)}`;
}

/** Wrap-up: Claude's next step is the main button; moving it to tomorrow and done stay a key away. */
function wrapStage(i: Issue, ctx: TodayCtx): Child[] {
  const { b } = ctx;
  const a = wrapAdvice(b, i);
  const step = a?.action ?? "carry";
  const decided = outcome(i, b, a);
  const buttons: Record<string, (primary: boolean) => HTMLElement> = {
    close: (p) => actButton("Mark done", "⌘↵", () => void markDone(i, ctx), p),
    carry: (p) => actButton(`Move to ${dayShort(b.next_day)}`, "m", () => void moveToTomorrow(i, true), p),
    move: (p) => actButton(`Set due ${shortDay(a!.move_to!)}`, "d", () => void setClaudeDate(i, a!.move_to!), p),
    ask: (p) => actButton("Copy message", "n", () => void copyDraft(i, a!.message ?? "", true), p),
  };
  return [
    stageTop(i, ""),
    isOpen(i) ? titleField(i, "h2") : h("h2", {}, i.title),
    a?.why ? h("p", { class: "td-why" }, a.why) : "",
    a?.action === "ask" && a.message && !decided ? draftBox(a.message, "Drafted by Claude") : "",
    decided ? h("p", { class: "td-okline" }, checkIcon(), decided)
      : h("div", { class: "td-acts" }, ...[step, ...["carry", "close"].filter((x) => x !== step)].map((x, n) => buttons[x](n === 0))),
    ...(isOpen(i) ? stageBody(i, true) : []),
    upNext(i, ctx),
  ];
}

/** Not on Today: a pick you didn't take (Add to Today), or a late issue with Claude's next step. */
function offStage(i: Issue, ctx: TodayCtx): Child[] {
  const { b } = ctx;
  const a = planAside(b, i);
  const pick = planPick(b, i);
  const decided = outcome(i, b, a);
  const step = !a || decided ? ""
    : a.action === "move" ? actButton(`Set due ${shortDay(a.move_to!)}`, "d", () => void setClaudeDate(i, a.move_to!), true)
    : a.action === "clear_date" ? actButton("Clear the date", "d", () => void setClaudeDate(i, null), true)
    : actButton("Copy message", "n", () => void copyDraft(i, a.message ?? "", true), true);
  const fit = pick?.minutes ? fitFor(pick.minutes, b.agenda) : null;
  return [
    stageTop(i, a ? h("span", { class: "late" }, "not on Today") : "Claude's pick, not on Today"),
    titleField(i, "h2"),
    (a ?? pick)?.why ? h("p", { class: "td-why" }, (a ?? pick)!.why) : "",
    a?.action === "ask" && a.message && !decided ? draftBox(a.message, "Drafted by Claude") : "",
    fit ? h("div", { class: `td-fit n${fit.over ? " over" : ""}` }, fit.text) : "",
    decided ? h("p", { class: "td-okline" }, checkIcon(), decided) : "",
    h("div", { class: "td-acts" }, step, actButton("Add to Today", "a", () => void addToToday(i), !step)),
    ...stageBody(i, false),
  ];
}

function todayStage(ctx: TodayCtx): HTMLElement {
  const i = ctx.sel;
  if (!i) {
    const decided = ctx.list.length;
    return h("article", { class: "td-st" }, h("div", { class: "td-clear" },
      ...(ctx.moment === "wrapup"
        ? [h("h2", {}, `All ${decided} decided.`), h("p", {}, `${weekday(ctx.b.next_day)}'s list is ready.`),
            ctx.b.checkin ? h("div", { class: "td-acts" }, h("button", { class: "td-btn", onclick: () => showCheckin(ctx.b.checkin!) }, "Weekly check-in")) : ""]
        : [h("h2", {}, "Nothing left on Today."), h("p", {}, `${ctx.b.completed_today.length} done. The wrap-up comes in with the 4 PM sweep.`)])));
  }
  const body = ctx.off.includes(i) ? offStage(i, ctx) : ctx.moment === "wrapup" ? wrapStage(i, ctx) : focusStage(i, ctx);
  return h("article", { class: "td-st", "aria-label": i.identifier }, ...body);
}

// ---- actions ---------------------------------------------------------------------------------------
function selectToday(id: string) {
  state.todaySel = id;
  render();
  document.querySelector(`.td-row[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
}

function stepTodaySel(delta: number) {
  if (!state.brief) return;
  const { order, sel } = todayCtx(state.brief);
  if (!order.length) return;
  const at = sel ? order.indexOf(sel) : -1;
  selectToday(order[Math.max(0, Math.min(order.length - 1, at < 0 ? 0 : at + delta))].id);
}

/** After an item leaves the list or is decided: the next one still to do. */
function selectAfter(i: Issue, ctx: TodayCtx) {
  const at = ctx.order.indexOf(i);
  const rest = [...ctx.order.slice(at + 1), ...ctx.order.slice(0, Math.max(at, 0)).reverse()]
    .filter((x) => !ctx.off.includes(x) && (ctx.moment !== "wrapup" || !outcome(x, ctx.b, wrapAdvice(ctx.b, x))));
  state.todaySel = rest[0]?.id ?? null;
}

async function markDone(i: Issue, ctx: TodayCtx) {
  selectAfter(i, ctx);
  await completeIssue(i);
  const b = state.brief;
  if (b && !state.issues.some((x) => x.id === i.id) && !b.completed_today.some((x) => x.id === i.id)) {
    const closed = doneStatus();
    b.completed_today = [{ ...i, state: { id: closed?.id ?? i.state.id, name: closed?.name ?? "Done", type: "completed" } }, ...b.completed_today];
    render();
  }
}

/** On tomorrow's Today list; through the day it also comes off today's. ⌘Z puts it back. */
async function moveToTomorrow(i: Issue, keepOnToday: boolean) {
  const b = state.brief;
  if (!b) return;
  const before = state.today.map((t) => t.issue_id);
  const had = b.next_today.includes(i.id);
  selectAfter(i, todayCtx(b));
  try {
    b.next_today = (await api.carryOver([i.id])).items.map((t) => t.issue_id);
    if (!keepOnToday) state.today = (await api.setToday(before.filter((x) => x !== i.id))).items;
    offerUndo(`${i.identifier} moved to ${weekday(b.next_day)}'s Today list`, `${i.identifier} is back`, async () => {
      if (!had) b.next_today = (await api.uncarry([i.id])).items.map((t) => t.issue_id);
      if (!keepOnToday) state.today = (await api.setToday(before)).items;
      state.todaySel = i.id;
    });
  } catch (e) {
    fail(e);
  }
  render();
}

async function setClaudeDate(i: Issue, due: string | null) {
  if (state.brief) selectAfter(i, todayCtx(state.brief));
  await editIssue(i, { due_date: due });
}

async function copyDraft(i: Issue, text: string, decides: boolean) {
  if (!(await copyText(text))) { toast("Couldn't copy the message", undefined, true); return; }
  if (decides && state.brief) {
    state.copied.add(i.id);
    selectAfter(i, todayCtx(state.brief));
  }
  toast(decides ? "Message copied. Paste it where you talk to them." : "Nudge copied. Paste it where you talk to them.");
  render();
}

async function addToToday(i: Issue) {
  const before = state.today.map((t) => t.issue_id);
  try {
    state.today = (await api.setToday([...before, i.id])).items;
    state.todaySel = i.id;
    offerUndo(`${i.identifier} added to Today`, `${i.identifier} is off Today again`, async () => {
      state.today = (await api.setToday(before)).items;
    });
  } catch (e) {
    fail(e);
  }
  render();
}

/** Today's keys: j / k (↑ ↓) select, ⌘↵ done, m move to tomorrow, b block time, n copy the nudge or
 *  message, d Claude's date, a add to Today, o open in Linear; on the cover, x checks and ↵ starts. */
function todayKey(e: KeyboardEvent): boolean {
  const b = state.brief;
  if (!b || !state.issuesLoaded) return false;
  if (todayMoment(b) === "cover") {
    const pk = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>(".pk");
    const free = !document.activeElement || document.activeElement === document.body;
    if (e.key === "Enter" && !e.metaKey && (pk || free)) { e.preventDefault(); void startDay(b); return true; }
    if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); moveCoverFocus(1); return true; }
    if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); moveCoverFocus(-1); return true; }
    if (e.key === "x" && pk?.dataset.id) { toggleCover(pk.dataset.id); return true; }
    return false;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    const ctx = todayCtx(b);
    if (ctx.sel && isOpen(ctx.sel) && !ctx.off.includes(ctx.sel)) { e.preventDefault(); void markDone(ctx.sel, ctx); return true; }
    return false;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); stepTodaySel(1); return true; }
  if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); stepTodaySel(-1); return true; }
  if (!["m", "b", "n", "d", "a", "o"].includes(e.key)) return false;
  const button = [...document.querySelectorAll<HTMLButtonElement>(".td-st .td-btn, .td-st .td-open")]
    .find((el) => el.querySelector("kbd")?.textContent === e.key);
  if (!button || button.disabled) return false;
  e.preventDefault();
  button.click();
  return true;
}

function todayView(): HTMLElement {
  ensureBrief();
  const b = state.brief;
  const day = b?.day ?? localToday();
  const head = pageHead("Today", { sub: new Date(day + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }) });
  if (!b || !state.issuesLoaded) return h("div", { class: "td" }, head, h("p", { class: "muted" }, "Loading from Linear…"));
  const ctx = todayCtx(b);
  if (ctx.moment === "cover") {
    return h("div", { class: "td" }, head, coverView(b, false));
  }
  const rising = !!state.planRiseAt && Date.now() - state.planRiseAt < RISE_MS;
  const sun = sunState();
  const sky = ctx.moment === "wrapup" ? duskView(ctx)
    : rising ? coverView(b, true)
    : h("section", { class: `td-sky band${sun.night ? " night" : ""}`, style: sun.vars, "aria-label": "Now and next" },
        ...skyLayers(), bandText(b, sun.x < 50));
  const go = (i: Issue) => {
    if (ctx.off.includes(i)) state.todayOffOpen = true;
    if (ctx.list.includes(i) || ctx.off.includes(i)) selectToday(i.id); else void openUrl(i.url);
  };
  const note = b.note ?? (b.plan ? { made_at: b.plan.made_at, headline: b.plan.headline, summary: b.plan.summary } : null);
  const noteBlock = ctx.moment === "wrapup" ? "" : h("section", { class: "td-note", "aria-label": "Claude's note" },
    h("p", {}, h("span", { class: "lead" }, ...claudeText(note?.headline || dayHeadline(b), go), " "), ...(note?.summary ? claudeText(note.summary, go) : [])),
    b.note ? claudeBy(b.note.made_at, b.note_run, "Redo", (btn) => void renote(btn))
      : claudeBy(b.plan?.made_at ?? null, b.plan_run, b.plan ? "Re-plan" : "Ask Claude to plan", (btn) => void replan(btn)));
  const empty = !ctx.list.length && !ctx.off.length && !b.completed_today.length;
  return h("div", { class: "td" }, head, sky, noteBlock,
    empty
      ? h("div", { class: "td-empty" }, h("div", { class: "td-clear" },
          ...(ctx.moment === "wrapup"
            ? [h("h2", {}, "Nothing to wrap up."), h("p", {}, b.next_agenda?.length ? `${weekday(b.next_day)} starts with ${hm12(b.next_agenda[0].start)} ${b.next_agenda[0].title}.` : `${weekday(b.next_day)} starts clear.`)]
            : [h("h2", {}, "Nothing on Today."), h("p", {}, "Star an issue in Client or Dev to put it here, or press ", h("kbd", {}, "c"), " to capture one."),
                h("div", { class: "td-acts" }, h("button", { class: "td-btn", onclick: () => goTab("client") }, "Open Client"),
                  h("button", { class: "td-btn", onclick: () => goTab("dev") }, "Open Dev"))])))
      : h("div", { class: "td-cols" }, todayQueue(ctx), todayStage(ctx)));
}

/** The reading pane for one issue (Today, Client and Dev): its ID, client or project and slips,
 *  the title, one row with status, priority, due date, client and project, then Block time (on
 *  Today) or Add to Today, and ⋯; below, the description, sub-issues and comments. */
function issuePane(i: Issue): HTMLElement {
  const t = state.today.find((x) => x.issue_id === i.id);
  loadDetail(i.id);
  const more = h("details", { class: "drop-menu pane-menu" },
    h("summary", { class: "ghost-btn small-btn icon-more", title: "More", "aria-label": "More actions" }, "⋯"),
    h("div", { class: "menu" },
      link("Open in Linear ↗", i.url, "menu-link"),
      state.meta?.periscope ? periscopeItem(i) : "",
      t ? h("button", { type: "button", onclick: () => void toggleToday(i.id) }, "Remove from Today") : "",
      h("button", { type: "button", class: "menu-danger", onclick: (e: Event) => {
        (e.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
        confirmDelete(i);
      } }, "Delete…")));
  return h("section", { class: "tl-pane", "aria-label": i.identifier },
    h("span", { class: "tl-meta" }, link(`${i.identifier} ↗`, i.url, "ident"), [i.client ?? i.project].filter(Boolean).map((x) => ` · ${x}`).join(""),
      state.slips?.slips[i.id] ? " · " : "", slipTag(state.slips?.slips[i.id])),
    titleField(i, "h3"),
    // One row: status, priority, due date, client, project, then Block time (or Add to Today) and ⋯.
    h("div", { class: "tl-fields" }, ...issueFields(i),
      h("span", { class: "tl-actions" },
        t ? blockControls(t) : h("button", { class: "ghost small-btn", title: "Star it for Today (then you can block time for it)",
          onclick: () => void toggleToday(i.id) }, "☆ Add to Today"),
        more, periscopePopover(i))),
    detailBody(i.id),
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
  const order: Issue[] = [];
  const withChildren = (i: Issue): HTMLElement[] => {
    const kids = (children.get(i.id) ?? []).sort(sortIssues);
    order.push(i, ...kids);
    return [listItem(kind, i, field), ...kids.map((c) => listItem(kind, c, field, true))];
  };
  const sections = names.map((name) => {
    const list = groups.get(name)!.sort(sortIssues);
    const all = list.flatMap((i) => [i, ...(children.get(i.id) ?? [])]);
    const lead = groupMark(name === "No project" ? null : { kind: kind === "client" ? "client" : "project", name });
    return h("section", { class: "ll-group" },
      groupHead(name, lead, all,
        kind === "client" && name !== "No project"
          ? h("button", { class: "link-btn group-action", onclick: () => void showSummary(name) }, "Weekly summary") : ""),
      ...list.flatMap(withChildren),
    );
  });
  return listWithPane(kind, sections, order);
}

// ---- one project, from the sidebar ----------------------------------------------------------------
function projectHead(name: string, filter: HTMLElement): HTMLElement {
  const issues = state.issues.filter((i) => i.project === name && isOpen(i));
  const client = issues.filter((i) => i.list === "client").length;
  return pageHead(name, {
    sub: state.issuesLoaded ? `${issues.length} open${client ? ` · ${client} client, ${issues.length - client} dev` : ""}` : "",
    right: filter });
}

/** Every issue in one project, Client and Dev together, grouped by status like the By status
 *  view; each row names its client. */
function projectView(name: string): HTMLElement {
  return statusView("dev", (i) => i.project === name);
}

// ---- by status ------------------------------------------------------------------------------
/** In progress first, then the not-started statuses in Linear's order, then backlog. */
const STATUS_RANK: Record<string, number> = { started: 0, unstarted: 1, backlog: 2 };

/** Client or Dev issues as one table per open Linear status, in the same rows as the grouped
 *  view. Change a row's status with its status menu and it moves to that group. */
function statusView(kind: "client" | "dev", only?: (i: Issue) => boolean): HTMLElement {
  if (!state.issuesLoaded) return h("div", { class: "empty" }, h("p", { class: "muted" }, "Loading from Linear…"));
  const items = state.issues.filter((i) => (only ? only(i) : i.list === kind) && matches(i));
  if (!items.length) return h("div", { class: "empty" }, h("p", {}, state.filter ? "No issues match the filter." : "No open issues."));
  const states = (state.meta?.states ?? []).filter((s) => s.type in STATUS_RANK);
  // Statuses the issues use but the team list doesn't have (stale meta) still get a group.
  for (const i of items) if (!states.some((s) => s.id === i.state.id)) states.push(i.state);
  const order = states.map((s, n) => ({ s, n }))
    .sort((a, b) => (STATUS_RANK[a.s.type] ?? 3) - (STATUS_RANK[b.s.type] ?? 3) || a.n - b.n)
    .map((x) => x.s);
  const backlog = items.filter((i) => i.state.type === "backlog");
  // The row shows the other field: the client on Client, the project on Dev, the client in a project.
  const other = kind === "client" && !only ? "project" : "client";
  const groups = order
    .filter((s) => s.type !== "backlog" || state.showBacklog)
    .map((s) => ({ s, list: items.filter((i) => i.state.id === s.id).sort(sortIssues) }))
    .filter((g) => g.list.length);
  const field = other === "project" ? "client" : "project";      // listItem shows the other one
  const shown = groups.flatMap((g) => g.list);
  return listWithPane(kind, [
    ...groups.map(({ s, list }) => h("section", { class: `ll-group st-group st-${s.type}` },
      groupHead(s.name, h("span", { class: `sdot ll-dot ${statusClass(s)}` }), list),
      ...list.map((i) => listItem(kind, i, field)),
    )),
    backlog.length > 0 ? h("button", {
      class: "ghost small-btn backlog-toggle", "aria-pressed": String(state.showBacklog),
      onclick: () => { state.showBacklog = !state.showBacklog; render(); },
    }, state.showBacklog ? "Hide backlog" : `Show backlog (${backlog.length})`) : "",
  ], shown);
}

function setLayout(kind: "client" | "dev", layout: "group" | "status") {
  state.listLayout[kind] = layout;
  savePref(kind === "client" ? "todohub.clientView" : "todohub.devView", layout);
  render();
}

/** Client / Dev header: the title with its open count, then By client (or project) · By status
 *  as tabs (v switches), with the filter on the tab line. */
function listHead(kind: "client" | "dev", filter: HTMLElement): HTMLElement {
  const current = state.listLayout[kind];
  const by = kind === "client" ? "client" : "project";
  const open = state.issues.filter((i) => i.list === kind && isOpen(i)).length;
  const tab = (id: "group" | "status", label: string) => ({ id, label, on: current === id, select: () => setLayout(kind, id) });
  return pageHead(kind === "client" ? "Client" : "Dev", {
    sub: state.issuesLoaded ? `${open} open` : "", label: "Group by",
    tabs: [tab("group", `By ${by}`), tab("status", "By status")], right: filter });
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
  pulls: ["M3.7 4.8a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M3.7 15.2a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0",
          "M12.7 15.2a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M5.5 6.6v6.8M14.5 13.4V8.3a2 2 0 0 0-2-2H9.2M10.8 4.6 9.1 6.3l1.7 1.7"],
  insights: ["M4.5 16.5v-5M8.5 16.5v-9M12.5 16.5v-6.5M16.5 16.5v-11"],
  settings: ["M15.33 7.99L17.42 8.34L17.42 11.66L15.33 12.01L15.19 12.35L16.42 14.07L14.07 16.42L12.35 15.19L12.01 15.33L11.66 17.42L8.34 17.42L7.99 15.33L7.65 15.19L5.93 16.42L3.58 14.07L4.81 12.35L4.67 12.01L2.58 11.66L2.58 8.34L4.67 7.99L4.81 7.65L3.58 5.93L5.93 3.58L7.65 4.81L7.99 4.67L8.34 2.58L11.66 2.58L12.01 4.67L12.35 4.81L14.07 3.58L16.42 5.93L15.19 7.65z",
             "M10 7.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z"],
};

function navIcon(tab: Tab): SVGElement {
  return svg("svg", { viewBox: "0 0 20 20", width: 18, height: 18, fill: "none", stroke: "currentColor",
    "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
    ...NAV_ICON[tab].map((d) => svg("path", { d })));
}

/** ``highlight``: issue identifiers to point out and scroll to (the digest's "Show ENG-123"). */
function goTab(id: Tab, highlight: string[] = []) {
  // Leaving a client the sidebar picked drops that filter, so the next tab starts unfiltered.
  if (state.pickedClient && state.filter === state.pickedClient) state.filter = "";
  if (state.pickedProject) state.filter = "";
  state.pickedClient = null;
  state.pickedProject = null;
  forgetPeriscope();
  state.tab = id;
  state.highlight = new Set(highlight);
  if (highlight.length) {
    state.filter = "";        // a filter could hide them
    if (state.issues.some((i) => state.highlight.has(i.identifier) && i.state.type === "backlog")) state.showBacklog = true;
  }
  if ((id === "client" || id === "dev") && highlight.length) {
    const first = state.issues.find((i) => i.list === id && state.highlight.has(i.identifier));
    if (first) state.listSel[id] = first.id;
  }
  render();
  if (highlight.length) requestAnimationFrame(() =>
    document.querySelector(".ll-item.hl, .row.hl")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  if (id !== "inbox" && !state.issuesLoaded) void refresh(true);
}

function pickClient(name: string) {
  forgetPeriscope();
  state.tab = "client";
  state.filter = name;
  state.pickedClient = name;
  state.pickedProject = null;
  render();
  if (!state.issuesLoaded) void refresh(true);
}

/** One project from the sidebar: every open issue in it, Client and Dev together (a client issue
 *  can belong to a project too), grouped by status. The filter then searches within it. */
function pickProject(name: string) {
  forgetPeriscope();
  state.tab = "dev";
  state.filter = "";
  state.pickedClient = name;
  state.pickedProject = name;
  render();
  if (!state.issuesLoaded) void refresh(true);
}

/** Projects of your open issues, Client and Dev, the ones that need you first: overdue, then the
 *  most open. Issues without a project aren't listed (they're under "No project" in Dev). */
function sidebarProjects(): { name: string; open: number; late: number }[] {
  const today = localToday();
  const by = new Map<string, { open: number; late: number }>();
  for (const i of state.issues) {
    if (!i.project || !isOpen(i)) continue;
    const p = by.get(i.project) ?? { open: 0, late: 0 };
    p.open += 1;
    if (i.due_date && i.due_date < today) p.late += 1;
    by.set(i.project, p);
  }
  return [...by.entries()].map(([name, p]) => ({ name, ...p }))
    .sort((a, b) => (b.late - a.late) || (b.open - a.open) || a.name.localeCompare(b.name));
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

/** Bottom of the sidebar: one line for the sources (a green dot and "next 12pm", a red dot and
 *  "1 error", or "Sweeping…"), then theme and help. The line opens a popover with each source, when it last
 *  worked, ↻ to check just that one, Run all and the sweep history. */
function sweepStatus(): HTMLElement {
  const r = state.run;
  const running = r.status === "running";
  const overview: SourceOverview[] = r.source_overview?.length ? r.source_overview
    : (r.sources ?? []).map((s) => ({ source: s.source, ok: s.ok, detail: s.detail, at: r.started_at ?? null,
        last_ok_at: s.ok ? r.started_at ?? null : null }));
  const errors = overview.filter((o) => o.ok === false).length;
  const next = nextSweep();
  const nextTip = nextSweepAt() ? `Next scheduled sweep: ${nextSweepAt()!.toLocaleString([],
    { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";

  const row = (o: SourceOverview) => {
    const name = SOURCE_NAME[o.source];
    const busy = running && (!r.scope || r.scope === o.source);
    const failed = o.ok === false;
    const timeText = busy ? "checking…" : failed ? (o.detail ? "" : "failed") : o.last_ok_at ? shortWhen(o.last_ok_at) : "not yet";
    const tip = failed
      ? `${name}: ${o.detail ?? "problem"} (${shortWhen(o.at)}).${o.last_ok_at ? ` Last worked ${shortWhen(o.last_ok_at)}; the next check catches up from there.` : ""}`
      : o.last_ok_at ? `${name}: last checked ${shortWhen(o.last_ok_at)}.` : `${name}: not checked yet.`;
    return h("div", { class: `src-row${failed ? " bad" : ""}${busy ? " busy" : ""}`, title: tip },
      h("span", { class: `src-dot${o.ok === null ? " none" : ""}` }),
      h("span", { class: "src-name" }, name,
        failed && o.detail ? h("span", { class: "src-why" }, o.detail) : ""),
      h("span", { class: "src-time" }, timeText),
      busy ? h("span", { class: "src-act" }, h("span", { class: "spinner" }))
        : h("button", {
            class: "src-act", disabled: running, "aria-label": `Check ${name} now`,
            title: `Check ${name} now${o.last_ok_at ? `: reads what's new since ${shortWhen(o.last_ok_at)}` : ""}${o.source === "github" ? " (no Claude run)" : ""}`,
            onclick: () => void runNow(o.source),
          }, "↻"));
  };

  const scopeName = r.scope ? SOURCE_NAME[r.scope as Source] ?? r.scope : "";
  const line = running
    ? [h("span", { class: "spinner" }), h("span", { class: "src-line-text" }, scopeName ? `Checking ${scopeName}…` : "Sweeping…")]
    : !overview.length
      ? [h("span", { class: "src-dot none" }), h("span", { class: "src-line-text" }, "No sweeps yet")]
      : [h("span", { class: `src-dot${errors ? " bad" : ""}` }),
         h("span", { class: "src-line-text" },
           errors ? h("span", { class: "src-err" }, plural(errors, "error")) : next ? `next ${next}` : "All OK")];
  const label = running ? "Sweep running" : errors ? `${plural(errors, "source")} with an error` : "All sources OK";
  const menu = h("details", { class: "drop-menu src-menu", open: state.sourcesOpen,
    ontoggle: (e: Event) => { state.sourcesOpen = (e.currentTarget as HTMLDetailsElement).open; } },
    h("summary", { class: "src-line", title: `${label}. Click for each source (r)`, "aria-label": `${label}: show sources` }, ...line),
    h("div", { class: "menu src-pop", role: "dialog", "aria-label": "Sources" },
      h("div", { class: "src-pop-head" }, h("b", {}, "Sources"),
        h("span", { class: "muted small", title: nextTip },
          [r.started_at ? `last sweep ${shortWhen(r.started_at)}` : "", next ? `next ${next}` : ""].filter(Boolean).join(" · "))),
      overview.length ? h("div", { class: "src-list" }, ...overview.map(row))
        : h("p", { class: "muted small" }, "No sweeps yet."),
      h("div", { class: "src-pop-foot" },
        h("button", { class: "primary small-btn", disabled: running, title: "Sweep every source now", onclick: () => void runNow() },
          running && !r.scope ? "Sweeping…" : "Run all"),
        h("button", { class: "link-btn", onclick: () => {
          state.sourcesOpen = false;
          renderHeader();
          void showSweepHistory();
        } }, "Sweep history →"))));
  return h("div", { class: "sweep" },
    h("div", { class: "sweep-actions" },
      menu,
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
    pulls: pullsCount() ?? 0,
    insights: 0,
    settings: 0,
    client: state.issues.filter((i) => i.list === "client").length,
    dev: state.issues.filter((i) => i.list === "dev").length,
  };
  const item = (id: Tab, label: string, key: number) => {
    const showCount = id === "pulls" ? pullsCount() !== null
      : id !== "insights" && id !== "settings" && (id === "inbox" || id === "today" || state.issuesLoaded);
    const on = state.tab === id && !((id === "client" || id === "dev") && state.pickedClient);
    return h("button", {
      class: `nav${on ? " active" : ""}`, title: `${label} (⌘${key})`, "aria-current": on ? "page" : undefined,
      onclick: () => goTab(id),
    }, navIcon(id), h("span", { class: "nav-label" }, label),
      showCount && h("span", { class: `count${id === "inbox" && counts.inbox > 0 ? " hot" : ""}` }, String(counts[id])));
  };
  const clients = state.issuesLoaded ? sidebarClients() : [];
  const shown = state.allClients ? clients : clients.slice(0, SIDEBAR_CLIENTS);
  const projects = state.issuesLoaded ? sidebarProjects() : [];
  const shownProjects = state.allProjects ? projects : projects.slice(0, SIDEBAR_CLIENTS);
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
      item("pulls", "Pull requests", 5), item("insights", "Insights", 6), h("div", { class: "nav-gap" }), item("settings", "Settings", 7)),
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
    projects.length > 0 ? h("div", { class: "side-group" }, "Projects") : "",
    projects.length > 0 ? h("div", { class: "side-clients" },
      ...shownProjects.map((p) => h("button", {
        class: `client-link${state.tab === "dev" && state.pickedClient === p.name ? " active" : ""}`,
        title: `${p.name}: ${p.open} open${p.late ? `, ${p.late} overdue` : ""}`,
        onclick: () => pickProject(p.name),
      }, h("span", { class: "proj-mark", "aria-hidden": "true" }, p.name.slice(0, 1).toUpperCase()),
        h("span", { class: "client-name" }, p.name),
        p.late ? h("span", { class: "client-hint late" }, `${p.late} late`)
          : h("span", { class: "client-hint" }, String(p.open)))),
      projects.length > SIDEBAR_CLIENTS && h("button", {
        class: "client-link more", onclick: () => { state.allProjects = !state.allProjects; renderHeader(); },
      }, state.allProjects ? "Show fewer" : `+ ${projects.length - SIDEBAR_CLIENTS} more`)) : "",
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

setupPane({ render, editIssue, offerUndo, canUndo, toast, fail, loadIssues, afterPointer, doneStatus, todoStatus, state });
setupPeriscope({ render, toast: (m, a) => void toast(m, a, false, 9000), fail });   // 9 s for Show, like Undo
setupPulls({
  rerender: () => { if (state.tab === "pulls" && !editing()) render(); else renderHeader(); },
  toast: (m) => void toast(m),
  issues: () => state.issues,
});

const settingsCtx: SettingsCtx = {
  rerender: () => { if (state.tab === "settings") { const y = window.scrollY; render(); window.scrollTo(0, y); } },
  themeChanged: () => renderHeader(),
  runNow: (source) => void runNow(source).then(() => settingsCtx.rerender()),
  running: () => state.run.status === "running",
  toast: (m) => void toast(m),
  fail,
  when: (iso) => shortWhen(iso),
};

function render() {
  if (state.tab === "client" || state.tab === "dev" || state.tab === "today") ensureSlips();
  ensureLogos([...state.candidates.map((c) => c.client_label), ...state.issues.map((i) => i.client)]);
  renderHeader();
  const main = document.querySelector("main")!;
  main.classList.toggle("wide", state.tab !== "insights" && state.tab !== "settings");
  main.classList.toggle("fit", state.tab === "today");      // Today fits the window; its panes scroll
  const problems = (state.run.source_overview?.length ? state.run.source_overview : state.run.sources ?? [])
    .filter((s) => s.ok === false);
  const filter = h("input", {
    class: "filter", type: "search", placeholder: "Filter", value: state.filter, "aria-label": "Filter",
    oninput: (e: Event) => {
      state.filter = (e.target as HTMLInputElement).value;
      if (state.pickedClient && !state.pickedProject) { state.pickedClient = null; renderHeader(); }
      const f = focusedCandidate();
      if (f && !matches(f)) state.focus = null;
      const content = document.querySelector(".content");
      content?.replaceChildren(view());
    },
  });
  // Inbox, Client and Dev headers (Today and Insights build their own with the same pageHead).
  const head = state.tab === "inbox"
    ? pageHead("Inbox", { sub: state.candidates.length ? `${state.candidates.length} to review` : "", right: filter })
    : state.tab === "dev" && state.pickedProject ? projectHead(state.pickedProject, filter)
    : state.tab === "client" || state.tab === "dev" ? listHead(state.tab, filter) : "";
  const byStatus = (state.tab === "client" || state.tab === "dev") && state.listLayout[state.tab] === "status";
  const view = () =>
    state.tab === "inbox" ? inboxView()
      : state.tab === "today" ? todayView()
      : state.tab === "settings" ? settingsView(settingsCtx)
      : state.tab === "pulls" ? pullsView()
      : state.tab === "insights" ? insightsView(() => { if (state.tab === "insights") render(); }, (t, ids) => goTab(t, ids))
      : state.tab === "dev" && state.pickedProject ? projectView(state.pickedProject)
      : byStatus ? statusView(state.tab as "client" | "dev")
      : listView(state.tab as "client" | "dev");
  rebuildKeepingPane(() => {
    main.replaceChildren(
      head,
      state.error ? h("div", { class: "banner error" }, state.error) : "",
      state.tab === "inbox" && state.run.status !== "running" && problems.length
        ? h("div", { class: "banner warn" },
            ...problems.map((p) => h("div", {}, `${SOURCE_NAME[p.source]}: ${p.detail ?? "problem during the last sweep"}`)))
        : "",
      state.tab === "inbox" ? captureBar : "",
      h("div", { class: "content" }, view()),
    );
  });
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
  ["j / k", "Next / previous task or pull request"],
  ["a or ⌘↩", "Approve (or close / post / track); on a linked card, do its pick"],
  ["d, then 1–5", "Drop, with a reason (on a linked card: pick Drop)"],
  ["s, then 1–3", "Snooze: tomorrow / next Monday / in a week"],
  ["m", "Linked card: select Merge; with Merge selected, merge"],
  ["x", "Select for bulk actions"],
  ["⌘Z", "Undo the last action (approve, drop, snooze, issue edit)"],
  ["⌘R", "Reload from Linear now (it also reloads every minute)"],
  ["⇧⌘R", "Reload: restart the backend and the window after a code change"],
  ["e", "Edit the title (an Inbox card, or the issue in Today, Client and Dev)"],
  ["⇧E · ⇧S · ⇧C", "Today, Client, Dev: edit the description · add a sub-issue · comment (⌘↵ posts)"],
  ["p", "Today, Client, Dev: start the issue in periscope (a worktree, Claude and a prompt)"],
  ["c", "Capture a task"],
  ["/", "Filter"],
  ["⌘1 – ⌘7", "Inbox, Today, Client, Dev, Pull requests, Insights, Settings (also ⌘,)"],
  ["⌥⌘T", "Capture from anywhere (when TodoHub is running)"],
  ["⌘+ · ⌘− · ⌘0", "Zoom in · zoom out · back to 100%"],
  ["⌘↵ · m · b", "Today: mark done · move to tomorrow's list · block time"],
  ["n · d · a · o", "Today: copy the nudge or message · Claude's due date · add to Today · open in Linear"],
  ["x · ↵", "Today, in the morning: check a suggestion · start the day"],
  ["v", "Client / Dev: group by client or project ↔ by status"],
  ["1 – 5 · Space · o · l", "Pull requests: pick a view · open or close the row · open it in GitHub · open its Linear issue. ⌘R refreshes all"],
  ["g", "Pull requests (Mine): group by client or project"],
  ["t", "Theme: follow the Mac → light → dark → daylight (follows the time of day)"],
  ["r", "Sources: each one's status, ↻ to check one, Run all"],
  ["?", "This list"],
];
const TAB_ORDER: Tab[] = ["inbox", "today", "client", "dev", "pulls", "insights", "settings"];

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
  render();
  document.querySelector(`.ib-item[data-id="${state.focus}"]`)?.scrollIntoView({ block: "nearest" });
}

function focusedCard(): HTMLElement | null {
  return document.querySelector(`.card[data-id="${state.focus}"]`);
}

function showShortcuts() {
  modal("Keyboard shortcuts", h("table", { class: "stats" },
    h("tbody", {}, ...SHORTCUTS.filter(([k]) => k !== "p" || state.meta?.periscope).map(([k, v]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, v))))));
}

// Swapping what's under the pointer before it's released would lose the click.
let pointerIsDown = false;
document.addEventListener("pointerup", () => { pointerIsDown = false; }, true);
document.addEventListener("pointercancel", () => { pointerIsDown = false; }, true);
document.addEventListener("keydown", () => { pointerIsDown = false; }, true);
document.addEventListener("pointermove", (e) => { if (e.buttons === 0) pointerIsDown = false; }, true);

/** Run ``fn`` now, or once the pointer is released and its click has landed. */
function afterPointer(fn: () => void) {
  if (!pointerIsDown) fn();
  else document.addEventListener("pointerup", () => setTimeout(fn), { once: true });
}

// A click anywhere outside an open Snooze or Drop menu closes it (including opening the other one).
// Same for the balance popover.
document.addEventListener("pointerdown", (e) => {
  pointerIsDown = true;
  dismissPeriscope(e.target as Element);
  // (Removed in place, not re-rendered, so the click that closed it still lands on its target.)
  if (state.balanceOpen && !(e.target as Element).closest?.(".bal-anchor")) {
    state.balanceOpen = false;
    document.querySelector(".bal-pop")?.remove();
    document.querySelector(".bal-anchor > button")?.setAttribute("aria-expanded", "false");
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

/** Called by the app's Edit → Undo (⌘Z): in the box a post just emptied, undo the post; in another
 *  text field, undo typing; else the last action. */
(window as unknown as { todohubUndo: () => void }).todohubUndo = () => {
  const post = postToUndoIn(document.activeElement);
  if (post) { void undo(post); return; }
  if (isTextField(document.activeElement)) {
    document.execCommand("undo");
    return;
  }
  if (!document.querySelector(".overlay")) void undo();
};

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  if ((e.metaKey || e.ctrlKey) && e.key === ",") {          // the Mac's usual Settings shortcut
    e.preventDefault();
    goTab("settings");
    return;
  }
  if ((e.metaKey || e.ctrlKey) && /^[1-7]$/.test(e.key)) {
    e.preventDefault();
    goTab(TAB_ORDER[Number(e.key) - 1]);
    return;
  }
  // ⌘R reloads from Linear now: issues, labels, projects and statuses, and re-checks the Inbox.
  // (It reloads every minute and when the window comes back anyway; ⇧⌘R restarts the app.)
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r") {
    e.preventDefault();
    toast("Reloading from Linear…");
    void refresh(true, "force");
    return;
  }
  // ⌘Z undoes the last action, except in a text field, where it undoes typing as usual (or the post
  // that just emptied it). In the app, Edit → Undo owns ⌘Z and calls todohubUndo(); this is for a plain browser.
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z"
      && !inApp && !document.querySelector(".overlay")) {
    const post = postToUndoIn(target);
    if (post || !isTextField(target)) {
      e.preventDefault();
      void undo(post ?? undefined);
      return;
    }
  }
  // ⌘↩ presses the focused Inbox card's main button: from the page or a field in the card, but
  // not from its draft reply.
  if (state.tab === "inbox" && (e.metaKey || e.ctrlKey) && e.key === "Enter" && !document.querySelector(".overlay")
      && (!typing || target.closest(".ib-pane .card")) && !target.closest(".reply")) {
    e.preventDefault();
    const c = focusedCard() ? focusedCandidate() : undefined;
    if (c && !e.repeat) decide(c);           // holding ⌘↩ must not decide the next card too
    return;
  }
  if (e.key === "Escape" && state.balanceOpen) { state.balanceOpen = false; render(); return; }
  // The periscope popover takes the keys: Esc closes it, its own keydown handles ↵, and no key acts
  // on the issue behind it. The ⌘ keys above still work.
  if (isPeriscopeOpen()) {
    if (e.key === "Escape") closePeriscope();
    return;
  }
  if (typing) {
    if (e.key === "Escape") target.blur();
    return;
  }
  if (state.tab === "inbox" && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")
      && !document.querySelector(".overlay")) {
    e.preventDefault();
    moveFocus(e.key === "ArrowUp" ? -1 : 1);
    return;
  }
  if (state.tab === "today" && !document.querySelector(".overlay") && todayKey(e)) return;
  if (state.tab === "pulls" && !document.querySelector(".overlay") && pullsKey(e)) return;
  const issueList = (state.tab === "client" || state.tab === "dev") && !document.querySelector(".overlay");
  if (issueList && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    stepList(e.key === "ArrowUp" ? -1 : 1);
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".overlay")) return;
  if (e.key === "p" && state.balanceOpen) return;      // one popover at a time
  // preventDefault: the key must not also type into the field it just focused.
  if ((state.tab === "today" || issueList) && paneKey(e.key)) { e.preventDefault(); return; }

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
  // A linked card with Drop picked takes 1–5 as the reason.
  if (c && isLinked(c) && linkChoice(c).pick === "drop" && /^[1-5]$/.test(e.key)) {
    linkChoice(c).reason = DROP_REASONS[Number(e.key) - 1].value;
    render();
    return;
  }
  if (e.repeat && (e.key === "a" || e.key === "m")) return;     // holding the key must not decide the next card too
  switch (e.key) {
    case "?": showShortcuts(); break;
    case "t": nextTheme(); renderHeader(); break;
    case "r": state.sourcesOpen = !state.sourcesOpen; renderHeader(); break;
    case "v":
      if (state.tab === "client" || state.tab === "dev") {
        setLayout(state.tab, state.listLayout[state.tab] === "status" ? "group" : "status");
      }
      break;
    case "/": e.preventDefault(); document.querySelector<HTMLInputElement>(".filter")?.focus(); break;
    case "c": e.preventDefault(); goTab("inbox"); captureInput.focus(); break;
    case "j": if (state.tab === "inbox") moveFocus(1); else if (issueList) stepList(1); break;
    case "k": if (state.tab === "inbox") moveFocus(-1); else if (issueList) stepList(-1); break;
    case "a": if (c) decide(c); break;
    case "m":     // shows the Merge plan first; with Merge selected, merges
      if (c && isLinked(c)) {
        if (linkChoice(c).pick === "merge") void merge(c);
        else { linkChoice(c).pick = "merge"; render(); }
      }
      break;
    case "x": if (c) toggleSelect(c.id); break;
    case "e": if (c) { e.preventDefault(); focusedCard()?.querySelector<HTMLInputElement>(".title-input")?.focus(); } break;
    case "d":
      if (c && isLinked(c)) { linkChoice(c).pick = "drop"; render(); }
      else if (c) { closeMenus(); const m = focusedCard()?.querySelector<HTMLDetailsElement>("details.drop-menu:not(.snooze-menu)"); if (m) m.open = true; }
      break;
    case "s": if (c) { closeMenus(); const m = focusedCard()?.querySelector<HTMLDetailsElement>("details.snooze-menu"); if (m) m.open = true; } break;
    default: return;
  }
});

// ---- start ----------------------------------------------------------------------------------
async function start() {
  document.querySelector("#app")!.replaceChildren(h("aside", { class: "sidebar" }), h("main", {}), h("div", { class: "toasts", role: "status" }));
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
  void loadSettings().then(() => renderHeader());       // the sweep's schedule, for "next 12pm"
  api.daylight().then(({ location }) => {
    setDaylightLocation(location);
    if (currentTheme() === "daylight") { applyTheme(); renderHeader(); }
  }).catch(() => undefined);
  onDesktopEvent("capture", () => { forgetPeriscope(); state.tab = "inbox"; render(); captureInput.focus(); });
  onDesktopEvent("run-now", () => void runNow());
  await refresh(true);
  void loadPulls();                  // for the sidebar's count
  pollWhileRunning();
  setInterval(() => void refresh(state.tab !== "inbox").then(pollWhileRunning), 60_000);
  setInterval(briefReminders, 60_000);
  briefReminders();
  window.addEventListener("focus", () => void refresh(state.tab !== "inbox", "reload").then(pollWhileRunning));
}

void start();
