// Desktop integration: menu-bar count, Mac notifications, and events from the menu bar
// and the ⌥⌘T shortcut. Each call is a no-op outside the Tauri app (e.g. in a browser).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { Candidate, Run } from "./api";

const inTauri = () => "__TAURI_INTERNALS__" in window;

export function setTrayCount(count: number) {
  if (inTauri()) void invoke("set_tray_count", { count }).catch(() => undefined);
}

export function onDesktopEvent(name: "capture" | "run-now", handler: () => void) {
  if (inTauri()) void listen(name, handler).catch(() => undefined);
}

let allowed: boolean | null = null;
async function canNotify(): Promise<boolean> {
  if (!inTauri()) return false;
  if (allowed === null) {
    try {
      allowed = (await isPermissionGranted()) || (await requestPermission()) === "granted";
    } catch {
      allowed = false;
    }
  }
  return allowed;
}

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Urgent = priority urgent or high, or due within two days (today, tomorrow, the day after). */
export function isUrgent(c: Candidate): boolean {
  return c.priority === 1 || c.priority === 2 || (!!c.due_date && c.due_date <= inDays(2));
}

const SWEEP_NOTICE_HOURS = 3;     // a sweep older than this isn't news any more (the app was closed)

/** One notification per sweep that added tasks: "TodoHub: 4 new tasks to review (1 urgent)", with
 *  the first titles, urgent ones first. Sent once the sweep has finished, so tasks it adds one by
 *  one make one notification; once per sweep, across app restarts. Typed captures don't notify. */
export async function notifySweep(run: Run, pending: Candidate[]) {
  if (run.status !== "ok" || !run.id || !run.finished_at) return;
  if (Date.now() - Date.parse(run.finished_at) > SWEEP_NOTICE_HOURS * 3600_000) return;
  const fresh = pending.filter((c) => c.run_id === run.id);
  if (!fresh.length) return;
  const urgent = fresh.filter(isUrgent);
  const ordered = [...urgent, ...fresh.filter((c) => !isUrgent(c))];
  const title = fresh.length === 1
    ? `TodoHub: ${urgent.length ? "urgent: " : ""}${fresh[0].title}`
    : `TodoHub: ${fresh.length} new tasks to review${urgent.length ? ` (${urgent.length} urgent)` : ""}`;
  const body = fresh.length === 1 ? fresh[0].why ?? "New task to review"
    : ordered.slice(0, 3).map((c) => c.title).join("\n") + (fresh.length > 3 ? `\nand ${fresh.length - 3} more` : "");
  await notifyOnce(`sweep-new-${run.id}`, title, body);
}

/** A Mac notification at most once per key (e.g. "brief-morning-2026-11-04"). */
export async function notifyOnce(key: string, title: string, body: string) {
  try {
    if (localStorage.getItem(`notified:${key}`)) return;
    if (!(await canNotify())) return;
    localStorage.setItem(`notified:${key}`, "1");
  } catch {
    return;       // no storage: skip rather than notify every minute
  }
  sendNotification({ title, body });
}
