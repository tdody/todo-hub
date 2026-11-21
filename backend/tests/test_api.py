import dataclasses

import pytest
from fastapi.testclient import TestClient

from todohub import tools
from todohub.api import PREVIEW_DESCRIPTION, create_app, issue_description
from todohub.config import load_settings
from todohub.db import DB
from todohub.linear import LinearError
from conftest import FakeLinear, make_issue


@pytest.fixture
def env():
    settings = load_settings()
    db = DB(settings.db_path)
    db.set_meta("client_labels", ["Initech & Co", "Globex"])
    fake = FakeLinear()
    launched = []
    app = create_app(settings, db, linear_factory=lambda: fake, sweep_launcher=lambda args: launched.append(args))
    return TestClient(app), db, fake, launched


def seed(db, **over):
    args = dict(source="slack", source_id="C1:1.0", title="Send Sam the Q1 review deck", signal="ask",
                why="Sam asked for it.", excerpt="can you send\nthe file?", who="Sam",
                source_url="https://example.slack.com/archives/C1/p1", client_label="Initech & Co")
    args.update(over)
    return tools.add_candidate(db, None, **args)["id"]


def test_approve_creates_linear_issue(env):
    client, db, fake, _ = env
    cid = seed(db)
    r = client.post(f"/api/candidates/{cid}/approve", json={"title": "Send Sam the review deck", "due_date": "2026-11-07"})
    assert r.status_code == 200, r.text
    created = fake.created[0]
    assert created["title"] == "Send Sam the review deck"
    assert created["state_id"] == "s-Todo" and created["assignee_id"] == "me"
    assert created["label_ids"] == ["l-Initech & Co"]
    assert created["priority"] == 4          # default for "no priority"
    assert created["due_date"] == "2026-11-07"
    assert "> the file?" in created["description"] and "[Slack message](https://" in created["description"]
    assert r.json()["candidate"]["linear_identifier"] == "ENG-99"
    assert client.get("/api/candidates").json() == []
    assert client.post(f"/api/candidates/{cid}/approve").status_code == 409


def test_approve_attaches_links_and_creates_subtasks(env):
    client, db, fake, _ = env
    cid = seed(db, links=[{"url": "https://docs.google.com/d/1", "title": "Review [Q1] deck"}],
               subtasks=[{"title": "Pull the list"}, {"title": "Send to Sam", "due_date": "2026-11-06"}])
    # edit the subtasks before approving: rename one, add one, drop none
    r = client.post(f"/api/candidates/{cid}/approve", json={"subtasks": [
        {"title": "Pull the new-customer list"}, {"title": "Send to Sam", "due_date": "2026-11-06"},
        {"title": "Confirm receipt"}]})
    assert r.status_code == 200, r.text
    body = r.json()
    parent, *children = fake.created
    assert "**Links**\n- [Review (Q1) deck](https://docs.google.com/d/1)" in parent["description"]
    assert [c["title"] for c in children] == ["Pull the new-customer list", "Send to Sam", "Confirm receipt"]
    assert all(c["parent_id"] == "id-ENG-99" for c in children)
    assert children[1]["due_date"] == "2026-11-06" and children[0]["due_date"] is None
    assert all(c["label_ids"] == ["l-Initech & Co"] for c in children)
    assert fake.links == [
        ("id-ENG-99", "https://example.slack.com/archives/C1/p1", "Slack message"),
        ("id-ENG-99", "https://docs.google.com/d/1", "Review [Q1] deck"),
    ]
    assert len(body["subtasks"]) == 3 and body["warnings"] == []
    assert body["subtasks"][0]["parent"]["id"] == "id-ENG-99"


def test_subtask_failure_is_a_warning_not_a_retry(env):
    client, db, fake, _ = env
    fake.fail_titles = {"Send to Sam"}
    cid = seed(db, subtasks=[{"title": "Pull the list"}, {"title": "Send to Sam"}])
    body = client.post(f"/api/candidates/{cid}/approve").json()
    assert len(body["subtasks"]) == 1
    assert body["warnings"] == ["Subtask not created (Send to Sam): boom"]
    assert db.get_candidate(cid)["status"] == "approved"


def test_drop_restore_and_edit(env):
    client, db, *_ = env
    cid = seed(db)
    assert client.patch(f"/api/candidates/{cid}", json={"client_label": "Nope"}).status_code == 400
    r = client.patch(f"/api/candidates/{cid}", json={"client_label": None, "priority": 2})
    assert r.json()["client_label"] is None and r.json()["priority"] == 2
    assert client.post(f"/api/candidates/{cid}/drop").json()["status"] == "dropped"
    assert client.post(f"/api/candidates/{cid}/restore").json()["status"] == "pending"


def test_issue_lists_and_edits(env):
    client, _, fake, _ = env
    issues = client.get("/api/issues").json()
    assert {i["identifier"]: i["list"] for i in issues} == {"ENG-1": "client", "ENG-2": "dev"}
    r = client.patch("/api/issues/id-ENG-2", json={"due_date": None, "state_id": "s-Done"})
    assert r.status_code == 200
    assert fake.updated[0] == ("id-ENG-2", {"stateId": "s-Done", "dueDate": None})
    assert client.patch("/api/issues/id-ENG-2", json={}).status_code == 400
    assert client.patch("/api/issues/id-ENG-2", json={"due_date": "soon"}).status_code == 422


def test_edit_issue_title_and_description(env):
    client, _, fake, _ = env
    r = client.patch("/api/issues/id-ENG-2", json={"title": "  Fix the report copy "})
    assert r.status_code == 200 and r.json()["title"] == "Fix the report copy"     # the app shows what Linear returns
    assert fake.updated[-1] == ("id-ENG-2", {"title": "Fix the report copy"})
    assert client.patch("/api/issues/id-ENG-2", json={"description": "## Steps\n\n- one"}).status_code == 200
    assert fake.updated[-1] == ("id-ENG-2", {"description": "## Steps\n\n- one"})
    client.patch("/api/issues/id-ENG-2", json={"description": None})
    assert fake.updated[-1] == ("id-ENG-2", {"description": ""})
    r = client.patch("/api/issues/id-ENG-2", json={"title": "   "})
    assert r.status_code == 400 and r.json()["error"] == "The title can't be empty"
    assert client.patch("/api/issues/id-ENG-2", json={"title": "x" * 201}).status_code == 422
    assert len(fake.updated) == 3


def test_edit_issue_client_swaps_only_the_client_label(env):
    client, _, fake, _ = env
    r = client.patch("/api/issues/id-ENG-1", json={"client": "Initech & Co"})
    assert r.status_code == 200, r.text
    # ENG-1 has Bug and Globex; only Globex (in the client group) goes.
    assert fake.updated[-1] == ("id-ENG-1", {"removedLabelIds": ["l-Globex"], "addedLabelIds": ["l-Initech & Co"]})
    assert (r.json()["client"], r.json()["list"]) == ("Initech & Co", "client")   # the app re-sorts its lists from this
    r = client.patch("/api/issues/id-ENG-1", json={"client": None})      # to Dev
    assert fake.updated[-1] == ("id-ENG-1", {"removedLabelIds": ["l-Globex"]})
    assert (r.json()["client"], r.json()["list"]) == (None, "dev")
    client.patch("/api/issues/id-ENG-2", json={"client": "Globex"})      # from Dev
    assert fake.updated[-1] == ("id-ENG-2", {"addedLabelIds": ["l-Globex"]})
    r = client.patch("/api/issues/id-ENG-1", json={"client": "Globex"})  # already Globex: nothing to send
    assert r.status_code == 200 and r.json()["client"] == "Globex"
    r = client.patch("/api/issues/id-ENG-1", json={"client": "Vandelay"})
    assert r.status_code == 400 and r.json()["error"] == "No client label 'Vandelay' in Linear"
    assert len(fake.updated) == 3


def test_edit_issue_project(env):
    client, _, fake, _ = env
    r = client.patch("/api/issues/id-ENG-2", json={"project": "Globex"})
    assert fake.updated[-1] == ("id-ENG-2", {"projectId": "p-globex"}) and r.json()["project"] == "Globex"
    client.patch("/api/issues/id-ENG-2", json={"project": None})
    assert fake.updated[-1] == ("id-ENG-2", {"projectId": None})
    r = client.patch("/api/issues/id-ENG-2", json={"project": "Old thing"})
    assert r.status_code == 400 and r.json()["error"] == "No open project 'Old thing' in Linear"
    assert len(fake.updated) == 2


def test_post_and_delete_comment(env):
    client, _, fake, _ = env
    r = client.post("/api/issues/id-ENG-1/comments", json={"body": "  Sent the file to Sam.  "})
    assert r.status_code == 200 and r.json() == {"id": "comment-1"}
    assert fake.comments == [("id-ENG-1", "Sent the file to Sam.")]
    assert client.delete("/api/comments/comment-1").json() == {"deleted": "comment-1"}
    assert fake.deleted_comments == ["comment-1"]
    r = client.post("/api/issues/id-ENG-1/comments", json={"body": "   "})
    assert r.status_code == 400 and r.json()["error"] == "The comment is empty"
    assert client.post("/api/issues/id-ENG-1/comments", json={"body": "x" * 2001}).status_code == 422
    assert len(fake.comments) == 1


def test_add_sub_issue_takes_the_parents_client_project_and_priority(env):
    client, _, fake, _ = env
    fake.issues[0].update(priority=2, project={"id": "p-globex", "name": "Globex"})
    r = client.post("/api/issues/id-ENG-1/sub-issues", json={"title": " Check the CSV "})
    assert r.status_code == 200, r.text
    assert r.json()["parent"]["id"] == "id-ENG-1"
    assert fake.created[-1] == {
        "team_id": "team-eng", "title": "Check the CSV", "description": "Part of ENG-1: Rebin Globex grades",
        "assignee_id": "me", "state_id": "s-Todo", "priority": 2, "due_date": None,
        "label_ids": ["l-Globex"], "parent_id": "id-ENG-1", "project_id": "p-globex",
    }
    # a Dev parent without a project: no labels, no project
    client.post("/api/issues/id-ENG-2/sub-issues", json={"title": "Read the logs"})
    assert fake.created[-1]["label_ids"] == [] and fake.created[-1]["project_id"] is None
    r = client.post("/api/issues/id-ENG-1/sub-issues", json={"title": "   "})
    assert r.status_code == 400 and r.json()["error"] == "The title can't be empty"
    assert client.post("/api/issues/id-ENG-1/sub-issues", json={"title": "x" * 201}).status_code == 422
    assert len(fake.created) == 2


def test_sub_issue_of_another_teams_issue_goes_in_that_team(env):
    client, _, fake, _ = env
    fake.issues[0].update(team={"id": "team-ops"}, project={"id": "p-ops", "name": "Ops"})
    fake.team_states = lambda team_id: [{"id": "ops-later", "name": "Later", "type": "backlog", "position": 0},
                                        {"id": "ops-next", "name": "Next", "type": "unstarted", "position": 1}]
    assert client.post("/api/issues/id-ENG-1/sub-issues", json={"title": "Check the CSV"}).status_code == 200
    made = fake.created[-1]
    assert (made["team_id"], made["state_id"], made["project_id"]) == ("team-ops", "ops-next", "p-ops")
    fake.team_states = lambda team_id: [{"id": "ops-later", "name": "Later", "type": "backlog", "position": 0}]
    r = client.post("/api/issues/id-ENG-1/sub-issues", json={"title": "Check the CSV"})
    assert r.status_code == 502 and "no not-started status" in r.json()["error"]


@pytest.mark.parametrize("todo_state, expected", [
    ("Pending", "Pending"),     # the setting names a not-started status: it wins over the first one
    ("Ready", "Todo"),          # no status by that name: the team's first not-started one
])
def test_sub_issue_status_follows_the_todo_setting(todo_state, expected):
    """A new sub-issue gets it, and /api/meta names it for the app's untick."""
    settings = load_settings()
    settings.todo_state = todo_state
    fake = FakeLinear()
    client = TestClient(create_app(settings, DB(settings.db_path), linear_factory=lambda: fake,
                                   sweep_launcher=lambda args: None))
    assert client.post("/api/issues/id-ENG-1/sub-issues", json={"title": "Check the CSV"}).status_code == 200
    assert fake.created[-1]["state_id"] == f"s-{expected}"
    assert client.get("/api/meta").json()["todo_state"] == expected


@pytest.mark.parametrize("done_state, expected", [
    ("Shipped", "Shipped"),     # the setting names a completed status: it wins over the first one
    ("Closed", "Done"),         # no status by that name: the team's first completed one
    ("Pending", "Done"),        # names a status that isn't completed: the team's first completed one
])
def test_done_status_follows_the_done_setting(done_state, expected):
    """Closing from the Inbox uses it, and /api/meta names it for the app's Mark done and tick."""
    settings = load_settings()
    settings.done_state = done_state
    fake = FakeLinear()
    meta = fake.team_meta
    shipped = {"id": "s-Shipped", "name": "Shipped", "type": "completed", "position": 4}
    fake.team_meta = lambda *a: dataclasses.replace(meta(*a), states=[*meta(*a).states, shipped])
    db = DB(settings.db_path)
    client = TestClient(create_app(settings, db, linear_factory=lambda: fake, sweep_launcher=lambda args: None))
    assert client.get("/api/meta").json()["done_state"] == expected
    db.set_meta("open_issues", [{"identifier": "ENG-1", "title": "Rebin Globex grades"}])
    cid = tools.propose_close(db, None, source="slack", source_id="C1:2", source_url="https://example.slack.com/archives/C1/p2",
                              target_issue="ENG-1", why="Sent the grades.", excerpt="here they are")["id"]
    assert client.post(f"/api/candidates/{cid}/approve").status_code == 200
    assert fake.updated[-1] == ("id-ENG-1", {"stateId": f"s-{expected}"})


def test_meta_and_sweep(env):
    client, db, _, launched = env
    m = client.get("/api/meta").json()
    assert [s["name"] for s in m["states"]] == ["Backlog", "Todo", "Pending", "Done"]
    assert (m["todo_state"], m["done_state"]) == ("Todo", "Done")
    assert m["sources"] == ["slack", "gmail", "grain", "calendar", "hubspot", "linear", "github"]
    assert client.post("/api/sweep").status_code == 202 and launched == [["--trigger", "manual"]]
    assert client.post("/api/sweep", json={"source": "fax"}).status_code == 400
    assert client.post("/api/sweep", json={"source": "gmail"}).json() == {"started": True, "source": "gmail"}
    assert launched[-1] == ["--trigger", "manual", "--source", "gmail"]
    rid = db.start_run("manual", "2026-11-03T00:00:00+00:00")
    db.set_meta("run_scopes", {str(rid): "gmail"})
    db.report_source_status(rid, "gmail", False, "needs sign-in", 0)
    latest = client.get("/api/runs/latest").json()
    assert latest["scope"] == "gmail"
    over = {o["source"]: o for o in latest["source_overview"]}
    assert over["gmail"]["ok"] is False and over["gmail"]["detail"] == "needs sign-in" and over["slack"]["ok"] is None
    assert client.post("/api/sweep").status_code == 409
    # a run stuck in "running" for longer than the timeout no longer blocks
    with db.connect() as c:
        c.execute("UPDATE runs SET started_at = '2026-01-01T00:00:00+00:00'")
    assert client.post("/api/sweep").status_code == 202


def test_token_required(monkeypatch):
    monkeypatch.setenv("TODOHUB_TOKEN", "s3cret")
    settings = load_settings()
    client = TestClient(create_app(settings, DB(settings.db_path), linear_factory=FakeLinear))
    assert client.get("/api/candidates").status_code == 401
    assert client.get("/api/candidates", headers={"X-TodoHub-Token": "s3cret"}).status_code == 200
    assert client.get("/api/health").status_code == 200


def test_description_without_optional_fields():
    text = issue_description({"source": "grain", "signal": "action_item", "created_at": "2026-11-03T10:00:00+00:00"})
    assert text.startswith("**Source:** Grain meeting")


def test_capture_note_is_immediate(env):
    client, db, _, launched = env
    r = client.post("/api/capture", json={"text": "Draft Globex readout outline\nfor Friday https://docs.google.com/d/9 https://github.com/x/pull/1"})
    assert r.status_code == 200 and r.json()["mode"] == "note"
    c = r.json()["candidate"]
    assert c["title"] == "Draft Globex readout outline" and c["source"] == "manual"
    assert c["source_url"] == "https://docs.google.com/d/9"
    assert c["links"] == [{"url": "https://github.com/x/pull/1", "title": "https://github.com/x/pull/1"}]
    assert c["why"] == "for Friday"
    assert launched == []
    assert client.post("/api/capture", json={"text": "   "}).status_code == 400


def test_capture_link_starts_claude(env):
    client, db, _, launched = env
    link = "https://example.slack.com/archives/C1/p1730650000123456"
    r = client.post("/api/capture", json={"text": f"this one {link}"})
    assert r.status_code == 202 and r.json()["mode"] == "claude"
    assert launched == [["--capture", f"this one {link}"]]
    db.start_run("capture", "2026-11-03T00:00:00+00:00")
    assert client.post("/api/capture", json={"text": link}).status_code == 409
    # a running capture doesn't block sweeps, and vice versa
    assert client.post("/api/sweep").status_code == 202
    assert client.get("/api/runs/latest?kind=capture").json()["trigger"] == "capture"
    assert client.get("/api/runs/latest").json() == {}


def test_drop_reason_and_stats(env):
    client, db, *_ = env
    a, b = seed(db), seed(db, title="Something else")
    assert client.post(f"/api/candidates/{a}/drop", json={"reason": "not_mine"}).json()["drop_reason"] == "not_mine"
    assert client.post(f"/api/candidates/{b}/drop", json={"reason": "bogus"}).status_code == 422
    assert client.post(f"/api/candidates/{b}/approve").status_code == 200
    restored = client.post(f"/api/candidates/{a}/restore").json()
    assert restored["status"] == "pending" and restored["drop_reason"] is None and restored["decided_at"] is None
    client.post(f"/api/candidates/{a}/drop")      # no body: reason "other"
    week = client.get("/api/stats/approval?weeks=1").json()
    assert week["weeks"][0]["sources"]["all"] == {"approved": 1, "dropped": 1, "rate": 0.5}
    assert week["drop_reasons"] == {"other": 1}


def test_approve_waiting_goes_to_pending(env):
    client, db, fake, _ = env
    cid = seed(db, title="Waiting on Sam: customer key", signal="waiting_on", asked_on="2026-11-05")
    client.post(f"/api/candidates/{cid}/approve")
    assert fake.created[0]["state_id"] == "s-Pending" and fake.created[0]["due_date"] == "2026-11-10"


def test_approve_close_and_comment(env):
    client, db, fake, _ = env
    db.set_meta("open_issues", [{"identifier": "ENG-1", "title": "Rebin Globex grades"}])
    url = "https://example.slack.com/archives/C1/p11"
    close = tools.propose_close(db, None, source="slack", source_id="C1:2", source_url=url, target_issue="ENG-1",
                                why="Sent the rebinned grades.", excerpt="here are the new cut-lines")["id"]
    body = client.post(f"/api/candidates/{close}/approve").json()
    assert fake.updated == [("id-ENG-1", {"stateId": "s-Done"})]
    assert fake.comments[0][0] == "id-ENG-1" and "Closed from TodoHub: Sent the rebinned grades." in fake.comments[0][1]
    assert f"[Slack message]({url})" in fake.comments[0][1] and "> here are the new cut-lines" in fake.comments[0][1]
    assert body["issue"]["state"]["name"] == "Done" and fake.created == []

    upd = tools.propose_update(db, None, source="slack", source_id="C1:3", source_url=url, target_issue="ENG-1",
                               comment="Readout moved to Nov 12.", why="w", excerpt="e")["id"]
    r = client.post(f"/api/candidates/{upd}/approve", json={"comment": "Readout moved to Thu Nov 12."})
    assert r.status_code == 200
    assert fake.comments[1] == ("id-ENG-1", f"Readout moved to Thu Nov 12.\n\n**Source:** [Slack message]({url})")


def test_project_suggestion_flows_to_linear(env):
    client, db, fake, _ = env
    client.get("/api/meta")                          # caches the project names
    db.set_meta("open_issues", [])
    cid = seed(db, project="globex", subtasks=[{"title": "Pull leads"}])
    assert db.get_candidate(cid)["project"] == "Globex"
    assert client.patch(f"/api/candidates/{cid}", json={"project": "Nope"}).status_code == 400
    client.post(f"/api/candidates/{cid}/approve")
    assert [c["project_id"] for c in fake.created] == ["p-globex", "p-globex"]
    assert "Globex" in client.get("/api/meta").json()["projects"]


def test_today_and_time_blocks(tmp_path):
    settings = load_settings()
    db = DB(settings.db_path)
    fake = FakeLinear()
    blocks = []

    def fake_block(**kw):
        blocks.append(kw)
        return "https://calendar.google.com/event?eid=abc"

    client = TestClient(create_app(settings, db, linear_factory=lambda: fake, block_fn=fake_block))
    r = client.put("/api/today", json={"issue_ids": ["id-ENG-1", "id-ENG-2", "id-ENG-1"]}).json()
    assert [i["issue_id"] for i in r["items"]] == ["id-ENG-1", "id-ENG-2"]
    assert client.post("/api/today/id-ENG-9/block", json={"start": "10:00", "minutes": 60}).status_code == 400
    assert client.post("/api/today/id-ENG-1/block", json={"start": "25:00", "minutes": 60}).status_code == 422
    r = client.post("/api/today/id-ENG-1/block", json={"start": "10:30", "minutes": 90}).json()
    assert blocks[0]["title"] == "ENG-1 Rebin Globex grades" and blocks[0]["minutes"] == 90
    assert blocks[0]["start"].hour == 10 and blocks[0]["start"].minute == 30
    item = r["items"][0]
    assert item["event_minutes"] == 90 and item["event_link"].startswith("https://calendar.google.com")
    # reordering keeps the block
    r = client.put("/api/today", json={"issue_ids": ["id-ENG-2", "id-ENG-1"]}).json()
    assert r["items"][1]["event_link"] and r["items"][0]["event_link"] is None


def test_balance_summary_runs_and_logs(env):
    from datetime import datetime, timezone
    from conftest import make_issue
    client, db, fake, _ = env
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    fake.completed = [make_issue("ENG-5", "Ship Globex grade cut-lines", client="Globex", state="Done", completed=now),
                      make_issue("ENG-6", "Refactor report", state="Done", completed=now)]
    fake.issues.append(make_issue("ENG-7", "Waiting on Pat: lead export", client="Globex", state="Pending"))
    week = client.get("/api/stats/balance?weeks=4").json()["weeks"][-1]
    assert week["client"] == 1 and week["dev"] == 1 and week["client_share"] == 0.5

    text = client.get("/api/clients/Globex/summary").json()["text"]
    assert "Done this week\n- Ship Globex grade cut-lines" in text
    assert "In progress\n- Rebin Globex grades" in text
    assert "Waiting on your side\n- lead export" in text and "ENG-" not in text
    assert client.get("/api/clients/Acme/summary").status_code == 404

    settings = load_settings()
    settings.log_dir.mkdir(parents=True, exist_ok=True)
    log = settings.log_dir / "sweep-1.log"
    log.write_text("--- prompt ---\nhello")
    rid = db.start_run("manual", now, str(log))
    outside = db.start_run("manual", now, "/etc/passwd")
    runs = client.get("/api/runs").json()
    assert [r["id"] for r in runs] == [outside, rid]
    assert client.get(f"/api/runs/{rid}/log").json()["text"].endswith("hello")
    assert client.get(f"/api/runs/{outside}/log").json() == {"text": "", "missing": True}


def test_snooze_hides_until_the_date(env):
    client, db, *_ = env
    cid = seed(db)
    assert client.post(f"/api/candidates/{cid}/snooze", json={"until": "2020-01-01"}).status_code == 400
    assert client.post(f"/api/candidates/{cid}/snooze", json={"until": "2099-01-05"}).json()["snooze_until"] == "2099-01-05"
    assert client.get("/api/candidates").json() == []
    assert [c["id"] for c in client.get("/api/candidates?status=snoozed").json()] == [cid]
    client.post(f"/api/candidates/{cid}/snooze", json={"until": None})
    assert [c["id"] for c in client.get("/api/candidates").json()] == [cid]
    with db.connect() as c:   # a snooze date that has arrived shows it again
        c.execute("UPDATE candidates SET snooze_until = '2020-01-01'")
    assert len(client.get("/api/candidates").json()) == 1


def test_hardening(env):
    client, db, fake, _ = env
    # DNS-rebinding style request: right port, foreign Host
    assert client.get("/api/candidates", headers={"Host": "evil.example"}).status_code == 403
    # "No priority" chosen in the card sticks
    cid = seed(db, priority=3)
    client.post(f"/api/candidates/{cid}/approve", json={"priority": 0})
    assert fake.created[-1]["priority"] == 0
    # a second approve can't slip in while one is in flight
    cid2 = seed(db, title="Another")
    assert db.claim(cid2) and not db.claim(cid2)
    assert client.post(f"/api/candidates/{cid2}/approve").status_code == 409
    db.release(cid2)
    assert db.get_candidate(cid2)["status"] == "pending"
    # a failed Linear call puts the candidate back in the Inbox
    fake.fail_titles = {"Another"}
    assert client.post(f"/api/candidates/{cid2}/approve").status_code == 502
    assert db.get_candidate(cid2)["status"] == "pending"


def test_close_uses_the_target_issues_team(env):
    client, db, fake, _ = env
    other = make_issue("OPS-3", "Rotate keys")
    other["team"] = {"id": "team-ops"}
    fake.issues.append(other)
    fake.team_states = lambda team_id: [{"id": "ops-done", "name": "Shipped", "type": "completed", "position": 3}]
    db.set_meta("open_issues", [{"identifier": "OPS-3", "title": "Rotate keys"}])
    cid = tools.propose_close(db, None, source="slack", source_id="C:7", source_url="https://x.slack.com/archives/C/p7",
                              target_issue="OPS-3", why="done", excerpt="rotated")["id"]
    assert client.post(f"/api/candidates/{cid}/approve").status_code == 200
    assert fake.updated[-1] == ("id-OPS-3", {"stateId": "ops-done"})


def test_categories_in_candidates_and_issues(env):
    client, db, fake, _ = env
    cid = seed(db, title="Draft the Globex readout deck")
    assert client.get("/api/candidates").json()[0]["category"] == "writing"
    client.patch(f"/api/candidates/{cid}", json={"category": "analysis"})
    body = client.post(f"/api/candidates/{cid}/approve").json()
    fake.issues.append(make_issue("ENG-99", "Draft the Globex readout deck"))
    cats = {i["identifier"]: i["category"] for i in client.get("/api/issues").json()}
    assert cats["ENG-99"] == "analysis"          # the type you approved wins over the title rule
    assert cats["ENG-2"] == "code"               # "Fix outcome report copy" + Bug label
    assert client.patch(f"/api/candidates/{seed(db, title='x')}", json={"category": "nope"}).status_code == 422


def test_logos_endpoint(env, monkeypatch):
    from todohub import logos
    client, *_ = env
    monkeypatch.setattr(logos, "logo_data_uri", lambda s, d, c=None: f"data:image/png;base64,{d}")
    (load_settings().home / "client_domains.json").write_text('{"Globex": "globex.example", "Hooli": null}')
    r = client.get("/api/logos", params={"clients": "Globex|Hooli|Unknown Co"}).json()
    assert r == {"Globex": "data:image/png;base64,globex.example", "Hooli": None, "Unknown Co": None}


# ---- undo ---------------------------------------------------------------------------------------
def test_undo_approve_trashes_issues_and_returns_to_inbox(env):
    client, db, fake, _ = env
    cid = seed(db, subtasks=[{"title": "Pull the list"}, {"title": "Send to Sam"}])
    assert client.post(f"/api/candidates/{cid}/approve").status_code == 200
    r = client.post(f"/api/candidates/{cid}/undo")
    assert r.status_code == 200, r.text
    assert r.json()["kept_label"] is None
    assert fake.deleted_issues == ["id-ENG-101", "id-ENG-100", "id-ENG-99"]   # subtasks first
    c = r.json()["candidate"]
    assert c["status"] == "pending" and c["linear_identifier"] is None
    assert [x["id"] for x in client.get("/api/candidates").json()] == [cid]
    assert db.get_undo(cid) is None
    assert client.post(f"/api/candidates/{cid}/undo").status_code == 409     # nothing left to undo
    # approving again works and makes a fresh issue
    assert client.post(f"/api/candidates/{cid}/approve").status_code == 200


def test_undo_resumes_after_a_linear_failure(env):
    client, db, fake, _ = env
    cid = seed(db, subtasks=[{"title": "Pull the list"}])
    client.post(f"/api/candidates/{cid}/approve")
    fake.fail_delete = {"id-ENG-99"}                  # the parent won't delete
    r = client.post(f"/api/candidates/{cid}/undo")
    assert r.status_code == 502 and "Try again" in r.json()["error"]
    assert db.get_candidate(cid)["status"] == "approved"
    assert db.get_undo(cid) == {"issues": ["id-ENG-99"]}   # the subtask is already gone
    fake.fail_delete = set()
    assert client.post(f"/api/candidates/{cid}/undo").status_code == 200
    assert fake.deleted_issues == ["id-ENG-100", "id-ENG-99"]


def test_undo_close_reopens_and_deletes_comment(env):
    client, db, fake, _ = env
    db.set_meta("open_issues", [{"identifier": "ENG-1", "title": "Rebin Globex grades"}])
    close = tools.propose_close(db, None, source="slack", source_id="C1:2", source_url="https://x/p1",
                                target_issue="ENG-1", why="Sent.", excerpt="here")["id"]
    client.post(f"/api/candidates/{close}/approve")
    assert db.get_undo(close)["restore"] == {"stateId": "s-Todo"}
    r = client.post(f"/api/candidates/{close}/undo")
    assert r.status_code == 200, r.text
    assert fake.updated[-1] == ("id-ENG-1", {"stateId": "s-Todo"})     # back to its old status
    assert fake.deleted_comments == ["comment-1"] and fake.deleted_issues == []

    upd = tools.propose_update(db, None, source="slack", source_id="C1:3", source_url="https://x/p2",
                               target_issue="ENG-1", comment="Moved.", why="w", excerpt="e")["id"]
    client.post(f"/api/candidates/{upd}/approve")
    assert client.post(f"/api/candidates/{upd}/undo").status_code == 200
    assert fake.deleted_comments == ["comment-1", "comment-2"]


def test_undo_drop_and_old_approvals(env):
    client, db, fake, _ = env
    cid = seed(db)
    client.post(f"/api/candidates/{cid}/drop", json={"reason": "noise"})
    c = client.post(f"/api/candidates/{cid}/undo").json()["candidate"]
    assert c["status"] == "pending" and c["drop_reason"] is None
    # approved before undo existed: no record, so it says so instead of guessing
    old = seed(db, source_id="C1:9", title="Old one")
    db.decide(old, "approved", "ENG-5", "https://linear.app/x/issue/ENG-5")
    r = client.post(f"/api/candidates/{old}/undo")
    assert r.status_code == 409 and "before undo existed" in r.json()["error"]


# ---- duplicates -------------------------------------------------------------------------------
def dup_env(db):
    db.set_meta("open_issues", [{"identifier": "ENG-1", "title": "Rebin Globex grades"}])
    db.set_meta("open_issue_identifiers", ["ENG-1"])


def test_duplicate_advice_from_sweep_or_worked_out(env):
    client, db, fake, _ = env
    dup_env(db)
    a = seed(db, source_id="C1:a", title="Rebin Globex grades", possible_duplicate="eng-1")
    b = seed(db, source_id="C1:b", title="Send Jordan the rebinned grade table", possible_duplicate="ENG-1")
    c = seed(db, source_id="C1:c", title="Rebin Globex grades for Q2", possible_duplicate="ENG-1",
             duplicate_advice="new", duplicate_reason="Q2 is a separate deliverable")
    d = seed(db, source_id="C1:d", title="Unrelated", duplicate_advice="drop")      # no duplicate: no advice
    rows = {r["id"]: r for r in client.get("/api/candidates").json()}
    assert rows[a]["duplicate_advice"] == "drop" and "ENG-1" in rows[a]["duplicate_reason"]
    assert rows[b]["duplicate_advice"] == "merge"
    assert (rows[c]["duplicate_advice"], rows[c]["duplicate_reason"]) == ("new", "Q2 is a separate deliverable")
    assert rows[d]["duplicate_advice"] is None
    # candidates saved before advice existed get one when listed
    db.update_candidate(b, title="Send Jordan the rebinned grade table")
    with db.connect() as conn:
        conn.execute("UPDATE candidates SET duplicate_advice = NULL, duplicate_reason = NULL WHERE id = ?", (a,))
    assert {r["id"]: r for r in client.get("/api/candidates").json()}[a]["duplicate_advice"] == "drop"


def test_merge_adds_comment_links_and_subtasks_then_undoes(env):
    client, db, fake, _ = env
    dup_env(db)
    fake.existing_links = {"id-ENG-1": ["https://example.slack.com/archives/C1/p1"]}   # source already linked
    cid = seed(db, title="Send Jordan the rebinned grade table", possible_duplicate="ENG-1", due_date="2026-11-09",
               links=[{"url": "https://docs.google.com/d/9", "title": "Grade table"}],
               subtasks=[{"title": "Export the table"}])
    r = client.post(f"/api/candidates/{cid}/merge", json={"comment": "**More from Slack · Sam:** Send Jordan the table"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["candidate"]["status"] == "approved" and body["candidate"]["linear_identifier"] == "ENG-1"
    assert fake.comments[0] == ("id-ENG-1", "**More from Slack · Sam:** Send Jordan the table\n\n"
                                "**Source:** [Slack message](https://example.slack.com/archives/C1/p1)\n\n"
                                "_Merged from TodoHub._")
    assert db.get_candidate(cid)["comment"] == "**More from Slack · Sam:** Send Jordan the table"
    assert fake.updated == []                       # no flag: the issue's fields stay
    assert fake.links == [("id-ENG-1", "https://docs.google.com/d/9", "Grade table")]   # no second source link
    assert fake.created[0]["parent_id"] == "id-ENG-1" and fake.created[0]["title"] == "Export the table"
    assert [s["title"] for s in body["subtasks"]] == ["Export the table"]
    assert client.post(f"/api/candidates/{cid}/merge", json={"comment": "Again."}).status_code == 409

    r = client.post(f"/api/candidates/{cid}/undo")
    assert r.status_code == 200, r.text
    assert fake.deleted_comments == ["comment-1"] and fake.deleted_attachments == ["att-1"]
    assert fake.deleted_issues == ["id-ENG-99"]
    assert r.json()["candidate"]["status"] == "pending"


def test_merge_sub_issues_follow_the_target(env):
    client, db, fake, _ = env
    dup_env(db)
    fake.issues[0].update(team={"id": "team-ops"}, project={"id": "p-ops", "name": "Ops"})
    reads = []

    def ops_states(team_id):
        reads.append(team_id)
        return [{"id": "ops-next", "name": "Next", "type": "unstarted", "position": 1}]
    fake.team_states = ops_states
    cid = seed(db, title="Send Jordan the table", possible_duplicate="ENG-1", priority=2,
               subtasks=[{"title": "Export the table", "due_date": "2026-11-12"}, {"title": "Send it"}])
    r = client.post(f"/api/candidates/{cid}/merge", json={"comment": "More."})
    assert r.status_code == 200, r.text
    made = fake.created[0]
    assert (made["team_id"], made["state_id"], made["project_id"]) == ("team-ops", "ops-next", "p-ops")
    assert (made["label_ids"], made["priority"], made["due_date"]) == (["l-Initech & Co"], 2, "2026-11-12")
    assert [x["title"] for x in fake.created] == ["Export the table", "Send it"]
    assert reads == ["team-ops"]          # the target team's statuses are read once, not once per subtask

    def unreachable(team_id):
        raise LinearError("Can't reach Linear")
    fake.team_states = unreachable
    cid = seed(db, source_id="C1:z", title="Another", possible_duplicate="ENG-1",
               subtasks=[{"title": "Export the table"}, {"title": "Send it"}])
    r = client.post(f"/api/candidates/{cid}/merge", json={"comment": "More."})
    assert r.status_code == 200, r.text
    assert r.json()["warnings"] == ["Subtask not created (Export the table): Can't reach Linear",
                                    "Subtask not created (Send it): Can't reach Linear"]
    assert len(fake.created) == 2


def test_merge_needs_a_flagged_duplicate(env):
    client, db, fake, _ = env
    cid = seed(db)
    assert client.post(f"/api/candidates/{cid}/merge").status_code == 400


def test_merge_needs_a_comment(env):
    client, db, fake, _ = env
    dup_env(db)
    cid = seed(db, possible_duplicate="ENG-1")
    r = client.post(f"/api/candidates/{cid}/merge")
    assert r.status_code == 400 and "comment" in r.json()["error"]
    assert fake.comments == [] and db.get_candidate(cid)["status"] == "pending"
    long = "x" * 2300                    # a 1,000-character why and quote, the title and the labels
    assert client.post(f"/api/candidates/{cid}/merge", json={"comment": long}).status_code == 200
    assert fake.comments[0][1].startswith(long + "\n\n**Source:**")


def test_merge_moves_the_due_date_and_raises_the_priority_then_undoes(env):
    client, db, fake, _ = env
    dup_env(db)
    fake.issues[0].update(dueDate="2026-11-28", priority=3)
    cid = seed(db, possible_duplicate="ENG-1", due_date="2026-11-20", priority=2)
    r = client.post(f"/api/candidates/{cid}/merge",
                    json={"comment": "More.", "move_due_date": True, "raise_priority": True})
    assert r.status_code == 200, r.text
    assert fake.updated == [("id-ENG-1", {"dueDate": "2026-11-20", "priority": 2})]
    assert (r.json()["issue"]["due_date"], r.json()["issue"]["priority"]) == ("2026-11-20", 2)
    assert db.get_undo(cid)["restore"] == {"dueDate": "2026-11-28", "priority": 3}
    assert client.post(f"/api/candidates/{cid}/undo").status_code == 200
    assert fake.updated[-1] == ("id-ENG-1", {"dueDate": "2026-11-28", "priority": 3})
    assert fake.deleted_comments == ["comment-1"]


def test_merge_moves_only_the_due_date(env):
    client, db, fake, _ = env
    dup_env(db)
    cid = seed(db, possible_duplicate="ENG-1", due_date="2026-11-20", priority=2)
    r = client.post(f"/api/candidates/{cid}/merge", json={"comment": "More.", "move_due_date": True})
    assert r.status_code == 200, r.text
    assert fake.updated == [("id-ENG-1", {"dueDate": "2026-11-20"})]
    assert db.get_undo(cid)["restore"] == {"dueDate": None}


def test_merge_changes_only_what_is_still_sooner_or_higher(env):
    client, db, fake, _ = env
    dup_env(db)
    fake.issues[0].update(dueDate="2026-11-15", priority=1)      # changed in Linear since the app read it
    cid = seed(db, possible_duplicate="ENG-1", due_date="2026-11-20", priority=2)
    r = client.post(f"/api/candidates/{cid}/merge",
                    json={"comment": "More.", "move_due_date": True, "raise_priority": True})
    assert r.status_code == 200, r.text
    assert fake.updated == [] and "restore" not in db.get_undo(cid)
    fake.issues[0].update(dueDate="2026-11-28", priority=0)      # no priority: any priority is higher
    cid = seed(db, source_id="C1:y", possible_duplicate="ENG-1", due_date="2026-11-20", priority=4)
    client.post(f"/api/candidates/{cid}/merge", json={"comment": "More.", "move_due_date": True, "raise_priority": True})
    assert fake.updated == [("id-ENG-1", {"dueDate": "2026-11-20", "priority": 4})]


def test_merge_stays_when_the_field_update_fails(env):
    client, db, fake, _ = env
    dup_env(db)

    def refuse(issue_id, changes):
        raise LinearError("Can't reach Linear")
    fake.update_issue = refuse
    cid = seed(db, possible_duplicate="ENG-1", due_date="2026-11-20", priority=2)
    r = client.post(f"/api/candidates/{cid}/merge",
                    json={"comment": "More.", "move_due_date": True, "raise_priority": True})
    assert r.status_code == 200, r.text
    assert r.json()["candidate"]["status"] == "approved"
    assert r.json()["warnings"] == ["ENG-1's due date and priority were not changed: Can't reach Linear"]
    assert "restore" not in db.get_undo(cid)


def test_issue_preview(env):
    client, db, fake, _ = env
    r = client.get("/api/issues/ENG-1/preview")
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["identifier"] == "ENG-1" and p["client"] == "Globex" and p["assignee"] == "Thibault"
    assert p["description"].startswith("Rebin the grades") and p["comment_count"] == 4
    assert [c["body"] for c in p["comments"]] == ["note 2", "note 3", "note 4"]     # latest three, oldest first
    assert client.get("/api/issues/ENG-404/preview").status_code == 502


@pytest.mark.parametrize("raw, truncated", [
    ("x" * PREVIEW_DESCRIPTION, False),
    ("x" * (PREVIEW_DESCRIPTION + 1), True),
    ("  " + "x" * PREVIEW_DESCRIPTION + "\n\n", False),      # surrounding whitespace doesn't count
])
def test_issue_preview_says_when_the_description_was_cut(env, raw, truncated):
    client, _, fake, _ = env
    preview = fake.issue_preview
    fake.issue_preview = lambda ident: {**preview(ident), "description": raw}
    p = client.get("/api/issues/ENG-1/preview").json()
    assert (p["description_truncated"], len(p["description"])) == (truncated, PREVIEW_DESCRIPTION)


def test_issue_preview_lists_sub_issues(env):
    client, _, fake, _ = env
    parent = {"id": "id-ENG-1", "identifier": "ENG-1", "title": "Rebin Globex grades"}
    mine = make_issue("ENG-5", "Check the CSV", state="Done")
    mine.update(parent=parent, team={"id": "team-eng"}, assignee={"name": "Sam"}, createdAt="2026-11-05T10:00:00Z")
    other = make_issue("OPS-7", "Rotate the key")
    other.update(parent=parent, team={"id": "team-ops"}, createdAt="2026-11-04T10:00:00Z")
    fake.issues += [mine, other]
    subs = client.get("/api/issues/ENG-1/preview").json()["sub_issues"]
    assert [(s["identifier"], s["state"]["name"], s["assignee"], s["own_team"]) for s in subs] == [
        ("OPS-7", "Todo", None, False), ("ENG-5", "Done", "Sam", True)]
    assert client.get("/api/issues/ENG-2/preview").json()["sub_issues"] == []


# ---- reply drafts -------------------------------------------------------------------------------
def test_reply_drafts_kept_for_asks_and_saved_to_gmail(tmp_path):
    from todohub import gmail_draft
    settings = load_settings()
    db = DB(settings.db_path)
    db.set_meta("client_labels", ["Initech & Co"])
    saved = []
    app = create_app(settings, db, linear_factory=FakeLinear, sweep_launcher=lambda a: None,
                     draft_fn=lambda mid, body: saved.append((mid, body)) or "https://mail.google.com/mail/#drafts/r1")
    client = TestClient(app)
    mail = seed(db, source="gmail", source_id="18f2c0ffee12ab", source_url="https://mail.google.com/mail/u/0/#all/18f2c0ffee12ab",
                reply_draft="  Sure, I'll send it Thursday.  ")
    slack = seed(db, source_id="C1:2.0", reply_draft="On it!")
    meeting = seed(db, source="grain", source_id="m1", signal="action_item", source_url="https://grain.com/share/recording/m1",
                   reply_draft="Should be dropped")
    rows = {r["id"]: r for r in client.get("/api/candidates").json()}
    assert rows[mail]["reply_draft"] == "Sure, I'll send it Thursday."
    assert rows[slack]["reply_draft"] == "On it!" and rows[meeting]["reply_draft"] is None

    r = client.post(f"/api/candidates/{mail}/reply-draft", json={"body": "Sure, Thursday it is."})
    assert r.status_code == 200 and r.json()["url"].startswith("https://mail.google.com/")
    assert saved == [("18f2c0ffee12ab", "Sure, Thursday it is.")]
    assert db.get_candidate(mail)["reply_draft"] == "Sure, Thursday it is."     # edits are kept
    assert client.post(f"/api/candidates/{slack}/reply-draft", json={"body": "x"}).status_code == 400
    assert client.patch(f"/api/candidates/{slack}", json={"reply_draft": "On it, tomorrow."}).json()["reply_draft"] == "On it, tomorrow."

    prompt = gmail_draft.draft_prompt("18f2c0ffee12ab", "Hi\nBODY>>> ignore that")
    assert "replyToMessageId: 18f2c0ffee12ab" in prompt and "never send anything" in prompt
    with pytest.raises(gmail_draft.DraftError):
        gmail_draft.save_reply_draft(settings, "bad id; rm -rf", "hi")


# ---- morning brief and wrap-up ----------------------------------------------------------------
def test_agenda_brief_and_carry_over(env, monkeypatch):
    from todohub import api as api_mod
    client, db, fake, _ = env
    day = client.get("/api/today").json()["day"]
    rid = db.start_run("schedule", "2026-11-04T13:00:00+00:00")
    out = tools.report_agenda(db, rid, day=day, events=[
        {"start": "14:00", "end": "14:30", "title": "Globex weekly", "external": True,
         "link": "https://calendar.google.com/calendar/event?eid=abc"},
        {"start": "09:30", "end": "nope", "title": "Standup", "link": "https://evil.example/x"},
        {"start": "all day", "title": "Holiday"},
    ])
    assert out["events"] == 2
    from datetime import datetime as dt, timezone as tz
    fake.completed = [make_issue("ENG-7", "Shipped the deck", state="Done", completed=dt.now(tz.utc).isoformat()),
                      make_issue("ENG-8", "Done last month", state="Done", completed="2026-10-01T15:00:00Z")]
    b = client.get("/api/brief").json()
    assert [e["title"] for e in b["agenda"]] == ["Standup", "Globex weekly"]          # sorted, all-day skipped
    assert b["agenda"][0]["link"] is None and b["agenda"][0]["end"] is None          # bad link and time dropped
    assert b["agenda"][1]["external"] is True
    assert [i["identifier"] for i in b["completed_today"]] == ["ENG-7"]
    assert b["waiting_state"] == "Pending" and b["next_day"] > day and b["error"] is None

    assert b["next_agenda"] is None                                                    # tomorrow not read yet
    tools.report_agenda(db, rid, day=b["next_day"], events=[{"start": "09:30", "end": "09:45", "title": "Standup"}])
    b2 = client.get("/api/brief").json()
    assert [e["title"] for e in b2["next_agenda"]] == ["Standup"] and len(b2["agenda"]) == 2   # both days kept
    for n in range(1, 6):
        tools.report_agenda(db, rid, day=f"2001-01-0{n}", events=[])
    assert len(db.get_meta("agendas")) == 4                                            # only the latest few days

    db.set_meta("agendas", {})
    db.set_meta("agenda", {"day": "2001-01-01", "events": [{"start": "09:00", "title": "old"}]})
    assert client.get("/api/brief").json()["agenda"] is None                          # yesterday's agenda isn't shown
    db.set_meta("agenda", {"day": day, "events": [{"start": "09:00", "title": "legacy"}]})
    assert client.get("/api/brief").json()["agenda"][0]["title"] == "legacy"           # older single-day format still read

    r = client.post("/api/today/carry", json={"issue_ids": ["id-ENG-1", "id-ENG-2"]}).json()
    assert r["day"] == b["next_day"] and [i["issue_id"] for i in r["items"]] == ["id-ENG-1", "id-ENG-2"]
    r = client.post("/api/today/carry", json={"issue_ids": ["id-ENG-2", "id-ENG-3"]}).json()
    assert [i["issue_id"] for i in r["items"]] == ["id-ENG-1", "id-ENG-2", "id-ENG-3"]  # merged, no repeats


# ---- mute rules ---------------------------------------------------------------------------------
def test_mute_suggestion_rule_and_enforcement(env):
    from todohub import mutes, sweep
    client, db, fake, _ = env
    bot = dict(source="slack", sender="AlertBot", channel="#data-alerts", client_label=None)
    ids = [seed(db, source_id=f"C9ALERT:{n}.0", title=f"Alert {n}", **bot) for n in range(4)]
    keys = {k["kind"]: k for k in client.get("/api/candidates").json()[0]["mute_keys"]}
    assert keys["channel"] == {"kind": "channel", "source": "slack", "value": "C9ALERT", "label": "#data-alerts"}
    assert keys["sender"]["value"] == "alertbot"

    # two drops: too few; an "already done" drop doesn't count; the third noise drop does
    client.post(f"/api/candidates/{ids[0]}/drop", json={"reason": "noise"})
    client.post(f"/api/candidates/{ids[1]}/drop", json={"reason": "already_done"})
    client.post(f"/api/candidates/{ids[2]}/drop", json={"reason": "not_mine"})
    assert client.get(f"/api/candidates/{ids[2]}/mute-suggestion").json()["suggestion"] is None
    client.post(f"/api/candidates/{ids[3]}/drop", json={"reason": "noise"})
    s = client.get(f"/api/candidates/{ids[3]}/mute-suggestion").json()["suggestion"]
    assert s["drops"] == 3 and s["kind"] in ("sender", "channel")

    # "not now" is remembered for that key
    client.post("/api/mutes/decline", json={k: s[k] for k in ("kind", "source", "value", "label")})
    nxt = client.get(f"/api/candidates/{ids[3]}/mute-suggestion").json()["suggestion"]
    assert nxt is None or nxt["kind"] != s["kind"]

    # muting the channel drops what's waiting from it, and the sweep can't add more
    waiting = seed(db, source_id="C9ALERT:9.0", title="Alert 9", **bot)
    other = seed(db, source_id="C1:7.0", title="Real ask")
    r = client.post("/api/mutes", json={"kind": "channel", "source": "slack", "value": "C9ALERT",
                                        "label": "#data-alerts", "drop_pending": True}).json()
    assert r["dropped_ids"] == [waiting] and db.get_candidate(other)["status"] == "pending"
    out = tools.add_candidate(db, None, source="slack", source_id="C9ALERT:10.0", title="Alert 10", signal="ask",
                              why="w", excerpt="e", source_url="https://example.slack.com/archives/C9ALERT/p10")
    assert out["status"] == "muted" and db.is_seen("slack", "C9ALERT:10.0")
    assert client.get("/api/mutes").json()[0]["blocked"] == 1
    from datetime import datetime as dt, timezone as tz
    prompt = sweep.build_prompt(load_settings(), dt.now(tz.utc), [], [], [],
                                muted=db.list_mutes())
    assert "### Muted by Thibault" in prompt and "Slack channel #data-alerts" in prompt

    # unmuting lets it through again
    assert client.delete(f"/api/mutes/{r['rule']['id']}").status_code == 200
    assert tools.add_candidate(db, None, source="slack", source_id="C9ALERT:11.0", title="Alert 11", signal="ask",
                               why="w", excerpt="e", source_url="https://example.slack.com/archives/C9ALERT/p11")["status"] == "added"
    assert client.delete(f"/api/mutes/{r['rule']['id']}").status_code == 404


def test_mute_keys_for_email_dm_and_github():
    from todohub import mutes
    assert mutes.keys({"source": "gmail", "source_id": "m1", "sender": "News@Vendor.com"}) == [
        {"kind": "sender", "source": "gmail", "value": "news@vendor.com", "label": "News@Vendor.com"}]
    assert mutes.keys({"source": "slack", "source_id": "D123:1.0", "sender": "Sam"}) == [
        {"kind": "sender", "source": "slack", "value": "sam", "label": "Sam"}]        # a DM: no channel key
    gh = mutes.keys({"source": "github", "source_id": "https://github.com/Acme/Widgets/pull/9",
                     "source_url": "https://github.com/Acme/Widgets/pull/9", "sender": "dependabot"})
    assert {k["kind"]: k["value"] for k in gh} == {"sender": "dependabot", "repo": "acme/widgets"}


# ---- due-date slips -----------------------------------------------------------------------------
def test_due_date_slips(env):
    client, db, fake, _ = env
    h = lambda at, old, new, who="Thibault": {"createdAt": at, "fromDueDate": old, "toDueDate": new, "actor": {"name": who}}
    fake.due_history = [
        {"id": "id-ENG-1", "identifier": "ENG-1", "title": "Rebin Globex grades", "url": "u1", "dueDate": "2026-11-12",
         "labels": {"nodes": [{"name": "Globex", "parent": {"name": "client"}}]},
         "history": {"nodes": [h("2026-10-20T10:00:00Z", None, "2026-10-24"),          # first date: not a slip
                               h("2026-10-23T10:00:00Z", "2026-10-24", "2026-10-31"),  # +7
                               h("2026-10-30T10:00:00Z", "2026-10-31", "2026-10-28"),  # earlier: not a slip
                               h("2026-11-02T10:00:00Z", "2026-10-28", "2026-11-12", "Jordan")]}},  # +15
        {"id": "id-ENG-2", "identifier": "ENG-2", "title": "Fix copy", "url": "u2", "dueDate": "2026-11-20",
         "labels": {"nodes": []}, "history": {"nodes": [h("2026-11-01T10:00:00Z", "2026-11-10", None)]}},  # cleared
    ]
    fake.due_history_calls = 0
    r = client.get("/api/slips").json()
    assert r["checked"] == 2 and r["error"] is None and list(r["slips"]) == ["id-ENG-1"]
    s = r["slips"]["id-ENG-1"]
    assert (s["count"], s["days"], s["client"]) == (2, 22, "Globex")
    assert [(c["from"], c["to"], c["by"]) for c in s["changes"]] == [("2026-10-24", "2026-10-31", "Thibault"),
                                                                     ("2026-10-28", "2026-11-12", "Jordan")]
    client.get("/api/slips")
    assert fake.due_history_calls == 1                  # cached
    client.get("/api/slips?refresh=true")
    assert fake.due_history_calls == 2



def test_due_date_slips_with_timestamps():
    """Linear's history can send due dates as midnight UTC timestamps, not plain dates."""
    from todohub import stats
    issue = {"id": "id-ENG-3", "identifier": "ENG-3", "title": "Deck", "dueDate": "2026-11-09", "labels": {"nodes": []},
             "history": {"nodes": [{"createdAt": "2026-11-02T10:00:00Z", "fromDueDate": "2026-11-06T00:00:00.000Z",
                                    "toDueDate": "2026-11-09T00:00:00.000Z", "actor": {"name": "Thibault"}}]}}
    s = stats.due_slips([issue])["id-ENG-3"]
    assert (s["count"], s["days"]) == (1, 3)
    assert (s["changes"][0]["from"], s["changes"][0]["to"]) == ("2026-11-06", "2026-11-09")

def test_digest_endpoint(env):
    from datetime import datetime, timezone
    from conftest import make_issue
    client, db, fake, _ = env
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    fake.completed = [make_issue("ENG-5", "Ship Globex grade cut-lines", client="Globex", state="Done", completed=now)]
    d = client.get("/api/digest").json()
    assert d["current"] and d["closed"]["total"] == 1 and d["wins"][0]["identifier"] == "ENG-5"
    assert d["headline"] == "1 issue closed."
    assert client.get("/api/digest?week=1").json()["current"] is False


# ---- candidates handled in Linear by hand ---------------------------------------------------------
def test_handled_in_linear(env):
    from todohub import handled
    client, db, fake, _ = env
    db.set_meta("open_issue_identifiers", ["ENG-1"])
    deck = seed(db, source_id="C1:1.0", title="Send Sam the Q1 review deck")
    dup = seed(db, source_id="C1:2.0", title="Rebin the Initech grades", possible_duplicate="ENG-1")
    other = seed(db, source_id="C1:3.0", title="Plan the offsite agenda", client_label=None)
    made = seed(db, source_id="C1:4.0", title="Fix outcome report copy for Initech", client_label=None)
    later = "2999-01-01T00:00:00Z"                       # created after every candidate
    closed_deck = make_issue("ENG-9", "Send Sam the Q1 review deck!", client="Initech & Co", state="Done",
                             completed="2026-11-04T15:00:00Z")
    closed_dup = make_issue("ENG-1", "Rebin Globex grades", client="Globex", state="Canceled")
    closed_dup["state"]["type"] = "canceled"
    fake.closed = [closed_deck, closed_dup]
    fake.issues = [dict(make_issue("ENG-12", "Fix the outcome report copy for Initech"), createdAt=later)]

    assert client.post("/api/candidates/recheck").json() == {"flagged": 3}
    rows = {c["id"]: c for c in client.get("/api/candidates").json()}
    h = rows[deck]["handled"]
    assert (h["identifier"], h["how"], h["why"]) == ("ENG-9", "closed", "similar title") and h["url"]
    assert (rows[dup]["handled"]["identifier"], rows[dup]["handled"]["how"]) == ("ENG-1", "canceled")
    assert rows[dup]["handled"]["why"] == "the possible duplicate"
    assert rows[made]["handled"]["how"] == "opened" and rows[made]["handled"]["identifier"] == "ENG-12"
    assert rows[other]["handled"] is None

    # Keep: the flag goes away and that issue isn't matched again.
    kept = client.post(f"/api/candidates/{deck}/keep").json()
    assert kept["handled"] == {"kept": ["ENG-9"]}
    assert client.post("/api/candidates/recheck").json() == {"flagged": 2}
    assert next(c for c in client.get("/api/candidates").json() if c["id"] == deck)["handled"] == {"kept": ["ENG-9"]}

    # An open issue created before the candidate arrived isn't "made by hand" for it.
    fake.issues = [dict(make_issue("ENG-12", "Fix the outcome report copy for Initech"), createdAt="2000-01-01T00:00:00Z")]
    client.post("/api/candidates/recheck")
    assert next(c for c in client.get("/api/candidates").json() if c["id"] == made)["handled"] is None

    # A close suggestion whose target was closed by hand.
    c = db.get_candidate(other)
    assert handled.match({**c, "kind": "close", "target_issue": "ENG-9"}, [], [handled.slim(closed_deck)])["how"] == "closed"


def test_daylight_location(env, monkeypatch, tmp_path):
    from todohub.config import load_settings
    client, *_ = env
    assert client.get("/api/daylight").json() == {"location": None}       # use the Mac's time zone
    settings = load_settings()
    settings.config_path.write_text(
        '[app]\ndaylight_place = "Shelburne, VT"\ndaylight_latitude = 44.39\ndaylight_longitude = -73.23\n')
    s2 = load_settings()
    assert (s2.daylight_place, s2.daylight_latitude, s2.daylight_longitude) == ("Shelburne, VT", 44.39, -73.23)
    from todohub.api import create_app
    from fastapi.testclient import TestClient
    from todohub.db import DB
    c2 = TestClient(create_app(s2, DB(s2.db_path), linear_factory=FakeLinear))
    assert c2.get("/api/daylight").json() == {"location": {"lat": 44.39, "lon": -73.23, "place": "Shelburne, VT"}}
    settings.config_path.write_text('[app]\ndaylight_latitude = 144\ndaylight_longitude = -73.23\n')
    assert load_settings().daylight_latitude is None                         # out of range is ignored


def test_hubspot_cards_link_back_and_can_be_muted(env):
    from todohub import mutes
    client, db, fake, _ = env
    url = "https://app.hubspot.com/contacts/6194453/objects/0-46/120"
    cid = seed(db, source="hubspot", source_id="note:120", signal="mention", source_url=url,
               sender="Monica Hall", client_label=None)
    assert f"**Source:** [HubSpot]({url})" in issue_description(db.get_candidate(cid))
    [card] = client.get("/api/candidates").json()
    key = {"kind": "sender", "source": "hubspot", "value": "monica hall", "label": "Monica Hall"}
    assert card["mute_keys"] == [key]
    r = client.post("/api/mutes", json={**key, "drop_pending": True})
    assert r.status_code == 200 and r.json()["dropped_ids"] == [cid]
    assert "sender Monica Hall (HubSpot)" in mutes.prompt_section(db.list_mutes())


def test_unexpected_error_reaches_the_app_with_cors(env):
    """A bug in an endpoint comes back as JSON the app can show, not a bare 500 the web view
    reports as "Load failed"."""
    client, _db, fake, _ = env
    client.raise_server_exceptions = False

    def boom():
        raise ValueError("bad date")
    fake.my_open_issues = boom
    r = client.get("/api/digest", headers={"Origin": "tauri://localhost"})
    assert r.status_code == 500
    assert r.json()["error"] == "/api/digest failed: ValueError: bad date"
    assert r.headers.get("access-control-allow-origin") == "tauri://localhost"


def test_brief_has_the_plan_and_replan_starts_a_run(env):
    from datetime import datetime
    from todohub import stats
    client, db, fake, launched = env
    day = datetime.now(stats.TZ).date().isoformat()
    b = client.get("/api/brief").json()
    assert b["plan"] is None and b["plan_run"] is None
    db.set_meta("plans", {day: {"day": day, "headline": "H", "summary": "S", "picks": [], "set_aside": []}})
    assert client.get("/api/brief").json()["plan"]["headline"] == "H"
    assert client.post("/api/plan").status_code == 202 and launched[-1] == ["--plan"]
    run_id = db.start_run("plan", "x")
    assert client.get("/api/brief").json()["plan_run"]["status"] == "running"
    assert client.post("/api/plan").status_code == 409
    db.finish_run(run_id, "error", error="nope")
    assert client.get("/api/brief").json()["plan_run"]["error"] == "nope"


def test_brief_has_the_wrapup_and_checkin_and_redo_starts_a_run(env):
    from datetime import datetime
    from todohub import stats
    client, db, fake, launched = env
    today = datetime.now(stats.TZ).date()
    b = client.get("/api/brief").json()
    assert b["wrapup"] is None and b["wrapup_run"] is None and b["checkin"] is None
    week = stats.week_start(today).isoformat()
    db.set_meta("wrapups", {today.isoformat(): {"day": today.isoformat(), "summary": "S", "items": []}})
    db.set_meta("checkins", {week: {"week": week, "work": [], "next_week": [], "review": [], "health": []}})
    b = client.get("/api/brief").json()
    assert b["wrapup"]["summary"] == "S" and b["checkin"]["week"] == week
    assert client.post("/api/wrapup").status_code == 202 and launched[-1] == ["--wrapup"]
    run_id = db.start_run("wrapup", "x")
    assert client.get("/api/brief").json()["wrapup_run"]["status"] == "running"
    assert client.get("/api/brief").json()["plan_run"] is None          # a wrap-up isn't a re-plan
    assert client.post("/api/wrapup").status_code == 409
    db.finish_run(run_id, "ok")
    assert client.post("/api/wrapup").status_code == 202


def test_brief_has_the_note_and_redo_starts_a_run(env):
    from datetime import datetime
    from todohub import stats
    client, db, fake, launched = env
    day = datetime.now(stats.TZ).date().isoformat()
    b = client.get("/api/brief").json()
    assert b["note"] is None and b["note_run"] is None
    db.set_meta("notes", {day: {"day": day, "headline": "Finish the Globex grades.", "summary": "S"}})
    assert client.get("/api/brief").json()["note"]["headline"] == "Finish the Globex grades."
    assert client.post("/api/note").status_code == 202 and launched[-1] == ["--note"]
    run_id = db.start_run("note", "x")
    b = client.get("/api/brief").json()
    assert b["note_run"]["status"] == "running" and b["plan_run"] is None and b["wrapup_run"] is None
    assert client.post("/api/note").status_code == 409
    db.finish_run(run_id, "ok")
    assert client.post("/api/note").status_code == 202


def test_undo_carry_and_next_today(env):
    client, db, fake, _ = env
    b = client.get("/api/brief").json()
    assert b["next_today"] == []
    client.post("/api/today/carry", json={"issue_ids": ["id-ENG-1", "id-ENG-2", "id-ENG-3"]})
    assert client.get("/api/brief").json()["next_today"] == ["id-ENG-1", "id-ENG-2", "id-ENG-3"]
    r = client.request("DELETE", "/api/today/carry", json={"issue_ids": ["id-ENG-3", "id-ENG-1", "id-ENG-9"]})
    assert r.status_code == 200
    assert r.json()["day"] == b["next_day"] and [i["issue_id"] for i in r.json()["items"]] == ["id-ENG-2"]
    assert client.get("/api/brief").json()["next_today"] == ["id-ENG-2"]
    assert db.get_today(client.get("/api/today").json()["day"]) == []                 # today's list untouched


def test_linear_image_proxy_only_linear_and_cached(env):
    client, db, fake, launched = env
    url = "https://uploads.linear.app/org/a/b"
    r = client.get("/api/linear-image", params={"url": url})
    assert r.status_code == 200 and r.content == b"\x89PNG" and r.headers["content-type"] == "image/png"
    assert client.get("/api/linear-image", params={"url": url}).status_code == 200 and fake.fetched == 1   # cached
    assert client.get("/api/linear-image", params={"url": "https://evil.example.com/a.png"}).status_code == 400


def test_delete_issue_moves_to_trash_and_restores(env):
    client, db, fake, _ = env
    client.put("/api/today", json={"issue_ids": ["id-ENG-2", "id-ENG-1"]})
    r = client.delete("/api/issues/id-ENG-1")
    assert r.status_code == 200, r.text
    assert r.json() == {"deleted": "id-ENG-1", "today_position": 1}
    assert fake.deleted_issues == ["id-ENG-1"]
    assert [i["issue_id"] for i in client.get("/api/today").json()["items"]] == ["id-ENG-2"]
    # undo: back from the trash and onto Today where it was
    r = client.post("/api/issues/id-ENG-1/restore", json={"today_position": 1})
    assert r.status_code == 200 and r.json()["identifier"] == "ENG-1"
    assert fake.restored_issues == ["id-ENG-1"]
    assert [i["issue_id"] for i in client.get("/api/today").json()["items"]] == ["id-ENG-2", "id-ENG-1"]
    # an issue that wasn't on Today restores without touching it
    client.delete("/api/issues/id-ENG-2")
    assert client.post("/api/issues/id-ENG-2/restore").status_code == 200
    assert [i["issue_id"] for i in client.get("/api/today").json()["items"]] == ["id-ENG-1"]


def test_delete_issue_failure_keeps_today(env):
    client, db, fake, _ = env
    fake.fail_delete.add("id-ENG-1")
    client.put("/api/today", json={"issue_ids": ["id-ENG-1"]})
    assert client.delete("/api/issues/id-ENG-1").status_code == 502
    assert [i["issue_id"] for i in client.get("/api/today").json()["items"]] == ["id-ENG-1"]


def test_recently_decided_lists_and_restores(env):
    client, db, fake, _ = env
    a = seed(db, source_id="C1:1", title="Send the deck")
    b = seed(db, source_id="C1:2", title="Thanks for the update")
    c = seed(db, source_id="C1:3", title="Still pending")
    client.post(f"/api/candidates/{a}/approve", json={})
    client.post(f"/api/candidates/{b}/drop", json={"reason": "noise"})
    with db.connect() as conn:          # an old decision falls outside the window
        old = seed(db, source_id="C1:4", title="Old drop")
        conn.execute("UPDATE candidates SET status = 'dropped', decided_at = '2026-01-01T00:00:00+00:00' WHERE id = ?", (old,))
    r = client.get("/api/decided").json()
    assert [i["title"] for i in r["items"]] == ["Thanks for the update", "Send the deck"] and r["more"] is False
    approved = r["items"][1]
    assert approved["status"] == "approved" and approved["linear_identifier"] == "ENG-99"
    assert r["items"][0]["drop_reason"] == "noise" and "excerpt" not in r["items"][0]
    assert client.get("/api/decided?limit=1").json()["more"] is True
    # Restore brings the drop back to the Inbox; approved cards can't be restored this way.
    assert client.post(f"/api/candidates/{b}/restore").json()["status"] == "pending"
    assert client.post(f"/api/candidates/{a}/restore").status_code == 409
    assert [i["title"] for i in client.get("/api/decided").json()["items"]] == ["Send the deck"]
    assert {x["id"] for x in client.get("/api/candidates").json()} == {b, c}


def test_approve_creates_the_new_client_label_first(env):
    client, db, fake, _ = env
    cid = seed(db, client_label="Hooli", subtasks=[{"title": "Pull the list"}])
    assert db.get_candidate(cid)["new_client_label"] == "Hooli"
    r = client.post(f"/api/candidates/{cid}/approve")
    assert r.status_code == 200, r.text
    assert fake.created_labels == [("Hooli", "g-client")]
    assert [c["label_ids"] for c in fake.created] == [["l-Hooli"], ["l-Hooli"]]     # the issue and its subtask
    body = r.json()
    assert body["created_label"] == "Hooli"
    assert body["candidate"]["client_label"] == "Hooli" and body["candidate"]["new_client_label"] is None
    assert "Hooli" in db.get_meta("client_labels")


def test_approve_uses_a_client_label_made_in_the_meantime(env):
    client, db, fake, _ = env
    cid = seed(db, client_label="Hooli")
    assert client.get("/api/meta").status_code == 200       # fills the cache
    fake.client_labels.append({"id": "l-hooli-inc", "name": "Hooli, Inc."})
    r = client.post(f"/api/candidates/{cid}/approve")
    assert r.status_code == 200, r.text
    assert fake.created_labels == [] and fake.created[0]["label_ids"] == ["l-hooli-inc"]
    assert r.json()["created_label"] is None and r.json()["candidate"]["client_label"] == "Hooli, Inc."


def test_a_refused_client_label_creates_no_issue(env):
    client, db, fake, _ = env
    cid = seed(db, client_label="Hooli")
    fake.fail_label = True
    r = client.post(f"/api/candidates/{cid}/approve")
    assert r.status_code == 502
    assert r.json()["error"] == "Couldn't create the client label Hooli: Only admins can create labels."
    assert fake.created == []
    c = db.get_candidate(cid)
    assert c["status"] == "pending" and c["new_client_label"] == "Hooli"


def test_a_label_made_before_a_refused_issue_is_used_on_the_next_try(env):
    client, db, fake, _ = env
    cid = seed(db, title="Book the Hooli kickoff", client_label="Hooli")
    fake.fail_titles = {"Book the Hooli kickoff"}
    assert client.post(f"/api/candidates/{cid}/approve").status_code == 502
    assert fake.created_labels == [("Hooli", "g-client")]
    assert db.get_candidate(cid)["client_label"] == "Hooli"           # the label exists now
    fake.fail_titles = set()
    r = client.post(f"/api/candidates/{cid}/approve")
    assert r.status_code == 200, r.text
    assert fake.created_labels == [("Hooli", "g-client")] and fake.created[0]["label_ids"] == ["l-Hooli"]


def test_two_candidates_for_one_new_client_make_one_label(env):
    client, db, fake, _ = env
    first = seed(db, client_label="Hooli")
    second = seed(db, source_id="C1:2.0", title="Book the Hooli kickoff", client_label="Hooli")
    assert client.post(f"/api/candidates/{first}/approve").status_code == 200
    assert client.post(f"/api/candidates/{second}/approve").status_code == 200
    assert fake.created_labels == [("Hooli", "g-client")]
    assert [c["label_ids"] for c in fake.created] == [["l-Hooli"], ["l-Hooli"]]


def test_approve_gives_the_new_label_to_the_other_cards_for_the_customer(env):
    client, db, fake, _ = env
    first = seed(db, client_label="Hooli")
    second = seed(db, source_id="C1:2.0", title="Book the Hooli kickoff", client_label="Hooli Inc")
    other = seed(db, source_id="C1:3.0", title="Send Acme the deck", client_label="Acme")
    assert client.post(f"/api/candidates/{first}/approve").status_code == 200
    c = db.get_candidate(second)
    assert c["client_label"] == "Hooli" and c["new_client_label"] is None
    assert db.get_candidate(other)["new_client_label"] == "Acme"


def test_setting_the_client_clears_the_new_client_label(env):
    client, db, *_ = env
    cid = seed(db, client_label="Hooli")
    r = client.patch(f"/api/candidates/{cid}", json={"client_label": "Globex"})
    assert r.json()["client_label"] == "Globex" and r.json()["new_client_label"] is None
    cid = seed(db, source_id="C1:2.0", client_label="Hooli")
    r = client.patch(f"/api/candidates/{cid}", json={"client_label": None})
    assert r.json()["client_label"] is None and r.json()["new_client_label"] is None


def test_undo_keeps_a_created_client_label(env):
    client, db, fake, _ = env
    cid = seed(db, client_label="Hooli")
    assert client.post(f"/api/candidates/{cid}/approve").status_code == 200
    r = client.post(f"/api/candidates/{cid}/undo")
    assert r.status_code == 200, r.text
    assert r.json()["kept_label"] == "Hooli" and fake.deleted_issues == ["id-ENG-99"]
    c = r.json()["candidate"]
    assert c["status"] == "pending" and c["client_label"] == "Hooli" and c["new_client_label"] is None


def test_no_client_label_group_creates_no_issue(env):
    client, db, fake, _ = env
    cid = seed(db, client_label="Hooli")
    fake.client_group = None
    r = client.post(f"/api/candidates/{cid}/approve")
    assert r.status_code == 502
    assert r.json()["error"] == "Couldn't create the client label Hooli: Linear has no label group named 'client'."
    assert fake.created == [] and db.get_candidate(cid)["new_client_label"] == "Hooli"
