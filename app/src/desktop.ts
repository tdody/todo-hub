// Desktop integration: menu-bar count, Mac notifications, and events from the menu bar
// and the ⌥⌘T shortcut. Each call is a no-op outside the Tauri app (e.g. in a browser).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { Candidate } from "./api";

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

let seen: Set<number> | null = null;

/** Notify about urgent candidates that weren't in the queue last time. The first call only records. */
export async function notifyNew(candidates: Candidate[]) {
  const ids = new Set(candidates.map((c) => c.id));
  if (seen === null) {
    seen = ids;
    return;
  }
  const fresh = candidates.filter((c) => !seen!.has(c.id) && isUrgent(c));
  seen = ids;
  if (!fresh.length || !(await canNotify())) return;
  if (fresh.length === 1) {
    sendNotification({ title: `TodoHub: ${fresh[0].title}`, body: fresh[0].why ?? "New urgent task to review" });
  } else {
    sendNotification({ title: `TodoHub: ${fresh.length} urgent tasks`, body: fresh.slice(0, 3).map((c) => c.title).join("\n") });
  }
}
