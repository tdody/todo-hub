"""Sources the sweep reads directly, without Claude's connectors.

- GitHub review requests: `gh search prs --review-requested=@me`. Each open PR becomes a
  "Review …" candidate. When an approved review issue's PR no longer asks for your review
  (you reviewed it, or it was merged or closed), a "close" candidate is proposed.
- Linear mentions: notifications where someone @-mentions you. They're handed to Claude as
  data in the sweep prompt, because deciding whether a mention is a task needs judgment.
"""

from __future__ import annotations

import json
import subprocess
from datetime import datetime

from . import tools
from .config import Settings
from .db import DB
from .linear import Linear, LinearError

MENTION_TYPES = {"issueMention", "issueCommentMention"}
MAX_MENTION_TEXT = 600


class SourceError(RuntimeError):
    pass


def github_review_requests(settings: Settings, env: dict | None = None) -> list[dict]:
    cmd = [settings.gh_path, "search", "prs", "--review-requested=@me", "--state=open",
           "--json", "number,title,url,repository,author,updatedAt", "--limit", "50"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=env)
    except FileNotFoundError:
        raise SourceError(f"Can't find gh at {settings.gh_path!r}. Install it or set sweep.gh_path.")
    except subprocess.TimeoutExpired:
        raise SourceError("gh timed out.")
    if proc.returncode != 0:
        raise SourceError(f"gh failed: {proc.stderr.strip()[:300]} (run `gh auth login`?)")
    try:
        return json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
        raise SourceError("gh returned something that isn't JSON.")


def sync_github(settings: Settings, db: DB, run_id: int, env: dict | None = None) -> None:
    """Add review requests as candidates, and propose closing reviews that are no longer requested."""
    try:
        prs = github_review_requests(settings, env)
    except SourceError as exc:
        db.report_source_status(run_id, "github", False, str(exc), None)
        return
    added = 0
    for pr in prs:
        url = pr["url"]
        if db.is_seen("github", url):
            continue
        repo = (pr.get("repository") or {}).get("nameWithOwner") or (pr.get("repository") or {}).get("name", "")
        short = repo.split("/")[-1]
        tools.add_candidate(
            db, run_id, source="github", source_id=url, source_url=url, signal="review_request",
            title=f"Review {short}#{pr['number']}: {pr['title']}",
            why=f"{(pr.get('author') or {}).get('login', 'Someone')} requested your review on GitHub.",
            excerpt=pr["title"], who=(pr.get("author") or {}).get("login"), priority=3,
        )
        added += 1
    requested = {pr["url"] for pr in prs}
    open_ids = [i["identifier"] for i in db.get_meta("open_issues", [])]
    closes = 0
    for w in db.watched_issues(open_ids):
        if w["source"] == "github" and w["source_url"] not in requested:
            try:
                r = tools.propose_close(
                    db, run_id, source="github", source_id=f"{w['source_url']}#done", source_url=w["source_url"],
                    target_issue=w["linear_identifier"],
                    why="GitHub no longer asks for your review: you reviewed it, or the PR was merged or closed.",
                    excerpt="Review request cleared on GitHub",
                )
                closes += r["status"] == "added"
            except tools.ToolError:
                pass
    db.report_source_status(
        run_id, "github", True, f"{len(prs)} open review requests, {added} new, {closes} to close", len(prs))


def linear_mentions(client: Linear, since: datetime) -> list[dict]:
    """Mentions of you in Linear since ``since``, newest first, with the comment text clipped."""
    data = client.gql(
        """
        query {
          notifications(first: 50, orderBy: createdAt) {
            nodes {
              id type createdAt
              actor { name }
              ... on IssueNotification {
                issue { identifier title url }
                comment { body url }
              }
            }
          }
        }
        """
    )
    out = []
    for n in data["notifications"]["nodes"]:
        if n.get("type") not in MENTION_TYPES:
            continue
        created = datetime.fromisoformat(n["createdAt"].replace("Z", "+00:00"))
        if created <= since:
            continue
        issue = n.get("issue") or {}
        comment = n.get("comment") or {}
        out.append({
            "id": n["id"],
            "when": n["createdAt"],
            "who": (n.get("actor") or {}).get("name", "someone"),
            "issue": issue.get("identifier"),
            "issue_title": issue.get("title"),
            "url": comment.get("url") or issue.get("url"),
            "text": (comment.get("body") or "")[:MAX_MENTION_TEXT],
        })
    return out


def mentions_section(mentions: list[dict] | None, error: str | None = None) -> str:
    if error:
        return f"(couldn't read Linear mentions: {error})"
    if not mentions:
        return "(no new mentions)"
    blocks = []
    for m in mentions:
        text = m["text"].replace("```", "'''")
        blocks.append(
            f"- notification {m['id']} | {m['when'][:16]} | {m['who']} on {m['issue']} \"{m['issue_title']}\" | {m['url']}\n"
            f"  ```\n  {text}\n  ```"
        )
    return "\n".join(blocks)
