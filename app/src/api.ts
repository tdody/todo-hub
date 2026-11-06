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

export interface Candidate {
  id: number;
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

export interface Meta {
  team_key: string;
  states: State[];
  client_labels: string[];
  projects: string[];
  priorities: { value: number; name: string }[];
  sources: Source[];
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
  /** Add a possible duplicate to the issue it duplicates instead of creating a new one. */
  merge: (id: number, edit: CandidateEdit) => call<ApproveResult>("POST", `/api/candidates/${id}/merge`, edit),
  /** Save a reply as a Gmail draft in the email's thread (nothing is sent). */
  replyDraft: (id: number, body: string) => call<{ url: string | null }>("POST", `/api/candidates/${id}/reply-draft`, { body }),
  issuePreview: (ident: string) => call<IssuePreview>("GET", `/api/issues/${encodeURIComponent(ident)}/preview`),
  mutes: () => call<MuteRule[]>("GET", "/api/mutes"),
  /** Mute a sender, channel or repo; with dropPending, cards already waiting from it are dropped too. */
  addMute: (key: MuteKey, dropPending = true) =>
    call<{ rule: MuteRule; dropped_ids: number[] }>("POST", "/api/mutes", { ...key, drop_pending: dropPending }),
  deleteMute: (id: number) => call<{ deleted: number }>("DELETE", `/api/mutes/${id}`),
  declineMute: (key: MuteKey) => call<{ declined: boolean }>("POST", "/api/mutes/decline", key),
  muteSuggestion: (id: number) =>
    call<{ suggestion: (MuteKey & { drops: number }) | null }>("GET", `/api/candidates/${id}/mute-suggestion`),
  daylight: () => call<{ location: { lat: number; lon: number; place: string } | null }>("GET", "/api/daylight"),
  recheck: () => call<{ flagged: number }>("POST", "/api/candidates/recheck"),
  keep: (id: number) => call<Candidate>("POST", `/api/candidates/${id}/keep`),
  drop: (id: number, reason: DropReason) => call<Candidate>("POST", `/api/candidates/${id}/drop`, { reason }),
  restore: (id: number) => call<Candidate>("POST", `/api/candidates/${id}/restore`),
  /** Back to the Inbox, reversing what an approval did in Linear. */
  undo: (id: number) => call<{ candidate: Candidate; warnings: string[] }>("POST", `/api/candidates/${id}/undo`),
  issues: () => call<Issue[]>("GET", "/api/issues"),
  slips: (refresh = false) => call<Slips>("GET", `/api/slips${refresh ? "?refresh=true" : ""}`),
  editIssue: (id: string, edit: IssueEdit) => call<Issue>("PATCH", `/api/issues/${encodeURIComponent(id)}`, edit),
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
  /** Put unfinished Today items on the next working day's list. */
  carryOver: (issueIds: string[]) => call<Today>("POST", "/api/today/carry", { issue_ids: issueIds }),
  setToday: (issueIds: string[]) => call<Today>("PUT", "/api/today", { issue_ids: issueIds }),
  block: (issueId: string, start: string, minutes: number) =>
    call<Today>("POST", `/api/today/${encodeURIComponent(issueId)}/block`, { start, minutes }),
  latestRun: (kind: "sweep" | "capture" = "sweep") => call<Run>("GET", `/api/runs/latest?kind=${kind}`),
  capture: (text: string) =>
    call<{ mode: "note" | "claude"; candidate?: Candidate; status?: string }>("POST", "/api/capture", { text }),
  runNow: (source?: Source) => call<{ started: boolean }>("POST", "/api/sweep", source ? { source } : {}),
};
