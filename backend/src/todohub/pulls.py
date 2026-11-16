"""Open pull requests for the Pull requests tab, read from GitHub with one `gh api graphql` call.

- mine: the open pull requests you opened.
- review: the open pull requests that ask for your review.

Everything is GitHub data; nothing is written by Claude. Comments, reviews and review requests
from bots are left out.
"""

from __future__ import annotations

import re
from datetime import datetime

from .config import Settings
from .sources import gh_json

MAX_PRS = 50
# The newest review threads read per pull request. Each one costs GitHub a lookup: 30 keep a read
# near 40 of the 5,000 points an hour GitHub allows.
MAX_THREADS = 30
SHOWN_THREADS = 3            # open threads sent with each pull request; the rest are only counted
THREAD_TEXT = 280            # characters kept of a thread's first comment
REVIEW_STATES = {"APPROVED", "CHANGES_REQUESTED", "COMMENTED"}
FAILED_CHECKS = {"FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"}
CI_STATE = {"SUCCESS": "passing", "FAILURE": "failing", "ERROR": "failing", "PENDING": "running", "EXPECTED": "running"}
# Linear's branch names hold the issue ("tdody/eng-646-add-report-url"), and titles often do.
ISSUE_REF = re.compile(r"\b([A-Za-z][A-Za-z0-9]{1,9}-\d+)\b")

FRAGMENTS = """
fragment reviewer on RequestedReviewer { __typename ... on User { login } ... on Team { name } ... on Bot { login } }
fragment pr on PullRequest {
  number title url isDraft createdAt updatedAt additions deletions
  reviewDecision mergeable baseRefName headRefName
  repository { nameWithOwner }
  author { login }
  comments(first: 50) { nodes { author { __typename } } }
  reviewThreads(last: $threads) {
    totalCount
    nodes {
      isResolved path line originalLine
      first: comments(first: 1) { totalCount nodes { author { __typename login } body createdAt } }
    }
  }
  reviewRequests(first: 20) { nodes { requestedReviewer { ...reviewer } } }
  latestReviews(first: 20) { nodes { author { __typename login } state submittedAt } }
  timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 30) {
    nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ...reviewer } } }
  }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { totalCount nodes {
    __typename
    ... on CheckRun { name status conclusion startedAt completedAt detailsUrl }
    ... on StatusContext { context state targetUrl }
  } } } } } }
}
"""
QUERY = """
query($n: Int!, $threads: Int!) {
  viewer { login }
  mine: search(query: "is:pr is:open author:@me archived:false sort:updated-desc", type: ISSUE, first: $n) {
    issueCount nodes { ...pr }
  }
  review: search(query: "is:pr is:open review-requested:@me archived:false sort:updated-desc", type: ISSUE, first: $n) {
    issueCount nodes { ...pr }
  }
}
""" + FRAGMENTS
ONE_QUERY = """
query($owner: String!, $name: String!, $number: Int!, $threads: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { state ...pr } }
}
""" + FRAGMENTS


def read(settings: Settings, env: dict | None = None) -> dict:
    """Your open pull requests and the ones that ask for your review. Raises sources.SourceError."""
    data = (gh_json(settings, ["api", "graphql", "-f", f"query={QUERY}", "-F", f"n={MAX_PRS}",
                                 "-F", f"threads={MAX_THREADS}"], env) or {})["data"]
    me = data["viewer"]["login"]
    mine = _link_stacks([shape(pr, me) for pr in data["mine"]["nodes"] if pr])
    review = [shape(pr, me) for pr in data["review"]["nodes"] if pr]
    return {"login": me, "mine": mine, "review": review,
            "mine_total": data["mine"]["issueCount"], "review_total": data["review"]["issueCount"]}


def read_one(settings: Settings, repo: str, number: int, env: dict | None = None) -> dict | None:
    """One pull request read again, or None when it is closed or merged. Raises sources.SourceError."""
    owner, name = repo.split("/")
    data = (gh_json(settings, ["api", "graphql", "-f", f"query={ONE_QUERY}", "-f", f"owner={owner}", "-f", f"name={name}",
                                 "-F", f"number={number}", "-F", f"threads={MAX_THREADS}"], env) or {})["data"]
    pr = data["repository"]["pullRequest"]
    return shape(pr, data["viewer"]["login"]) if pr["state"] == "OPEN" else None


def updated(d: dict, repo: str, number: int, pr: dict | None) -> dict:
    """The read ``d`` with one pull request read again. A closed or merged one (None) leaves its list."""
    def same(p: dict) -> bool:
        return (p["repo"], p["number"]) == (repo, number)

    out = dict(d)
    for side in ("mine", "review"):
        if not any(map(same, d[side])):
            continue
        if pr:
            prs = [pr if same(p) else p for p in d[side]]
        else:
            prs = [p for p in d[side] if not same(p)]
            out[f"{side}_total"] -= 1
        out[side] = _link_stacks(prs) if side == "mine" else prs
    return out


def _link_stacks(mine: list[dict]) -> list[dict]:
    """Set ``stacked_on``: the number of your open pull request whose head branch is this one's base."""
    heads = {(p["repo"], p["head"]): p["number"] for p in mine}
    return [{**p, "stacked_on": heads.get((p["repo"], p["base"]))} for p in mine]


def shape(pr: dict, me: str) -> dict:
    reviews = {r["author"]["login"]: r for r in _nodes(pr, "latestReviews")
               if r.get("author") and _is_person(r["author"]) and r["state"] in REVIEW_STATES}
    asked = {}
    for e in _nodes(pr, "timelineItems"):          # oldest first, so the last request for each reviewer wins
        if who := _reviewer(e.get("requestedReviewer")):
            asked[who] = e["createdAt"]
    waiting = [w for r in _nodes(pr, "reviewRequests") if (w := _reviewer(r.get("requestedReviewer")))]
    people_threads = [t for t in _nodes(pr, "reviewThreads") if _is_person(_first(t).get("author"))]
    open_threads = [t for t in people_threads if not t["isResolved"]]
    others = {login: r for login, r in reviews.items() if login != me}
    return {
        "number": pr["number"], "title": pr["title"], "url": pr["url"],
        "repo": pr["repository"]["nameWithOwner"], "author": (pr.get("author") or {}).get("login") or "ghost",
        "stage": _stage(pr, others), "created_at": pr["createdAt"], "updated_at": pr["updatedAt"],
        "additions": pr["additions"], "deletions": pr["deletions"],
        "base": pr["baseRefName"], "head": pr["headRefName"], "conflicts": pr["mergeable"] == "CONFLICTING",
        "ci": _ci(pr),
        "comments": sum(_is_person(c.get("author")) for c in _nodes(pr, "comments"))
                    + sum(t["first"]["totalCount"] for t in people_threads),
        "open_threads": len(open_threads),
        "threads_unread": (pr.get("reviewThreads") or {}).get("totalCount", 0) - len(_nodes(pr, "reviewThreads")),
        "threads": [_thread(t) for t in open_threads[:SHOWN_THREADS]],
        "reviewers": [{"login": w, "state": "waiting", "at": asked.get(w)} for w in waiting if w != me]
                     + [{"login": login, "state": r["state"].lower(), "at": r["submittedAt"]}
                        for login, r in others.items() if login not in waiting],
        "refs": list(dict.fromkeys(m.upper() for m in ISSUE_REF.findall(f"{pr['headRefName']} {pr['title']}"))),
        # For the review tab: when you were asked (your own request, else the team's), and whether you reviewed it before.
        "asked_at": asked.get(me) or max((asked[w] for w in waiting if w in asked), default=pr["createdAt"]),
        "reviewed_before": me in reviews,
    }


def _stage(pr: dict, reviews: dict) -> str:
    if pr["isDraft"]:
        return "draft"
    decision = pr.get("reviewDecision")
    if decision is None:                 # the branch needs no review, so GitHub leaves the decision empty
        states = {r["state"] for r in reviews.values()}
        decision = "CHANGES_REQUESTED" if "CHANGES_REQUESTED" in states else "APPROVED" if "APPROVED" in states else None
    return {"APPROVED": "approved", "CHANGES_REQUESTED": "changes_requested"}.get(decision, "in_review")


def _ci(pr: dict) -> dict:
    commits = _nodes(pr, "commits")
    rollup = commits[0]["commit"].get("statusCheckRollup") if commits else None
    if not rollup:
        return {"state": "none", "total": 0, "done": 0, "failing": []}
    done, failing = 0, []
    for c in rollup["contexts"]["nodes"]:
        if c["__typename"] == "CheckRun":
            done += c["status"] == "COMPLETED"
            if c.get("conclusion") in FAILED_CHECKS:
                failing.append({"name": c["name"], "seconds": _seconds(c.get("startedAt"), c.get("completedAt")),
                                "url": c.get("detailsUrl")})
        else:
            done += c.get("state") not in ("PENDING", "EXPECTED")
            if c.get("state") in ("FAILURE", "ERROR"):
                failing.append({"name": c["context"], "seconds": None, "url": c.get("targetUrl")})
    return {"state": CI_STATE.get(rollup["state"], "running"), "total": rollup["contexts"]["totalCount"],
            "done": done, "failing": failing}


def _thread(t: dict) -> dict:
    c = _first(t)
    text = " ".join((c.get("body") or "").split())
    return {"author": (c.get("author") or {}).get("login") or "ghost", "path": t["path"],
            "line": t.get("line") or t.get("originalLine"), "at": c.get("createdAt"),
            "text": text if len(text) <= THREAD_TEXT else text[:THREAD_TEXT - 1].rstrip() + "…"}


def _nodes(pr: dict, field: str) -> list[dict]:
    return [n for n in ((pr.get(field) or {}).get("nodes") or []) if n]


def _first(thread: dict) -> dict:
    return (thread["first"]["nodes"] or [{}])[0]


def _is_person(author: dict | None) -> bool:
    """A deleted account (no author) still counts as a person; a bot does not."""
    return (author or {}).get("__typename") != "Bot"


def _reviewer(r: dict | None) -> str | None:
    """A requested reviewer's login, or a team's name; None for a bot."""
    if not r or r.get("__typename") == "Bot":
        return None
    return r.get("login") or r.get("name")


def _seconds(start: str | None, end: str | None) -> int | None:
    if not start or not end:
        return None
    return int((datetime.fromisoformat(end.replace("Z", "+00:00"))
                - datetime.fromisoformat(start.replace("Z", "+00:00"))).total_seconds())
