"""todo-db: a local stdio MCP server the sweep uses to write candidate tasks to SQLite.

Started by Claude Code from the per-run MCP config that sweep.py writes. It reads
TODOHUB_HOME (where the database lives) and TODOHUB_RUN_ID (the sweep run) from env.
"""

from __future__ import annotations

import os
from typing import Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError as MCPToolError
from pydantic import BaseModel, Field

from . import tools
from .config import load_settings
from .db import DB

server = MCPServer(
    name="todo-db",
    instructions="Store candidate tasks found during a TodoHub sweep. Nothing here sends anything anywhere.",
)

_db: DB | None = None


class Link(BaseModel):
    url: str = Field(description="https URL of a document, file, PR, dashboard or page referenced in the source")
    title: str = Field(description="Short human name, e.g. 'Q1 review deck (Google Slides)' or 'api PR #812'")


class Subtask(BaseModel):
    title: str = Field(description="Short imperative step, e.g. 'Pull the new-customer list from BigQuery'")
    due_date: str | None = Field(default=None, description="YYYY-MM-DD, only when the source states one")


def _get_db() -> DB:
    global _db
    if _db is None:
        _db = DB(load_settings().db_path)
    return _db


def _call(fn, *args, **kwargs) -> dict:
    """Run a tool; a validation problem goes back to Claude as a readable error it can fix."""
    try:
        return fn(*args, **kwargs)
    except tools.ToolError as exc:
        raise MCPToolError(str(exc)) from exc


def _run_id() -> int | None:
    value = os.environ.get("TODOHUB_RUN_ID")
    return int(value) if value else None


@server.tool()
def is_seen(source: Literal["slack", "gmail", "grain", "calendar", "linear", "hubspot"], source_id: str) -> dict:
    """Check whether a message, email or meeting already produced a candidate task.

    Call this before reading an item in depth; skip items that return seen=true.
    """
    return _call(tools.is_seen, _get_db(), source, source_id)


@server.tool()
def mark_seen(source: Literal["slack", "gmail", "grain", "calendar", "linear", "hubspot"], source_id: str) -> dict:
    """Record that an item was fully read and holds no task, so later sweeps skip it.

    Don't call this for a Grain meeting whose notes or action items aren't ready yet.
    """
    return _call(tools.mark_seen, _get_db(), source, source_id)


@server.tool()
def add_candidate(
    source: Literal["slack", "gmail", "grain", "calendar", "linear", "hubspot"],
    source_id: str,
    title: str,
    signal: Literal["ask", "commitment", "action_item", "deadline", "waiting_on", "meeting_prep", "mention"],
    why: str,
    excerpt: str,
    source_url: str,
    links: list[Link] | None = None,
    subtasks: list[Subtask] | None = None,
    who: str | None = None,
    client_label: str | None = None,
    due_date: str | None = None,
    priority: int = 0,
    possible_duplicate: str | None = None,
    asked_on: str | None = None,
    project: str | None = None,
    category: Literal["code", "analysis", "model", "review", "meeting", "email", "writing", "admin"] | None = None,
    duplicate_advice: Literal["drop", "merge", "new"] | None = None,
    duplicate_reason: str | None = None,
    reply_draft: str | None = None,
    sender: str | None = None,
    channel: str | None = None,
) -> dict:
    """Add one candidate task to the user's review queue. He approves or drops it later.

    source_id: "<channel id>:<message ts>" for Slack, the Gmail message id, the Grain meeting id, or
        "ticket:<id>" or "note:<id>" for HubSpot.
    title: a short imperative task title, e.g. "Send Sam the Q1 review deck".
    signal: ask (someone asked him), commitment (he said he would), action_item (Grain), deadline,
        or waiting_on (HE asked someone else for something and is waiting for it; title it
        "Waiting on <person>: <what>", and set asked_on).
    why: one sentence on why this is a task for him.
    excerpt: the exact words from the source that show it (up to ~300 characters).
    source_url: REQUIRED https link back to the exact Slack message (permalink), email, Grain meeting
        (from resolve_urls) or HubSpot record (from the search result's urlTemplate). For email, pass ""
        and the link is built from source_id.
    links: every https link in the source that the task needs (docs, sheets, decks, files, PRs,
        dashboards, Linear issues), with a short title. Don't repeat source_url.
    subtasks: the distinct steps, only when the source spells them out (2 to 10). Omit otherwise.
    who: the person who asked, or the meeting's other participants.
    client_label: exactly one of the client label names given in the prompt, or omit.
    due_date: YYYY-MM-DD only when a date is stated or clearly implied.
    priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
    possible_duplicate: identifier of a similar open Linear issue from the prompt's list, e.g. ENG-123.
    duplicate_advice: with possible_duplicate only. drop = the open issue already covers this exact
        task; merge = same piece of work, but this adds something (a new ask, a date, a step, a link)
        worth adding to that issue; new = related but a separate deliverable, so it needs its own issue.
    sender: who sent it: the sender's email address for email, the person's Slack display name for
        Slack, the commenter's name for Linear, the note's author for HubSpot. Used for mute rules.
    channel: Slack only: the channel name, e.g. "#data-team", or "DM".
    reply_draft: Slack or email asks only: the reply the user could send now, in his voice. Answer it
        if the source has what's needed; otherwise acknowledge and say when he'll do it. Plain text,
        no subject line or greeting boilerplate, usually 1 to 4 sentences.
    duplicate_reason: with duplicate_advice: one short sentence saying why, e.g. "Same deck Sam asked
        for on Monday" or "New ask: the Q2 numbers, not Q1".
    asked_on: waiting_on only: YYYY-MM-DD date he asked; the follow-up date is counted from it.
    project: exactly one active Linear project name from the prompt's list, when one clearly fits.
    category: the kind of work: code (build/fix software), analysis (data, queries, audits, metrics),
        model (train/tune/score models), review (code or document review), meeting (prep or follow-up
        for a call), email (reply, send, follow up with someone), writing (docs, decks, reports), admin.
    """
    return _call(
        tools.add_candidate, _get_db(), _run_id(),
        source=source, source_id=source_id, title=title, signal=signal, why=why, excerpt=excerpt,
        source_url=source_url, who=who, client_label=client_label, due_date=due_date,
        priority=priority, possible_duplicate=possible_duplicate,
        links=[l.model_dump() for l in links or []],
        subtasks=[s.model_dump() for s in subtasks or []],
        gmail_account=load_settings().gmail_account, asked_on=asked_on,
        followup_days=load_settings().followup_days, project=project, category=category,
        duplicate_advice=duplicate_advice, duplicate_reason=duplicate_reason, reply_draft=reply_draft,
        sender=sender, channel=channel,
    )


@server.tool()
def propose_close(
    source: Literal["slack", "gmail", "grain", "linear", "hubspot"],
    source_id: str,
    source_url: str,
    target_issue: str,
    why: str,
    excerpt: str,
) -> dict:
    """Propose closing one of the user's open issues because the source shows it's finished.

    Use it when a later message shows the task was done (he sent the file, the PR merged,
    the client confirmed), or when the reply he was waiting on arrived.
    target_issue: identifier from the prompt's list of open issues, e.g. ENG-123.
    excerpt: the exact words that show it's done. source_url: link to that message ("" for email).
    """
    s = load_settings()
    return _call(
        tools.propose_close, _get_db(), _run_id(), source=source, source_id=source_id, source_url=source_url,
        target_issue=target_issue, why=why, excerpt=excerpt, gmail_account=s.gmail_account,
    )


@server.tool()
def propose_update(
    source: Literal["slack", "gmail", "grain", "linear", "hubspot"],
    source_id: str,
    source_url: str,
    target_issue: str,
    comment: str,
    why: str,
    excerpt: str,
) -> dict:
    """Propose a comment on one of the user's open issues, instead of a new task.

    Use it when a message adds information to something already tracked: a new date, a
    changed requirement, an answer, a file. comment: 1-4 sentences to post on the issue,
    written plainly as a status note. source_url: link to that message ("" for email).
    """
    s = load_settings()
    return _call(
        tools.propose_update, _get_db(), _run_id(), source=source, source_id=source_id, source_url=source_url,
        target_issue=target_issue, comment=comment, why=why, excerpt=excerpt, gmail_account=s.gmail_account,
    )


class AgendaEvent(BaseModel):
    start: str = Field(description="HH:MM, 24-hour, America/New_York")
    end: str | None = Field(default=None, description="HH:MM, 24-hour, America/New_York")
    title: str
    link: str | None = Field(default=None, description="the event's htmlLink")
    external: bool = Field(default=False, description="true when someone outside his email domain attends")


@server.tool()
def report_agenda(day: str, events: list[AgendaEvent]) -> dict:
    """Save one day's calendar: today's for the user's morning brief, the next working day's for
    his wrap-up. Call once per day, with every timed event he hasn't declined on that day (skip
    all-day events), in start order.

    day: YYYY-MM-DD (America/New_York).
    """
    return _call(tools.report_agenda, _get_db(), _run_id(), day=day, events=[e.model_dump() for e in events])


class PlanPick(BaseModel):
    identifier: str = Field(description="the issue identifier, e.g. ENG-123")
    why: str = Field(description="one sentence, at most 25 words: why today, with the concrete reason")
    minutes: int = Field(description="your estimate of the time it takes, 5 to 240")


class PlanAside(BaseModel):
    identifier: str = Field(description="a late issue you didn't pick")
    action: Literal["move", "ask", "clear_date"]
    why: str = Field(description="one sentence")
    move_to: str | None = Field(default=None, description="move only: the new due date, YYYY-MM-DD")
    message: str | None = Field(default=None, description="ask only: a short note he could send, in his voice")


@server.tool()
def report_plan(day: str, headline: str, recap: str, summary: str, picks: list[PlanPick],
                set_aside: list[PlanAside] | None = None) -> dict:
    """Save today's plan for the user: what to do today, most important first, each with why and
    how long; and a next step for each late issue you left out. Call once. These are suggestions
    he reviews; nothing is changed in Linear.

    day: YYYY-MM-DD (America/New_York).
    headline: one line, e.g. "About 5 h free around 3 meetings. Here's a plan for 3½ h."
    recap: one or two short sentences (about 30 words) on the last working day: what he closed,
        what carried over, what slipped, who still hasn't answered.
    summary: two short sentences (about 35 words) about the shape of today, as a colleague would say it.
    In recap and summary, mark each issue you name as [short label](ENG-123).
    """
    return _call(tools.report_plan, _get_db(), _run_id(), day=day, headline=headline, recap=recap,
                 summary=summary, picks=[p.model_dump() for p in picks],
                 set_aside=[a.model_dump() for a in set_aside or []])


class WrapupItem(BaseModel):
    identifier: str = Field(description="an issue under \"Still open\", e.g. ENG-123")
    action: Literal["carry", "move", "ask", "close"]
    why: str = Field(description="one sentence, at most 25 words, with the concrete reason")
    move_to: str | None = Field(default=None, description="move only: the new due date, YYYY-MM-DD")
    message: str | None = Field(default=None, description="ask only: a short note he could send, in his voice")


class StartWith(BaseModel):
    identifier: str = Field(description="the open issue to start the next working day with")
    why: str = Field(description="one sentence")


class CheckinGroup(BaseModel):
    mission: str = Field(description="a mission name exactly as listed, or \"Other\"")
    items: list[str] = Field(description="plain first-person accomplishments (releases, client results), each ending with the issue identifier in parentheses")


class CheckinHealth(BaseModel):
    mission: str = Field(description="a mission he leads, exactly as listed")
    status: Literal["on_track", "at_risk", "off_track"]
    why: str = Field(description="one sentence")


class Checkin(BaseModel):
    work: list[CheckinGroup] = Field(default_factory=list, description="accomplishments this week, by mission; no meetings or communication")
    next_week: list[str] = Field(default_factory=list, description="results he expects next week, plain lines with identifiers")
    review: list[str] = Field(default_factory=list, description="documents, decks or dashboards to look at, \"title: link\"; never a pull request")
    health: list[CheckinHealth] = Field(default_factory=list, description="one per mission he leads")


@server.tool()
def report_wrapup(day: str, summary: str, items: list[WrapupItem], start_with: StartWith | None = None,
                  notes: list[str] | None = None, checkin: Checkin | None = None) -> dict:
    """Save today's wrap-up for the user: a short summary, a next step for each issue still open on
    today's list, what to start the next working day with, notes on today's work kept for the
    week, and the week's mission check-in draft. Call once. These are suggestions he reviews;
    nothing is changed in Linear and nothing is sent.

    day: YYYY-MM-DD (America/New_York).
    summary: two or three short sentences (one idea each, under 15 words): what moved, what's stuck,
        how the next day starts, shown as one short paragraph. Mark each issue you name as
        [short label](ENG-123).
    """
    return _call(tools.report_wrapup, _get_db(), _run_id(), day=day, summary=summary,
                 items=[i.model_dump() for i in items], start_with=start_with.model_dump() if start_with else None,
                 notes=notes or [], checkin=checkin.model_dump() if checkin else None)


@server.tool()
def report_note(day: str, headline: str, summary: str) -> dict:
    """Save the user's midday note: a fresh look at the rest of his day. Call once. It's a
    suggestion he reads; nothing is changed in Linear and nothing is sent.

    day: YYYY-MM-DD (America/New_York).
    headline: one plain line on what to do next.
    summary: at most two short sentences (about 35 words): what's still open on today's list, the
        next meeting and what to do before it, who to nudge. Mark each issue you name as
        [short label](ENG-123).
    """
    return _call(tools.report_note, _get_db(), _run_id(), day=day, headline=headline, summary=summary)


@server.tool()
def report_source_status(
    source: Literal["slack", "gmail", "grain", "calendar", "linear", "hubspot"],
    ok: bool,
    detail: str,
    items_scanned: int | None = None,
) -> dict:
    """Record how scanning one source went. Call once per source, at the end of that source.

    ok=false when the source's tools failed (for example, a sign-in is needed); put the error in detail.
    """
    return _call(
        tools.report_source_status, _get_db(), _run_id(), source=source, ok=ok, detail=detail, items_scanned=items_scanned
    )


def main() -> None:
    server.run("stdio")


if __name__ == "__main__":
    main()
