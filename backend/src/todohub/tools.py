"""The logic behind the todo-db MCP tools, kept free of MCP code so it can be tested directly.

Claude calls these during a sweep. Every input is checked here, because the text the
sweep reads (emails, Slack messages, transcripts) is untrusted.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from zoneinfo import ZoneInfo

from . import categories, mutes
from .db import DB, SOURCES, title_key
from .linear import matching_client_label

DUPLICATE_ADVICE = ("drop", "merge", "new")


def advise_duplicate(title: str, dup: str, dup_title: str | None) -> tuple[str, str]:
    """A fallback recommendation when the sweep didn't give one: nearly the same title means
    the same task (drop); otherwise it probably adds to the existing issue (merge)."""
    if dup_title and SequenceMatcher(None, title_key(title), title_key(dup_title)).ratio() >= 0.8:
        return "drop", f"Same task as {dup}."
    return "merge", f"Looks like more on {dup}; add it there."

MAX_TITLE = 200
MAX_REPLY = 1500
REPLY_SOURCES = ("slack", "gmail")          # where a drafted reply can be sent from
REPLY_SIGNALS = ("ask", "mention")
MAX_TEXT = 1000
MAX_LINKS = 10
MAX_SUBTASKS = 10
_URL_RE = re.compile(r"^https://[^\s<>\"]+$")
MISSING_URL_HELP = {
    "slack": "Use the message permalink from the search result, or open the thread with slack_read_thread to get it.",
    "grain": "Get the meeting link with the Grain resolve_urls tool. Never build a Grain URL by hand.",
    "calendar": "Use the event's htmlLink from the calendar tool.",
    "linear": "Use the comment link given with the mention in the prompt.",
    "github": "Use the pull request URL.",
    "hubspot": "Use the record link built from the search result's urlTemplate.",
}


TZ = ZoneInfo("America/New_York")
TASK_SIGNALS = ("ask", "commitment", "action_item", "deadline", "manual", "waiting_on", "meeting_prep",
                "review_request", "mention")


def today_local() -> date:
    return datetime.now(TZ).date()


def add_working_days(start: date, days: int) -> date:
    """``days`` working days after ``start``, skipping Saturdays and Sundays (not holidays)."""
    d = start
    while days > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            days -= 1
    return d


def gmail_url(account: str, message_id: str) -> str:
    """Gmail web link for a message, opened in the right account."""
    return f"https://mail.google.com/mail/u/{account}/#all/{message_id}"


def clean_links(raw: list | None, source_url: str | None, notes: list[str]) -> list[dict]:
    links: list[dict] = []
    seen = {source_url} if source_url else set()
    for item in raw or []:
        if not isinstance(item, dict):
            notes.append("a link was not an object with url and title; skipped")
            continue
        url = str(item.get("url") or "").strip()
        if not _URL_RE.match(url):
            notes.append(f"link {url[:80]!r} skipped: must be an https link")
            continue
        if url in seen:
            continue
        seen.add(url)
        title = _clip(str(item.get("title") or ""), MAX_TITLE) or url
        links.append({"url": url, "title": title})
    if len(links) > MAX_LINKS:
        notes.append(f"kept the first {MAX_LINKS} links")
    return links[:MAX_LINKS]


def clean_subtasks(raw: list | None, notes: list[str]) -> list[dict]:
    subtasks: list[dict] = []
    for item in raw or []:
        if isinstance(item, str):
            item = {"title": item}
        if not isinstance(item, dict):
            continue
        title = _clip(str(item.get("title") or ""), MAX_TITLE)
        if not title:
            continue
        due = (item.get("due_date") or "").strip() or None
        if due:
            try:
                date.fromisoformat(due)
            except ValueError:
                notes.append(f"subtask due_date {due!r} is not YYYY-MM-DD; left empty")
                due = None
        subtasks.append({"title": title, "due_date": due})
    if len(subtasks) > MAX_SUBTASKS:
        notes.append(f"kept the first {MAX_SUBTASKS} subtasks")
    return subtasks[:MAX_SUBTASKS]


class ToolError(ValueError):
    pass


def _clip(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value[:limit] if value else None


def _source(source: str) -> str:
    s = (source or "").strip().lower()
    if s not in SOURCES:
        raise ToolError(f"source must be one of {', '.join(SOURCES)}")
    return s


def is_seen(db: DB, source: str, source_id: str) -> dict:
    return {"seen": db.is_seen(_source(source), source_id.strip())}


def mark_seen(db: DB, source: str, source_id: str) -> dict:
    sid = (source_id or "").strip()
    if not sid:
        raise ToolError("source_id is required")
    db.mark_seen(_source(source), sid)
    return {"status": "marked"}


def add_candidate(
    db: DB,
    run_id: int | None,
    *,
    source: str,
    source_id: str,
    title: str,
    signal: str,
    why: str,
    excerpt: str,
    source_url: str | None = None,
    who: str | None = None,
    client_label: str | None = None,
    due_date: str | None = None,
    priority: int = 0,
    possible_duplicate: str | None = None,
    links: list | None = None,
    subtasks: list | None = None,
    gmail_account: str = "",
    asked_on: str | None = None,
    followup_days: int = 3,
    project: str | None = None,
    category: str | None = None,
    duplicate_advice: str | None = None,
    duplicate_reason: str | None = None,
    reply_draft: str | None = None,
    sender: str | None = None,
    channel: str | None = None,
) -> dict:
    notes: list[str] = []
    src = _source(source)
    sid = (source_id or "").strip()
    if not sid:
        raise ToolError("source_id is required")
    clean_title = _clip(title, MAX_TITLE)
    if not clean_title:
        raise ToolError("title is required")
    sig = (signal or "").strip().lower()
    if sig not in TASK_SIGNALS:
        raise ToolError(f"signal must be one of {', '.join(TASK_SIGNALS)}")
    kind = "waiting" if sig == "waiting_on" else "task"

    # Every candidate links back to where it came from.
    url = (source_url or "").strip() or None
    if url and not _URL_RE.match(url):
        url = None
        if src in MISSING_URL_HELP:
            raise ToolError(f"source_url must be an https link. {MISSING_URL_HELP[src]}")
    if not url and src == "manual":
        pass   # a typed note may have no link
    elif not url:
        if src == "gmail" and gmail_account:
            url = gmail_url(gmail_account, sid)
        elif src == "gmail":
            raise ToolError("source_url is required for email.")
        else:
            raise ToolError(f"source_url is required. {MISSING_URL_HELP[src]}")

    label = _clip(client_label, 80)
    new_label = None
    if label:
        known = db.get_meta("client_labels", [])
        found = matching_client_label(label, known)
        if found:
            if found.lower() != label.lower():
                notes.append(f"client_label {label!r} matched the label {found!r}")
            label = found
        elif known:
            notes.append(f"client_label {label!r} is not a label yet; proposed as a new client label")
            label, new_label = None, label
        else:  # labels never read from Linear (a new install, or no client label group)
            notes.append(f"client_label {label!r} left empty: no client labels are loaded")
            label = None

    proj = (project or "").strip() or None
    if proj:
        known_projects = {p.lower(): p for p in db.get_meta("projects", [])}
        if proj.lower() in known_projects:
            proj = known_projects[proj.lower()]
        else:
            notes.append(f"project {proj!r} is not an active Linear project; left empty")
            proj = None

    due = (due_date or "").strip() or None
    if due:
        try:
            date.fromisoformat(due)
        except ValueError:
            notes.append(f"due_date {due!r} is not YYYY-MM-DD; left empty")
            due = None

    if kind == "waiting" and not due:
        # Follow up after N working days with no reply, counted from when he asked.
        start = today_local()
        if asked_on:
            try:
                start = date.fromisoformat(asked_on.strip()[:10])
            except ValueError:
                notes.append(f"asked_on {asked_on!r} is not YYYY-MM-DD; counted from today")
        due = add_working_days(start, followup_days).isoformat()

    try:
        prio = int(priority)
    except (TypeError, ValueError):
        prio = 0
    if prio not in range(0, 5):
        notes.append("priority must be 0-4; set to 0")
        prio = 0

    clean_sender = _clip(sender, MAX_TITLE)
    clean_channel = _clip(channel, 80) if src == "slack" else None
    rule = mutes.matching_rule(db, {"source": src, "source_id": sid, "source_url": url,
                                    "sender": clean_sender, "channel": clean_channel})
    if rule:
        db.bump_mute(rule["id"])
        db.mark_seen(src, sid)
        return {"status": "muted", "notes": [f"Thibault muted {rule['label']}; not added. Skip anything else from it."]}

    dup = (possible_duplicate or "").strip().upper() or None
    if dup and dup not in set(db.get_meta("open_issue_identifiers", [])):
        notes.append(f"possible_duplicate {dup} is not one of your open issues; ignored")
        dup = None
    advice = reason = None
    if dup:
        advice = (duplicate_advice or "").strip().lower() or None
        reason = _clip(duplicate_reason, MAX_TITLE) or None
        if advice and advice not in DUPLICATE_ADVICE:
            notes.append("duplicate_advice must be drop, merge or new; worked out instead")
            advice = None
        if not advice:
            dup_title = next((i["title"] for i in db.get_meta("open_issues", []) if i["identifier"] == dup), None)
            advice, reason = advise_duplicate(clean_title, dup, dup_title)

    added, cid = db.add_candidate(
        run_id,
        source=src, source_id=sid, source_url=url, title=clean_title, signal=sig,
        why=_clip(why, MAX_TEXT), excerpt=_clip(excerpt, MAX_TEXT), who=_clip(who, MAX_TITLE),
        client_label=label, new_client_label=new_label, due_date=due, priority=prio, possible_duplicate=dup,
        links=clean_links(links, url, notes), subtasks=clean_subtasks(subtasks, notes), kind=kind,
        project=proj, duplicate_advice=advice, duplicate_reason=reason,
        sender=clean_sender, channel=clean_channel,
        reply_draft=_clip(reply_draft, MAX_REPLY) if src in REPLY_SOURCES and sig in REPLY_SIGNALS else None,
        category=categories.clean(category) or categories.categorize(clean_title, signal=sig, source=src),
    )
    result: dict = {"status": "added" if added else "already_in_queue"}
    if cid is not None:
        result["id"] = cid
    if notes:
        result["notes"] = notes
    return result


def _target(db: DB, target_issue: str) -> dict:
    ident = (target_issue or "").strip().upper()
    issue = next((i for i in db.get_meta("open_issues", []) if i["identifier"] == ident), None)
    if not issue:
        raise ToolError(f"{ident or 'target_issue'} is not one of Thibault's open issues listed in the prompt")
    return issue


def _source_link(src: str, sid: str, source_url: str | None, gmail_account: str) -> str:
    url = (source_url or "").strip()
    if _URL_RE.match(url):
        return url
    if src == "gmail" and gmail_account:
        return gmail_url(gmail_account, sid)
    raise ToolError(f"source_url is required. {MISSING_URL_HELP.get(src, '')}".strip())


def propose_close(db: DB, run_id: int | None, *, source: str, source_id: str, source_url: str | None,
                  target_issue: str, why: str, excerpt: str, gmail_account: str = "") -> dict:
    """The source shows an open issue is finished (or the reply you waited for came in)."""
    src = _source(source)
    issue = _target(db, target_issue)
    added, cid = db.add_candidate(
        run_id, source=src, source_id=source_id.strip(), source_url=_source_link(src, source_id, source_url, gmail_account),
        title=f"Close {issue['identifier']}: {issue['title']}"[:MAX_TITLE], signal="done",
        why=_clip(why, MAX_TEXT), excerpt=_clip(excerpt, MAX_TEXT), kind="close", target_issue=issue["identifier"],
    )
    return {"status": "added" if added else "already_in_queue", **({"id": cid} if cid else {})}


def propose_update(db: DB, run_id: int | None, *, source: str, source_id: str, source_url: str | None,
                   target_issue: str, comment: str, why: str, excerpt: str, gmail_account: str = "") -> dict:
    """New information about an open issue: proposed as a comment on it, not a new task."""
    src = _source(source)
    issue = _target(db, target_issue)
    body = _clip(comment, 2000)
    if not body:
        raise ToolError("comment is required: the update to post on the issue")
    added, cid = db.add_candidate(
        run_id, source=src, source_id=source_id.strip(), source_url=_source_link(src, source_id, source_url, gmail_account),
        title=f"Update {issue['identifier']}: {issue['title']}"[:MAX_TITLE], signal="update",
        why=_clip(why, MAX_TEXT), excerpt=_clip(excerpt, MAX_TEXT), kind="comment",
        target_issue=issue["identifier"], comment=body,
    )
    return {"status": "added" if added else "already_in_queue", **({"id": cid} if cid else {})}


_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_CAL_URL_RE = re.compile(r"^https://(www\.)?(calendar\.google\.com|meet\.google\.com)/\S+$")
_IDENT_RE = re.compile(r"[A-Z][A-Z0-9]*-\d+")
_LINK_RE = re.compile(r"\[([^\[\]\n]+)\]\(([^()\n]*)\)")


def clean_refs(text: str, known: set[str]) -> str:
    """Keep each issue ref ``[label](ENG-123)`` to one of his open issues; any other markdown link
    becomes its plain label."""
    def keep(m: re.Match) -> str:
        label, target = m.group(1).strip(), m.group(2).strip().upper()
        if _IDENT_RE.fullmatch(target) and (not known or target in known):
            return f"[{label}]({target})"
        return label
    return _LINK_RE.sub(keep, text)


def report_agenda(db: DB, run_id: int | None, *, day: str, events: list) -> dict:
    """Save a day's calendar (today's for the morning brief, the next working day's for the
    wrap-up): times, titles, links. Replaces that day's agenda; keeps the latest few days."""
    if run_id is None:
        raise ToolError("no active run")
    try:
        date.fromisoformat(day)
    except (TypeError, ValueError):
        raise ToolError("day must be YYYY-MM-DD")
    rows = []
    for e in (events or [])[:40]:
        start = str(e.get("start") or "").strip()
        if not _HHMM_RE.match(start):
            continue
        end = str(e.get("end") or "").strip()
        link = str(e.get("link") or "").strip()
        rows.append({
            "start": start, "end": end if _HHMM_RE.match(end) else None,
            "title": _clip(str(e.get("title") or ""), 120) or "(no title)",
            "link": link if _CAL_URL_RE.match(link) else None,
            "external": bool(e.get("external")),
        })
    rows.sort(key=lambda r: r["start"])
    agendas = dict(db.get_meta("agendas", {}) or {})
    agendas[day] = rows
    db.set_meta("agendas", {d: agendas[d] for d in sorted(agendas)[-4:]})
    return {"status": "recorded", "events": len(rows)}


PLAN_ACTIONS = ("move", "ask", "clear_date")
MAX_PICKS = 6


def report_plan(db: DB, run_id: int | None, *, day: str, headline: str, recap: str, summary: str, picks: list,
                set_aside: list | None = None) -> dict:
    """Save Claude's plan for a day: a recap of the last working day, picks with a reason and a
    time estimate, and a next step for each late issue left out. Only suggestions: the app shows
    them and Thibault decides."""
    if run_id is None:
        raise ToolError("no active run")
    try:
        when = date.fromisoformat(day)
    except (TypeError, ValueError):
        raise ToolError("day must be YYYY-MM-DD")
    known = set(db.get_meta("open_issue_identifiers", []) or [])

    def ident(x: object) -> str:
        v = str(x or "").strip().upper()
        if not _IDENT_RE.fullmatch(v):
            raise ToolError(f"{x!r} isn't an issue identifier like ENG-123")
        if known and v not in known:
            raise ToolError(f"{v} isn't one of his open issues")
        return v

    rows, seen = [], set()
    for p in (picks or []):
        i = ident(p.get("identifier"))
        if i in seen:
            continue
        seen.add(i)
        try:
            minutes = int(p.get("minutes") or 0)
        except (TypeError, ValueError):
            raise ToolError(f"{i}: minutes must be a number")
        rows.append({"identifier": i, "why": _clip(str(p.get("why") or ""), 300) or "",
                     "minutes": max(5, min(minutes or 30, 480))})
    if not rows:
        raise ToolError("picks needs at least one issue")
    if len(rows) > MAX_PICKS:
        raise ToolError(f"at most {MAX_PICKS} picks")

    aside = []
    for a in (set_aside or [])[:20]:
        i = ident(a.get("identifier"))
        if i in seen:
            continue
        seen.add(i)
        action = str(a.get("action") or "")
        if action not in PLAN_ACTIONS:
            raise ToolError(f"{i}: action must be one of {', '.join(PLAN_ACTIONS)}")
        row = {"identifier": i, "action": action, "why": _clip(str(a.get("why") or ""), 300) or ""}
        if action == "move":
            try:
                to = date.fromisoformat(str(a.get("move_to") or ""))
            except ValueError:
                raise ToolError(f"{i}: move needs move_to as YYYY-MM-DD")
            if to <= when:
                raise ToolError(f"{i}: move_to must be after {day}")
            row["move_to"] = to.isoformat()
        if action == "ask":
            msg = _clip(str(a.get("message") or ""), 600)
            if not msg:
                raise ToolError(f"{i}: ask needs a message")
            row["message"] = msg
        aside.append(row)

    plans = dict(db.get_meta("plans", {}) or {})
    plans[when.isoformat()] = {
        "day": when.isoformat(), "made_at": datetime.now(TZ).replace(microsecond=0).isoformat(), "run_id": run_id,
        "headline": _clip(str(headline or ""), 200) or "",
        "recap": clean_refs(_clip(str(recap or ""), 700) or "", known),
        "summary": clean_refs(_clip(str(summary or ""), 700) or "", known),
        "picks": rows, "set_aside": aside,
    }
    db.set_meta("plans", {d: plans[d] for d in sorted(plans)[-4:]})
    return {"status": "recorded", "picks": len(rows), "set_aside": len(aside)}


WRAPUP_ACTIONS = ("carry", "move", "ask", "close")
HEALTH = ("on_track", "at_risk", "off_track")


def _lines(value: object, most: int, limit: int = 300) -> list[str]:
    """A list of short non-empty lines, clipped."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise ToolError("expected a list of strings")
    out = [_clip(str(v).strip(), limit) or "" for v in value]
    return [v for v in out if v][:most]


def report_wrapup(db: DB, run_id: int | None, *, day: str, summary: str, items: list | None = None,
                  start_with: dict | None = None, notes: list | None = None, checkin: dict | None = None) -> dict:
    """Save Claude's wrap-up for a day: a short summary, a next step for each open item, what to
    start the next working day with, notes kept for the week, and the week's mission check-in
    draft. Only suggestions: the app shows them and Thibault decides."""
    if run_id is None:
        raise ToolError("no active run")
    try:
        when = date.fromisoformat(day)
    except (TypeError, ValueError):
        raise ToolError("day must be YYYY-MM-DD")
    known = set(db.get_meta("open_issue_identifiers", []) or [])

    def ident(x: object) -> str:
        v = str(x or "").strip().upper()
        if not _IDENT_RE.fullmatch(v):
            raise ToolError(f"{x!r} isn't an issue identifier like ENG-123")
        if known and v not in known:
            raise ToolError(f"{v} isn't one of his open issues")
        return v

    rows, seen = [], set()
    for it in (items or [])[:30]:
        i = ident(it.get("identifier"))
        if i in seen:
            continue
        seen.add(i)
        action = str(it.get("action") or "")
        if action not in WRAPUP_ACTIONS:
            raise ToolError(f"{i}: action must be one of {', '.join(WRAPUP_ACTIONS)}")
        row = {"identifier": i, "action": action, "why": _clip(str(it.get("why") or ""), 300) or ""}
        if action == "move":
            try:
                to = date.fromisoformat(str(it.get("move_to") or ""))
            except ValueError:
                raise ToolError(f"{i}: move needs move_to as YYYY-MM-DD")
            if to <= when:
                raise ToolError(f"{i}: move_to must be after {day}")
            row["move_to"] = to.isoformat()
        if action == "ask":
            msg = _clip(str(it.get("message") or ""), 600)
            if not msg:
                raise ToolError(f"{i}: ask needs a message")
            row["message"] = msg
        rows.append(row)

    first = None
    if start_with and start_with.get("identifier"):
        first = {"identifier": ident(start_with["identifier"]), "why": _clip(str(start_with.get("why") or ""), 300) or ""}

    c = checkin or {}
    if not isinstance(c, dict):
        raise ToolError("checkin must be an object")
    work = []
    for g in (c.get("work") or [])[:12]:
        lines = _lines(g.get("items"), 10)
        name = _clip(str(g.get("mission") or "").strip(), 120) or ""
        if name and lines:
            work.append({"mission": name, "items": lines})
    health = []
    for x in (c.get("health") or [])[:6]:
        status = str(x.get("status") or "")
        if status not in HEALTH:
            raise ToolError(f"health status must be one of {', '.join(HEALTH)}")
        health.append({"mission": _clip(str(x.get("mission") or ""), 120) or "", "status": status,
                       "why": _clip(str(x.get("why") or ""), 300) or ""})

    made = datetime.now(TZ).replace(microsecond=0).isoformat()
    wrapups = dict(db.get_meta("wrapups", {}) or {})
    wrapups[when.isoformat()] = {
        "day": when.isoformat(), "made_at": made, "run_id": run_id,
        "summary": clean_refs(_clip(str(summary or ""), 700) or "", known), "items": rows, "start_with": first,
        "notes": _lines(notes, 6),
    }
    db.set_meta("wrapups", {d: wrapups[d] for d in sorted(wrapups)[-10:]})

    week = (when - timedelta(days=when.weekday())).isoformat()
    checkins = dict(db.get_meta("checkins", {}) or {})
    checkins[week] = {
        "week": week, "through": when.isoformat(), "made_at": made, "run_id": run_id, "work": work,
        "next_week": _lines(c.get("next_week"), 10), "review": _lines(c.get("review"), 8), "health": health,
    }
    db.set_meta("checkins", {w: checkins[w] for w in sorted(checkins)[-4:]})
    return {"status": "recorded", "items": len(rows), "work_groups": len(work)}


def report_note(db: DB, run_id: int | None, *, day: str, headline: str, summary: str) -> dict:
    """Save Claude's midday note for a day: what to do next, and the rest of the day in short."""
    if run_id is None:
        raise ToolError("no active run")
    try:
        when = date.fromisoformat(day)
    except (TypeError, ValueError):
        raise ToolError("day must be YYYY-MM-DD")
    known = set(db.get_meta("open_issue_identifiers", []) or [])
    notes = dict(db.get_meta("notes", {}) or {})
    notes[when.isoformat()] = {
        "day": when.isoformat(), "made_at": datetime.now(TZ).replace(microsecond=0).isoformat(), "run_id": run_id,
        "headline": _clip(str(headline or ""), 200) or "",
        "summary": clean_refs(_clip(str(summary or ""), 700) or "", known),
    }
    db.set_meta("notes", {d: notes[d] for d in sorted(notes)[-4:]})
    return {"status": "recorded"}


def report_source_status(db: DB, run_id: int | None, *, source: str, ok: bool, detail: str,
                         items_scanned: int | None = None) -> dict:
    if run_id is None:
        raise ToolError("no active run")
    db.report_source_status(run_id, _source(source), bool(ok), _clip(detail, MAX_TEXT) or "", items_scanned)
    return {"status": "recorded"}
