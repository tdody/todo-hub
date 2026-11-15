import json

import pytest
from fastapi.testclient import TestClient

from todohub import pulls
from todohub.api import create_app
from todohub.config import load_settings
from todohub.db import DB

ME = "thib"


@pytest.fixture
def settings():
    return load_settings()


def person(login):
    return {"__typename": "User", "login": login}


def thread(starter, resolved=False, comments=1, body="Rename it.", path="api/report.py", line=88):
    return {"isResolved": resolved, "path": path, "line": line, "originalLine": line,
            "first": {"totalCount": comments, "nodes": [{"author": starter, "body": body, "createdAt": "2026-11-13T09:00:00Z"}]}}


def pr(number, title="Report list page", head="thib/eng-716-report-list", base="main", draft=False, decision=None,
       rollup=None, comments=(), threads=(), requests=(), reviews=(), asked=(), mergeable="MERGEABLE", unread=0):
    return {
        "number": number, "title": title, "url": f"https://github.com/initech/platform/pull/{number}",
        "isDraft": draft, "createdAt": "2026-11-01T10:00:00Z", "updatedAt": "2026-11-13T10:00:00Z",
        "additions": 10, "deletions": 2, "reviewDecision": decision, "mergeable": mergeable,
        "baseRefName": base, "headRefName": head, "repository": {"nameWithOwner": "initech/platform"},
        "author": {"login": ME},
        "comments": {"nodes": [{"author": a} for a in comments]},
        "reviewThreads": {"totalCount": len(threads) + unread, "nodes": list(threads)},
        "reviewRequests": {"nodes": [{"requestedReviewer": r} for r in requests]},
        "latestReviews": {"nodes": [{"author": a, "state": s, "submittedAt": "2026-11-12T10:00:00Z"} for a, s in reviews]},
        "timelineItems": {"nodes": [{"createdAt": at, "requestedReviewer": r} for r, at in asked]},
        "commits": {"nodes": [{"commit": {"statusCheckRollup": rollup}}]},
    }


def checks(state, *nodes):
    return {"state": state, "contexts": {"totalCount": len(nodes), "nodes": list(nodes)}}


def run(name, conclusion="SUCCESS", status="COMPLETED"):
    return {"__typename": "CheckRun", "name": name, "status": status, "conclusion": conclusion,
            "startedAt": "2026-11-13T10:00:00Z", "completedAt": "2026-11-13T10:01:12Z",
            "detailsUrl": f"https://github.com/initech/platform/actions/runs/7/{name}"}


def fake_gh(tmp_path, settings, mine=(), review=()):
    """A gh that prints the given pull requests and counts its runs in calls.txt."""
    out, calls = tmp_path / "gh.json", tmp_path / "calls.txt"
    out.write_text(json.dumps({"data": {
        "viewer": {"login": ME},
        "mine": {"issueCount": len(mine), "nodes": list(mine)},
        "review": {"issueCount": len(review), "nodes": list(review)},
    }}))
    gh = tmp_path / "gh"
    gh.write_text(f"#!/bin/sh\necho x >> {calls}\ncat {out}\n")
    gh.chmod(0o755)
    settings.gh_path = str(gh)
    return out, calls


def test_read_shapes_mine(settings, tmp_path):
    bot = {"__typename": "Bot", "login": "linear-code"}
    fake_gh(tmp_path, settings, mine=[
        pr(1, head="thib/eng-716-report-list", decision="CHANGES_REQUESTED",
           rollup=checks("FAILURE", run("lint", "FAILURE"), run("test"), run("build", None, "IN_PROGRESS")),
           comments=[person("ana"), bot, bot],
           threads=[thread(person("ana"), comments=2), thread(person("raj")),
                    thread(person("ana"), resolved=True), thread(bot)],
           requests=[person("raj"), {"__typename": "Bot", "login": "copilot"}],
           reviews=[(person("ana"), "CHANGES_REQUESTED"), (bot, "APPROVED")],
           asked=[(person("raj"), "2026-11-10T10:00:00Z"), (person("raj"), "2026-11-12T10:00:00Z")]),
        pr(2, title="ENG-719: Paginate the report list", head="thib/paginate", base="thib/eng-716-report-list",
           draft=True, rollup=checks("PENDING", run("lint"), run("test", None, "QUEUED")), mergeable="CONFLICTING"),
        pr(3, head="thib/readme", reviews=[(person("raj"), "APPROVED")], unread=4),
    ])
    d = pulls.read(settings)
    first, second, third = d["mine"]
    assert d["login"] == ME and d["mine_total"] == 3
    assert first["stage"] == "changes_requested" and first["refs"] == ["ENG-716"]
    assert first["ci"] == {"state": "failing", "total": 3, "done": 2, "failing": [{"name": "lint", "seconds": 72, "url": "https://github.com/initech/platform/actions/runs/7/lint"}]}
    assert first["comments"] == 1 + 2 + 1 + 1          # ana's comment, then the people's threads; no bots
    assert first["open_threads"] == 2                  # the third is resolved; the bot's is left out
    assert first["threads"][0]["author"] == "ana" and first["threads"][0]["path"] == "api/report.py"
    assert first["reviewers"] == [{"login": "raj", "state": "waiting", "at": "2026-11-12T10:00:00Z"},
                                  {"login": "ana", "state": "changes_requested", "at": "2026-11-12T10:00:00Z"}]
    assert first["stacked_on"] is None
    assert second["stage"] == "draft" and second["stacked_on"] == 1 and second["conflicts"]
    assert second["ci"]["state"] == "running" and second["ci"]["done"] == 1
    assert second["refs"] == ["ENG-719"]
    # no review decision (the branch needs none): the reviews decide
    assert third["stage"] == "approved" and third["ci"]["state"] == "none"
    assert first["threads_unread"] == 0 and third["threads_unread"] == 4     # older threads than the newest 30


def test_read_review_requests(settings, tmp_path):
    team = {"__typename": "Team", "name": "platform"}
    fake_gh(tmp_path, settings, review=[
        pr(5, requests=[person(ME)], reviews=[(person(ME), "COMMENTED")],
           asked=[(person(ME), "2026-11-02T10:00:00Z"), (person(ME), "2026-11-11T10:00:00Z")]),
        pr(6, requests=[team], asked=[(team, "2026-11-09T10:00:00Z")]),
        pr(7, requests=[team]),
    ])
    five, six, seven = pulls.read(settings)["review"]
    assert five["asked_at"] == "2026-11-11T10:00:00Z" and five["reviewed_before"]
    assert six["asked_at"] == "2026-11-09T10:00:00Z" and not six["reviewed_before"]
    assert seven["asked_at"] == "2026-11-01T10:00:00Z"       # no request event: when it was opened


def test_pulls_endpoint_caches_and_keeps_the_last_read(settings, tmp_path):
    out, calls = fake_gh(tmp_path, settings, mine=[pr(1)])
    client = TestClient(create_app(settings, DB(settings.db_path)))
    body = client.get("/api/pulls").json()
    assert [p["number"] for p in body["mine"]] == [1] and body["read_at"] and body["error"] is None
    client.get("/api/pulls")
    assert len(calls.read_text().split()) == 1           # read once, then from the cache

    (tmp_path / "gh").write_text("#!/bin/sh\necho 'To get started with GitHub CLI, please run:  gh auth login' >&2\nexit 4\n")
    body = client.get("/api/pulls?refresh=true").json()
    assert body["error"] == "gh is not signed in. Run gh auth login in a terminal." and body["error_at"]
    assert [p["number"] for p in body["mine"]] == [1]    # what was read before
