"""The weekly digest on the Insights tab: one week, written out.

Everything here is counted, not written by a model, so it costs nothing and can't make
things up. Weeks run Monday to Sunday, America/New_York, as in stats.py.

- Closed: your Linear issues whose completedAt falls in the week (canceled ones aren't).
- Client share: closed client-labeled issues / all closed issues that week.
- Inbox: candidates you approved or dropped that week; captured notes aren't counted.
- Slipping: open issues whose due date was moved later two or more times (stats.due_slips).
  This reads the issues' whole history, so it's the same for every week.
- Overdue: open issues due before today.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from . import stats

SOURCE_NAME = {"slack": "Slack", "gmail": "Gmail", "grain": "Grain", "calendar": "Calendar",
               "linear": "Linear", "github": "GitHub"}
BALANCE_GAP = 0.15          # how far from the target before the digest calls it out
MIN_CLOSED_FOR_BALANCE = 3  # fewer closed issues than this says nothing about balance
NOISY_MIN = 5               # decisions from a source before its drop rate is worth a note
NOISY_RATE = 0.5            # drop rate at or above this is "noisy"


def _in_week(iso: str | None, start: date) -> bool:
    return bool(iso) and start <= stats.local_date(iso) < start + timedelta(days=7)


def _pct(x: float) -> str:
    return f"{round(x * 100)}%"


def build(*, week_offset: int, completed: list[dict], open_issues: list[dict], slips: dict,
          decisions: list[dict], runs: list[dict], target: float = 0.5,
          today: date | None = None) -> dict:
    """``week_offset`` 0 = this week, 1 = last week. ``completed`` and ``open_issues`` are shaped
    issues; ``completed`` must reach back to the start of the previous week of the one shown."""
    today = today or datetime.now(stats.TZ).date()
    start = stats.week_start(today) - timedelta(weeks=week_offset)
    prev = start - timedelta(weeks=1)

    closed = sorted((i for i in completed if _in_week(i.get("completed_at"), start)),
                    key=lambda i: i["completed_at"], reverse=True)
    prev_closed = [i for i in completed if _in_week(i.get("completed_at"), prev)]
    n_client = sum(1 for i in closed if i["list"] == "client")
    share = n_client / len(closed) if closed else None

    by_source: dict[str, dict] = {}
    for d in decisions:
        if not _in_week(d.get("decided_at"), start):
            continue
        row = by_source.setdefault(d["source"], {"approved": 0, "dropped": 0})
        row[d["status"]] += 1
    approved = sum(r["approved"] for r in by_source.values())
    dropped = sum(r["dropped"] for r in by_source.values())
    noisy = max(((s, r) for s, r in by_source.items()
                 if r["approved"] + r["dropped"] >= NOISY_MIN and r["dropped"] / (r["approved"] + r["dropped"]) >= NOISY_RATE),
                key=lambda x: x[1]["dropped"], default=None)

    week_runs = [r for r in runs if r.get("trigger") != "capture" and _in_week(r.get("started_at"), start)]
    cost = sum(r.get("cost_usd") or 0 for r in week_runs)

    slipping = sorted((s for s in (slips.get("slips") or {}).values() if s["count"] >= 2),
                      key=lambda s: (-s["count"], -s["days"]))
    today_s = today.isoformat()
    overdue = sorted((i for i in open_issues if i.get("due_date") and i["due_date"] < today_s),
                     key=lambda i: i["due_date"])

    # Headline: how much, then the balance.
    if not closed:
        headline = "Nothing closed yet this week." if week_offset == 0 else "Nothing closed that week."
    else:
        headline = f"{len(closed)} issue{'s' if len(closed) != 1 else ''} closed."
        if len(closed) >= MIN_CLOSED_FOR_BALANCE and share is not None:
            if share < target - BALANCE_GAP:
                headline += " Client work fell behind."
            elif share > target + BALANCE_GAP:
                headline += " Dev work fell behind."
            else:
                headline += " Client and dev were balanced."

    recs: list[dict] = []
    if slipping:
        s = slipping[0]
        recs.append({"text": f"{s['identifier']} has been pushed {s['count']} times ({s['days']} days). "
                             "Break it up, or set a date you'll keep.",
                     "action": "open", "label": "Open", "url": s.get("url")})
    if len(closed) >= MIN_CLOSED_FOR_BALANCE and share is not None and abs(share - target) >= BALANCE_GAP:
        behind = "client" if share < target else "dev"
        recs.append({"text": f"Client work was {_pct(share)} of what you closed (target {_pct(target)}). "
                             f"Start next week with {behind} work.",
                     "action": "tab", "tab": behind, "label": f"Show {behind} work"})
    if overdue:
        recs.append({"text": f"{len(overdue)} open issue{'s are' if len(overdue) != 1 else ' is'} overdue. "
                             "Re-date or close them.",
                     "action": "tab", "tab": overdue[0]["list"], "label": "Review"})
    if noisy:
        src, r = noisy
        recs.append({"text": f"{SOURCE_NAME.get(src, src)}: you dropped {r['dropped']} of {r['approved'] + r['dropped']} "
                             "suggestions. Mute the senders or channels you always drop.",
                     "action": "tab", "tab": "inbox", "label": "Go to Inbox"})

    def brief(i: dict) -> dict:
        return {k: i.get(k) for k in ("identifier", "title", "client", "url", "list", "due_date", "completed_at")}

    return {
        "week": start.isoformat(),
        "week_end": (start + timedelta(days=6)).isoformat(),
        "current": week_offset == 0,
        "headline": headline,
        "closed": {"total": len(closed), "client": n_client, "dev": len(closed) - n_client,
                   "client_share": round(share, 3) if share is not None else None,
                   "prev_total": len(prev_closed), "target": target},
        "wins": [brief(i) for i in closed],
        "slipping": [{k: s.get(k) for k in ("identifier", "title", "client", "url", "count", "days", "due_date")}
                     for s in slipping],
        "slips_error": slips.get("error"),
        "overdue": [brief(i) for i in overdue],
        "inbox": {"approved": approved, "dropped": dropped,
                  "by_source": {SOURCE_NAME.get(s, s): r for s, r in sorted(by_source.items())},
                  "noisy": SOURCE_NAME.get(noisy[0], noisy[0]) if noisy else None},
        "sweeps": {"runs": len(week_runs), "cost_usd": round(cost, 2)},
        "recommendations": recs[:3],
    }
