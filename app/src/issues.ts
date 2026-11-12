// Small things the pages ask about an issue or a day: is it open, what's today, and how a due
// date or a time reads.
import type { Issue } from "./api";

/** Done, canceled or duplicate: off the open lists. */
export function closedType(type: string): boolean {
  return type === "completed" || type === "canceled" || type === "duplicate";
}

export function isOpen(i: Issue): boolean {
  return !closedType(i.state.type);
}

/** ``d``'s day in local time, as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function localToday(): string {
  return isoDay(new Date());
}

export function dueLabel(due: string, today: string): string {
  if (due === today) return "due today";
  const days = Math.round((Date.parse(today) - Date.parse(due)) / 864e5);
  return days > 0 ? `${days} day${days === 1 ? "" : "s"} overdue` : `due ${due}`;
}

export function when(iso: string | null | undefined): string {
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
