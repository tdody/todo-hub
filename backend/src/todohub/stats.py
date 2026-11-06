"""Numbers for the Insights tab.

Approval rate, per source and week:
    approved / (approved + dropped)
counting candidates decided (approved or dropped) during that week, Monday to Sunday,
America/New_York. Captured notes are left out: you typed them, so they'd always count
as approved. Still-pending candidates aren't counted. A week with no decisions has no
rate (None), not 0.

Client vs dev balance, per week:
    client share = completed client-labeled issues / all completed issues
counting your Linear issues whose completedAt falls in that week. Canceled issues aren't
counted. The target is 50%.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/New_York")


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def local_date(iso: str) -> date:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ).date()


def week_starts(weeks: int, today: date | None = None) -> list[date]:
    this = week_start(today or datetime.now(TZ).date())
    return [this - timedelta(weeks=i) for i in reversed(range(weeks))]


def first_day(weeks: int, today: date | None = None) -> datetime:
    """Start of the oldest week shown, as an aware datetime (for queries)."""
    d = week_starts(weeks, today)[0]
    return datetime(d.year, d.month, d.day, tzinfo=TZ)


def _rate(approved: int, dropped: int) -> float | None:
    total = approved + dropped
    return round(approved / total, 3) if total else None


def approval_rate(decisions: list[dict], weeks: int = 8, today: date | None = None) -> dict:
    starts = week_starts(weeks, today)
    counts: dict = defaultdict(lambda: {"approved": 0, "dropped": 0})
    reasons: dict = defaultdict(int)
    sources: set[str] = set()
    for d in decisions:
        wk = week_start(local_date(d["decided_at"]))
        if wk < starts[0]:
            continue
        sources.add(d["source"])
        counts[(wk, d["source"])][d["status"]] += 1
        counts[(wk, "all")][d["status"]] += 1
        if d["status"] == "dropped":
            reasons[d.get("drop_reason") or "other"] += 1
    rows = []
    for wk in starts:
        row = {"week": wk.isoformat(), "sources": {}}
        for s in sorted(sources) + ["all"]:
            c = counts[(wk, s)]
            row["sources"][s] = {**c, "rate": _rate(c["approved"], c["dropped"])}
        rows.append(row)
    return {"weeks": rows, "drop_reasons": dict(reasons)}


def due_slips(issues: list[dict], client_group: str = "client") -> dict:
    """Due-date slips for issues fetched with their history.

    A slip is one change that moved the due date later: both the old and the new date are set and
    the new one is after the old. Setting a first due date, clearing it, or moving it earlier
    isn't a slip. ``days`` is the total pushed, summed over the slips."""
    out: dict = {}
    for i in issues:
        changes = []
        for n in sorted((i.get("history") or {}).get("nodes", []), key=lambda n: n.get("createdAt") or ""):
            old, new = n.get("fromDueDate"), n.get("toDueDate")
            if old and new and new > old:
                changes.append({"from": old, "to": new, "at": n.get("createdAt"),
                                "by": (n.get("actor") or {}).get("name")})
        if not changes:
            continue
        client = next((l["name"] for l in (i.get("labels") or {}).get("nodes", [])
                       if (l.get("parent") or {}).get("name") == client_group), None)
        out[i["id"]] = {
            "identifier": i["identifier"], "title": i["title"], "url": i.get("url"), "due_date": i.get("dueDate"),
            "client": client, "count": len(changes),
            "days": sum((date.fromisoformat(c["to"]) - date.fromisoformat(c["from"])).days for c in changes),
            "changes": changes,
        }
    return out


def balance(completed: list[dict], weeks: int = 8, today: date | None = None, target: float = 0.5) -> dict:
    """``completed`` holds shaped issues with ``completed_at`` and ``list`` ("client" | "dev")."""
    starts = week_starts(weeks, today)
    counts: dict = defaultdict(lambda: {"client": 0, "dev": 0})
    for i in completed:
        if not i.get("completed_at"):
            continue
        wk = week_start(local_date(i["completed_at"]))
        if wk >= starts[0]:
            counts[wk][i["list"]] += 1
    rows = []
    for wk in starts:
        c = counts[wk]
        total = c["client"] + c["dev"]
        rows.append({"week": wk.isoformat(), **c, "client_share": round(c["client"] / total, 3) if total else None})
    return {"weeks": rows, "target": target}
