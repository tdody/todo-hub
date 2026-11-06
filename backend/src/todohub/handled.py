"""Pending Inbox candidates that seem to be handled in Linear already.

When Thibault closes, cancels, merges or opens a ticket by hand, the matching suggestion can
sit in the Inbox. Before each sweep (and on Refresh in the app) every pending candidate is
compared with his issues, and a likely match is saved on the candidate as ``handled``:

    {"identifier", "title", "url", "how": "closed" | "canceled" | "opened", "at", "why"}

Rules, in order; the first that fits wins:
1. The issue the candidate targets (``target_issue``, for a "close" or "comment" suggestion) or
   flags as a possible duplicate (``possible_duplicate``) has since been closed or canceled.
2. A closed or canceled issue (touched in the last CLOSED_LOOKBACK_DAYS days) whose title is
   close to the candidate's: similarity >= TITLE_MATCH, or >= TITLE_MATCH_SAME_CLIENT when both
   have the same client label. Similarity is difflib's ratio on lower-cased, punctuation-free
   titles.
3. An open issue created after the candidate arrived, with a title that close (he made the
   ticket himself instead of approving).
A candidate he marked "Keep" for an issue isn't flagged for that issue again. Everything here is
a string comparison: no model, no cost.
"""

from __future__ import annotations

from difflib import SequenceMatcher

from .db import DB, title_key
from .linear import client_label_of

CLOSED_LOOKBACK_DAYS = 14
TITLE_MATCH = 0.78
TITLE_MATCH_SAME_CLIENT = 0.66


def slim(issue: dict, client_group: str = "client") -> dict:
    """The fields the check needs, from a raw Linear issue."""
    state = issue.get("state") or {}
    return {"identifier": issue["identifier"], "title": issue["title"], "url": issue.get("url"),
            "client": client_label_of(issue, client_group), "state_type": state.get("type"),
            "state_name": state.get("name"), "created_at": issue.get("createdAt"),
            "closed_at": issue.get("completedAt") or issue.get("canceledAt") or issue.get("updatedAt")}


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, title_key(a), title_key(b)).ratio()


def _close_enough(c: dict, issue: dict) -> float:
    score = _similar(c["title"], issue["title"])
    same_client = bool(c.get("client_label")) and c.get("client_label") == issue.get("client")
    return score if score >= (TITLE_MATCH_SAME_CLIENT if same_client else TITLE_MATCH) else 0.0


def _closed(issue: dict, why: str) -> dict:
    how = "canceled" if issue.get("state_type") == "canceled" else "closed"
    return {"identifier": issue["identifier"], "title": issue["title"], "url": issue.get("url"),
            "how": how, "at": issue.get("closed_at"), "why": why}


def match(c: dict, open_issues: list[dict], closed: list[dict]) -> dict | None:
    kept = set((c.get("handled") or {}).get("kept") or [])
    by_ident = {i["identifier"]: i for i in closed}
    for ident, why in ((c.get("target_issue"), "the issue this suggestion is about"),
                       (c.get("possible_duplicate"), "the possible duplicate")):
        if ident and ident in by_ident and ident not in kept:
            return _closed(by_ident[ident], why)
    best: tuple[float, dict | None] = (0.0, None)
    if c.get("kind") in ("task", "waiting"):
        for i in closed:
            score = _close_enough(c, i)
            if score > best[0] and i["identifier"] not in kept:
                best = (score, _closed(i, "similar title"))
        for i in open_issues:
            if not i.get("created_at") or not c.get("created_at") or i["created_at"] < c["created_at"]:
                continue
            if i["identifier"] == c.get("possible_duplicate") or i["identifier"] in kept:
                continue
            score = _close_enough(c, i)
            if score > best[0]:
                best = (score, {"identifier": i["identifier"], "title": i["title"], "url": i.get("url"),
                                "how": "opened", "at": i["created_at"], "why": "similar title"})
    return best[1]


def recheck(db: DB, open_issues: list[dict], closed: list[dict]) -> int:
    """Update the ``handled`` flag on every pending candidate. Returns how many are flagged."""
    flagged = 0
    for c in db.list_candidates("pending"):
        hit = match(c, open_issues, closed)
        kept = (c.get("handled") or {}).get("kept") or []
        new = {**hit, "kept": kept} if hit else ({"kept": kept} if kept else None)
        if new != c.get("handled"):
            db.set_handled(c["id"], new)
        flagged += bool(hit)
    return flagged


def keep(db: DB, c: dict) -> None:
    """"Keep" on a flagged candidate: forget this match and don't suggest it again."""
    h = c.get("handled") or {}
    kept = sorted(set(h.get("kept") or []) | ({h["identifier"]} if h.get("identifier") else set()))
    db.set_handled(c["id"], {"kept": kept})
