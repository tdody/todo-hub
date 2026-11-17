import asyncio
import json
import stat
import sys
import textwrap
from datetime import date, datetime

import httpx
import pytest

from todohub import mcp_server, plan, stats, sweep, tools, wrapup
from todohub.config import load_settings
from todohub.db import DB
from todohub.linear import Linear, shape_issue
from conftest import FakeLinear, make_issue


@pytest.fixture
def db():
    d = DB(load_settings().db_path)
    d.set_meta("open_issue_identifiers", ["ENG-1", "ENG-2", "ENG-3", "ENG-4", "ENG-5"])
    return d


def test_report_wrapup_saves_day_and_week(db):
    r = tools.report_wrapup(
        db, 9, day="2026-11-06", summary="Globex items are out. Hooli slips.",
        items=[{"identifier": "eng-1", "action": "carry", "why": "Still first."},
               {"identifier": "ENG-2", "action": "move", "move_to": "2026-11-11", "why": "Waiting on data."},
               {"identifier": "ENG-3", "action": "ask", "message": "Hi Jordan, any news on the export?", "why": "Blocked."},
               {"identifier": "ENG-4", "action": "close", "why": "Riley confirmed she got the file in #hooli."},
               {"identifier": "ENG-1", "action": "close", "why": "dup"}],
        start_with={"identifier": "ENG-1", "why": "The review is Monday."},
        notes=["Shipped calibration diagnostics (ENG-5)", "", "Sent the mismatch table (ENG-9)"],
        checkin={"work": [{"mission": "Improve our scoring models", "items": ["Shipped calibration diagnostics (ENG-5)"]},
                          {"mission": "Other", "items": []}],
                 "next_week": ["Finish the re-binning (ENG-1)"], "review": ["Calibration doc: https://docs.google.com/x"],
                 "health": [{"mission": "Improve our scoring models", "status": "on_track", "why": "Diagnostics shipped."}]})
    assert r == {"status": "recorded", "items": 4, "work_groups": 1}
    w = db.get_meta("wrapups")["2026-11-06"]
    assert [i["action"] for i in w["items"]] == ["carry", "move", "ask", "close"]
    assert w["items"][1]["move_to"] == "2026-11-11" and w["items"][2]["message"].startswith("Hi Jordan")
    assert w["start_with"] == {"identifier": "ENG-1", "why": "The review is Monday."}
    assert w["notes"] == ["Shipped calibration diagnostics (ENG-5)", "Sent the mismatch table (ENG-9)"]
    c = db.get_meta("checkins")["2026-11-02"]                      # the week's Monday
    assert c["through"] == "2026-11-06" and c["work"][0]["items"] == ["Shipped calibration diagnostics (ENG-5)"]
    assert c["health"][0]["status"] == "on_track" and c["review"] == ["Calibration doc: https://docs.google.com/x"]

    bad = [dict(items=[{"identifier": "ENG-99", "action": "carry", "why": ""}]),
           dict(items=[{"identifier": "ENG-1", "action": "drop", "why": ""}]),
           dict(items=[{"identifier": "ENG-1", "action": "move", "move_to": "2026-11-06", "why": ""}]),
           dict(items=[{"identifier": "ENG-1", "action": "ask", "why": ""}]),
           dict(start_with={"identifier": "nope"}),
           dict(checkin={"health": [{"mission": "X", "status": "great", "why": ""}]})]
    for kw in bad:
        with pytest.raises(tools.ToolError):
            tools.report_wrapup(db, 9, day="2026-11-06", summary="", **kw)
    with pytest.raises(tools.ToolError):
        tools.report_wrapup(db, None, day="2026-11-06", summary="")


def test_wrapup_due(db):
    ny = stats.TZ
    assert wrapup.wrapup_due(db, datetime(2026, 11, 6, 16, 0, tzinfo=ny))
    assert not wrapup.wrapup_due(db, datetime(2026, 11, 6, 14, 0, tzinfo=ny))      # the 2 PM sweep
    assert not wrapup.wrapup_due(db, datetime(2026, 11, 7, 16, 0, tzinfo=ny))      # Saturday
    db.set_meta("wrapups", {"2026-11-06": {}})
    assert not wrapup.wrapup_due(db, datetime(2026, 11, 6, 16, 0, tzinfo=ny))      # already written
    assert wrapup.previous_working_day(date(2026, 11, 9)) == date(2026, 11, 6)
    assert wrapup.next_working_day(date(2026, 11, 6)) == date(2026, 11, 9)


def _shaped(ident, title, due=None, client=None, project=None, stype="unstarted", state="Todo", completed=None):
    i = make_issue(ident, title, client=client, due=due)
    i["state"] = {"id": "s", "name": state, "type": stype}
    i["project"] = {"id": "p", "name": project} if project else None
    if completed:
        i["completedAt"] = completed
    return shape_issue(i, load_settings())


def test_section_lists_the_day_and_the_week():
    s = load_settings()
    today = date(2026, 11, 6)
    ctx = {
        "today": today, "next_day": date(2026, 11, 9), "week": date(2026, 11, 2),
        "plan": {"headline": "Clear Globex first.", "picks": [{"identifier": "ENG-1", "why": "Review at 2."}]},
        "why": {"ENG-1": "Review at 2."},
        "still_open": [_shaped("ENG-1", "Re-binning", due="2026-11-06", client="Globex", project="Improve our scoring models")],
        "done_today": [_shaped("ENG-5", "Calibration diagnostics", stype="completed", completed="2026-11-06T15:00:00Z")],
        "done_week": [_shaped("ENG-5", "Calibration diagnostics", stype="completed", completed="2026-11-06T15:00:00Z")],
        "upcoming": [_shaped("ENG-2", "Export pagination", due="2026-11-12")],
        "slips": {"id-ENG-1": {"count": 3}}, "waiting_state": s.waiting_state,
        "agenda_today": [{"start": "14:00", "end": "14:45", "title": "Globex review", "external": True}],
        "agenda_next": None, "initiative": "Q4 Missions",
        "missions": [{"name": "Improve our scoring models", "mine": True, "status": "In Progress"},
                     {"name": "Pixel", "mine": False, "status": ""}],
        "notes": [("2026-11-04", ["Sent Riley the file (ENG-3)"])], "client_done": 1, "done": 3,
    }
    text = wrapup.section(ctx)
    assert "### Wrap up the day (Friday 2026-11-06)" in text
    assert "ENG-1 [client: Globex; project: Improve our scoring models] Re-binning | due today | Todo" in text
    assert "due date pushed 3×" in text and "this morning's reason: Review at 2." in text
    assert "Monday's meetings:\n  (not read yet)" in text and "14:00–14:45 Globex review (external)" in text
    assert "Wed: Sent Riley the file (ENG-3)" in text and "ENG-5 [dev] Calibration diagnostics (closed Fri)" in text
    assert "(he leads it: give its health)" in text and "  - Pixel\n" in text + "\n"
    assert "last working day of the week" in text and "`checkin`" in text and "`close`" in text
    assert "isn't technical" in text and "no pull request numbers or links" in text
    assert "Leave out meetings, calls" in text and "Never a pull request" in text
    ctx["missions"], ctx["today"] = [], date(2026, 11, 5)
    text = wrapup.section(ctx)
    assert "couldn't be read from Linear" in text and "the week so far" in text


def test_plan_sees_yesterdays_start_with(db, monkeypatch):
    monkeypatch.setattr(plan, "Linear", lambda key: FakeLinear())
    db.set_meta("wrapups", {"2026-11-06": {"start_with": {"identifier": "ENG-1", "why": "The review is Monday."}}})
    ctx = plan.gather(load_settings(), db, datetime(2026, 11, 9, 8, 0, tzinfo=stats.TZ))   # Monday
    assert ctx["start_with"]["identifier"] == "ENG-1"
    assert "suggested starting today with ENG-1: The review is Monday." in plan.section(ctx, agenda_from_this_run=False)


def test_initiative_projects_falls_back_to_the_name():
    calls = []

    def handler(request: httpx.Request):
        body = json.loads(request.content)
        calls.append(body["query"])
        if "initiative(id:" in body["query"]:
            return httpx.Response(200, json={"errors": [{"message": "Entity not found"}]})
        return httpx.Response(200, json={"data": {"initiatives": {"nodes": [{"projects": {"nodes": [
            {"name": "Improve our scoring models", "lead": {"isMe": True}, "status": {"type": "started", "name": "In Progress"}},
            {"name": "Pixel", "lead": {"isMe": False}, "status": {"type": "started", "name": "In Progress"}},
            {"name": "Old one", "lead": None, "status": {"type": "canceled", "name": "Canceled"}}]}}]}}})

    got = Linear("k", transport=httpx.MockTransport(handler)).initiative_projects("Q4 Missions")
    assert got == [{"name": "Improve our scoring models", "mine": True, "status": "In Progress"},
                   {"name": "Pixel", "mine": False, "status": "In Progress"}]
    assert len(calls) == 2
    nothing = Linear("k", transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json={"errors": [{"message": "no"}]}))).initiative_projects("Q4 Missions")
    assert nothing == []


def test_mcp_tool_schema():
    names = {t.name: t for t in asyncio.run(mcp_server.server.list_tools())}
    schema = names["report_wrapup"].input_schema
    assert {"day", "summary", "items"} <= set(schema["required"])
    assert "checkin" in schema["properties"]


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
        tools.report_wrapup(db, int(env["TODOHUB_RUN_ID"]), day={day!r}, summary="S",
                            items=[{{"identifier": "ENG-1", "action": "carry", "why": "Globex is waiting."}}],
                            checkin={{"work": [{{"mission": "Other", "items": ["Fixed copy (ENG-2)"]}}]}})
    print(json.dumps({{"type": "result", "subtype": "success", "is_error": False, "num_turns": 3,
                      "total_cost_usd": 0.03, "result": "1 item", "permission_denials": []}}))
""")


def _claude(tmp_path, monkeypatch, save=True):
    fake = tmp_path / "claude"
    src = str(__import__("pathlib").Path(sweep.__file__).parent.parent)
    fake.write_text(FAKE.format(python=sys.executable, src=src, save=save, day=datetime.now(stats.TZ).date().isoformat()))
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    for mod in (sweep, plan, wrapup):
        monkeypatch.setattr(mod, "Linear", lambda key: FakeLinear())
    s = load_settings()
    s.claude_path = str(fake)
    return s


def test_run_wrapup(tmp_path, monkeypatch):
    s = _claude(tmp_path, monkeypatch)
    run = sweep.run_wrapup(s)
    assert run["status"] == "ok" and run["trigger"] == "wrapup", run
    db = DB(s.db_path)
    today = datetime.now(stats.TZ).date().isoformat()
    assert db.get_meta("wrapups")[today]["items"][0]["identifier"] == "ENG-1"
    assert db.latest_run("wrapup")["id"] == run["id"] and db.latest_run() is None
    argv = json.loads((s.home / "argv.json").read_text())
    prompt = argv[argv.index("-p") + 1]
    assert "### Wrap up the day" in prompt and "$" not in prompt
    assert "mcp__todo-db__report_wrapup" in argv[argv.index("--allowedTools") + 1].split(",")


def test_run_wrapup_without_saving_is_an_error(tmp_path, monkeypatch):
    s = _claude(tmp_path, monkeypatch, save=False)
    run = sweep.run_wrapup(s)
    assert run["status"] == "error" and "without saving a wrap-up" in run["error"]


def test_afternoon_sweep_wraps_up(tmp_path, monkeypatch):
    s = _claude(tmp_path, monkeypatch)
    s.gh_path = "/nonexistent/gh"
    monkeypatch.setattr(plan, "plan_due", lambda db: False)
    monkeypatch.setattr(wrapup, "wrapup_due", lambda db: True)
    sweep.run_sweep(s, "schedule")
    prompt = (lambda a: a[a.index("-p") + 1])(json.loads((s.home / "argv.json").read_text()))
    assert "### Wrap up the day" in prompt
    monkeypatch.setattr(wrapup, "wrapup_due", lambda db: False)
    sweep.run_sweep(s, "schedule")
    prompt = (lambda a: a[a.index("-p") + 1])(json.loads((s.home / "argv.json").read_text()))
    assert "### Wrap up the day" not in prompt
