import pytest
from fastapi.testclient import TestClient

from todohub import tools
from todohub.api import create_app, issue_description
from todohub.config import load_settings
from todohub.db import DB
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


def test_meta_and_sweep(env):
    client, db, _, launched = env
    m = client.get("/api/meta").json()
    assert [s["name"] for s in m["states"]] == ["Backlog", "Todo", "Pending", "Done"]
    assert m["sources"] == ["slack", "gmail", "grain", "calendar", "linear", "github"]
    assert client.post("/api/sweep").status_code == 202 and launched == [["--trigger", "manual"]]
    db.start_run("manual", "2026-11-03T00:00:00+00:00")
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
