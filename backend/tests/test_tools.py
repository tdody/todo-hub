import pytest

from todohub import tools
from todohub.config import load_settings
from todohub.db import DB


@pytest.fixture
def db():
    d = DB(load_settings().db_path)
    d.set_meta("client_labels", ["Initech & Co", "Globex"])
    d.set_meta("open_issue_identifiers", ["ENG-123"])
    return d


def add(db, **over):
    args = dict(source="slack", source_id="C1:1.0", title="Send Sam the Q1 review deck", signal="ask",
                why="Sam asked for it.", excerpt="can you send the file?",
                source_url="https://example.slack.com/archives/C1/p10")
    args.update(over)
    return tools.add_candidate(db, None, **args)


def test_add_and_dedup(db):
    assert add(db)["status"] == "added"
    assert add(db)["status"] == "already_in_queue"
    # same message, different task: allowed
    assert add(db, title="Book a review call")["status"] == "added"
    assert tools.is_seen(db, "slack", "C1:1.0") == {"seen": True}


def test_normalizes_and_rejects_bad_fields(db):
    r = add(db, client_label="globex", due_date="next friday", priority=9,
            possible_duplicate="eng-1")
    c = db.get_candidate(r["id"])
    assert c["client_label"] == "Globex"
    assert c["due_date"] is None and c["priority"] == 0
    assert c["possible_duplicate"] is None
    assert c["source_url"] == "https://example.slack.com/archives/C1/p10"
    assert len(r["notes"]) == 3


def test_unknown_label_dropped_known_duplicate_kept(db):
    r = add(db, client_label="Acme", possible_duplicate="ENG-123")
    c = db.get_candidate(r["id"])
    assert c["client_label"] is None and c["possible_duplicate"] == "ENG-123"


@pytest.mark.parametrize("field,value", [("source", "teams"), ("signal", "fyi"), ("title", "  "), ("source_id", "")])
def test_required_fields(db, field, value):
    with pytest.raises(tools.ToolError):
        add(db, **{field: value})


def test_mark_seen(db):
    assert tools.is_seen(db, "grain", "m1") == {"seen": False}
    tools.mark_seen(db, "grain", "m1")
    assert tools.is_seen(db, "grain", "m1") == {"seen": True}


def test_report_needs_run(db):
    with pytest.raises(tools.ToolError):
        tools.report_source_status(db, None, source="slack", ok=True, detail="fine")


def test_source_url_required_with_help(db):
    with pytest.raises(tools.ToolError, match="permalink"):
        add(db, source_url=None)
    with pytest.raises(tools.ToolError, match="resolve_urls"):
        add(db, source="grain", source_url="javascript:alert(1)")


def test_gmail_link_is_built(db):
    r = tools.add_candidate(db, None, source="gmail", source_id="18f2a", title="Reply to Robin", signal="ask",
                            why="w", excerpt="e", source_url="", gmail_account="me@example.com")
    assert db.get_candidate(r["id"])["source_url"] == \
        "https://mail.google.com/mail/u/me@example.com/#all/18f2a"


def test_links_cleaned(db):
    r = add(db, links=[
        {"url": "https://docs.google.com/d/1", "title": "Q1 review deck"},
        {"url": "https://docs.google.com/d/1", "title": "dup"},
        {"url": "https://example.slack.com/archives/C1/p10", "title": "same as source"},
        {"url": "http://insecure.example", "title": "x"},
        {"url": "https://github.com/acme/api/pull/812", "title": ""},
        "not a dict",
    ])
    assert db.get_candidate(r["id"])["links"] == [
        {"url": "https://docs.google.com/d/1", "title": "Q1 review deck"},
        {"url": "https://github.com/acme/api/pull/812", "title": "https://github.com/acme/api/pull/812"},
    ]
    assert len(r["notes"]) == 2


def test_subtasks_cleaned(db):
    r = add(db, subtasks=[{"title": "Pull the list", "due_date": "2026-11-05"}, {"title": " "},
                          "Send to Sam", {"title": "Book call", "due_date": "friday"}])
    assert db.get_candidate(r["id"])["subtasks"] == [
        {"title": "Pull the list", "due_date": "2026-11-05"},
        {"title": "Send to Sam", "due_date": None},
        {"title": "Book call", "due_date": None},
    ]
    many = add(db, title="Big", subtasks=[f"step {i}" for i in range(14)])
    assert len(db.get_candidate(many["id"])["subtasks"]) == 10


def test_old_database_is_upgraded(tmp_path):
    import sqlite3
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as c:
        c.execute("CREATE TABLE candidates (id INTEGER PRIMARY KEY, run_id INTEGER, source TEXT NOT NULL, "
                  "source_id TEXT NOT NULL, source_url TEXT, title TEXT NOT NULL, title_key TEXT NOT NULL, "
                  "signal TEXT NOT NULL, why TEXT, excerpt TEXT, who TEXT, client_label TEXT, due_date TEXT, "
                  "priority INTEGER NOT NULL DEFAULT 0, possible_duplicate TEXT, status TEXT NOT NULL DEFAULT 'pending', "
                  "linear_identifier TEXT, linear_url TEXT, created_at TEXT NOT NULL, decided_at TEXT, "
                  "UNIQUE (source, source_id, title_key))")
        c.execute("INSERT INTO candidates (source, source_id, title, title_key, signal, created_at) "
                  "VALUES ('slack', 'a', 'Old task', 'old task', 'ask', '2026-11-01T00:00:00+00:00')")
    old = DB(path).list_candidates()[0]
    assert old["links"] == [] and old["subtasks"] == []


def test_waiting_on_gets_a_followup_date(db):
    from datetime import date
    assert tools.add_working_days(date(2026, 11, 6), 3) == date(2026, 11, 11)     # Fri + 3 working days = Wed
    r = add(db, title="Waiting on Sam: Q1 customer key", signal="waiting_on", asked_on="2026-11-05", followup_days=3)
    c = db.get_candidate(r["id"])
    assert c["kind"] == "waiting" and c["due_date"] == "2026-11-10"
    r = add(db, title="Waiting on Mona: review", signal="waiting_on", due_date="2026-11-20")
    assert db.get_candidate(r["id"])["due_date"] == "2026-11-20"                 # a stated date wins


def test_propose_close_and_update(db):
    db.set_meta("open_issues", [{"identifier": "ENG-123", "title": "Pipeline audit"}])
    url = "https://example.slack.com/archives/C1/p11"
    r = tools.propose_close(db, None, source="slack", source_id="C1:2", source_url=url, target_issue="eng-123",
                            why="The client answered all four questions.", excerpt="answers attached")
    c = db.get_candidate(r["id"])
    assert c["kind"] == "close" and c["target_issue"] == "ENG-123" and c["title"] == "Close ENG-123: Pipeline audit"
    r = tools.propose_update(db, None, source="slack", source_id="C1:3", source_url=url, target_issue="ENG-123",
                             comment="Client moved the readout to Nov 12.", why="New date", excerpt="let's do the 12th")
    c = db.get_candidate(r["id"])
    assert c["kind"] == "comment" and c["comment"] == "Client moved the readout to Nov 12."
    with pytest.raises(tools.ToolError, match="not one of"):
        tools.propose_close(db, None, source="slack", source_id="C1:4", source_url=url, target_issue="ENG-1",
                            why="w", excerpt="e")
    with pytest.raises(tools.ToolError, match="comment is required"):
        tools.propose_update(db, None, source="slack", source_id="C1:5", source_url=url, target_issue="ENG-123",
                             comment=" ", why="w", excerpt="e")
    with pytest.raises(tools.ToolError, match="signal"):
        add(db, signal="done")
