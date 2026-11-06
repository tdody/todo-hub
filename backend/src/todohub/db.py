"""SQLite storage: the candidate queue, sweep runs and per-source status."""

from __future__ import annotations

import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id            INTEGER PRIMARY KEY,
    trigger       TEXT NOT NULL,              -- schedule | manual (sweeps) | capture
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    status        TEXT NOT NULL,              -- running | ok | error
    since         TEXT NOT NULL,              -- messages after this time were scanned
    cost_usd      REAL,
    num_turns     INTEGER,
    error         TEXT,
    log_path      TEXT
);

CREATE TABLE IF NOT EXISTS candidates (
    id                 INTEGER PRIMARY KEY,
    run_id             INTEGER REFERENCES runs(id),
    source             TEXT NOT NULL,         -- slack | gmail | grain
    source_id          TEXT NOT NULL,         -- message ts / email id / meeting id
    source_url         TEXT,
    title              TEXT NOT NULL,
    title_key          TEXT NOT NULL,         -- normalized title, for dedup
    signal             TEXT NOT NULL,         -- ask | commitment | action_item | deadline
    why                TEXT,
    excerpt            TEXT,
    who                TEXT,                  -- who asked / who was in the meeting
    client_label       TEXT,
    due_date           TEXT,
    priority           INTEGER NOT NULL DEFAULT 0,
    possible_duplicate TEXT,                  -- Linear identifier of a similar open issue
    links              TEXT NOT NULL DEFAULT '[]',        -- JSON [{url, title}] mentioned in the source
    subtasks           TEXT NOT NULL DEFAULT '[]',        -- JSON [{title, due_date}]
    status             TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | dropped
    drop_reason        TEXT,                  -- not_mine | already_done | noise | duplicate | other
    kind               TEXT NOT NULL DEFAULT 'task',      -- task | waiting | close | comment
    target_issue       TEXT,                  -- close/comment: the Linear identifier it acts on
    comment            TEXT,                  -- comment: the proposed update
    project            TEXT,                  -- suggested Linear project name
    snooze_until       TEXT,                  -- hidden from the Inbox until this date (YYYY-MM-DD)
    category           TEXT,                  -- task type: code | analysis | model | review | meeting | email | writing | admin
    linear_identifier  TEXT,
    linear_url         TEXT,
    created_at         TEXT NOT NULL,
    decided_at         TEXT,
    UNIQUE (source, source_id, title_key)
);

CREATE TABLE IF NOT EXISTS source_status (
    run_id        INTEGER REFERENCES runs(id),
    source        TEXT NOT NULL,
    ok            INTEGER NOT NULL,
    detail        TEXT,
    items_scanned INTEGER,
    PRIMARY KEY (run_id, source)
);

CREATE TABLE IF NOT EXISTS seen (              -- items scanned that produced no task
    source     TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    seen_at    TEXT NOT NULL,
    PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS today (               -- issues picked for a day, in order
    day            TEXT NOT NULL,               -- YYYY-MM-DD, America/New_York
    issue_id       TEXT NOT NULL,
    position       INTEGER NOT NULL,
    event_start    TEXT,                        -- calendar block, if one was made
    event_minutes  INTEGER,
    event_link     TEXT,
    PRIMARY KEY (day, issue_id)
);

CREATE TABLE IF NOT EXISTS mute_rules (          -- senders, channels and repos the sweep should skip
    id              INTEGER PRIMARY KEY,
    kind            TEXT NOT NULL,                   -- sender | channel | repo
    source          TEXT NOT NULL,                   -- slack | gmail | linear | github
    value           TEXT NOT NULL,                   -- lowercased sender, Slack channel id, or owner/repo
    label           TEXT NOT NULL,                   -- what to show: "news@vendor.com", "#alerts", "org/repo"
    created_at      TEXT NOT NULL,
    blocked         INTEGER NOT NULL DEFAULT 0,      -- candidates refused since
    last_blocked_at TEXT,
    UNIQUE (kind, source, value)
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

SIGNALS = ("ask", "commitment", "action_item", "deadline", "manual", "waiting_on", "done", "update")
SOURCES = ("slack", "gmail", "grain", "calendar", "linear", "github", "manual")
SWEEP_TRIGGERS = ("schedule", "manual")
CAPTURE_TRIGGERS = ("capture",)
CANDIDATE_FIELDS = (
    "id", "run_id", "source", "source_id", "source_url", "title", "signal", "why", "excerpt", "who",
    "client_label", "due_date", "priority", "possible_duplicate", "links", "subtasks", "status", "drop_reason", "kind", "target_issue", "comment", "project", "snooze_until", "category",
    "duplicate_advice", "duplicate_reason", "reply_draft", "sender", "channel", "handled",
    "linear_identifier", "linear_url", "created_at", "decided_at",
)
EDITABLE_FIELDS = ("title", "client_label", "due_date", "priority", "why", "subtasks", "comment", "project",
                   "category", "reply_draft")
JSON_FIELDS = ("links", "subtasks")
# Columns added after the first release, so an existing queue is upgraded in place.
MIGRATIONS = {
    "links": "ALTER TABLE candidates ADD COLUMN links TEXT NOT NULL DEFAULT '[]'",
    "subtasks": "ALTER TABLE candidates ADD COLUMN subtasks TEXT NOT NULL DEFAULT '[]'",
    "drop_reason": "ALTER TABLE candidates ADD COLUMN drop_reason TEXT",
    "kind": "ALTER TABLE candidates ADD COLUMN kind TEXT NOT NULL DEFAULT 'task'",
    "target_issue": "ALTER TABLE candidates ADD COLUMN target_issue TEXT",
    "comment": "ALTER TABLE candidates ADD COLUMN comment TEXT",
    "project": "ALTER TABLE candidates ADD COLUMN project TEXT",
    "snooze_until": "ALTER TABLE candidates ADD COLUMN snooze_until TEXT",
    "category": "ALTER TABLE candidates ADD COLUMN category TEXT",
    # What an approval did in Linear (JSON), so it can be undone.
    "undo": "ALTER TABLE candidates ADD COLUMN undo TEXT",
    # For a possible duplicate: drop | merge | new, and a one-line reason.
    "duplicate_advice": "ALTER TABLE candidates ADD COLUMN duplicate_advice TEXT",
    "duplicate_reason": "ALTER TABLE candidates ADD COLUMN duplicate_reason TEXT",
    # A reply Thibault could send to an ask (Slack or email), drafted by the sweep.
    "reply_draft": "ALTER TABLE candidates ADD COLUMN reply_draft TEXT",
    # Who and where a candidate came from, for mute rules.
    "sender": "ALTER TABLE candidates ADD COLUMN sender TEXT",
    "channel": "ALTER TABLE candidates ADD COLUMN channel TEXT",
    # A Linear issue that seems to have handled a pending candidate already (JSON); see handled.py.
    "handled": "ALTER TABLE candidates ADD COLUMN handled TEXT",
}
KINDS = ("task", "waiting", "close", "comment")
DROP_REASONS = ("not_mine", "already_done", "noise", "duplicate", "other")


def _row(row: sqlite3.Row) -> dict:
    d = dict(row)
    for f in JSON_FIELDS:
        if f in d:
            d[f] = json.loads(d[f] or "[]")
    if "handled" in d:
        d["handled"] = json.loads(d["handled"]) if d["handled"] else None
    return d


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def title_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


class DB:
    def __init__(self, path: Path | str):
        self.path = str(path)
        with self.connect() as c:
            c.executescript(SCHEMA)
            have = {r["name"] for r in c.execute("PRAGMA table_info(candidates)")}
            for column, sql in MIGRATIONS.items():
                if column not in have:
                    c.execute(sql)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ---- meta -------------------------------------------------------------------------
    def get_meta(self, key: str, default: Any = None) -> Any:
        with self.connect() as c:
            row = c.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def set_meta(self, key: str, value: Any) -> None:
        with self.connect() as c:
            c.execute(
                "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )

    # ---- runs -------------------------------------------------------------------------
    def start_run(self, trigger: str, since: str, log_path: str | None = None) -> int:
        with self.connect() as c:
            cur = c.execute(
                "INSERT INTO runs (trigger, started_at, status, since, log_path) VALUES (?, ?, 'running', ?, ?)",
                (trigger, now_iso(), since, log_path),
            )
            return int(cur.lastrowid)

    def finish_run(self, run_id: int, status: str, cost_usd: float | None = None,
                   num_turns: int | None = None, error: str | None = None) -> None:
        with self.connect() as c:
            c.execute(
                "UPDATE runs SET finished_at = ?, status = ?, cost_usd = ?, num_turns = ?, error = ? WHERE id = ?",
                (now_iso(), status, cost_usd, num_turns, error, run_id),
            )

    def get_run(self, run_id: int, with_sources: bool = False) -> dict | None:
        with self.connect() as c:
            row = c.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
            if not row:
                return None
            run = dict(row)
            run["added"] = c.execute("SELECT COUNT(*) FROM candidates WHERE run_id = ?", (run_id,)).fetchone()[0]
            if with_sources:
                run["sources"] = [
                    {**dict(r), "ok": bool(r["ok"])} for r in c.execute(
                        "SELECT source, ok, detail, items_scanned FROM source_status WHERE run_id = ? ORDER BY source",
                        (run_id,),
                    )
                ]
        return run

    def list_runs(self, limit: int = 30) -> list[dict]:
        with self.connect() as c:
            ids = [r["id"] for r in c.execute("SELECT id FROM runs ORDER BY id DESC LIMIT ?", (limit,))]
        return [self.get_run(i, with_sources=True) for i in ids]

    def count_candidates_for_run(self, run_id: int) -> int:
        with self.connect() as c:
            return c.execute("SELECT COUNT(*) FROM candidates WHERE run_id = ?", (run_id,)).fetchone()[0]

    def latest_run(self, kind: str = "sweep") -> dict | None:
        """Latest sweep (scheduled or manual), or latest capture when kind="capture"."""
        triggers = CAPTURE_TRIGGERS if kind == "capture" else SWEEP_TRIGGERS
        marks = ", ".join("?" * len(triggers))
        with self.connect() as c:
            row = c.execute(
                f"SELECT id FROM runs WHERE trigger IN ({marks}) ORDER BY id DESC LIMIT 1", triggers
            ).fetchone()
        return self.get_run(row["id"], with_sources=True) if row else None

    def last_successful_start(self) -> str | None:
        with self.connect() as c:
            row = c.execute(
                "SELECT started_at FROM runs WHERE status = 'ok' AND trigger IN ('schedule', 'manual') "
                "ORDER BY id DESC LIMIT 1"
            ).fetchone()
        return row["started_at"] if row else None

    def last_ok_start(self, source: str) -> str | None:
        """Start of the latest finished sweep in which ``source`` reported success."""
        with self.connect() as c:
            row = c.execute(
                "SELECT r.started_at FROM runs r JOIN source_status s ON s.run_id = r.id "
                "WHERE s.source = ? AND s.ok = 1 AND r.status = 'ok' AND r.trigger IN ('schedule', 'manual') "
                "ORDER BY r.id DESC LIMIT 1", (source,)).fetchone()
        return row["started_at"] if row else None

    def source_overview(self, sources: list[str]) -> list[dict]:
        """Per source: its latest report in any sweep (full or one-source), and when it last worked."""
        out = []
        with self.connect() as c:
            for source in sources:
                row = c.execute(
                    "SELECT s.ok, s.detail, s.items_scanned, r.started_at, r.id FROM source_status s "
                    "JOIN runs r ON r.id = s.run_id WHERE s.source = ? AND r.trigger IN ('schedule', 'manual') "
                    "ORDER BY r.id DESC LIMIT 1", (source,)).fetchone()
                out.append({"source": source, "ok": bool(row["ok"]) if row else None,
                            "detail": row["detail"] if row else None, "at": row["started_at"] if row else None,
                            "run_id": row["id"] if row else None, "last_ok_at": self.last_ok_start(source)})
        return out

    def has_reported(self, source: str) -> bool:
        with self.connect() as c:
            return c.execute("SELECT 1 FROM source_status WHERE source = ? LIMIT 1", (source,)).fetchone() is not None

    def mark_stale_runs(self, older_than_iso: str) -> None:
        """A run still 'running' from before ``older_than_iso`` died without cleaning up."""
        with self.connect() as c:
            c.execute(
                "UPDATE runs SET status = 'error', finished_at = ?, error = 'Run was interrupted' "
                "WHERE status = 'running' AND started_at < ?",
                (now_iso(), older_than_iso),
            )

    def report_source_status(self, run_id: int, source: str, ok: bool, detail: str,
                             items_scanned: int | None) -> None:
        with self.connect() as c:
            c.execute(
                "INSERT INTO source_status (run_id, source, ok, detail, items_scanned) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(run_id, source) DO UPDATE SET ok = excluded.ok, detail = excluded.detail, "
                "items_scanned = excluded.items_scanned",
                (run_id, source, int(ok), detail, items_scanned),
            )

    # ---- candidates -------------------------------------------------------------------
    def is_seen(self, source: str, source_id: str) -> bool:
        with self.connect() as c:
            row = c.execute(
                "SELECT 1 FROM candidates WHERE source = ? AND source_id = ? "
                "UNION ALL SELECT 1 FROM seen WHERE source = ? AND source_id = ? LIMIT 1",
                (source, source_id, source, source_id),
            ).fetchone()
        return row is not None

    def mark_seen(self, source: str, source_id: str) -> None:
        with self.connect() as c:
            c.execute(
                "INSERT OR IGNORE INTO seen (source, source_id, seen_at) VALUES (?, ?, ?)",
                (source, source_id, now_iso()),
            )

    def add_candidate(self, run_id: int | None, **f: Any) -> tuple[bool, int | None]:
        """Insert a candidate. Returns (added, id); added is False for a duplicate."""
        key = title_key(f["title"])
        with self.connect() as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO candidates (run_id, source, source_id, source_url, title, title_key, signal, "
                "why, excerpt, who, client_label, due_date, priority, possible_duplicate, links, subtasks, "
                "kind, target_issue, comment, project, category, duplicate_advice, duplicate_reason, reply_draft, "
                "sender, channel, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    run_id, f["source"], f["source_id"], f.get("source_url"), f["title"], key, f["signal"],
                    f.get("why"), f.get("excerpt"), f.get("who"), f.get("client_label"), f.get("due_date"),
                    int(f.get("priority") or 0), f.get("possible_duplicate"),
                    json.dumps(f.get("links") or []), json.dumps(f.get("subtasks") or []),
                    f.get("kind") or "task", f.get("target_issue"), f.get("comment"), f.get("project"),
                    f.get("category"), f.get("duplicate_advice"), f.get("duplicate_reason"),
                    f.get("reply_draft"), f.get("sender"), f.get("channel"), now_iso(),
                ),
            )
            if cur.rowcount == 0:
                return False, None
            return True, int(cur.lastrowid)

    def list_candidates(self, status: str = "pending", today: str | None = None) -> list[dict]:
        """``status`` "pending" leaves out snoozed candidates (shown again on their date);
        "snoozed" lists only those. With no ``today``, snoozing is ignored."""
        where, params = "status = ?", [status]
        if status in ("pending", "snoozed") and today:
            params = ["pending"]
            if status == "pending":
                where = "status = ? AND (snooze_until IS NULL OR snooze_until <= ?)"
            else:
                where = "status = ? AND snooze_until > ?"
            params.append(today)
        with self.connect() as c:
            rows = c.execute(
                f"SELECT {', '.join(CANDIDATE_FIELDS)} FROM candidates WHERE {where} ORDER BY created_at DESC, id DESC",
                params,
            ).fetchall()
        return [_row(r) for r in rows]

    def snooze(self, cid: int, until: str | None) -> dict | None:
        with self.connect() as c:
            c.execute("UPDATE candidates SET snooze_until = ? WHERE id = ?", (until, cid))
        return self.get_candidate(cid)

    def set_undo(self, cid: int, record: dict | None) -> None:
        with self.connect() as c:
            c.execute("UPDATE candidates SET undo = ? WHERE id = ?", (json.dumps(record) if record else None, cid))

    def get_undo(self, cid: int) -> dict | None:
        with self.connect() as c:
            row = c.execute("SELECT undo FROM candidates WHERE id = ?", (cid,)).fetchone()
        return json.loads(row["undo"]) if row and row["undo"] else None

    def get_candidate(self, cid: int) -> dict | None:
        with self.connect() as c:
            row = c.execute(f"SELECT {', '.join(CANDIDATE_FIELDS)} FROM candidates WHERE id = ?", (cid,)).fetchone()
        return _row(row) if row else None

    def update_candidate(self, cid: int, **changes: Any) -> dict | None:
        changes = {k: v for k, v in changes.items() if k in EDITABLE_FIELDS}
        for f in JSON_FIELDS:
            if f in changes:
                changes[f] = json.dumps(changes[f] or [])
        if changes:
            sets = ", ".join(f"{k} = ?" for k in changes)
            params = list(changes.values())
            if "title" in changes:
                sets += ", title_key = ?"
                params.append(title_key(changes["title"]))
            with self.connect() as c:
                c.execute(f"UPDATE candidates SET {sets} WHERE id = ?", (*params, cid))
        return self.get_candidate(cid)

    def claim(self, cid: int) -> bool:
        """Mark a pending candidate as being approved. False if another request got there first."""
        with self.connect() as c:
            return c.execute(
                "UPDATE candidates SET status = 'approving' WHERE id = ? AND status = 'pending'", (cid,)
            ).rowcount == 1

    def release(self, cid: int | None = None) -> None:
        """Undo a claim after a failed approval (or, with no id, all claims left by a crash)."""
        with self.connect() as c:
            if cid is None:
                c.execute("UPDATE candidates SET status = 'pending' WHERE status = 'approving'")
            else:
                c.execute("UPDATE candidates SET status = 'pending' WHERE id = ? AND status = 'approving'", (cid,))

    def set_handled(self, cid: int, handled: dict | None) -> None:
        with self.connect() as c:
            c.execute("UPDATE candidates SET handled = ? WHERE id = ?",
                      (json.dumps(handled) if handled else None, cid))

    def decide(self, cid: int, status: str, linear_identifier: str | None = None,
               linear_url: str | None = None, drop_reason: str | None = None) -> dict | None:
        decided = None if status == "pending" else now_iso()
        with self.connect() as c:
            c.execute(
                "UPDATE candidates SET status = ?, decided_at = ?, linear_identifier = ?, linear_url = ?, "
                "drop_reason = ? WHERE id = ?",
                (status, decided, linear_identifier, linear_url, drop_reason, cid),
            )
        return self.get_candidate(cid)

    # ---- today ------------------------------------------------------------------------
    def get_today(self, day: str) -> list[dict]:
        with self.connect() as c:
            rows = c.execute(
                "SELECT issue_id, position, event_start, event_minutes, event_link FROM today "
                "WHERE day = ? ORDER BY position", (day,)).fetchall()
        return [dict(r) for r in rows]

    def set_today(self, day: str, issue_ids: list[str]) -> list[dict]:
        """Replace the day's picks with ``issue_ids`` in that order; keep blocks already made."""
        with self.connect() as c:
            keep = {r["issue_id"]: dict(r) for r in c.execute("SELECT * FROM today WHERE day = ?", (day,))}
            c.execute("DELETE FROM today WHERE day = ?", (day,))
            for pos, issue_id in enumerate(dict.fromkeys(issue_ids)):
                old = keep.get(issue_id, {})
                c.execute(
                    "INSERT INTO today (day, issue_id, position, event_start, event_minutes, event_link) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (day, issue_id, pos, old.get("event_start"), old.get("event_minutes"), old.get("event_link")),
                )
        return self.get_today(day)

    def set_block(self, day: str, issue_id: str, start: str, minutes: int, link: str | None) -> None:
        with self.connect() as c:
            c.execute(
                "UPDATE today SET event_start = ?, event_minutes = ?, event_link = ? WHERE day = ? AND issue_id = ?",
                (start, minutes, link, day, issue_id),
            )

    # ---- learning from decisions ------------------------------------------------------
    # ---- mute rules ---------------------------------------------------------------------
    def list_mutes(self) -> list[dict]:
        with self.connect() as c:
            return [dict(r) for r in c.execute("SELECT * FROM mute_rules ORDER BY created_at DESC, id DESC")]

    def add_mute(self, kind: str, source: str, value: str, label: str) -> dict:
        with self.connect() as c:
            c.execute("INSERT OR IGNORE INTO mute_rules (kind, source, value, label, created_at) VALUES (?, ?, ?, ?, ?)",
                      (kind, source, value, label, now_iso()))
            row = c.execute("SELECT * FROM mute_rules WHERE kind = ? AND source = ? AND value = ?",
                            (kind, source, value)).fetchone()
        return dict(row)

    def delete_mute(self, rule_id: int) -> bool:
        with self.connect() as c:
            return c.execute("DELETE FROM mute_rules WHERE id = ?", (rule_id,)).rowcount > 0

    def bump_mute(self, rule_id: int) -> None:
        with self.connect() as c:
            c.execute("UPDATE mute_rules SET blocked = blocked + 1, last_blocked_at = ? WHERE id = ?", (now_iso(), rule_id))

    def decided_since(self, source: str, since_iso: str) -> list[dict]:
        """Approved and dropped candidates from one source, decided since ``since_iso``."""
        with self.connect() as c:
            rows = c.execute(
                f"SELECT {', '.join(CANDIDATE_FIELDS)} FROM candidates WHERE source = ? "
                "AND status IN ('approved', 'dropped') AND decided_at >= ?", (source, since_iso)).fetchall()
        return [_row(r) for r in rows]

    def recent_decisions(self, limit: int = 15) -> dict:
        """The latest kept and dropped candidates, shown to the sweep as examples."""
        with self.connect() as c:
            kept = c.execute(
                "SELECT title, source, signal FROM candidates WHERE status = 'approved' AND source != 'manual' "
                "ORDER BY decided_at DESC LIMIT ?", (limit,)).fetchall()
            dropped = c.execute(
                "SELECT title, source, signal, drop_reason FROM candidates WHERE status = 'dropped' "
                "ORDER BY decided_at DESC LIMIT ?", (limit,)).fetchall()
        return {"approved": [dict(r) for r in kept], "dropped": [dict(r) for r in dropped]}

    def watched_issues(self, open_identifiers: list[str], limit: int = 40) -> list[dict]:
        """Open Linear issues that TodoHub created, with the source they came from."""
        if not open_identifiers:
            return []
        marks = ", ".join("?" * len(open_identifiers))
        with self.connect() as c:
            rows = c.execute(
                f"SELECT linear_identifier, title, kind, source, source_id, source_url, who, decided_at "
                f"FROM candidates WHERE status = 'approved' AND kind IN ('task', 'waiting') "
                f"AND linear_identifier IN ({marks}) AND source != 'manual' ORDER BY decided_at DESC LIMIT ?",
                (*open_identifiers, limit)).fetchall()
        return [dict(r) for r in rows]

    def categories_by_identifier(self) -> dict[str, str]:
        """Task type of each Linear issue TodoHub created, so lists show the same icon."""
        with self.connect() as c:
            rows = c.execute(
                "SELECT linear_identifier, category FROM candidates "
                "WHERE status = 'approved' AND linear_identifier IS NOT NULL AND category IS NOT NULL").fetchall()
        return {r["linear_identifier"]: r["category"] for r in rows}

    def decisions_since(self, since_iso: str) -> list[dict]:
        with self.connect() as c:
            rows = c.execute(
                "SELECT source, status, drop_reason, decided_at FROM candidates "
                "WHERE status IN ('approved', 'dropped') AND source != 'manual' AND decided_at >= ?",
                (since_iso,)).fetchall()
        return [dict(r) for r in rows]
