"""When a sweep couldn't load the claude.ai connectors: how Claude Code's connector fetch ended, and
whether Anthropic has posted an incident about it.

The fetch's lines come from ``claude --debug=claudeai-mcp --debug-file …``. Their wording is Claude
Code's, not a contract: when it changes, ``connector_failure`` finds nothing and the sources keep the
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


def connector_failure(lines: list[str]) -> str | None:
    """How Claude Code's connector fetch ended: None when it worked, when no line says, or when Anthropic
    refused the request (a 4xx: a sign-in, permission or rate problem, not an outage); else its last
    status since the last success ("HTTP 503", "ECONNRESET", or "" when no line gave one)."""
    failure: str | None = None
    for line in lines:
        if "[claudeai-mcp]" not in line:
            continue
        if "] Fetched " in line:
            failure = None
        elif found := FETCH_FAILED.search(line):
            value = found.group(1) or ""
            if re.fullmatch(r"4\d\d", value):
                failure = None
            elif re.fullmatch(r"\d{3}", value):
                failure = f"HTTP {value}"
            elif value and value != "unknown":
                failure = value
            elif failure is None:
                failure = ""
    return failure


def claude_code_incident(get: Callable[..., httpx.Response] = httpx.get) -> str | None:
    """The name of the newest unresolved incident on Anthropic's status page that lists Claude Code."""
    try:
        resp = get(STATUS_URL, timeout=5)
        resp.raise_for_status()
        listing = [i for i in resp.json()["incidents"] if any(c["name"] == "Claude Code" for c in i["components"])]
        return max(listing, key=lambda i: i["created_at"])["name"] if listing else None
    except Exception as exc:    # the incident line is optional: never fail a sweep over it
        log.warning("Couldn't read Anthropic's status page: %s", exc)
        return None


def detail(failure: str, incident: str | None) -> str:
    """A failed connector source's detail when Claude Code couldn't load the connectors."""
    status = f" ({failure})" if failure else ""
    text = f"Anthropic's connector service didn't respond{status}, so it wasn't read."
    return f'{text} Anthropic reports "{incident}" ({STATUS_PAGE}).' if incident else text
