"""The midday note: Claude takes a fresh look at the rest of the day.

The first sweep of a working day from noon, before the wrap-up hour, also writes the note, using
what it just read; "Redo" in the app runs one on its own (``todohub sweep --note``). Claude saves
it with the ``report_note`` tool, and the day view shows it in place of the morning plan's summary.

What Claude sees: today's Today list, what was closed today, the meetings left today, and the
morning plan's picks.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone

import httpx

from .config import Settings, get_linear_key
from .db import DB
from .linear import Linear, LinearError, shape_issue
from . import plan, stats, wrapup

log = logging.getLogger("todohub.note")

NOTE_HOUR = 12              # the first sweep from noon, before the wrap-up hour, writes the note, once


def note_due(db: DB, now: datetime | None = None) -> bool:
    """A working day from noon until the wrap-up hour, with no note saved for today yet."""
    local = (now or datetime.now(stats.TZ)).astimezone(stats.TZ)
    if local.weekday() >= 5 or not (NOTE_HOUR <= local.hour < wrapup.WRAPUP_HOUR):
        return False
    return local.date().isoformat() not in (db.get_meta("notes", {}) or {})


def gather(settings: Settings, db: DB, now: datetime | None = None) -> dict | None:
    """What the note prompt needs, read from Linear and the app. None when Linear can't be reached."""
    local = (now or datetime.now(stats.TZ)).astimezone(stats.TZ)
    today = local.date()
    since = datetime(today.year, today.month, today.day, tzinfo=stats.TZ).astimezone(timezone.utc)
    try:
        client = Linear(get_linear_key())
        try:
            issues = [shape_issue(i, settings) for i in client.my_open_issues()]
            done = [shape_issue(i, settings) for i in client.my_completed_issues(since.isoformat())]
        finally:
            client.close()
    except (LinearError, RuntimeError, httpx.HTTPError) as exc:
        log.warning("Can't write the note without Linear: %s", exc)
        return None
    hhmm = local.strftime("%H:%M")
    agenda = (db.get_meta("agendas", {}) or {}).get(today.isoformat())
    day_plan = (db.get_meta("plans", {}) or {}).get(today.isoformat()) or {}
    return {
        "today": today, "now": hhmm, "waiting_state": settings.waiting_state,
        "on_today": plan.on_today(db, today, issues),
        "done_today": [i for i in done if i.get("completed_at") and stats.local_date(i["completed_at"]) == today],
        "agenda_left": None if agenda is None else [e for e in agenda if (e.get("end") or e["start"]) > hhmm],
        "picks": day_plan.get("picks", []),
    }


def section(ctx: dict, agenda_from_this_run: bool) -> str:
    """The "midday note" part of the prompt."""
    today: date = ctx["today"]
    listed = "\n".join(plan.issue_row(i, today, ctx["waiting_state"]) for i in ctx["on_today"]) or "  (empty)"
    done = "\n".join(f"  - {i['identifier']} {plan._tag(i)} {i['title']}" for i in ctx["done_today"]) or "  (none yet)"
    picks = ("This morning's plan picked:\n" + "\n".join(f"  - {p['identifier']}: {p.get('why', '')}" for p in ctx["picks"])
             if ctx["picks"] else "No plan was made this morning.")
    if ctx["agenda_left"] is not None:
        meetings = f"Meetings left today:\n{wrapup._events(ctx['agenda_left'])}"
    elif agenda_from_this_run:
        meetings = f"Use today's events you listed for `report_agenda` above, from {ctx['now']} on."
    else:
        meetings = "His calendar for today isn't available."

    return (
        f"### Midday note ({today.strftime('%A %Y-%m-%d')}, {ctx['now']})\n"
        "He checks TodoHub between meetings. Call `report_note` once, after the sources above, with:\n"
        "- `headline`: one plain line on what to do next, like \"Finish the Globex grades before the 2:00 "
        "review.\" No links.\n"
        "- `summary`: at most two short sentences, about 35 words in all, on the rest of his day: what's "
        "still open on today's list, the next meeting and what to do before it, and who to nudge. "
        f"{plan.ISSUE_REFS}\n"
        "Use what you read in Slack, email and meetings. You may open a Slack thread, email or Grain meeting "
        "to check an item (read-only). The note never adds candidates.\n\n"
        f"{picks}\n\nDone today:\n{done}\n\nStill open on today's list:\n{listed}\n\n{meetings}"
    )
