// Talks to the local Python backend. The Rust shell started it and knows its port and token.
import { invoke } from "@tauri-apps/api/core";

export type Source = "slack" | "gmail" | "grain" | "calendar" | "linear" | "github" | "manual";
export type Signal =
  | "ask" | "commitment" | "action_item" | "deadline" | "manual" | "waiting_on" | "done" | "update"
  | "meeting_prep" | "review_request" | "mention";
export type Kind = "task" | "waiting" | "close" | "comment";

export type DropReason = "not_mine" | "already_done" | "noise" | "duplicate" | "other";

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
  drop: (id: number, reason: DropReason) => call<Candidate>("POST", `/api/candidates/${id}/drop`, { reason }),
  restore: (id: number) => call<Candidate>("POST", `/api/candidates/${id}/restore`),
  /** Back to the Inbox, reversing what an approval did in Linear. */
  undo: (id: number) => call<{ candidate: Candidate; warnings: string[] }>("POST", `/api/candidates/${id}/undo`),
  issues: () => call<Issue[]>("GET", "/api/issues"),
  editIssue: (id: string, edit: IssueEdit) => call<Issue>("PATCH", `/api/issues/${encodeURIComponent(id)}`, edit),
  today: () => call<Today>("GET", "/api/today"),
  logos: (clients: string[]) =>
    call<Record<string, string | null>>("GET", `/api/logos?clients=${encodeURIComponent(clients.join("|"))}`),
  balance: (weeks: number) => call<BalanceStats>("GET", `/api/stats/balance?weeks=${weeks}`),
  approval: (weeks: number) => call<ApprovalStats>("GET", `/api/stats/approval?weeks=${weeks}`),
  runs: (limit: number) => call<Run[]>("GET", `/api/runs?limit=${limit}`),
  runLog: (id: number) => call<{ text: string; truncated?: boolean; missing: boolean }>("GET", `/api/runs/${id}/log`),
  clientSummary: (client: string) =>
    call<{ client: string; text: string }>("GET", `/api/clients/${encodeURIComponent(client)}/summary`),
  setToday: (issueIds: string[]) => call<Today>("PUT", "/api/today", { issue_ids: issueIds }),
  block: (issueId: string, start: string, minutes: number) =>
    call<Today>("POST", `/api/today/${encodeURIComponent(issueId)}/block`, { start, minutes }),
  latestRun: (kind: "sweep" | "capture" = "sweep") => call<Run>("GET", `/api/runs/latest?kind=${kind}`),
  capture: (text: string) =>
    call<{ mode: "note" | "claude"; candidate?: Candidate; status?: string }>("POST", "/api/capture", { text }),
  runNow: () => call<{ started: boolean }>("POST", "/api/sweep"),
};
