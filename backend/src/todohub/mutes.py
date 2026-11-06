"""Mute rules: stop proposing tasks from a sender, a Slack channel or a GitHub repo.

TodoHub suggests a rule after several drops of the same kind and no approvals. A rule is
enforced twice: the sweep is told to skip muted sources (so it doesn't spend turns on them),
and add_candidate refuses any candidate that matches anyway.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from .db import DB

KINDS = ("sender", "channel", "repo")
SUGGEST_AFTER = 3            # drops with no approvals, in the window below
WINDOW_DAYS = 30
NOT_A_PATTERN = ("already_done", "duplicate")   # drop reasons that say nothing about the sender
_REPO_RE = re.compile(r"^https://github\.com/([\w.-]+/[\w.-]+)/")


def keys(c: dict) -> list[dict]:
    """What a candidate could be muted by: its sender, its Slack channel, its GitHub repo."""
    out: list[dict] = []
    sender = (c.get("sender") or "").strip()
    if sender:
        out.append({"kind": "sender", "source": c["source"], "value": sender.lower(), "label": sender})
    if c["source"] == "slack":
        channel = (c.get("source_id") or "").split(":")[0]
        if channel and not channel.startswith("D"):          # a DM is a person: mute the sender instead
            name = (c.get("channel") or "").strip()
            label = (name if name.startswith("#") else f"#{name}") if name else channel
            out.append({"kind": "channel", "source": "slack", "value": channel, "label": label})
    if c["source"] == "github":
        m = _REPO_RE.match(c.get("source_url") or c.get("source_id") or "")
        if m:
            out.append({"kind": "repo", "source": "github", "value": m.group(1).lower(), "label": m.group(1)})
    return out


def _key(k: dict) -> tuple[str, str, str]:
    return (k["kind"], k["source"], k["value"])


def matching_rule(db: DB, c: dict) -> dict | None:
    rules = {_key(r): r for r in db.list_mutes()}
    return next((rules[_key(k)] for k in keys(c) if _key(k) in rules), None)


def suggestion(db: DB, c: dict, now: datetime | None = None) -> dict | None:
    """After dropping ``c``: the sender, channel or repo worth muting, if there is one."""
    since = ((now or datetime.now(timezone.utc)) - timedelta(days=WINDOW_DAYS)).isoformat()
    ruled = {_key(r) for r in db.list_mutes()}
    declined = {tuple(d) for d in db.get_meta("mute_declined", [])}
    recent = db.decided_since(c["source"], since)
    best = None
    for k in keys(c):
        if _key(k) in ruled or _key(k) in declined:
            continue
        drops = approvals = 0
        for d in recent:
            if _key(k) not in {_key(x) for x in keys(d)}:
                continue
            if d["status"] == "approved":
                approvals += 1
            elif d["drop_reason"] not in NOT_A_PATTERN:
                drops += 1
        if approvals == 0 and drops >= SUGGEST_AFTER and (not best or drops > best["drops"]):
            best = {**k, "drops": drops}
    return best


def decline(db: DB, key: dict) -> None:
    declined = db.get_meta("mute_declined", [])
    if list(_key(key)) not in declined:
        db.set_meta("mute_declined", [*declined, list(_key(key))])


def prompt_section(rules: list[dict]) -> str:
    """For the sweep: what to skip, and how to leave it out of searches."""
    if not rules:
        return ""
    lines = ["### Muted by Thibault", "Don't propose tasks from these, and don't open or read their messages:"]
    names = {"sender": "sender", "channel": "Slack channel", "repo": "GitHub repo"}
    for r in rules:
        where = {"gmail": "email", "slack": "Slack", "linear": "Linear", "github": "GitHub"}.get(r["source"], r["source"])
        lines.append(f"- {names[r['kind']]} {r['label']}" + (f" ({where})" if r["kind"] == "sender" else ""))
    lines.append("Leave them out of searches where you can: `-in:#channel` or `-from:@name` in Slack, "
                 "`-from:address` in Gmail.")
    return "\n".join(lines)
