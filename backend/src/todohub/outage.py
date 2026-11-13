"""When a sweep couldn't load the claude.ai connectors: how Claude Code's connector fetch ended, and
whether Anthropic has posted an incident about it.

The fetch's lines come from ``claude --debug=claudeai-mcp --debug-file …``. Their wording is Claude
Code's, not a contract: when it changes, ``fetch_failure`` finds nothing and the sources keep the
sweep's own message."""

from __future__ import annotations

import logging
import re
from typing import Callable

import httpx

log = logging.getLogger("todohub.outage")

STATUS_PAGE = "status.claude.com"
STATUS_URL = f"https://{STATUS_PAGE}/api/v2/summary.json"
# "Transient fetch error (503)", "Fetch failed (503) after 3 attempt(s)", "fetch failed transiently"
FETCH_FAILED = re.compile(r"fetch (?:failed|error)(?: \(([^)]*)\))?", re.IGNORECASE)


def fetch_failure(lines: list[str]) -> str | None:
    """How the connector fetch ended: None when it worked or no line says, else its last status since
    the last success ("HTTP 503", "ECONNRESET", or "" when no line gave one)."""
    failure: str | None = None
    for line in lines:
        if "[claudeai-mcp]" not in line:
            continue
        if "] Fetched " in line:
            failure = None
        elif found := FETCH_FAILED.search(line):
            value = found.group(1)
            if value:
                failure = f"HTTP {value}" if re.fullmatch(r"\d{3}", value) else value
            elif failure is None:
                failure = ""
    return failure


def open_incident(get: Callable[..., httpx.Response] = httpx.get) -> str | None:
    """The name of the first unresolved incident on Anthropic's status page that lists Claude Code."""
    try:
        resp = get(STATUS_URL, timeout=5)
        resp.raise_for_status()
        incidents = resp.json().get("incidents") or []
        return next((i["name"] for i in incidents
                     if any(c.get("name") == "Claude Code" for c in i.get("components") or [])), None)
    except Exception as exc:    # the incident line is optional: never fail a sweep over it
        log.warning("Couldn't read Anthropic's status page: %s", exc)
        return None


def message(failure: str, incident: str | None) -> str:
    """A connector source's status after a sweep whose connector fetch failed."""
    text = f"Anthropic's connector service didn't respond{f' ({failure})' if failure else ''}, so it wasn't read."
    return f'{text} Anthropic reports "{incident}" ({STATUS_PAGE}).' if incident else text
