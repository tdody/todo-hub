"""On-demand capture: turn a pasted link or a typed note into a candidate task.

A Slack, Gmail or Grain link needs Claude to read the item, so it starts a short
capture run (see sweep.run_capture). Anything else is a note: it becomes a candidate
right away, with any links in it attached.
"""

from __future__ import annotations

import re
import uuid
from urllib.parse import urlparse

from . import tools
from .config import Settings
from .db import DB

URL_RE = re.compile(r"https://[^\s<>\"')\]]+")
MAX_INPUT = 4000


def source_of(url: str) -> str | None:
    """Which connector can read this link, if any."""
    host = (urlparse(url).hostname or "").lower()
    if host.endswith("slack.com"):
        return "slack"
    if host == "mail.google.com":
        return "gmail"
    if host.endswith("grain.com"):
        return "grain"
    return None


def needs_claude(settings: Settings, text: str) -> bool:
    enabled = set(settings.enabled_sources())
    return any(source_of(u) in enabled for u in URL_RE.findall(text))


def add_note(db: DB, text: str) -> dict:
    """A typed note (optionally with links) becomes a candidate without calling Claude."""
    text = text.strip()[:MAX_INPUT]
    urls = URL_RE.findall(text)
    words = URL_RE.sub("", text).strip()
    first_line = next((l.strip() for l in words.splitlines() if l.strip()), "")
    title = first_line or (urls[0] if urls else "")
    if not title:
        raise tools.ToolError("Type a task or paste a link.")
    rest = "\n".join(l for l in words.splitlines()[1:] if l.strip()) or None
    return tools.add_candidate(
        db, None,
        source="manual", source_id=f"manual:{uuid.uuid4().hex[:12]}", title=title, signal="manual",
        why=rest or "Added by hand.", excerpt=text if len(text) <= 300 else text[:300] + "…",
        source_url=urls[0] if urls else None,
        links=[{"url": u, "title": u} for u in urls[1:]],
    )
