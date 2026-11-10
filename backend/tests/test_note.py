import asyncio
import json
import stat
import sys
import textwrap
from datetime import datetime

import pytest

from todohub import mcp_server, note, plan, stats, sweep, tools, wrapup
from todohub.config import load_settings
from todohub.db import DB
from conftest import FakeLinear, make_issue


@pytest.fixture
def db():
    d = DB(load_settings().db_path)
    d.set_meta("open_issue_identifiers", ["ENG-1", "ENG-2"])
    return d


def test_note_due(db):
    ny = stats.TZ
    assert note.note_due(db, datetime(2026, 11, 10, 12, 0, tzinfo=ny))
    assert note.note_due(db, datetime(2026, 11, 10, 14, 59, tzinfo=ny))
    assert not note.note_due(db, datetime(2026, 11, 10, 11, 59, tzinfo=ny))     # still morning
    assert not note.note_due(db, datetime(2026, 11, 10, 15, 0, tzinfo=ny))      # wrap-up time
    assert not note.note_due(db, datetime(2026, 11, 14, 12, 0, tzinfo=ny))      # Saturday
    db.set_meta("notes", {"2026-11-10": {}})
    assert not note.note_due(db, datetime(2026, 11, 10, 12, 0, tzinfo=ny))     # already written


def test_report_note_saves_with_refs(db):
    r = tools.report_note(db, 4, day="2026-11-10", headline=" Finish the Globex grades before 2:00. ",
                          summary="[The Globex grades](eng-1) are still open. Nudge Sam on [the Hooli export](ENG-9).")
    assert r == {"status": "recorded"}
    n = db.get_meta("notes")["2026-11-10"]
    assert n["headline"] == "Finish the Globex grades before 2:00." and n["run_id"] == 4 and n["day"] == "2026-11-10"
    assert n["summary"] == "[The Globex grades](ENG-1) are still open. Nudge Sam on the Hooli export."
    assert n["made_at"].startswith("20")
    for d in range(1, 6):
        tools.report_note(db, 4, day=f"2001-01-0{d}", headline="", summary="")
    assert len(db.get_meta("notes")) == 4                                         # only the latest few days
    with pytest.raises(tools.ToolError):
        tools.report_note(db, None, day="2026-11-10", headline="", summary="")
    with pytest.raises(tools.ToolError):
        tools.report_note(db, 4, day="today", headline="", summary="")


def test_mcp_tool_schemas():
    names = {t.name: t for t in asyncio.run(mcp_server.server.list_tools())}
    assert set(names["report_note"].input_schema["required"]) == {"day", "headline", "summary"}
    assert "recap" in names["report_plan"].input_schema["required"]


def test_gather_and_section(db, monkeypatch):
    fake = FakeLinear()
    fake.completed = [make_issue("ENG-5", "Send Hooli the scores", state="Done", completed="2026-11-10T15:00:00Z"),
                      make_issue("ENG-6", "Old", state="Done", completed="2026-11-09T15:00:00Z")]
    fake.issues[1]["state"] = {"id": "s-Pending", "name": "Pending", "type": "unstarted"}
    monkeypatch.setattr(note, "Linear", lambda key: fake)
    db.set_today("2026-11-10", ["id-ENG-2", "id-ENG-5", "id-ENG-1"])
    db.set_meta("agendas", {"2026-11-10": [{"start": "09:30", "end": "10:00", "title": "Standup"},
                                           {"start": "11:45", "end": "12:30", "title": "Globex weekly", "external": True},
                                           {"start": "14:00", "end": None, "title": "Initech & Co sync"}]})
    db.set_meta("plans", {"2026-11-10": {"picks": [{"identifier": "ENG-1", "why": "Globex review at 2."}]}})

    ctx = note.gather(load_settings(), db, datetime(2026, 11, 10, 12, 5, tzinfo=stats.TZ))
    assert fake.completed_since == "2026-11-10T05:00:00+00:00"
    assert [i["identifier"] for i in ctx["on_today"]] == ["ENG-2", "ENG-1"]        # ENG-5 is closed
    assert [i["identifier"] for i in ctx["done_today"]] == ["ENG-5"]
    assert [e["title"] for e in ctx["agenda_left"]] == ["Globex weekly", "Initech & Co sync"]
    text = note.section(ctx, agenda_from_this_run=False)
    assert "### Midday note for Thibault (Tuesday 2026-11-10, 12:05)" in text
    assert "This morning's plan picked:\n  - ENG-1: Globex review at 2." in text
    assert "Done today:\n  - ENG-5 [dev] Send Hooli the scores" in text
    assert "  - ENG-2 [dev] Fix outcome report copy | no due date | Pending | a follow-up: he's waiting on someone" in text
    assert "11:45–12:30 Globex weekly (external)" in text and "Standup" not in text
    assert "`report_note`" in text and "[short label](IDENTIFIER)" in text

    db.set_meta("agendas", {})
    db.set_meta("plans", {})
    ctx = note.gather(load_settings(), db, datetime(2026, 11, 10, 12, 5, tzinfo=stats.TZ))
    assert ctx["agenda_left"] is None and ctx["picks"] == []
    assert "No plan was made this morning." in note.section(ctx, agenda_from_this_run=False)
    assert "His calendar for today isn't available." in note.section(ctx, agenda_from_this_run=False)
    assert "listed for `report_agenda` above, from 12:05 on" in note.section(ctx, agenda_from_this_run=True)


FAKE = textwrap.dedent("""\
    #!{python}
    import json, os, sys
    args = sys.argv[1:]
    cfg = json.load(open(args[args.index("--mcp-config") + 1]))
    env = cfg["mcpServers"]["todo-db"]["env"]
    os.environ.update(env)
    sys.path.insert(0, {src!r})
    from todohub import tools
    from todohub.db import DB
    from todohub.config import load_settings
    db = DB(load_settings().db_path)
    open(os.path.join(os.environ["TODOHUB_HOME"], "argv.json"), "w").write(json.dumps(args))
    if {save}:
        tools.report_note(db, int(env["TODOHUB_RUN_ID"]), day={day!r}, headline="H",
                          summary="[The Globex grades](ENG-1) are next.")
    print(json.dumps({{"type": "result", "subtype": "success", "is_error": False, "num_turns": 3,
                      "total_cost_usd": 0.02, "result": "H", "permission_denials": []}}))
""")


def _claude(tmp_path, monkeypatch, save=True):
    fake = tmp_path / "claude"
    src = str(__import__("pathlib").Path(sweep.__file__).parent.parent)
    fake.write_text(FAKE.format(python=sys.executable, src=src, save=save, day=datetime.now(stats.TZ).date().isoformat()))
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    for mod in (sweep, plan, wrapup, note):
        monkeypatch.setattr(mod, "Linear", lambda key: FakeLinear())
    s = load_settings()
    s.claude_path = str(fake)
    return s


def test_run_note(tmp_path, monkeypatch):
    s = _claude(tmp_path, monkeypatch)
    run = sweep.run_note(s)
    assert run["status"] == "ok" and run["trigger"] == "note", run
    db = DB(s.db_path)
    today = datetime.now(stats.TZ).date().isoformat()
    assert db.get_meta("notes")[today]["summary"] == "[The Globex grades](ENG-1) are next."
    assert db.latest_run("note")["id"] == run["id"] and db.latest_run() is None
    argv = json.loads((s.home / "argv.json").read_text())
    prompt = argv[argv.index("-p") + 1]
    assert "### Midday note for Thibault" in prompt and "$" not in prompt
    assert "## First: today's calendar" in prompt                                  # no agenda saved yet
    assert "mcp__todo-db__report_note" in argv[argv.index("--allowedTools") + 1].split(",")


def test_run_note_without_saving_is_an_error(tmp_path, monkeypatch):
    run = sweep.run_note(_claude(tmp_path, monkeypatch, save=False))
    assert run["status"] == "error" and "without saving a note" in run["error"]


def test_midday_sweep_writes_the_note(tmp_path, monkeypatch):
    s = _claude(tmp_path, monkeypatch)
    s.gh_path = "/nonexistent/gh"
    monkeypatch.setattr(plan, "plan_due", lambda db: False)
    monkeypatch.setattr(wrapup, "wrapup_due", lambda db: False)
    monkeypatch.setattr(note, "note_due", lambda db: True)
    sweep.run_sweep(s, "schedule")
    prompt = (lambda a: a[a.index("-p") + 1])(json.loads((s.home / "argv.json").read_text()))
    assert "### Midday note for Thibault" in prompt
    monkeypatch.setattr(note, "note_due", lambda db: False)
    sweep.run_sweep(s, "schedule")
    prompt = (lambda a: a[a.index("-p") + 1])(json.loads((s.home / "argv.json").read_text()))
    assert "### Midday note for Thibault" not in prompt
