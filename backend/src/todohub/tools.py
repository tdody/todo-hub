"""The logic behind the todo-db MCP tools, kept free of MCP code so it can be tested directly.

Claude calls these during a sweep. Every input is checked here, because the text the
sweep reads (emails, Slack messages, transcripts) is untrusted.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from . import categories
from .db import DB, SOURCES

MAX_TITLE = 200
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

    label = (client_label or "").strip() or None
    if label:
        known = {l.lower(): l for l in db.get_meta("client_labels", [])}
        if label.lower() in known:
            label = known[label.lower()]
        else:
            notes.append(f"client_label {label!r} is not a known client label; left empty")
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

    dup = (possible_duplicate or "").strip().upper() or None
    if dup and dup not in set(db.get_meta("open_issue_identifiers", [])):
        notes.append(f"possible_duplicate {dup} is not one of your open issues; ignored")
        dup = None

    added, cid = db.add_candidate(
        run_id,
        source=src, source_id=sid, source_url=url, title=clean_title, signal=sig,
        why=_clip(why, MAX_TEXT), excerpt=_clip(excerpt, MAX_TEXT), who=_clip(who, MAX_TITLE),
        client_label=label, due_date=due, priority=prio, possible_duplicate=dup,
        links=clean_links(links, url, notes), subtasks=clean_subtasks(subtasks, notes), kind=kind,
        project=proj,
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


def report_source_status(db: DB, run_id: int | None, *, source: str, ok: bool, detail: str,
                         items_scanned: int | None = None) -> dict:
    if run_id is None:
        raise ToolError("no active run")
    db.report_source_status(run_id, _source(source), bool(ok), _clip(detail, MAX_TEXT) or "", items_scanned)
    return {"status": "recorded"}
