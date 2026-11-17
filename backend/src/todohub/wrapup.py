"""The wrap-up: Claude looks back on the day and drafts the weekly mission check-in.

The 4 PM sweep of a working day also writes the wrap-up, using what it just read; "Redo" in the app
runs one on its own (``todohub sweep --wrapup``). Either way Claude only suggests: it saves the
wrap-up with the ``report_wrapup`` tool, and nothing is carried, re-dated, closed or sent until
Thibault clicks.

What Claude writes:
  - a short summary of the day (what moved, what's stuck, how the next day starts);
  - a next step for each open item on the day's list (Claude's picks, then the rest of Today):
    carry it to the next working day, move its due date, ask someone (a message to copy), or close
    it when what Claude read shows it's done;
  - the issue to start the next working day with (the next morning's plan sees it);
  - a few lines on what got done today, kept for the week;
  - the week's mission check-in draft (work by mission, next week, deliverables to review, health
    of the missions he leads), rebuilt each day from the week so far. He pastes it into the
    /mission-checkin skill, which posts his words as they are.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

import httpx

from .config import Settings, get_linear_key
from .db import DB
from .linear import Linear, LinearError, shape_issue
from . import plan, stats

log = logging.getLogger("todohub.wrapup")

WRAPUP_HOUR = 15            # the first sweep at or after 3 PM (the 4 PM one) writes the wrap-up, once
MAX_NEXT_WEEK = 15
MAX_CLOSED = 40


def next_working_day(d: date) -> date:
    d += timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def previous_working_day(d: date) -> date:
    d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def wrapup_due(db: DB, now: datetime | None = None) -> bool:
    """A working afternoon from 3 PM with no wrap-up saved for today yet."""
    local = (now or datetime.now(stats.TZ)).astimezone(stats.TZ)
    if local.weekday() >= 5 or local.hour < WRAPUP_HOUR:
        return False
    return local.date().isoformat() not in (db.get_meta("wrapups", {}) or {})


def start_with_yesterday(db: DB, today: date) -> dict | None:
    """What the last working day's wrap-up said to start today with: {identifier, why}, or None."""
    w = (db.get_meta("wrapups", {}) or {}).get(previous_working_day(today).isoformat()) or {}
    return w.get("start_with") or None


def gather(settings: Settings, db: DB, now: datetime | None = None) -> dict | None:
    """What the wrap-up prompt needs, read from Linear and the app. None when Linear can't be reached."""
    today = plan.today_local(now)
    week = stats.week_start(today)
    since = datetime(week.year, week.month, week.day, tzinfo=stats.TZ).astimezone(timezone.utc)
    try:
        client = Linear(get_linear_key())
        try:
            issues = [shape_issue(i, settings) for i in client.my_open_issues()]
            done = [shape_issue(i, settings) for i in client.my_completed_issues(since.replace(microsecond=0).isoformat())]
            try:
                slips = stats.due_slips(client.due_date_history(), settings.client_label_group)
            except LinearError as exc:
                log.warning("No due-date history for the wrap-up: %s", exc)
                slips = {}
            try:
                missions = client.initiative_projects(settings.missions_initiative) if settings.missions_initiative else []
            except (LinearError, KeyError, TypeError) as exc:
                log.warning("Couldn't read the missions initiative: %s", exc)
                missions = []
        finally:
            client.close()
    except (LinearError, RuntimeError, httpx.HTTPError) as exc:
        log.warning("Can't wrap up without Linear: %s", exc)
        return None

    done = [i for i in done if i.get("completed_at") and stats.local_date(i["completed_at"]) >= week]
    done.sort(key=lambda i: i["completed_at"])
    done_today = [i for i in done if stats.local_date(i["completed_at"]) == today]
    open_ = [i for i in issues if i["state"]["type"] not in ("completed", "canceled")]
    by_ident = {i["identifier"]: i for i in open_}
    by_id = {i["id"]: i for i in open_}

    day = today.isoformat()
    day_plan = (db.get_meta("plans", {}) or {}).get(day)
    why = {p["identifier"]: p.get("why", "") for p in (day_plan or {}).get("picks", [])}
    still_open, seen = [], set()
    for ident in why:
        if ident in by_ident and ident not in seen:
            seen.add(ident)
            still_open.append(by_ident[ident])
    for t in db.get_today(day):
        i = by_id.get(t["issue_id"])
        if i and i["identifier"] not in seen:
            seen.add(i["identifier"])
            still_open.append(i)

    # Next week: open issues due by next Friday, and work in progress, for "plan for next week".
    next_friday = week + timedelta(days=11)
    upcoming = [i for i in open_ if (i.get("due_date") and i["due_date"] <= next_friday.isoformat())
                or i["state"]["type"] == "started"]
    upcoming.sort(key=lambda i: (i.get("due_date") or "9999", i.get("priority") or 9))

    wrapups = db.get_meta("wrapups", {}) or {}
    notes = [(d, w.get("notes") or []) for d, w in sorted(wrapups.items())
             if week.isoformat() <= d < day and w.get("notes")]
    agendas = db.get_meta("agendas", {}) or {}
    nxt = next_working_day(today)
    return {
        "today": today, "next_day": nxt, "week": week, "plan": day_plan, "why": why,
        "still_open": still_open, "done_today": done_today, "done_week": done[-MAX_CLOSED:],
        "upcoming": upcoming[:MAX_NEXT_WEEK], "slips": slips, "waiting_state": settings.waiting_state,
        "agenda_today": agendas.get(day), "agenda_next": agendas.get(nxt.isoformat()),
        "missions": missions, "initiative": settings.missions_initiative, "notes": notes,
        "client_done": sum(1 for i in done if i["list"] == "client"), "done": len(done),
    }


def _tag(i: dict) -> str:
    bits = [f"client: {i['client']}" if i.get("client") else "dev"]
    if i.get("project"):
        bits.append(f"project: {i['project']}")
    return "[" + "; ".join(bits) + "]"


def _events(agenda: list[dict] | None) -> str:
    if agenda is None:
        return "  (not read yet)"
    return "\n".join(f"  - {e['start']}–{e.get('end') or '?'} {e['title']}" + (" (external)" if e.get("external") else "")
                     for e in agenda) or "  (no meetings)"


def section(ctx: dict) -> str:
    """The "wrap up the day" part of the prompt."""
    today: date = ctx["today"]
    nxt: date = ctx["next_day"]
    next_name = nxt.strftime("%A")
    friday = today.weekday() == 4

    rows = []
    for i in ctx["still_open"]:
        slip = ctx["slips"].get(i["id"])
        bits = [plan._due_note(i.get("due_date"), today), i["state"]["name"]]
        if i.get("priority") in plan.PRIORITY:
            bits.append(plan.PRIORITY[i["priority"]])
        if slip and slip["count"]:
            bits.append(f"due date pushed {slip['count']}×")
        if i["state"]["name"] == ctx["waiting_state"]:
            bits.append("a follow-up: he's waiting on someone")
        if ctx["why"].get(i["identifier"]):
            bits.append(f"this morning's reason: {ctx['why'][i['identifier']]}")
        rows.append(f"  - {i['identifier']} {_tag(i)} {i['title']} | " + " | ".join(bits))
    still_open = "\n".join(rows) or "  (nothing: everything on today's list is done)"

    p = ctx["plan"]
    plan_text = (f"This morning's plan: \"{p.get('headline', '')}\"\n"
                 + "\n".join(f"  - {x['identifier']}: {x.get('why', '')}" for x in p.get("picks", []))
                 if p else "No plan was made this morning.")
    done_today = "\n".join(f"  - {i['identifier']} {_tag(i)} {i['title']}" for i in ctx["done_today"]) or "  (none yet)"
    done_week = "\n".join(
        f"  - {i['identifier']} {_tag(i)} {i['title']} (closed {stats.local_date(i['completed_at']).strftime('%a')})"
        for i in ctx["done_week"]) or "  (none)"
    notes = "\n".join(f"  - {datetime.fromisoformat(d).strftime('%a')}: " + " / ".join(n) for d, n in ctx["notes"]) or "  (none)"
    upcoming = "\n".join(f"  - {i['identifier']} {_tag(i)} {i['title']} | {plan._due_note(i.get('due_date'), today)} | {i['state']['name']}"
                         for i in ctx["upcoming"]) or "  (none)"
    if ctx["missions"]:
        missions = "\n".join(f"  - {m['name']}" + (" (he leads it: give its health)" if m["mine"] else "")
                             + (f" [{m['status']}]" if m.get("status") else "") for m in ctx["missions"])
        missions_note = f"Missions (projects in the \"{ctx['initiative']}\" initiative):\n{missions}"
    else:
        missions_note = (f"The \"{ctx['initiative']}\" missions couldn't be read from Linear. Group the work by "
                         "each issue's project name, and leave `health` empty.")
    balance = (f"{ctx['client_done']} of the {ctx['done']} issues he closed this week were client work"
               if ctx["done"] else "he hasn't closed any issues yet this week")
    week_word = ("Today is the last working day of the week, so this is the draft he'll paste."
                 if friday else "The week isn't over: write it as the week so far; it's rebuilt each day.")

    return (
        f"### Wrap up the day ({today.strftime('%A %Y-%m-%d')})\n"
        "He closes his day in TodoHub late in the afternoon. Call `report_wrapup` once, after the sources "
        "above, with:\n"
        f"- `summary`: two or three short sentences, the way a colleague would say it: what moved today, "
        f"what's stuck and why, how {next_name} starts. One idea per sentence, under 15 words each; the app "
        f"shows it as one short paragraph under the day's score. {plan.ISSUE_REFS}\n"
        "- `items`: one for every issue under \"Still open\" below, each with `why` (one sentence, at most 25 "
        "words, with the concrete reason from what you read) and an `action`:\n"
        f"  - `carry`: it's still the right thing to do next; it goes on {next_name}'s Today list.\n"
        f"  - `move` with `move_to` (a realistic new due date after today) when it won't happen {next_name}.\n"
        "  - `ask` with `message` when someone else is blocking it: a short, friendly note in his voice.\n"
        "  - `close` when what you read shows it's already done (say what shows it: who said what, where). "
        "Only with real evidence.\n"
        f"- `start_with`: the one open issue to start {next_name} with, and `why` in one sentence. "
        f"{next_name}'s morning plan will see it.\n"
        "- `notes`: zero to three short first-person lines on what he accomplished today, each naming the "
        "issue identifier. Accomplishments only, as defined under `checkin`; leave it empty on a day without "
        "one. Kept for the week's check-in.\n"
        "- `checkin`: his weekly mission check-in draft, Monday to today, rebuilt from scratch. He pastes it "
        "into a check-in that posts his words exactly as written, and the main reader is the company's COO, who "
        "isn't technical. Write in his voice, first person, plain and short, no hype, nothing you can't back "
        "up, so that anyone at the company understands every line.\n"
        "  - What counts: real accomplishments only. **Releases**: code that shipped (merged and released, or "
        "live), described by what it does for clients or the team, not how it works. **Client results**: "
        "something a client received or a result they got (scores or a model delivered, an analysis handed "
        "over, a lift or match rate). Leave out meetings, calls, prep, emails and Slack replies, sharing a "
        "deck, reviewing someone else's work, internal admin, and work that only started.\n"
        "  - Plain language: no pull request numbers or links, no repository, branch, function, table or "
        "API names, no acronyms a salesperson wouldn't know. Say what changed and who it helps, e.g. "
        "\"Outcome reports now show how confident each score is, so clients can see which predictions to "
        "trust (ENG-8466)\" rather than \"Shipped calibration diagnostics\". Keep the Linear issue identifier "
        "in parentheses at the end of each line: the check-in uses it to file the line under the right "
        "mission.\n"
        "  - `work`: groups, one per mission (use the mission names below exactly; accomplishments that are "
        "in no mission go in one group named \"Other\"). Each group lists those lines. A mission with no "
        "accomplishment this week gets no group. Use the closed issues, the notes from earlier days and what "
        "you read.\n"
        "  - `next_week`: short plain lines with identifiers: the results he expects to deliver by next "
        "Friday (from what's open and due, or in flight), worded the same way.\n"
        "  - `review`: documents, decks or dashboards he finished this week that the reader should look at, "
        "each \"title: link\". Never a pull request or code link. Empty if none.\n"
        "  - `health`: for each mission he leads, `status` (on_track, at_risk or off_track) and `why` in one "
        "plain sentence. He confirms or changes it.\n"
        f"  {week_word}\n"
        "Don't write how his week went, help needed, highlights or shoutouts: he writes those himself.\n"
        "You may open a Slack thread, email or Grain meeting to check an item (read-only). Wrapping up never "
        "adds candidates.\n\n"
        f"{plan_text}\n\n"
        f"Done today:\n{done_today}\n\n"
        f"Still open (today's list):\n{still_open}\n\n"
        f"Today's meetings:\n{_events(ctx['agenda_today'])}\n\n"
        f"{next_name}'s meetings:\n{_events(ctx['agenda_next'])}\n\n"
        f"This week so far: {balance}.\n\n"
        f"Closed this week:\n{done_week}\n\n"
        f"Notes from earlier wrap-ups this week:\n{notes}\n\n"
        f"Open and due by next Friday, or in progress:\n{upcoming}\n\n"
        f"{missions_note}"
    )
