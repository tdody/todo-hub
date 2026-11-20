// Talks to the local Python backend. The Rust shell started it and knows its port and token.
import { invoke } from "@tauri-apps/api/core";

export type Source = "slack" | "gmail" | "grain" | "calendar" | "linear" | "github" | "hubspot" | "manual";
export type Signal =
  | "ask" | "commitment" | "action_item" | "deadline" | "manual" | "waiting_on" | "done" | "update"
  | "meeting_prep" | "review_request" | "mention";
export type Kind = "task" | "waiting" | "close" | "comment";

export type DropReason = "not_mine" | "already_done" | "noise" | "duplicate" | "other";

export interface MuteKey {
  kind: "sender" | "channel" | "repo";
  source: Source;
  value: string;
  label: string;
}

export interface MuteRule extends MuteKey {
  id: number;
  created_at: string;
  blocked: number;
  last_blocked_at: string | null;
}

export interface Link {
  url: string;
  title: string;
}

export interface Subtask {
  title: string;
  due_date: string | null;
}

/** A card approved or dropped recently (the Inbox's "Recently decided"). */
export interface DecidedItem {
  id: number;
  title: string;
  status: "approved" | "dropped";
  kind: Kind | null;
  drop_reason: DropReason | null;
  decided_at: string;
  source: Source;
  source_url: string | null;
  who: string | null;
  client_label: string | null;
  linear_identifier: string | null;
  linear_url: string | null;
  target_issue: string | null;
}

export interface Candidate {
  id: number;
  run_id?: number | null;      // the sweep or capture that proposed it
  source: Source;
  source_id: string;
  source_url: string | null;
  title: string;
  signal: Signal;
  why: string | null;
  excerpt: string | null;
  who: string | null;
  client_label: string | null;
  due_date: string | null;
  priority: number;
  possible_duplicate: string | null;
  /** For a possible duplicate: what to do about it, and why. */
  duplicate_advice: "drop" | "merge" | "new" | null;
  duplicate_reason: string | null;
  /** For a Slack or email ask: a reply he could send, drafted by the sweep. */
  reply_draft: string | null;
  sender: string | null;
  channel: string | null;
  /** A Linear issue that seems to have handled this already: closed, canceled, or opened by hand.
   *  Only "kept" (issues he said don't cover it) when nothing matches now. */
  handled: Handled | null;
  /** What this card could be muted by: its sender, Slack channel or GitHub repo. */
  mute_keys: MuteKey[];
  links: Link[];
  subtasks: Subtask[];
  status: "pending" | "approved" | "dropped";
  drop_reason: DropReason | null;
  kind: Kind;
  target_issue: string | null;
  comment: string | null;
  project: string | null;
  snooze_until: string | null;
  category: string | null;
  linear_identifier: string | null;
  linear_url: string | null;
  created_at: string;
}

export interface State {
  id: string;
  name: string;
  type: string;
}

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  due_date: string | null;
  updated_at: string;
  state: State;
  project: string | null;
  parent: { id: string; identifier: string; title: string } | null;
  client: string | null;
  list: "client" | "dev";
  category: string;
}

export interface Handled {
  identifier?: string;
  title?: string;
  url?: string | null;
  how?: "closed" | "canceled" | "opened";
  at?: string | null;
  why?: string;
  kept?: string[];
}

export interface IssuePreview extends Issue {
  assignee: string | null;
  created_at: string | null;
  description: string;
  description_truncated: boolean;
  comment_count: number;
  comments: { author: string; created_at: string | null; body: string }[];
  sub_issues: SubIssue[];
}

export interface AgendaEvent {
  start: string;          // HH:MM, America/New_York
  end: string | null;
  title: string;
  link: string | null;
  external: boolean;
}

export interface Brief {
  day: string;
  next_day: string;
  /** Saved by the first sweep of the day; null until then. */
  agenda: AgendaEvent[] | null;
  /** The next working day's calendar, also saved by the first sweep of the day; null until then. */
  next_agenda: AgendaEvent[] | null;
  completed_today: Issue[];
  waiting_state: string;
  error: string | null;
  /** Claude's plan for today (saved by the first morning sweep or by Re-plan); null until then. */
  plan: DayPlan | null;
  /** Today's latest Re-plan run: running, or how it ended. */
  plan_run: RunState | null;
  /** Claude's wrap-up of today (written by the 4 PM sweep or by Redo); null until then. */
  wrapup: Wrapup | null;
  /** Today's latest wrap-up Redo run: running, or how it ended. */
  wrapup_run: RunState | null;
  /** Claude's note for the rest of the day (written by the first sweep from noon, or by Redo); null until then. */
  note: DayNote | null;
  /** Today's latest note Redo run: running, or how it ended. */
  note_run: RunState | null;
  /** The next working day's Today list (issue ids, in order): what the wrap-up moved there. */
  next_today: string[];
  /** This week's mission check-in draft, rebuilt by each wrap-up; null until the first one. */
  checkin: Checkin | null;
}

export type RunState = { id: number; status: string; error: string | null; started_at: string; finished_at: string | null };

export interface Wrapup {
  day: string;
  made_at: string;
  summary: string;
  items: { identifier: string; action: "carry" | "move" | "ask" | "close"; why: string; move_to?: string; message?: string }[];
  start_with: { identifier: string; why: string } | null;
  notes: string[];
}

export interface Checkin {
  week: string;
  through: string;
  made_at: string;
  work: { mission: string; items: string[] }[];
  next_week: string[];
  review: string[];
  health: { mission: string; status: "on_track" | "at_risk" | "off_track"; why: string }[];
}

/** Claude's text marks each issue it names as `[label](ENG-123)`; the app shows those as chips. */
export interface DayPlan {
  day: string;
  made_at: string;
  headline: string;
  summary: string;
  /** The last working day in a sentence or two; plans made before the recap existed have none. */
  recap?: string;
  picks: { identifier: string; why: string; minutes: number }[];
  set_aside: { identifier: string; action: "move" | "ask" | "clear_date"; why: string; move_to?: string; message?: string }[];
}

export interface DayNote {
  day: string;
  made_at: string;
  headline: string;
  summary: string;
}

/** A due date moved later: both dates set, the new one after the old. */
export interface Slip {
  identifier: string;
  title: string;
  url: string | null;
  due_date: string | null;
  client: string | null;
  count: number;        // times pushed
  days: number;         // total days pushed
  changes: { from: string; to: string; at: string | null; by: string | null }[];
}

export interface Slips {
  slips: Record<string, Slip>;    // by issue id; only issues pushed at least once
  checked: number;                // open issues with a due date that were looked at
  error: string | null;
}

/** Per week, Monday to Sunday (ET): your pull requests merged, and others' you reviewed. Lines added
 *  and removed by the ones merged this week and last week. */
export interface PullWeeks {
  weeks: { week: string; merged: number; reviewed: number }[];
  lines: { additions: number; deletions: number } | null;
  last_lines: { additions: number; deletions: number } | null;
  error: string | null;
}

export interface Meta {
  team_key: string;
  states: State[];
  client_labels: string[];
  projects: string[];
  priorities: { value: number; name: string }[];
  sources: Source[];
  todo_state: string | null;      // the status a new or reopened sub-issue gets; null if the team has none
  done_state: string | null;      // the completed status Mark done and a ticked sub-issue get; null if the team has none
  periscope: boolean;             // app.periscope_url is set: Start in periscope is on
  claude_code: boolean;           // Settings lists a repo: Start in Claude Code is on
  claude_desktop: boolean;        // Claude Desktop is installed: Start in Claude Desktop is on
}

export interface SourceStatus {
  source: Source;
  ok: boolean;
  detail: string | null;
  items_scanned: number | null;
}

export interface Run {
  id?: number;
  trigger?: string;
  added?: number;
  started_at?: string;
  finished_at?: string | null;
  status?: "running" | "ok" | "error";
  error?: string | null;
  cost_usd?: number | null;
  num_turns?: number | null;
  sources?: SourceStatus[];
  /** A one-source sweep ("Check now"): which source it read. Absent or null for a full sweep. */
  scope?: Source | null;
  /** Each enabled source's latest report across sweeps, and when it last worked. */
  source_overview?: SourceOverview[];
}

export interface SourceOverview {
  source: Source;
  ok: boolean | null;          // null: never reported
  detail: string | null;
  at: string | null;           // start of the sweep that made the latest report
  last_ok_at: string | null;
  fail_streak?: number;        // how many of its latest reports failed in a row
  failing_since?: string | null;
}

export type SourceState = "on" | "paused" | "removed";

export interface SettingsSource {
  key: Exclude<Source, "manual">;
  name: string;
  reads: string;               // what it looks for, one line
  via: string;                 // "claude.ai connector", "gh command", ...
  state: SourceState;
  status: SourceOverview | null;
}

export interface Schedule {
  every: number;               // hours between sweeps
  start: number;               // first sweep (hour)
  end: number;                 // last possible sweep (hour)
  days: "weekdays" | "every day";
  hours: number[];             // the hours it runs at
  plan_hour: number | null;    // the run that writes the morning plan
  wrapup_hour: number | null;  // the run that writes the wrap-up
  installed: boolean;          // the Mac schedule is set up
  supported: boolean;
}

export interface AppSettings {
  sources: SettingsSource[];
  schedule: Schedule;
  daylight: { place: string; latitude: number | null; longitude: number | null };
  start: StartSettings;
}

/** Settings → Start Claude: Start in Claude Code's repos, and the prompts. */
export interface StartSettings {
  repos: { repo: string; label: string }[];   // absolute top folders; the label shows ~
  code_prompt: string;                        // Start in periscope and Start in Claude Code
  chat_prompt: string;                        // Start in Claude Desktop
  default_code_prompt: string;
  default_chat_prompt: string;
}

/** Start in periscope and Start in Claude Code: what the popover shows first. */
export interface StartOptions {
  repos: { repo: string; label: string }[];   // periscope's repos, or the Settings repos
  repo: string | null;                          // the one to select first
  hint: string;                                 // why: "Remembered for Pipelines.", or ""
  branch: string;                               // Linear's branch name
  branch_worktrees: string[];                   // repos with a worktree already on that branch
  prompt: string;                               // the Settings page's template, filled in
}

export interface PeriscopeStart {
  mode: "spawned" | "existing";                 // existing: a Claude was already on the branch
  pid: string;                                  // periscope always gives the pane's id
  warnings: string[];                           // why the session comment was not added; usually empty
}

export interface ClaudeCodeStart {
  path: string;                                 // the worktree
  reused: boolean;                              // it was already on the branch
  session_id: string;
  warnings: string[];                           // a fetch that failed, a comment Linear refused; usually empty
}

export interface RateCell {
  approved: number;
  dropped: number;
  rate: number | null;
}

export interface ApprovalStats {
  weeks: { week: string; sources: Record<string, RateCell> }[];
  drop_reasons: Record<string, number>;
}

export interface DigestIssue {
  identifier: string;
  title: string;
  client: string | null;
  url: string | null;
  list: "client" | "dev";
  due_date: string | null;
  completed_at: string | null;
}

export interface DigestRec {
  text: string;
  action: "open" | "tab";
  label: string;
  url?: string | null;
  tab?: "inbox" | "client" | "dev";
  issues?: string[];     // identifiers to highlight on that tab
}

/** One week written out; see backend digest.py for how each number is counted. */
export interface Digest {
  week: string;          // Monday, YYYY-MM-DD
  week_end: string;      // Sunday
  current: boolean;
  headline: string;
  closed: { total: number; client: number; dev: number; client_share: number | null; prev_total: number; target: number };
  wins: DigestIssue[];
  slipping: { identifier: string; title: string; client: string | null; url: string | null; count: number; days: number; due_date: string | null }[];
  slips_error: string | null;
  overdue: DigestIssue[];
  inbox: { approved: number; dropped: number; by_source: Record<string, { approved: number; dropped: number }>; noisy: string | null };
  sweeps: { runs: number; cost_usd: number };
  recommendations: DigestRec[];
}

export interface BalanceStats {
  weeks: { week: string; client: number; dev: number; client_share: number | null }[];
  target: number;
}

export interface CandidateEdit {
  title?: string;
  client_label?: string | null;
  due_date?: string | null;
  priority?: number;
  subtasks?: Subtask[];
  comment?: string;
  project?: string | null;
  reply_draft?: string;
  category?: string | null;
}

export interface ApproveResult {
  candidate: Candidate;
  issue: Issue;
  subtasks: Issue[];
  warnings: string[];
}

export interface IssueEdit {
  state_id?: string;
  priority?: number;
  due_date?: string | null;
  title?: string;
  /** Markdown; empty clears it. */
  description?: string;
  /** A client label's name; null makes it a Dev issue. */
  client?: string | null;
  /** An open project's name; null takes it out of its project. */
  project?: string | null;
}

/** A sub-issue in the reading pane. ``own_team``: it's in TodoHub's team, so the app's statuses apply. */
export interface SubIssue extends Issue {
  assignee: string | null;
  own_team: boolean;
}

export interface TodayItem {
  issue_id: string;
  position: number;
  event_start: string | null;
  event_minutes: number | null;
  event_link: string | null;
}

export interface Today {
  day: string;
  items: TodayItem[];
}

/** An open pull request, from GitHub (backend pulls.py). Bots' comments and reviews are left out. */
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  repo: string;                    // "owner/name"
  author: string;
  stage: "draft" | "in_review" | "changes_requested" | "approved";
  created_at: string;
  updated_at: string;
  additions: number;
  deletions: number;
  base: string;                    // branch names
  head: string;
  conflicts: boolean;
  ci: { state: "failing" | "running" | "passing" | "none"; total: number; done: number;
        failing: { name: string; seconds: number | null; url: string | null }[] };   // url: the run's log
  comments: number;
  /** Unresolved review threads whose last comment is not yours (of the newest 30). */
  open_threads: number;
  threads_unread: number;          // older threads than the newest 30
  threads: { author: string; path: string; line: number | null; at: string; text: string }[];
  reviewers: { login: string; state: "waiting" | "approved" | "changes_requested" | "commented"; at: string | null }[];
  /** Linear identifiers named in the branch or the title, e.g. "ENG-646". */
  refs: string[];
  /** Yours only: the pull request this one is built on (its base branch is that one's branch). */
  stacked_on?: number | null;
  asked_at: string;                // when your review was asked for
  reviewed_before: boolean;        // you reviewed it before this request
}

export interface Pulls {
  login: string | null;
  mine: PullRequest[];
  review: PullRequest[];
  mine_total: number;              // GitHub's count; more than mine.length when some were not read
  review_total: number;
  read_at: string | null;          // the last good read
  error: string | null;            // why the last read failed
  error_at: string | null;
}

interface BackendInfo {
  url: string;
  token: string;
  error: string | null;
}

let backend: BackendInfo | null = null;

export class ApiError extends Error {}

async function info(): Promise<BackendInfo> {
  if (!backend) backend = await invoke<BackendInfo>("backend_info");
  if (backend.error) throw new ApiError(backend.error);
  return backend;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const b = await info();
  const resp = await fetch(b.url + path, {
    method,
    headers: { "X-TodoHub-Token": b.token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await resp.text();
  const data = text ? JSON.parse(text) : null;
  if (!resp.ok) throw new ApiError(data?.error ?? data?.detail?.[0]?.msg ?? `HTTP ${resp.status}`);
  return data as T;
}

/** An image pasted into Linear, fetched by the backend with the Linear key, as a data: URL (the
 *  app's content policy allows data: images, and the bytes never touch the page as markup). */
export async function linearImage(url: string): Promise<string> {
  const b = await info();
  const resp = await fetch(`${b.url}/api/linear-image?url=${encodeURIComponent(url)}`, { headers: { "X-TodoHub-Token": b.token } });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = `HTTP ${resp.status}`;
    try { msg = JSON.parse(text)?.error ?? msg; } catch { /* not JSON */ }
    throw new ApiError(msg);
  }
  const blob = await resp.blob();
  if (!blob.type.startsWith("image/")) throw new ApiError("That link isn't an image.");
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(new ApiError("Couldn't read the image."));
    r.readAsDataURL(blob);
  });
}

/** Wait for the backend to answer, for up to ~15 seconds after launch. */
export async function waitForBackend(): Promise<void> {
  const b = await info();
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(b.url + "/api/health");
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new ApiError("The backend didn't start. See logs/api.log in the TodoHub settings folder.");
}

export const api = {
  meta: (refresh = false) => call<Meta>("GET", `/api/meta${refresh ? "?refresh=true" : ""}`),
  candidates: (status: "pending" | "snoozed" = "pending") => call<Candidate[]>("GET", `/api/candidates?status=${status}`),
  snooze: (id: number, until: string | null) => call<Candidate>("POST", `/api/candidates/${id}/snooze`, { until }),
  editCandidate: (id: number, edit: CandidateEdit) => call<Candidate>("PATCH", `/api/candidates/${id}`, edit),
  approve: (id: number, edit: CandidateEdit) =>
    call<ApproveResult>("POST", `/api/candidates/${id}/approve`, edit),
  /** Merge a linked card into its open issue. ``edit.comment`` is the text to post; the flags set
   *  the issue's due date and priority to the card's. */
  merge: (id: number, edit: CandidateEdit, fields: { move_due_date: boolean; raise_priority: boolean }) =>
    call<ApproveResult>("POST", `/api/candidates/${id}/merge`, { ...edit, ...fields }),
  /** Save a reply as a Gmail draft in the email's thread (nothing is sent). */
  replyDraft: (id: number, body: string) => call<{ url: string | null }>("POST", `/api/candidates/${id}/reply-draft`, { body }),
  issuePreview: (ident: string) => call<IssuePreview>("GET", `/api/issues/${encodeURIComponent(ident)}/preview`),
  periscopeOptions: (issueId: string) =>
    call<StartOptions>("GET", `/api/issues/${encodeURIComponent(issueId)}/periscope`),
  startInPeriscope: (issueId: string, body: { repo: string; branch: string; prompt: string }) =>
    call<PeriscopeStart>("POST", `/api/issues/${encodeURIComponent(issueId)}/periscope`, body),
  showInPeriscope: (pid: string) => call<{ ok: boolean }>("POST", "/api/periscope/show", { pid }),
  claudeCodeOptions: (issueId: string) =>
    call<StartOptions>("GET", `/api/issues/${encodeURIComponent(issueId)}/claude-code`),
  startInClaudeCode: (issueId: string, body: { repo: string; branch: string; prompt: string }) =>
    call<ClaudeCodeStart>("POST", `/api/issues/${encodeURIComponent(issueId)}/claude-code`, body),
  startInClaudeDesktop: (issueId: string) =>
    call<{ ok: boolean }>("POST", `/api/issues/${encodeURIComponent(issueId)}/claude-desktop`),
  mutes: () => call<MuteRule[]>("GET", "/api/mutes"),
  /** Mute a sender, channel or repo; with dropPending, cards already waiting from it are dropped too. */
  addMute: (key: MuteKey, dropPending = true) =>
    call<{ rule: MuteRule; dropped_ids: number[] }>("POST", "/api/mutes", { ...key, drop_pending: dropPending }),
  deleteMute: (id: number) => call<{ deleted: number }>("DELETE", `/api/mutes/${id}`),
  declineMute: (key: MuteKey) => call<{ declined: boolean }>("POST", "/api/mutes/decline", key),
  muteSuggestion: (id: number) =>
    call<{ suggestion: (MuteKey & { drops: number }) | null }>("GET", `/api/candidates/${id}/mute-suggestion`),
  settings: () => call<AppSettings>("GET", "/api/settings"),
  setSource: (key: string, state: SourceState) =>
    call<AppSettings>("PUT", `/api/settings/sources/${encodeURIComponent(key)}`, { state }),
  setSchedule: (s: Pick<Schedule, "every" | "start" | "end" | "days">) => call<AppSettings>("PUT", "/api/settings/schedule", s),
  installSchedule: () => call<AppSettings>("POST", "/api/settings/schedule/install"),
  setDaylightPlace: (d: AppSettings["daylight"]) => call<AppSettings>("PUT", "/api/settings/daylight", d),
  setPrompt: (kind: "code" | "chat", prompt: string) => call<AppSettings>("PUT", `/api/settings/prompts/${kind}`, { prompt }),
  addRepo: (path: string) => call<AppSettings>("POST", "/api/settings/repos", { path }),
  removeRepo: (repo: string) => call<AppSettings>("DELETE", `/api/settings/repos?repo=${encodeURIComponent(repo)}`),
  daylight: () => call<{ location: { lat: number; lon: number; place: string } | null }>("GET", "/api/daylight"),
  recheck: () => call<{ flagged: number }>("POST", "/api/candidates/recheck"),
  keep: (id: number) => call<Candidate>("POST", `/api/candidates/${id}/keep`),
  drop: (id: number, reason: DropReason) => call<Candidate>("POST", `/api/candidates/${id}/drop`, { reason }),
  restore: (id: number) => call<Candidate>("POST", `/api/candidates/${id}/restore`),
  decided: (days = 30) => call<{ days: number; more: boolean; items: DecidedItem[] }>("GET", `/api/decided?days=${days}`),
  /** Back to the Inbox, reversing what an approval did in Linear. */
  undo: (id: number) => call<{ candidate: Candidate; warnings: string[] }>("POST", `/api/candidates/${id}/undo`),
  issues: () => call<Issue[]>("GET", "/api/issues"),
  slips: (refresh = false) => call<Slips>("GET", `/api/slips${refresh ? "?refresh=true" : ""}`),
  pulls: (refresh = false) => call<Pulls>("GET", `/api/pulls${refresh ? "?refresh=true" : ""}`),
  pull: (repo: string, number: number) => call<Pulls>("POST", `/api/pulls/${repo}/${number}`),
  pullWeeks: () => call<PullWeeks>("GET", "/api/pulls/weekly"),
  editIssue: (id: string, edit: IssueEdit) => call<Issue>("PATCH", `/api/issues/${encodeURIComponent(id)}`, edit),
  /** Move an issue to Linear's trash (restorable there for 30 days); it also leaves Today. */
  deleteIssue: (id: string) =>
    call<{ deleted: string; today_position: number | null }>("DELETE", `/api/issues/${encodeURIComponent(id)}`),
  /** Undo a delete: back from Linear's trash, and onto Today at ``todayPosition`` if given. */
  restoreIssue: (id: string, todayPosition: number | null) =>
    call<Issue>("POST", `/api/issues/${encodeURIComponent(id)}/restore`, { today_position: todayPosition }),
  /** Post a comment as you; the id lets Undo delete it. */
  addComment: (issueId: string, body: string) =>
    call<{ id: string }>("POST", `/api/issues/${encodeURIComponent(issueId)}/comments`, { body }),
  deleteComment: (id: string) => call<{ deleted: string }>("DELETE", `/api/comments/${encodeURIComponent(id)}`),
  /** A sub-issue with the parent's client, project and priority, assigned to you, in Todo. */
  addSubIssue: (parentId: string, title: string) =>
    call<Issue>("POST", `/api/issues/${encodeURIComponent(parentId)}/sub-issues`, { title }),
  today: () => call<Today>("GET", "/api/today"),
  logos: (clients: string[]) =>
    call<Record<string, string | null>>("GET", `/api/logos?clients=${encodeURIComponent(clients.join("|"))}`),
  balance: (weeks: number) => call<BalanceStats>("GET", `/api/stats/balance?weeks=${weeks}`),
  approval: (weeks: number) => call<ApprovalStats>("GET", `/api/stats/approval?weeks=${weeks}`),
  digest: (week = 0) => call<Digest>("GET", `/api/digest?week=${week}`),
  runs: (limit: number) => call<Run[]>("GET", `/api/runs?limit=${limit}`),
  runLog: (id: number) => call<{ text: string; truncated?: boolean; missing: boolean }>("GET", `/api/runs/${id}/log`),
  clientSummary: (client: string) =>
    call<{ client: string; text: string }>("GET", `/api/clients/${encodeURIComponent(client)}/summary`),
  brief: () => call<Brief>("GET", "/api/brief"),
  /** Ask Claude for a fresh plan for today; it runs in the background (about a minute). */
  replan: () => call<{ started: boolean }>("POST", "/api/plan"),
  /** Ask Claude to write today's wrap-up again; it runs in the background (about a minute). */
  rewrap: () => call<{ started: boolean }>("POST", "/api/wrapup"),
  /** Ask Claude to write today's midday note again; it runs in the background (about a minute). */
  renote: () => call<{ started: boolean }>("POST", "/api/note"),
  /** Put unfinished Today items on the next working day's list. */
  carryOver: (issueIds: string[]) => call<Today>("POST", "/api/today/carry", { issue_ids: issueIds }),
  /** Take items back off the next working day's list (undoes carryOver). */
  uncarry: (issueIds: string[]) => call<Today>("DELETE", "/api/today/carry", { issue_ids: issueIds }),
  setToday: (issueIds: string[]) => call<Today>("PUT", "/api/today", { issue_ids: issueIds }),
  block: (issueId: string, start: string, minutes: number) =>
    call<Today>("POST", `/api/today/${encodeURIComponent(issueId)}/block`, { start, minutes }),
  latestRun: (kind: "sweep" | "capture" = "sweep") => call<Run>("GET", `/api/runs/latest?kind=${kind}`),
  capture: (text: string) =>
    call<{ mode: "note" | "claude"; candidate?: Candidate; status?: string }>("POST", "/api/capture", { text }),
  runNow: (source?: Source) => call<{ started: boolean }>("POST", "/api/sweep", source ? { source } : {}),
};
