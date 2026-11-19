"""Local HTTP API the Tauri app talks to. Binds to 127.0.0.1 only.

When the app starts it generates a random token and passes it in TODOHUB_TOKEN; every
request must then carry it in the X-TodoHub-Token header.
"""

from __future__ import annotations

import argparse
import os
import secrets
import subprocess
import sys
import threading
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Literal

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from . import calendar_block, digest, gmail_draft, handled
from . import capture as capture_mod
from . import logos, mutes, pulls, schedule, stats, summary, tools
from .categories import categorize
from .config import (DEFAULT_PERISCOPE_PROMPT, SCHEDULE_DAYS, SCHEDULE_EVERY, SCHEDULE_FIRST, SCHEDULE_LAST,
                     SOURCE_FIELDS, Settings, get_linear_key, load_settings, read_overrides, source_state,
                     write_overrides)
from .db import DB
from .linear import Linear, LinearError, TeamMeta, client_labels_of, is_linear_upload, shape_issue
from .periscope import Periscope, PeriscopeError, bring_to_front
from .selfcmd import self_command
from .sources import SourceError
from .start import claude_name, default_repo, fill_prompt, remember_repo
from .sweep import _env, next_working_day
from .tools import ToolError

TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420"]
META_TTL_SECONDS = 600
PULLS_TTL_SECONDS = 300       # a read takes GitHub about 20 points and 5 to 8 seconds
SOURCE_NAMES = {"slack": "Slack message", "gmail": "Email", "grain": "Grain meeting", "calendar": "Calendar event",
                "hubspot": "HubSpot", "manual": "Link"}


class SubtaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    due_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class CandidateEdit(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    client_label: str | None = None
    due_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    priority: int | None = Field(default=None, ge=0, le=4)
    subtasks: list[SubtaskIn] | None = Field(default=None, max_length=10)
    comment: str | None = Field(default=None, min_length=1, max_length=4000)
    project: str | None = None
    category: Literal["code", "analysis", "model", "review", "meeting", "email", "writing", "admin"] | None = None
    reply_draft: str | None = Field(default=None, max_length=4000)


class MergeIn(CandidateEdit):
    """A merge: the card's edits (``comment`` is the text to post) and the issue fields to change."""
    move_due_date: bool = False      # set the issue's due date to the card's
    raise_priority: bool = False     # set the issue's priority to the card's


class MuteIn(BaseModel):
    kind: Literal["sender", "channel", "repo"]
    source: Literal["slack", "gmail", "grain", "calendar", "linear", "github", "hubspot", "manual"]
    value: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=1, max_length=200)
    drop_pending: bool = False        # also drop cards already in the Inbox that match


class CarryIn(BaseModel):
    issue_ids: list[str] = Field(max_length=30)


class ReplyDraftIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class TodayIn(BaseModel):
    issue_ids: list[str] = Field(max_length=30)


class SourceStateIn(BaseModel):
    state: Literal["on", "paused", "removed"]


class ScheduleIn(BaseModel):
    every: int
    start: int = Field(ge=SCHEDULE_FIRST, le=SCHEDULE_LAST)
    end: int = Field(ge=SCHEDULE_FIRST, le=SCHEDULE_LAST)
    days: Literal["weekdays", "every day"] = "weekdays"


class DaylightIn(BaseModel):
    place: str = Field(default="", max_length=80)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class PeriscopePromptIn(BaseModel):
    prompt: str = Field(max_length=8000)       # empty: back to the default


class PeriscopeStartIn(BaseModel):
    repo: str = Field(min_length=1, max_length=500)       # a repo path from periscope's catalog
    branch: str = Field(min_length=1, max_length=250)
    prompt: str = Field(min_length=1, max_length=8000)


class PeriscopeShowIn(BaseModel):
    pid: str = Field(min_length=1, max_length=100)


# The Settings page's sources, in the order it lists them: key, name, what it reads, how.
SOURCE_INFO = [
    ("slack", "Slack", "Direct asks and mentions", "claude.ai connector"),
    ("gmail", "Email", "Someone asking you for something", "Gmail · claude.ai connector"),
    ("grain", "Grain", "Meeting action items", "claude.ai connector"),
    ("calendar", "Calendar", "Meetings and free time", "Google Calendar · claude.ai connector"),
    ("hubspot", "HubSpot", "Tickets and notes waiting on you", "claude.ai connector"),
    ("linear", "Linear mentions", "Where someone @-mentions you", "Linear API"),
    ("github", "GitHub reviews", "PRs waiting on your review", "gh command"),
]


class BlockIn(BaseModel):
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")    # HH:MM today, America/New_York
    minutes: int = Field(ge=15, le=240)


class RunIn(BaseModel):
    source: str | None = None


class SnoozeIn(BaseModel):
    until: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")   # None un-snoozes


class DropIn(BaseModel):
    reason: Literal["not_mine", "already_done", "noise", "duplicate", "other"] = "other"


class CaptureIn(BaseModel):
    text: str = Field(max_length=4000)


class IssueEdit(BaseModel):
    state_id: str | None = None
    priority: int | None = Field(default=None, ge=0, le=4)
    due_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    title: str | None = Field(default=None, max_length=200)
    description: str | None = None      # Markdown; empty or null clears it
    client: str | None = None           # a client label's name; null makes it a Dev issue
    project: str | None = None          # an open project's name; null takes it out of its project


class RestoreIn(BaseModel):
    today_position: int | None = Field(default=None, ge=0)


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class SubIssueIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


PREVIEW_DESCRIPTION = 6000   # characters of an issue's description in the reading pane
PREVIEW_COMMENT = 1500       # characters of each of the latest three comments
IMAGE_CACHE = 40             # Linear images kept in memory for the reading pane


def _md(text: str) -> str:
    """Keep a link title from breaking the markdown link around it."""
    return text.replace("[", "(").replace("]", ")")


def issue_description(c: dict) -> str:
    lines: list[str] = []
    if c.get("why"):
        lines += [c["why"], ""]
    if c.get("excerpt"):
        lines += ["> " + line for line in c["excerpt"].splitlines()] + [""]
    source = SOURCE_NAMES.get(c["source"], c["source"])
    link = f"[{source}]({c['source_url']})" if c.get("source_url") else source
    who = f" · {c['who']}" if c.get("who") else ""
    lines.append(f"**Source:** {link}{who}")
    lines.append("")
    if c.get("links"):
        lines.append("**Links**")
        lines += [f"- [{_md(l['title'])}]({l['url']})" for l in c["links"]]
        lines.append("")
    lines.append(f"_Captured by TodoHub ({c['signal'].replace('_', ' ')}) on {c['created_at'][:10]}._")
    return "\n".join(lines)


def create_app(settings: Settings | None = None, db: DB | None = None,
               linear_factory: Callable[[], Linear] | None = None,
               sweep_launcher: Callable[[list[str]], None] | None = None,
               block_fn: Callable[..., str | None] | None = None,
               draft_fn: Callable[[str, str], str | None] | None = None,
               periscope_factory: Callable[[], Periscope] | None = None,
               front_fn: Callable[[str], None] | None = None,
               name_fn: Callable[[dict], str] | None = None,
               scheduler=schedule) -> FastAPI:
    settings = settings or load_settings()
    db = db or DB(settings.db_path)
    db.release()     # approvals interrupted by a crash go back to the Inbox
    linear_factory = linear_factory or (lambda: Linear(get_linear_key()))
    periscope_factory = periscope_factory or (lambda: Periscope(settings.periscope_url))
    front = front_fn or bring_to_front
    name_claude = name_fn or (lambda issue: claude_name(settings, issue))
    token = os.environ.get("TODOHUB_TOKEN")

    def default_launcher(args: list[str]) -> None:
        """Start a sweep or capture in the background; it outlives this request."""
        subprocess.Popen(
            [*self_command("sweep"), *args],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
        )

    launch = sweep_launcher or default_launcher
    block = block_fn or (lambda **kw: calendar_block.block_time(settings, **kw))
    app = FastAPI(title="TodoHub", docs_url=None, redoc_url=None)

    # An unexpected error would otherwise come back as a bare 500 from the outermost layer,
    # without the CORS headers, and the app's web view would only say "Load failed". Catch it
    # here, inside CORS, so the app shows what went wrong; the traceback goes to api.log.
    @app.middleware("http")
    async def unexpected_errors(request: Request, call_next):
        try:
            return await call_next(request)
        except Exception as exc:  # noqa: BLE001 - reported to the app, logged in full
            traceback.print_exc()
            return JSONResponse({"error": f"{request.url.path} failed: {type(exc).__name__}: {exc}"}, status_code=500)

    app.add_middleware(
        CORSMiddleware, allow_origins=TAURI_ORIGINS, allow_methods=["*"], allow_headers=["*"],
    )

    cache: dict = {"meta": None, "at": 0.0}
    lock = threading.Lock()

    def check_token(request: Request) -> None:
        # Only loopback names: blocks DNS-rebinding pages that point a hostname at 127.0.0.1.
        host = (request.headers.get("host") or "").rsplit(":", 1)[0].strip("[]")
        if host not in ("127.0.0.1", "localhost", "testserver", "::1"):
            raise HTTPException(403, "Bad Host header")
        if token and not secrets.compare_digest(request.headers.get("x-todohub-token", ""), token):
            raise HTTPException(401, "Bad or missing token")

    def linear_call(fn: Callable[[Linear], object]):
        client = linear_factory()
        try:
            return fn(client)
        except LinearError as exc:
            raise HTTPException(502, str(exc))
        except RuntimeError as exc:   # missing API key
            raise HTTPException(503, str(exc))
        finally:
            client.close()

    def periscope_call(fn: Callable[[Periscope], object]):
        client = periscope_factory()
        try:
            return fn(client)
        except PeriscopeError as exc:
            raise HTTPException(exc.status, str(exc))
        finally:
            client.close()

    def add_session_comment(issue: dict, email: str | None, session_id: str) -> list[str]:
        """Record a new Claude session on the issue. A comment that Linear refuses is a warning, not an error:
        Claude already runs."""
        comment = (f"- Started: {datetime.now(stats.TZ).replace(microsecond=0).isoformat()}\n"
                   f"- Claude account: {email or 'unknown'}\n"
                   f"- Claude session: `{session_id}`")
        client = linear_factory()
        try:
            client.create_comment(issue["id"], comment)
        except LinearError as exc:
            return [f"The Claude session was not added to {issue['identifier']}: {exc}"]
        finally:
            client.close()
        return []

    def team_meta(refresh: bool = False) -> TeamMeta:
        with lock:
            if refresh or cache["meta"] is None or time.time() - cache["at"] > META_TTL_SECONDS:
                cache["meta"] = linear_call(lambda l: l.team_meta(settings.team_key, settings.client_label_group))
                cache["at"] = time.time()
                db.set_meta("client_labels", [l["name"] for l in cache["meta"].client_labels])
                db.set_meta("projects", [p["name"] for p in cache["meta"].projects])
            return cache["meta"]

    def id_by_name(items: list[dict], name: str | None, what: str) -> str | None:
        """The id of the client label or project called ``name`` (None for none); a 400 if Linear has none."""
        if name is None:
            return None
        found = next((x for x in items if x["name"] == name), None)
        if not found:
            raise HTTPException(400, f"No {what} {name!r} in Linear")
        return found["id"]

    def todo_status(states: list[dict]) -> dict | None:
        """The status a new or reopened sub-issue gets: the one named ``todo_state``, else the team's first
        not-started one."""
        return next((s for s in states if s["name"] == settings.todo_state), None) or \
            next((s for s in states if s["type"] == "unstarted"), None)

    def done_status(states: list[dict]) -> dict | None:
        """The status closing an issue moves it to: the completed one named ``done_state``, else the team's first
        completed one."""
        completed = [s for s in states if s["type"] == "completed"]
        return next((s for s in completed if s["name"] == settings.done_state), None) or next(iter(completed), None)

    def sub_issue_team(l: Linear, m: TeamMeta, parent: dict) -> tuple[str, str]:
        """The team a sub-issue of ``parent`` goes in (the parent's, so its project fits) and the id of its Todo
        status there (todo_status). Raises LinearError when that team has no not-started status."""
        team_id = (parent.get("team") or {}).get("id") or m.team_id
        todo = todo_status(m.states if team_id == m.team_id else l.team_states(team_id))
        if not todo:
            raise LinearError("the parent's team has no not-started status")
        return team_id, todo["id"]

    def create_sub_issue(l: Linear, m: TeamMeta, parent: dict, title: str, *, team_id: str, state_id: str,
                         label_ids: list[str], priority: int, due_date: str | None = None) -> dict:
        """A sub-issue under ``parent``, an issue already in Linear: in ``team_id`` and ``state_id`` (from
        sub_issue_team) and the parent's project, assigned to you."""
        return l.create_issue(
            team_id=team_id, title=title, description=f"Part of {parent['identifier']}: {parent['title']}",
            assignee_id=m.viewer_id, state_id=state_id, priority=priority, due_date=due_date,
            label_ids=label_ids, parent_id=parent["id"], project_id=(parent.get("project") or {}).get("id"),
        )

    def candidate_or_404(cid: int) -> dict:
        c = db.get_candidate(cid)
        if not c:
            raise HTTPException(404, "No such candidate")
        return c

    auth = [Depends(check_token)]

    def today_str() -> str:
        return datetime.now(stats.TZ).date().isoformat()

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    @app.get("/api/meta", dependencies=auth)
    def meta(refresh: bool = False) -> dict:
        m = team_meta(refresh)
        return {
            "team_key": settings.team_key,
            "states": m.states,
            "client_labels": [l["name"] for l in m.client_labels],
            "projects": [p["name"] for p in m.projects],
            "priorities": [
                {"value": 0, "name": "No priority"}, {"value": 1, "name": "Urgent"},
                {"value": 2, "name": "High"}, {"value": 3, "name": "Medium"}, {"value": 4, "name": "Low"},
            ],
            "sources": settings.enabled_sources(),
            "todo_state": (todo_status(m.states) or {}).get("name"),
            "done_state": (done_status(m.states) or {}).get("name"),
            "periscope": settings.periscope_on,
        }

    @app.get("/api/daylight", dependencies=auth)
    def daylight() -> dict:
        """Where the Daylight theme works out sunset: config.toml's daylight_latitude/longitude,
        or null to use the Mac's time zone (the app does that part)."""
        lat, lon = settings.daylight_latitude, settings.daylight_longitude
        if lat is None or lon is None:
            return {"location": None}
        return {"location": {"lat": lat, "lon": lon,
                             "place": settings.daylight_place or f"{lat:.2f}, {lon:.2f}"}}

    # ---- Settings page ----------------------------------------------------------------
    # Its choices go to settings.json in the TodoHub folder (config.toml stays as you wrote it) and
    # apply at once: this process reloads them, and each sweep reads them when it starts.
    def reload_settings() -> None:
        settings.__dict__.update(load_settings().__dict__)

    def save_override(section: str, value) -> None:
        data = read_overrides()
        if isinstance(value, dict) and isinstance(data.get(section), dict) and section == "sources":
            data[section] = {**data[section], **value}
        else:
            data[section] = value
        write_overrides(data)
        reload_settings()

    def settings_body() -> dict:
        status = {o["source"]: o for o in db.source_overview([k for k, *_ in SOURCE_INFO])}
        return {
            "sources": [{"key": k, "name": name, "reads": reads, "via": via, "state": source_state(settings, k),
                         "status": status.get(k)} for k, name, reads, via in SOURCE_INFO],
            "schedule": schedule.describe(settings, scheduler.installed()) | {"supported": scheduler.supported()},
            "daylight": {"place": settings.daylight_place, "latitude": settings.daylight_latitude,
                         "longitude": settings.daylight_longitude},
            "periscope": {"enabled": settings.periscope_on, "prompt": settings.periscope_prompt,
                          "default_prompt": DEFAULT_PERISCOPE_PROMPT},
        }

    @app.get("/api/settings", dependencies=auth)
    def get_settings() -> dict:
        return settings_body()

    @app.put("/api/settings/sources/{key}", dependencies=auth)
    def set_source(key: str, body: SourceStateIn) -> dict:
        if key not in SOURCE_FIELDS:
            raise HTTPException(404, f"No source called {key}")
        save_override("sources", {key: body.state})
        return settings_body()

    @app.put("/api/settings/schedule", dependencies=auth)
    def set_schedule(body: ScheduleIn) -> dict:
        """Save the hours and, when the schedule is installed, reload it so they apply now."""
        if body.every not in SCHEDULE_EVERY:
            raise HTTPException(400, f"every must be one of {', '.join(map(str, SCHEDULE_EVERY))} hours")
        if body.end < body.start:
            raise HTTPException(400, "The last sweep can't be before the first")
        if body.days not in SCHEDULE_DAYS:
            raise HTTPException(400, "days must be weekdays or every day")
        save_override("schedule", body.model_dump())
        if scheduler.installed():
            try:
                scheduler.install(settings)
            except schedule.ScheduleError as exc:
                raise HTTPException(502, f"Saved, but the Mac schedule wasn't updated: {exc}")
        return settings_body()

    @app.post("/api/settings/schedule/install", dependencies=auth)
    def install_schedule() -> dict:
        try:
            scheduler.install(settings)
        except schedule.ScheduleError as exc:
            raise HTTPException(502, str(exc))
        return settings_body()

    @app.put("/api/settings/daylight", dependencies=auth)
    def set_daylight(body: DaylightIn) -> dict:
        """Where Daylight follows the sun. Without both coordinates it uses the Mac's time zone."""
        if (body.latitude is None) != (body.longitude is None):
            raise HTTPException(400, "Give both latitude and longitude, or neither")
        save_override("daylight", body.model_dump())
        return settings_body()

    @app.put("/api/settings/periscope", dependencies=auth)
    def set_periscope(body: PeriscopePromptIn) -> dict:
        """The prompt Start in periscope sends; an empty one goes back to the default."""
        save_override("periscope", {"prompt": body.prompt.strip()})
        return settings_body()

    # ---- review queue -----------------------------------------------------------------
    @app.get("/api/candidates", dependencies=auth)
    def candidates(status: str = "pending") -> list[dict]:
        if status not in ("pending", "snoozed", "approved", "dropped"):
            raise HTTPException(400, "status must be pending, snoozed, approved or dropped")
        rows = db.list_candidates(status, today=today_str())
        open_titles = {i["identifier"]: i["title"] for i in db.get_meta("open_issues", [])}
        for c in rows:
            if not c.get("category"):       # candidates from before task types existed
                c["category"] = categorize(c["title"], signal=c["signal"], source=c["source"])
            c["mute_keys"] = mutes.keys(c)
            if c.get("possible_duplicate") and not c.get("duplicate_advice"):   # from before advice existed
                c["duplicate_advice"], c["duplicate_reason"] = tools.advise_duplicate(
                    c["title"], c["possible_duplicate"], open_titles.get(c["possible_duplicate"]))
        return rows

    @app.post("/api/candidates/recheck", dependencies=auth)
    def recheck_handled() -> dict:
        """Compare pending candidates with my open and recently closed issues now (the sweep does
        this too). Returns how many look handled in Linear already."""
        since = (datetime.now(timezone.utc) - timedelta(days=handled.CLOSED_LOOKBACK_DAYS)).replace(microsecond=0).isoformat()
        group = settings.client_label_group
        def fetch(l: Linear) -> tuple[list[dict], list[dict]]:
            return ([handled.slim(i, group) for i in l.my_open_issues()],
                    [handled.slim(i, group) for i in l.my_closed_issues(since)])
        open_issues, closed = linear_call(fetch)
        return {"flagged": handled.recheck(db, open_issues, closed)}

    @app.post("/api/candidates/{cid}/keep", dependencies=auth)
    def keep_candidate(cid: int) -> dict:
        """Not handled after all: clear the flag and don't match it to that issue again."""
        handled.keep(db, candidate_or_404(cid))
        return candidate_or_404(cid)

    @app.post("/api/candidates/{cid}/snooze", dependencies=auth)
    def snooze(cid: int, body: SnoozeIn) -> dict:
        c = candidate_or_404(cid)
        if c["status"] != "pending":
            raise HTTPException(409, f"Already {c['status']}")
        if body.until and body.until <= today_str():
            raise HTTPException(400, "Pick a date after today")
        return db.snooze(cid, body.until)

    @app.patch("/api/candidates/{cid}", dependencies=auth)
    def edit_candidate(cid: int, edit: CandidateEdit) -> dict:
        candidate_or_404(cid)
        changes = edit.model_dump(include=edit.model_fields_set)
        if changes.get("client_label"):
            if changes["client_label"] not in db.get_meta("client_labels", []):
                raise HTTPException(400, f"Unknown client label {changes['client_label']!r}")
        if changes.get("project"):
            if changes["project"] not in db.get_meta("projects", []):
                raise HTTPException(400, f"Unknown project {changes['project']!r}")
        return db.update_candidate(cid, **changes)

    def source_line(c: dict) -> str:
        source = SOURCE_NAMES.get(c["source"], c["source"])
        return f"**Source:** [{source}]({c['source_url']})" if c.get("source_url") else f"**Source:** {source}"

    def act_on_issue(c: dict, m: TeamMeta) -> dict:
        """Approve a "close this issue" or "post this update" candidate."""
        warnings: list[str] = []
        undo: dict = {"comments": []}

        def run(l: Linear) -> dict:
            target = l.get_issue(c["target_issue"])
            undo["issue"] = target["id"]
            if c["kind"] == "close":
                team_id = (target.get("team") or {}).get("id")
                states = m.states if team_id in (None, m.team_id) else l.team_states(team_id)
                done = done_status(states)
                if not done:
                    raise LinearError(f"{c['target_issue']}'s team has no completed status")
                closed = l.update_issue(target["id"], {"stateId": done["id"]})
                undo["restore"] = {"stateId": target["state"]["id"]}
                quote = "\n".join("> " + line for line in (c.get("excerpt") or "").splitlines())
                try:
                    undo["comments"].append(l.create_comment(target["id"], "\n\n".join(
                        part for part in (f"Closed from TodoHub: {c.get('why') or 'done'}", quote, source_line(c)) if part)))
                except LinearError as exc:
                    warnings.append(f"Closed, but the comment wasn't added: {exc}")
                return closed
            undo["comments"].append(l.create_comment(target["id"], f"{c['comment']}\n\n{source_line(c)}"))
            return target

        issue = linear_call(run)
        updated = db.decide(c["id"], "approved", issue["identifier"], issue["url"])
        undo["comments"] = [x for x in undo["comments"] if x]
        db.set_undo(c["id"], undo)
        return {"candidate": updated, "issue": shape_issue(issue, settings),
                "subtasks": [], "warnings": warnings}

    @app.post("/api/candidates/{cid}/approve", dependencies=auth)
    def approve(cid: int, edit: CandidateEdit | None = None) -> dict:
        c = candidate_or_404(cid)
        if c["status"] != "pending":
            raise HTTPException(409, f"Already {c['status']}")
        if edit and edit.model_fields_set:
            c = edit_candidate(cid, edit)
        # A priority picked in the card wins, even "No priority" (0).
        chosen_priority = edit.priority if edit and "priority" in edit.model_fields_set else None
        if not db.claim(cid):
            raise HTTPException(409, "Already being approved")
        try:
            return approve_claimed(c, chosen_priority)
        finally:
            db.release(cid)      # no-op once the candidate is marked approved

    def approve_claimed(c: dict, chosen_priority: int | None) -> dict:
        cid = c["id"]
        m = team_meta()
        if c["kind"] in ("close", "comment"):
            return act_on_issue(c, m)

        state_name = settings.waiting_state if c["kind"] == "waiting" else settings.todo_state
        state = next((s for s in m.states if s["name"] == state_name), None)
        if not state:
            raise HTTPException(500, f"Team {settings.team_key} has no {state_name!r} status")
        label_ids = [l["id"] for l in m.client_labels if l["name"] == c["client_label"]]
        project_id = next((p["id"] for p in m.projects if p["name"] == c.get("project")), None)
        priority = chosen_priority if chosen_priority is not None else (c["priority"] or settings.default_priority)
        issue = linear_call(lambda l: l.create_issue(
            team_id=m.team_id, title=c["title"], description=issue_description(c),
            assignee_id=m.viewer_id, state_id=state["id"], priority=priority,
            due_date=c["due_date"], label_ids=label_ids, project_id=project_id,
        ))
        # The parent issue exists now, so mark the candidate approved before the extras:
        # a failure below must not lead to a second issue on retry.
        updated = db.decide(cid, "approved", issue["identifier"], issue["url"])
        undo = {"issues": [issue["id"]]}     # newest last; undo deletes them in reverse
        db.set_undo(cid, undo)
        warnings: list[str] = []
        created: list[dict] = []

        client = linear_factory()
        try:
            source = SOURCE_NAMES.get(c["source"], c["source"])
            links = ([{"url": c["source_url"], "title": source}] if c.get("source_url") else []) + c["links"]
            for link in links:
                try:
                    client.add_link(issue["id"], link["url"], link["title"])
                except LinearError as exc:
                    warnings.append(f"Link not attached ({link['title']}): {exc}")
            for sub in c["subtasks"]:
                try:
                    child = client.create_issue(
                        team_id=m.team_id, title=sub["title"],
                        description=f"Part of {issue['identifier']}: {c['title']}",
                        assignee_id=m.viewer_id, state_id=state["id"], priority=priority,
                        due_date=sub.get("due_date"), label_ids=label_ids, parent_id=issue["id"],
                        project_id=project_id,
                    )
                    created.append(shape_issue(child, settings))
                    undo["issues"].append(child["id"])
                    db.set_undo(cid, undo)
                except LinearError as exc:
                    warnings.append(f"Subtask not created ({sub['title']}): {exc}")
        finally:
            client.close()

        return {
            "candidate": updated,
            "issue": shape_issue(issue, settings),
            "subtasks": created,
            "warnings": warnings,
        }

    @app.post("/api/candidates/{cid}/merge", dependencies=auth)
    def merge(cid: int, body: MergeIn | None = None) -> dict:
        """Add a candidate to the open issue it is linked to, instead of making a new issue: the
        comment, its links, its subtasks as sub-issues and, when asked, its due date and priority."""
        c = candidate_or_404(cid)
        if c["status"] != "pending":
            raise HTTPException(409, f"Already {c['status']}")
        if c["kind"] not in ("task", "waiting") or not c.get("possible_duplicate"):
            raise HTTPException(400, "Only a task linked to an open issue can be merged")
        body = body or MergeIn()
        if body.model_fields_set:
            c = edit_candidate(cid, body)
        if not c.get("comment"):
            raise HTTPException(400, "A merge needs a comment")
        if not db.claim(cid):
            raise HTTPException(409, "Already being approved")
        try:
            return merge_claimed(c, body)
        finally:
            db.release(cid)

    def merge_claimed(c: dict, body: MergeIn) -> dict:
        cid = c["id"]
        m = team_meta()
        warnings: list[str] = []
        created: list[dict] = []
        try:
            client = linear_factory()
        except RuntimeError as exc:      # missing API key
            raise HTTPException(503, str(exc))
        try:
            try:
                target = client.get_issue(c["possible_duplicate"])
                comment_id = client.create_comment(
                    target["id"], f"{c['comment']}\n\n{source_line(c)}\n\n_Merged from TodoHub._")
            except LinearError as exc:
                raise HTTPException(502, str(exc))
            # The comment is in, so the candidate counts as handled; the rest is best effort.
            updated = db.decide(cid, "approved", target["identifier"], target["url"])
            undo: dict = {"issue": target["id"], "comments": [comment_id] if comment_id else [],
                          "attachments": [], "issues": []}
            db.set_undo(cid, undo)

            # The app's copy of the issue can be old: change a field only if the card's value is still
            # sooner (due date) or higher (priority: a smaller number, 0 is none) than the issue's now.
            changes = {}
            if (body.move_due_date and c["due_date"]
                    and (not target.get("dueDate") or c["due_date"] < target["dueDate"])):
                changes["dueDate"] = c["due_date"]
            if (body.raise_priority and c["priority"]
                    and (not target.get("priority") or c["priority"] < target["priority"])):
                changes["priority"] = c["priority"]
            if changes:
                undo["restore"] = {field: target.get(field) for field in changes}
                db.set_undo(cid, undo)
                try:
                    target = client.update_issue(target["id"], changes)
                except LinearError as exc:
                    undo.pop("restore")
                    db.set_undo(cid, undo)
                    what = " and ".join(name for field, name in (("dueDate", "due date"), ("priority", "priority"))
                                        if field in changes)
                    warnings.append(f"{target['identifier']}'s {what} {'were' if len(changes) > 1 else 'was'} "
                                    f"not changed: {exc}")

            source = SOURCE_NAMES.get(c["source"], c["source"])
            links = ([{"url": c["source_url"], "title": source}] if c.get("source_url") else []) + c["links"]
            try:
                have = client.attachment_urls(target["id"]) if links else set()
            except LinearError:
                have = set()
            for link in links:
                if link["url"] in have:
                    continue          # already on the issue; leave it alone (and out of undo)
                try:
                    attachment_id = client.add_link(target["id"], link["url"], link["title"])
                    if attachment_id:
                        undo["attachments"].append(attachment_id)
                        db.set_undo(cid, undo)
                except LinearError as exc:
                    warnings.append(f"Link not attached ({link['title']}): {exc}")

            if c["subtasks"]:
                label_ids = [l["id"] for l in m.client_labels if l["name"] == c["client_label"]]
                priority = c["priority"] or target.get("priority") or settings.default_priority
                try:
                    team_id, state_id = sub_issue_team(client, m, target)      # one status read for them all
                except LinearError as exc:
                    warnings += [f"Subtask not created ({sub['title']}): {exc}" for sub in c["subtasks"]]
                else:
                    for sub in c["subtasks"]:
                        try:
                            child = create_sub_issue(
                                client, m, target, sub["title"], team_id=team_id, state_id=state_id,
                                label_ids=label_ids, priority=priority, due_date=sub.get("due_date"),
                            )
                            created.append(shape_issue(child, settings))
                            undo["issues"].append(child["id"])
                            db.set_undo(cid, undo)
                        except LinearError as exc:
                            warnings.append(f"Subtask not created ({sub['title']}): {exc}")
        finally:
            client.close()
        return {"candidate": updated, "issue": shape_issue(target, settings), "subtasks": created,
                "warnings": warnings}

    save_draft = draft_fn or (lambda message_id, body: gmail_draft.save_reply_draft(settings, message_id, body))

    @app.post("/api/candidates/{cid}/reply-draft", dependencies=auth)
    def reply_draft(cid: int, body: ReplyDraftIn) -> dict:
        """Save the card's reply as a Gmail draft in the original thread. Nothing is sent."""
        c = candidate_or_404(cid)
        if c["source"] != "gmail":
            raise HTTPException(400, "Only email tasks can be saved as Gmail drafts; copy the reply instead")
        db.update_candidate(cid, reply_draft=body.body.strip())
        try:
            url = save_draft(c["source_id"], body.body)
        except gmail_draft.DraftError as exc:
            raise HTTPException(502, str(exc))
        return {"url": url}

    # ---- mute rules ---------------------------------------------------------------------
    @app.get("/api/mutes", dependencies=auth)
    def list_mutes() -> list[dict]:
        return db.list_mutes()

    @app.post("/api/mutes", dependencies=auth)
    def add_mute(body: MuteIn) -> dict:
        """Stop proposing tasks from a sender, channel or repo. With drop_pending, cards already
        waiting in the Inbox from it are dropped too (as noise); their ids come back for undo."""
        value = body.value.strip().lower() if body.kind != "channel" else body.value.strip()
        rule = db.add_mute(body.kind, body.source, value, body.label.strip())
        dropped: list[int] = []
        if body.drop_pending:
            key = (rule["kind"], rule["source"], rule["value"])
            for c in db.list_candidates("pending"):
                if key in {(k["kind"], k["source"], k["value"]) for k in mutes.keys(c)}:
                    db.decide(c["id"], "dropped", drop_reason="noise")
                    dropped.append(c["id"])
        return {"rule": rule, "dropped_ids": dropped}

    @app.delete("/api/mutes/{rule_id}", dependencies=auth)
    def delete_mute(rule_id: int) -> dict:
        if not db.delete_mute(rule_id):
            raise HTTPException(404, "No such mute rule")
        return {"deleted": rule_id}

    @app.post("/api/mutes/decline", dependencies=auth)
    def decline_mute(body: MuteIn) -> dict:
        """'Not now' on a suggestion: don't suggest muting this one again."""
        mutes.decline(db, {"kind": body.kind, "source": body.source, "value": body.value})
        return {"declined": True}

    @app.get("/api/candidates/{cid}/mute-suggestion", dependencies=auth)
    def mute_suggestion(cid: int) -> dict:
        """After a drop: a sender, channel or repo worth muting, or null."""
        return {"suggestion": mutes.suggestion(db, candidate_or_404(cid))}

    @app.post("/api/candidates/{cid}/drop", dependencies=auth)
    def drop(cid: int, body: DropIn | None = None) -> dict:
        c = candidate_or_404(cid)
        if c["status"] != "pending":
            raise HTTPException(409, f"Already {c['status']}")
        return db.decide(cid, "dropped", drop_reason=(body.reason if body else "other"))

    def completed_since_weeks(weeks: int) -> list[dict]:
        since = stats.first_day(weeks).astimezone(timezone.utc).replace(microsecond=0).isoformat()
        raw = linear_call(lambda l: l.my_completed_issues(since))
        return [shape_issue(i, settings) for i in raw]

    @app.get("/api/stats/balance", dependencies=auth)
    def balance_stats(weeks: int = 8) -> dict:
        weeks = max(1, min(weeks, 26))
        return stats.balance(completed_since_weeks(weeks), weeks)

    @app.get("/api/clients/{client}/summary", dependencies=auth)
    def client_summary(client: str) -> dict:
        if client not in db.get_meta("client_labels", []):
            team_meta()
            if client not in db.get_meta("client_labels", []):
                raise HTTPException(404, f"No client label {client!r}")
        week = stats.week_starts(1)[0]
        open_issues = [shape_issue(i, settings) for i in linear_call(lambda l: l.my_open_issues())]
        text = summary.client_summary(client, week, open_issues, completed_since_weeks(1), settings.waiting_state)
        return {"client": client, "text": text}

    @app.get("/api/runs", dependencies=auth)
    def runs(limit: int = 30) -> list[dict]:
        return db.list_runs(max(1, min(limit, 200)))

    @app.get("/api/runs/{run_id}/log", dependencies=auth)
    def run_log(run_id: int) -> dict:
        run = db.get_run(run_id)
        if not run:
            raise HTTPException(404, "No such run")
        path = Path(run["log_path"] or "")
        # Only ever serve files from the logs folder.
        if not run["log_path"] or path.resolve().parent != settings.log_dir.resolve() or not path.exists():
            return {"text": "", "missing": True}
        text = path.read_text(errors="replace")
        return {"text": text[-120_000:], "truncated": len(text) > 120_000, "missing": False}

    @app.get("/api/stats/approval", dependencies=auth)
    def approval_stats(weeks: int = 8) -> dict:
        weeks = max(1, min(weeks, 26))
        since = stats.first_day(weeks).astimezone(timezone.utc).replace(microsecond=0).isoformat()
        return stats.approval_rate(db.decisions_since(since), weeks)

    @app.post("/api/candidates/{cid}/undo", dependencies=auth)
    def undo(cid: int) -> dict:
        """Put an approved or dropped candidate back in the Inbox, reversing what it did in Linear:
        created issues go to Linear's trash, a closed or merged-into issue gets its old fields back,
        and posted comments are deleted. If Linear fails part-way, what's left is kept for a retry."""
        c = candidate_or_404(cid)
        if c["status"] == "pending":
            raise HTTPException(409, "Nothing to undo: it's already in the Inbox")
        warnings: list[str] = []
        if c["status"] == "approved":
            record = db.get_undo(cid)
            if not record:
                raise HTTPException(409, f"{c['linear_identifier'] or 'This'} was approved before undo existed; "
                                         "change it in Linear instead.")
            try:
                client = linear_factory()
            except RuntimeError as exc:      # missing API key
                raise HTTPException(503, str(exc))
            try:
                if record.get("restore"):            # the issue's fields as they were
                    client.update_issue(record["issue"], record["restore"])
                    record.pop("restore")
                    db.set_undo(cid, record)
                for attachment_id in list(record.get("attachments", [])):
                    try:
                        client.delete_attachment(attachment_id)
                    except LinearError as exc:
                        warnings.append(f"A link on {c['linear_identifier']} wasn't removed: {exc}")
                    record["attachments"].remove(attachment_id)
                    db.set_undo(cid, record)
                while record.get("issues"):          # subtasks first, then the parent
                    client.delete_issue(record["issues"][-1])
                    record["issues"].pop()
                    db.set_undo(cid, record)
                for comment_id in list(record.get("comments", [])):
                    try:
                        client.delete_comment(comment_id)
                    except LinearError as exc:
                        warnings.append(f"The comment on {c['target_issue'] or c['linear_identifier']} "
                                        f"wasn't deleted: {exc}")
                    record["comments"].remove(comment_id)
                    db.set_undo(cid, record)
            except LinearError as exc:
                raise HTTPException(502, f"Couldn't undo in Linear: {exc}. Try again.")
            finally:
                client.close()
            db.set_undo(cid, None)
        return {"candidate": db.decide(cid, "pending"), "warnings": warnings}

    DECIDED_FIELDS = ("id", "title", "status", "kind", "drop_reason", "decided_at", "source", "source_url", "who",
                      "client_label", "linear_identifier", "linear_url", "target_issue")

    @app.get("/api/decided", dependencies=auth)
    def decided(days: int = 30, limit: int = 300) -> dict:
        """The Inbox's "Recently decided": approved and dropped cards of the last ``days``, newest
        decision first. ``more`` is true when the limit cut the list short."""
        days, limit = max(1, min(days, 365)), max(1, min(limit, 1000))
        since = (datetime.now(timezone.utc) - timedelta(days=days)).replace(microsecond=0).isoformat()
        rows = db.list_decided(since, limit + 1)
        return {"days": days, "more": len(rows) > limit,
                "items": [{k: r.get(k) for k in DECIDED_FIELDS} for r in rows[:limit]]}

    @app.post("/api/candidates/{cid}/restore", dependencies=auth)
    def restore(cid: int) -> dict:
        c = candidate_or_404(cid)
        if c["status"] != "dropped":
            raise HTTPException(409, "Only dropped candidates can be restored")
        return db.decide(cid, "pending")

    # ---- Linear lists -----------------------------------------------------------------
    @app.get("/api/issues", dependencies=auth)
    def issues() -> list[dict]:
        raw = linear_call(lambda l: l.my_open_issues())
        known = db.categories_by_identifier()    # issues TodoHub created keep the type you approved
        out = []
        for i in raw:
            shaped = shape_issue(i, settings)
            shaped["category"] = known.get(shaped["identifier"], shaped["category"])
            out.append(shaped)
        return out

    images: dict[str, tuple[bytes, str]] = {}     # recent Linear images, oldest first

    @app.get("/api/linear-image", dependencies=auth)
    def linear_image(url: str) -> Response:
        """An image pasted into a Linear description or comment, fetched with the Linear API key
        (those files are private). Only Linear's upload server; the last 40 are kept in memory."""
        if not is_linear_upload(url):
            raise HTTPException(400, "Only images stored on Linear can be loaded.")
        hit = images.pop(url, None) or linear_call(lambda l: l.fetch_upload(url))
        images[url] = hit
        while len(images) > IMAGE_CACHE:
            images.pop(next(iter(images)))
        return Response(content=hit[0], media_type=hit[1], headers={"Cache-Control": "private, max-age=3600"})

    @app.get("/api/issues/{ident}/preview", dependencies=auth)
    def issue_preview(ident: str) -> dict:
        """A quick look at an issue: its description, latest comments and sub-issues."""
        raw = linear_call(lambda l: l.issue_preview(ident))
        nodes = sorted((raw.get("comments") or {}).get("nodes", []), key=lambda n: n.get("createdAt") or "")
        description = (raw.get("description") or "").strip()
        own_team = team_meta().team_id
        return {
            **shape_issue(raw, settings),
            "assignee": (raw.get("assignee") or {}).get("name"),
            "created_at": raw.get("createdAt"),
            # Long enough to read the whole thing in the app's pane (rendered as Markdown there). One cut
            # short isn't editable in the app: saving the cut text would drop the rest in Linear.
            "description": description[:PREVIEW_DESCRIPTION],
            "description_truncated": len(description) > PREVIEW_DESCRIPTION,
            "comment_count": len(nodes),
            "comments": [
                {"author": (n.get("user") or {}).get("name") or "Someone", "created_at": n.get("createdAt"),
                 "body": (n.get("body") or "").strip()[:PREVIEW_COMMENT]}
                for n in nodes[-3:]
            ],
            # Done ones too. A sub-issue in another team has statuses the app doesn't know, so the
            # pane shows its status without a checkbox.
            "sub_issues": [
                {**shape_issue(n, settings), "assignee": (n.get("assignee") or {}).get("name"),
                 "own_team": (n.get("team") or {}).get("id") == own_team}
                for n in sorted((raw.get("children") or {}).get("nodes", []), key=lambda n: n.get("createdAt") or "")
            ],
        }

    slip_cache: dict = {"at": 0.0, "data": None}

    # ---- Start in periscope -----------------------------------------------------------------
    def require_periscope() -> None:
        if not settings.periscope_on:
            raise HTTPException(404, "Start in periscope is off. Set app.periscope_url in config.toml.")

    periscope_auth = [*auth, Depends(require_periscope)]

    @app.get("/api/issues/{issue_id}/periscope", dependencies=periscope_auth)
    def periscope_options(issue_id: str) -> dict:
        """What the popover shows first: periscope's repos, the one to select and why, Linear's branch, the
        repos with a worktree already on it, and the Settings page's prompt filled in for the issue."""
        raw = linear_call(lambda l: l.get_issue(issue_id))
        issue = shape_issue(raw, settings)
        catalog = periscope_call(lambda p: p.catalog())
        repos = [{"repo": r["repo"], "label": r["label"]} for r in catalog["repos"]]
        repo, hint = default_repo(db, issue, [r["repo"] for r in repos])
        branch = raw["branchName"]
        return {
            "repos": repos, "repo": repo, "hint": hint, "branch": branch,
            "branch_worktrees": sorted({w["repo"] for w in catalog["worktrees"] if w["branch"] == branch}),
            "prompt": fill_prompt(settings.periscope_prompt, issue),
        }

    @app.post("/api/issues/{issue_id}/periscope", dependencies=periscope_auth)
    def periscope_start(issue_id: str, body: PeriscopeStartIn) -> dict:
        """Ask periscope to start Claude on the branch with the prompt and a name from Haiku, then remember the
        repo for the issue's project (or client). A Claude already on the branch is answered as mode "existing".
        A new Claude's session goes into a comment on the issue; a comment that fails is a warning."""
        branch = body.branch.strip()
        if not branch:
            raise HTTPException(400, "The branch is empty")
        issue = shape_issue(linear_call(lambda l: l.get_issue(issue_id)), settings)
        name = name_claude(issue)
        try:
            result = periscope_call(lambda p: p.start(
                repo=body.repo, branch=branch, ticket=issue["identifier"], title=issue["title"],
                prompt=body.prompt, name=name))
        except HTTPException as exc:
            if exc.status_code == 409:
                raise HTTPException(409, f"Periscope is already starting {issue['identifier']}.")
            raise
        remember_repo(db, issue, body.repo)
        warnings = add_session_comment(issue, result.get("email"), result["session_id"]) \
            if result.get("session_id") else []
        return {**result, "warnings": warnings}

    @app.post("/api/periscope/show", dependencies=periscope_auth)
    def periscope_show(body: PeriscopeShowIn) -> dict:
        """Select the pane in periscope, then bring periscope to the front if periscope_app_id is set."""
        def select_then_front(p: Periscope) -> None:
            p.select(body.pid)
            if settings.periscope_app_id:
                front(settings.periscope_app_id)

        periscope_call(select_then_front)
        return {"ok": True}

    @app.get("/api/slips", dependencies=auth)
    def slips(refresh: bool = False) -> dict:
        """Due-date slips on my open issues (see stats.due_slips). Cached for 15 minutes."""
        if refresh or not slip_cache["data"] or time.time() - slip_cache["at"] > 15 * 60:
            try:
                raw = linear_call(lambda l: l.due_date_history())
            except HTTPException as exc:
                return {"slips": {}, "checked": 0, "error": str(exc.detail)}
            slip_cache.update(at=time.time(), data={
                "slips": stats.due_slips(raw, settings.client_label_group), "checked": len(raw), "error": None})
        return slip_cache["data"]

    pull_cache: dict = {"at": 0.0, "data": None, "read_at": None, "error": None, "error_at": None}
    pull_lock = threading.Lock()

    @app.get("/api/pulls", dependencies=auth)
    def pull_requests(refresh: bool = False) -> dict:
        """Open pull requests from GitHub (see pulls.py), read again after 5 minutes. When gh fails, the
        last good read comes back with the error."""
        with pull_lock:
            if refresh or time.time() - pull_cache["at"] > PULLS_TTL_SECONDS:
                started = datetime.now(timezone.utc).replace(microsecond=0)
                # One clock: the app asks again 5 minutes after read_at or error_at, so the cache ages from the same instant.
                pull_cache["at"] = started.timestamp()
                try:
                    pull_cache.update(data=pulls.read(settings, _env()), read_at=started.isoformat(), error=None, error_at=None)
                except SourceError as exc:
                    pull_cache.update(error=str(exc), error_at=started.isoformat())
            return pulls_payload()

    @app.post("/api/pulls/{owner}/{name}/{number}", dependencies=auth)
    def pull_request_again(owner: str, name: str, number: int) -> dict:
        """Read one pull request again and put it in the last read. The 5-minute read of the list is unchanged."""
        with pull_lock:
            if pull_cache["data"] is None:      # the backend restarted after the app read the list
                raise HTTPException(409, "There is no list to update yet. Use Refresh all.")
            try:
                pr = pulls.read_one(settings, f"{owner}/{name}", number, _env())
            except SourceError as exc:
                raise HTTPException(502, str(exc))
            pull_cache["data"] = pulls.updated(pull_cache["data"], f"{owner}/{name}", number, pr)
            return pulls_payload()

    pull_week_cache: dict = {"at": 0.0, "data": None}

    @app.get("/api/pulls/weekly", dependencies=auth)
    def pull_weeks(refresh: bool = False) -> dict:
        """Pull requests merged (with their lines) and reviewed per week (see pulls.weekly), for Insights.
        Cached for 15 minutes."""
        if refresh or not pull_week_cache["data"] or time.time() - pull_week_cache["at"] > 15 * 60:
            try:
                weekly = pulls.weekly(settings, _env())
            except SourceError as exc:
                return {"weeks": [], "lines": None, "last_lines": None, "error": str(exc)}
            pull_week_cache.update(at=time.time(), data={**weekly, "error": None})
        return pull_week_cache["data"]

    def pulls_payload() -> dict:
        empty = {"login": None, "mine": [], "review": [], "mine_total": 0, "review_total": 0}
        return {**(pull_cache["data"] or empty), "read_at": pull_cache["read_at"],
                "error": pull_cache["error"], "error_at": pull_cache["error_at"]}

    @app.get("/api/digest", dependencies=auth)
    def weekly_digest(week: int = 0) -> dict:
        """The weekly digest (see digest.py). week: 0 = this week, 1 = last week, up to 8."""
        week = max(0, min(week, 8))
        since = stats.first_day(week + 1).astimezone(timezone.utc).replace(microsecond=0).isoformat()
        open_issues = [shape_issue(i, settings) for i in linear_call(lambda l: l.my_open_issues())]
        return digest.build(week_offset=week, completed=completed_since_weeks(week + 2), open_issues=open_issues,
                            slips=slips(), decisions=db.decisions_since(since), runs=db.list_runs(200))

    @app.get("/api/logos", dependencies=auth)
    def client_logos(clients: str = "") -> dict:
        """Logos as data URIs for the given client labels ("|"-separated); null = show initials."""
        names = [c for c in clients.split("|") if c][:150]
        return logos.logos_for(settings, names)

    @app.patch("/api/issues/{issue_id}", dependencies=auth)
    def edit_issue(issue_id: str, edit: IssueEdit) -> dict:
        fields = edit.model_fields_set
        if not fields:
            raise HTTPException(400, "Nothing to change")
        changes: dict = {}
        if "state_id" in fields:
            if not edit.state_id:
                raise HTTPException(400, "state_id can't be empty")
            changes["stateId"] = edit.state_id
        if "priority" in fields:
            changes["priority"] = edit.priority or 0
        if "due_date" in fields:
            changes["dueDate"] = edit.due_date   # None clears it
        if "title" in fields:
            title = (edit.title or "").strip()
            if not title:
                raise HTTPException(400, "The title can't be empty")
            changes["title"] = title
        if "description" in fields:
            changes["description"] = edit.description or ""
        if "project" in fields:
            changes["projectId"] = id_by_name(team_meta().projects, edit.project, "open project")
        new_client = id_by_name(team_meta().client_labels, edit.client, "client label") if "client" in fields else None

        def run(l: Linear) -> dict:
            labels: dict = {}
            # A client change swaps the label in the client group and keeps every other label.
            if "client" in fields:
                current = l.get_issue(issue_id)
                old = [x["id"] for x in client_labels_of(current, settings.client_label_group)]
                new = [new_client] if new_client else []
                if removed := [x for x in old if x not in new]:
                    labels["removedLabelIds"] = removed
                if added := [x for x in new if x not in old]:
                    labels["addedLabelIds"] = added
                if not changes and not labels:      # it already has that client: nothing to send
                    return current
            return l.update_issue(issue_id, changes | labels)

        return shape_issue(linear_call(run), settings)

    @app.delete("/api/issues/{issue_id}", dependencies=auth)
    def delete_issue(issue_id: str) -> dict:
        """Move an issue to Linear's trash (restorable there for 30 days) and take it off Today.
        Returns where it sat on Today (or null) so an undo can put it back."""
        linear_call(lambda l: l.delete_issue(issue_id))
        day = today_str()
        ids = [i["issue_id"] for i in db.get_today(day)]
        at = ids.index(issue_id) if issue_id in ids else None
        if at is not None:
            db.set_today(day, [i for i in ids if i != issue_id])
        return {"deleted": issue_id, "today_position": at}

    @app.post("/api/issues/{issue_id}/restore", dependencies=auth)
    def restore_issue(issue_id: str, body: RestoreIn | None = None) -> dict:
        """Undo a delete: bring the issue back from Linear's trash (and onto Today if it was there)."""
        def run(l: Linear) -> dict:
            l.restore_issue(issue_id)
            return l.get_issue(issue_id)
        issue = linear_call(run)
        if body and body.today_position is not None:
            day = today_str()
            ids = [i["issue_id"] for i in db.get_today(day) if i["issue_id"] != issue_id]
            ids.insert(min(body.today_position, len(ids)), issue_id)
            db.set_today(day, ids)
        return shape_issue(issue, settings)

    @app.post("/api/issues/{issue_id}/comments", dependencies=auth)
    def add_comment(issue_id: str, body: CommentIn) -> dict:
        """Post a comment as you. Returns its id, so Undo can delete it."""
        text = body.body.strip()
        if not text:
            raise HTTPException(400, "The comment is empty")
        return {"id": linear_call(lambda l: l.create_comment(issue_id, text))}

    @app.delete("/api/comments/{comment_id}", dependencies=auth)
    def delete_comment(comment_id: str) -> dict:
        linear_call(lambda l: l.delete_comment(comment_id))
        return {"deleted": comment_id}

    @app.post("/api/issues/{issue_id}/sub-issues", dependencies=auth)
    def add_sub_issue(issue_id: str, body: SubIssueIn) -> dict:
        """A sub-issue made as merging an Inbox task makes them (create_sub_issue), with the parent's client label
        and priority. Undo deletes it like any issue."""
        title = body.title.strip()
        if not title:
            raise HTTPException(400, "The title can't be empty")
        m = team_meta()

        def run(l: Linear) -> dict:
            parent = l.get_issue(issue_id)
            team_id, state_id = sub_issue_team(l, m, parent)
            return create_sub_issue(l, m, parent, title, team_id=team_id, state_id=state_id,
                                    priority=parent["priority"],
                                    label_ids=[x["id"] for x in client_labels_of(parent, settings.client_label_group)])

        return shape_issue(linear_call(run), settings)

    # ---- sweeps -----------------------------------------------------------------------
    @app.get("/api/runs/latest", dependencies=auth)
    def latest_run(kind: str = "sweep") -> dict:
        run = db.latest_run("capture" if kind == "capture" else "sweep") or {}
        if kind != "capture" and run:
            # A one-source sweep ("Check now") reports only its source; the overview keeps the rest.
            run["scope"] = (db.get_meta("run_scopes", {}) or {}).get(str(run["id"]))
            run["source_overview"] = db.source_overview(settings.enabled_sources())
        return run

    def clear_stale() -> None:
        # A run left "running" by a crash shouldn't block the button forever.
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=settings.timeout_minutes + 5)
        db.mark_stale_runs(cutoff.replace(microsecond=0).isoformat())

    @app.post("/api/sweep", dependencies=auth, status_code=202)
    def run_now(body: RunIn | None = None) -> dict:
        """Sweep every source, or only ``body.source``."""
        clear_stale()
        source = body.source if body else None
        if source and source not in settings.enabled_sources():
            raise HTTPException(400, f"{source} isn't an enabled source")
        run = db.latest_run()
        if run and run["status"] == "running":
            raise HTTPException(409, "A sweep is already running")
        launch(["--trigger", "manual", *(["--source", source] if source else [])])
        return {"started": True, "source": source}

    # ---- today --------------------------------------------------------------------------
    @app.get("/api/today", dependencies=auth)
    def get_today() -> dict:
        return {"day": today_str(), "items": db.get_today(today_str())}

    @app.put("/api/today", dependencies=auth)
    def put_today(body: TodayIn) -> dict:
        return {"day": today_str(), "items": db.set_today(today_str(), body.issue_ids)}

    @app.post("/api/today/carry", dependencies=auth)
    def carry_over(body: CarryIn) -> dict:
        """End of day: put unfinished Today items on the next working day's list."""
        day = date.fromisoformat(today_str())
        nxt = next_working_day(day).isoformat()
        have = [i["issue_id"] for i in db.get_today(nxt)]
        items = db.set_today(nxt, have + [i for i in body.issue_ids if i not in have])
        return {"day": nxt, "items": items}

    @app.delete("/api/today/carry", dependencies=auth)
    def undo_carry(body: CarryIn) -> dict:
        """Undo a carry: take these issues off the next working day's list."""
        nxt = next_working_day(date.fromisoformat(today_str())).isoformat()
        items = db.set_today(nxt, [i["issue_id"] for i in db.get_today(nxt) if i["issue_id"] not in body.issue_ids])
        return {"day": nxt, "items": items}

    @app.get("/api/brief", dependencies=auth)
    def brief() -> dict:
        """What the morning brief and the wrap-up need beyond the issue list: today's and the next
        working day's agendas (saved by the first sweep of the day), the issues completed today, the
        next working day's Today list, and Claude's plan, midday note and wrap-up."""
        day = today_str()
        next_day = next_working_day(date.fromisoformat(day)).isoformat()
        agendas = db.get_meta("agendas", {}) or {}
        legacy = db.get_meta("agenda", None)          # before agendas were kept per day
        if day not in agendas and legacy and legacy.get("day") == day:
            agendas = {**agendas, day: legacy["events"]}
        start = datetime.combine(date.fromisoformat(day), datetime.min.time(), tzinfo=stats.TZ)
        since = start.astimezone(timezone.utc).replace(microsecond=0).isoformat()
        try:
            done = [shape_issue(i, settings) for i in linear_call(lambda l: l.my_completed_issues(since))
                    if (i.get("completedAt") or "") and datetime.fromisoformat(i["completedAt"].replace("Z", "+00:00")) >= start]
            done.sort(key=lambda i: i.get("completed_at") or "", reverse=True)
            error = None
        except HTTPException as exc:
            done, error = [], str(exc.detail)
        return {
            "day": day,
            "next_day": next_day,
            "agenda": agendas.get(day),
            "next_agenda": agendas.get(next_day),
            "next_today": [i["issue_id"] for i in db.get_today(next_day)],
            "completed_today": done,
            "waiting_state": settings.waiting_state,
            "error": error,
            "plan": (db.get_meta("plans", {}) or {}).get(day),
            "plan_run": todays_run("plan"),
            "note": (db.get_meta("notes", {}) or {}).get(day),
            "note_run": todays_run("note"),
            "wrapup": (db.get_meta("wrapups", {}) or {}).get(day),
            "wrapup_run": todays_run("wrapup"),
            "checkin": (db.get_meta("checkins", {}) or {}).get(stats.week_start(date.fromisoformat(day)).isoformat()),
        }

    def todays_run(kind: str) -> dict | None:
        """The latest "Re-plan" (or note or wrap-up "Redo") run, if it's from today: running, or how it ended."""
        run = db.latest_run(kind)
        if not run or not run["started_at"] or stats.local_date(run["started_at"]).isoformat() != today_str():
            return None
        return {k: run.get(k) for k in ("id", "status", "error", "started_at", "finished_at")}

    @app.post("/api/plan", dependencies=auth, status_code=202)
    def replan() -> dict:
        """Ask Claude for a fresh plan for today (a run of its own, about a minute)."""
        clear_stale()
        run = db.latest_run("plan")
        if run and run["status"] == "running":
            raise HTTPException(409, "Claude is already planning")
        launch(["--plan"])
        return {"started": True}

    @app.post("/api/note", dependencies=auth, status_code=202)
    def renote() -> dict:
        """Ask Claude for a fresh midday note (a run of its own, about a minute)."""
        clear_stale()
        run = db.latest_run("note")
        if run and run["status"] == "running":
            raise HTTPException(409, "Claude is already writing a note")
        launch(["--note"])
        return {"started": True}

    @app.post("/api/wrapup", dependencies=auth, status_code=202)
    def rewrap() -> dict:
        """Ask Claude for a fresh wrap-up of today (a run of its own, about a minute)."""
        clear_stale()
        run = db.latest_run("wrapup")
        if run and run["status"] == "running":
            raise HTTPException(409, "Claude is already wrapping up")
        launch(["--wrapup"])
        return {"started": True}

    @app.post("/api/today/{issue_id}/block", dependencies=auth)
    def block_time(issue_id: str, body: BlockIn) -> dict:
        day = today_str()
        if issue_id not in {i["issue_id"] for i in db.get_today(day)}:
            raise HTTPException(400, "Add the issue to Today first")
        issue = linear_call(lambda l: l.get_issue(issue_id))
        hh, mm = map(int, body.start.split(":"))
        start = datetime.now(stats.TZ).replace(hour=hh, minute=mm, second=0, microsecond=0)
        try:
            link = block(title=f"{issue['identifier']} {issue['title']}", url=issue["url"], start=start,
                         minutes=body.minutes)
        except calendar_block.BlockError as exc:
            raise HTTPException(502, str(exc))
        db.set_block(day, issue_id, start.isoformat(), body.minutes, link)
        return {"day": day, "items": db.get_today(day)}

    # ---- on-demand capture ------------------------------------------------------------
    @app.post("/api/capture", dependencies=auth)
    def capture(body: CaptureIn) -> JSONResponse:
        """A typed note becomes a candidate now; a Slack/Gmail/Grain link starts a short Claude run."""
        text = body.text.strip()
        if not text:
            raise HTTPException(400, "Type a task or paste a link.")
        if not capture_mod.needs_claude(settings, text):
            try:
                result = capture_mod.add_note(db, text)
            except ToolError as exc:
                raise HTTPException(400, str(exc))
            return JSONResponse({"mode": "note", "candidate": db.get_candidate(result["id"]) if "id" in result else None,
                                 "status": result["status"]})
        clear_stale()
        run = db.latest_run("capture")
        if run and run["status"] == "running":
            raise HTTPException(409, "A capture is already running; try again in a moment")
        launch(["--capture", text])
        return JSONResponse({"mode": "claude", "started": True}, status_code=202)

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    return app


def _exit_with_parent() -> None:
    """When the app that started us goes away (even killed outright), stop too."""
    parent = os.getppid()

    def watch() -> None:
        while True:
            time.sleep(2)
            if os.getppid() != parent:
                os._exit(0)

    threading.Thread(target=watch, daemon=True).start()


def serve() -> None:
    parser = argparse.ArgumentParser(description="Run the TodoHub local API.")
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()
    settings = load_settings()
    if not os.environ.get("TODOHUB_TOKEN"):
        # Never serve without a token: any web page could otherwise post to localhost.
        os.environ["TODOHUB_TOKEN"] = secrets.token_hex(24)
        print(f"No TODOHUB_TOKEN set; using {os.environ['TODOHUB_TOKEN']} (send it as X-TodoHub-Token).")
    if os.environ.get("TODOHUB_EXIT_WITH_PARENT"):
        _exit_with_parent()
    uvicorn.run(create_app(settings), host="127.0.0.1", port=args.port or settings.port, log_level="warning")


if __name__ == "__main__":
    serve()
