"""The morning plan: Claude picks what to do today and says why.

The first sweep of a working morning (6:00 to 11:00, America/New_York) also plans the day, using
what it just read; "Re-plan" in the app runs a plan on its own (``todohub sweep --plan``). Either
way Claude only suggests: it saves the plan with the ``report_plan`` tool, and nothing is starred,
re-dated or sent until Thibault clicks.

What Claude sees for planning: today's calendar, this week's client/dev balance, and the open
issues worth considering today (late or due within three days, urgent or high priority, in
progress, or a follow-up that's due), with their due dates, priority, state and how many times
the due date was pushed. For the recap of the last working day: its wrap-up summary, what was
closed that day, and what's already on today's list.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

import httpx

from .config import Settings, get_linear_key
from .db import DB
from .linear import Linear, LinearError, shape_issue
from . import stats

log = logging.getLogger("todohub.plan")

PLAN_START_HOUR, PLAN_END_HOUR = 6, 11      # the sweep plans the day in this window, once
DUE_SOON_DAYS = 3
MAX_CANDIDATES = 30
WORKDAY = ("08:30", "18:00")                # free time is counted inside this, lunch excluded
LUNCH_MINUTES = 60


def today_local(now: datetime | None = None) -> date:
    return (now or datetime.now(stats.TZ)).astimezone(stats.TZ).date()


def plan_due(db: DB, now: datetime | None = None) -> bool:
    """A working morning with no plan saved for today yet."""
    local = (now or datetime.now(stats.TZ)).astimezone(stats.TZ)
    if local.weekday() >= 5 or not (PLAN_START_HOUR <= local.hour < PLAN_END_HOUR):
        return False
    return local.date().isoformat() not in (db.get_meta("plans", {}) or {})


def _minutes(hhmm: str) -> int:
    hh, mm = hhmm.split(":")
    return int(hh) * 60 + int(mm)


def free_minutes(agenda: list[dict] | None, start: str = WORKDAY[0], end: str = WORKDAY[1]) -> int | None:
    """Minutes between ``start`` and ``end`` not taken by meetings, minus lunch. None without an agenda."""
    if agenda is None:
        return None
    lo, hi = _minutes(start), _minutes(end)
    busy: list[tuple[int, int]] = []
    for e in agenda:
        s = _minutes(e["start"])
        f = _minutes(e["end"]) if e.get("end") else s + 30
        s, f = max(s, lo), min(f, hi)
        if f > s:
            busy.append((s, f))
    busy.sort()
    taken, cur_s, cur_f = 0, None, None
    for s, f in busy:
        if cur_f is None or s > cur_f:
            if cur_f is not None:
                taken += cur_f - cur_s
            cur_s, cur_f = s, f
        else:
            cur_f = max(cur_f, f)
    if cur_f is not None:
        taken += cur_f - cur_s
    return max(0, hi - lo - taken - LUNCH_MINUTES)


def candidates(issues: list[dict], waiting_state: str, today: date) -> list[dict]:
    """Open issues worth considering today: late or due soon, urgent or high, in progress, or a
    follow-up whose date has come."""
    soon = (today + timedelta(days=DUE_SOON_DAYS)).isoformat()
    t = today.isoformat()

    def keep(i: dict) -> bool:
        if i["state"]["type"] in ("completed", "canceled"):
            return False
        if i["state"]["name"] == waiting_state:
            return bool(i.get("due_date")) and i["due_date"] <= t
        return ((i.get("due_date") or "9") <= soon or i.get("priority") in (1, 2)
                or i["state"]["type"] == "started")

    picked = [i for i in issues if keep(i)]
    picked.sort(key=lambda i: (i.get("due_date") or "9999", i.get("priority") or 9))
    return picked[:MAX_CANDIDATES]


def _due_note(due: str | None, today: date) -> str:
    if not due:
        return "no due date"
    days = (date.fromisoformat(due) - today).days
    if days < 0:
        return f"due {due} ({-days} day{'s' if days != -1 else ''} late)"
    return "due today" if days == 0 else f"due {due} (in {days} day{'s' if days != 1 else ''})"


PRIORITY = {1: "urgent", 2: "high", 3: "medium", 4: "low"}
ISSUE_REFS = ("Mark each issue you name as `[short label](IDENTIFIER)`, a markdown link whose target is the "
              "issue identifier, e.g. \"Finish [the Globex grades](ENG-123) before the review.\" The app turns "
              "each into a chip, so keep labels to a few words. No other links or markdown.")


def _tag(i: dict) -> str:
    return f"[client: {i['client']}]" if i.get("client") else "[dev]"


def issue_row(i: dict, today: date, waiting_state: str, pushed: int = 0) -> str:
    """One open issue for a prompt: identifier, client or dev, title, due date, state, priority."""
    bits = [_due_note(i.get("due_date"), today), i["state"]["name"]]
    if i.get("priority") in PRIORITY:
        bits.append(PRIORITY[i["priority"]])
    if pushed:
        bits.append(f"due date pushed {pushed}×")
    if i["state"]["name"] == waiting_state:
        bits.append("a follow-up: he's waiting on someone")
    return f"  - {i['identifier']} {_tag(i)} {i['title']} | " + " | ".join(bits)


def on_today(db: DB, day: date, open_issues: list[dict]) -> list[dict]:
    """The open issues on the day's Today list, in its order."""
    by_id = {i["id"]: i for i in open_issues}
    return [by_id[t["issue_id"]] for t in db.get_today(day.isoformat()) if t["issue_id"] in by_id]


def gather(settings: Settings, db: DB, now: datetime | None = None) -> dict | None:
    """What the planning prompt needs, read from Linear. None when Linear can't be reached."""
    today = today_local(now)
    week = stats.week_start(today)
    prev = today - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    first = min(week, prev)                 # on a Monday, the last working day is in last week
    since = datetime(first.year, first.month, first.day, tzinfo=stats.TZ).astimezone(timezone.utc)
    try:
        client = Linear(get_linear_key())
        try:
            issues = [shape_issue(i, settings) for i in client.my_open_issues()]
            done = [shape_issue(i, settings) for i in client.my_completed_issues(since.replace(microsecond=0).isoformat())]
            try:
                slips = stats.due_slips(client.due_date_history(), settings.client_label_group)
            except LinearError as exc:          # nice to have; plan without it
                log.warning("No due-date history for the plan: %s", exc)
                slips = {}
        finally:
            client.close()
    except (LinearError, RuntimeError, httpx.HTTPError) as exc:
        log.warning("Can't plan without Linear: %s", exc)
        return None
    done = [i for i in done if i.get("completed_at")]
    done_prev = [i for i in done if stats.local_date(i["completed_at"]) == prev]
    done = [i for i in done if stats.local_date(i["completed_at"]) >= week]
    agenda = (db.get_meta("agendas", {}) or {}).get(today.isoformat())
    prev_wrapup = (db.get_meta("wrapups", {}) or {}).get(prev.isoformat()) or {}
    return {
        "start_with": prev_wrapup.get("start_with"), "prev_day": prev,
        "prev_wrapup_summary": prev_wrapup.get("summary"), "done_prev": done_prev,
        "on_today": on_today(db, today, issues),
        "today": today, "issues": candidates(issues, settings.waiting_state, today),
        "waiting_state": settings.waiting_state, "slips": slips, "agenda": agenda,
        "free": free_minutes(agenda),
        "client_done": sum(1 for i in done if i["list"] == "client"), "done": len(done),
    }


def section(ctx: dict, agenda_from_this_run: bool) -> str:
    """The "plan the day" part of the prompt."""
    today: date = ctx["today"]

    def row(i: dict) -> str:
        return issue_row(i, today, ctx["waiting_state"], (ctx["slips"].get(i["id"]) or {}).get("count", 0))

    issues = "\n".join(row(i) for i in ctx["issues"]) or "  (none)"

    if ctx["agenda"] is not None:
        events = "\n".join(f"  - {e['start']}–{e.get('end') or '?'} {e['title']}" + (" (external)" if e.get("external") else "")
                           for e in ctx["agenda"]) or "  (no meetings)"
        time_line = (f"Today's meetings:\n{events}\n\nHe has about {ctx['free']} minutes free between "
                     f"{WORKDAY[0]} and {WORKDAY[1]}, after meetings and an hour for lunch.")
    elif agenda_from_this_run:
        time_line = ("Use today's events you listed for `report_agenda` above. Count his free time between "
                     f"{WORKDAY[0]} and {WORKDAY[1]}, minus meetings and an hour for lunch.")
    else:
        time_line = "His calendar for today isn't available; assume about 5 hours of free time."
    balance = (f"{ctx['client_done']} of the {ctx['done']} issues he closed this week were client work"
               if ctx["done"] else "he hasn't closed any issues yet this week")
    sw = ctx.get("start_with")
    yesterday = (f"\n\nLast working day's wrap-up suggested starting today with {sw['identifier']}: {sw.get('why', '')} "
                 "Weigh it, but pick differently if what you read since changes things." if sw else "")
    prev_name = ctx["prev_day"].strftime("%A")
    prev_wrapup = (f"{prev_name}'s wrap-up said: \"{ctx['prev_wrapup_summary']}\"" if ctx.get("prev_wrapup_summary")
                   else f"No wrap-up was saved for {prev_name}.")
    done_prev = "\n".join(f"  - {i['identifier']} {_tag(i)} {i['title']}" for i in ctx["done_prev"]) or "  (none)"
    listed = "\n".join(row(i) for i in ctx["on_today"]) or "  (empty)"

    return (
        f"### Plan Thibault's day ({today.strftime('%A %Y-%m-%d')})\n"
        "He opens TodoHub between 8:00 and 9:30 to plan his day. Call `report_plan` once, after the sources "
        "above, with:\n"
        "- `picks`: 2 to 6 of the issues below to do today, most important first. Weigh: a person waiting "
        "and the work is late; what today's meetings need (do the prep before the meeting); due today or "
        "soon; the client/dev balance (target: half client); urgent and high priority. Pick a follow-up "
        "only when its date has come; it's usually 5 minutes.\n"
        "  - `why`: one sentence, at most 25 words, saying why today, with the concrete reason: who asked "
        "and where, which meeting needs it, the date. Use what you read in Slack, email and meetings. "
        "Never a generic reason like \"it's important\".\n"
        "  - `minutes`: your estimate of how long it takes, 5 to 240.\n"
        "  Keep the total within his free time, with some slack.\n"
        "- `set_aside`: every **late** issue below that you didn't pick, each with a next step: `move` with "
        "`move_to` (a realistic new date), `ask` with `message` (a short, friendly note he could send to "
        "whoever owns it or blocks it, in his voice), or `clear_date` (no one is waiting on it). Add a "
        "one-sentence `why`.\n"
        "- `headline`: one line for the top of his plan, like \"About 5 h free around 3 meetings. Here's a "
        "plan for 3½ h.\"\n"
        f"- `recap`: one or two short sentences, about 30 words in all, on {prev_name}: how many issues he "
        "closed (client vs dev), what carried over, what slipped, and who still hasn't answered.\n"
        "- `summary`: two short sentences, about 35 words in all, the way a colleague would say it, about the "
        "shape of today: the meeting that matters, what to do before it, what to do after.\n"
        f"  In `recap` and `summary`: {ISSUE_REFS}\n"
        "You may open a Slack thread, email or Grain meeting to understand an issue (read-only). Planning "
        "never adds candidates.\n\n"
        f"{time_line}\n\nThis week so far: {balance}.{yesterday}\n\n"
        f"{prev_wrapup}\n\nClosed {prev_name}:\n{done_prev}\n\n"
        f"On today's list already (mostly carried over from {prev_name}):\n{listed}\n\n"
        f"Issues to consider:\n{issues}"
    )
