import json
import stat
import sys
import textwrap
from datetime import date, datetime

import pytest

from todohub import plan, stats, sweep, tools
from todohub.config import load_settings
from todohub.db import DB
from conftest import FakeLinear, make_issue


@pytest.fixture
def db():
    d = DB(load_settings().db_path)
    d.set_meta("open_issue_identifiers", ["ENG-1", "ENG-2", "ENG-3", "ENG-4"])
    return d


def test_report_plan_saves_and_checks(db):
    r = tools.report_plan(db, 7, day="2026-11-05", headline="About 5 h free.", recap="Closed 2.", summary="Grades first.",
                          picks=[{"identifier": "eng-1", "why": "The 2:00 review needs it.", "minutes": 120},
                                 {"identifier": "ENG-2", "why": "Jordan asked.", "minutes": 1000},
                                 {"identifier": "ENG-1", "why": "dup", "minutes": 5}],
                          set_aside=[{"identifier": "ENG-3", "action": "move", "move_to": "2026-11-09", "why": "Blocked."},
                                     {"identifier": "ENG-4", "action": "ask", "message": "Hi Morgan, is this yours?", "why": "x"},
                                     {"identifier": "ENG-2", "action": "clear_date", "why": "already a pick"}])
    assert r == {"status": "recorded", "picks": 2, "set_aside": 2}
    p = db.get_meta("plans")["2026-11-05"]
    assert [x["identifier"] for x in p["picks"]] == ["ENG-1", "ENG-2"]
    assert p["picks"][1]["minutes"] == 480                        # clamped
    assert p["set_aside"][0]["move_to"] == "2026-11-09" and p["set_aside"][1]["message"].startswith("Hi Morgan")
    assert p["summary"] == "Grades first." and p["recap"] == "Closed 2." and p["run_id"] == 7

    bad = [dict(picks=[]), dict(picks=[{"identifier": "ENG-99", "why": "", "minutes": 5}]),
           dict(picks=[{"identifier": "rm -rf", "why": "", "minutes": 5}]),
           dict(picks=[{"identifier": "ENG-1", "why": "", "minutes": 5}],
                set_aside=[{"identifier": "ENG-3", "action": "move", "move_to": "2026-11-05"}]),
           dict(picks=[{"identifier": "ENG-1", "why": "", "minutes": 5}],
                set_aside=[{"identifier": "ENG-3", "action": "ask"}]),
           dict(picks=[{"identifier": "ENG-1", "why": "", "minutes": 5}],
                set_aside=[{"identifier": "ENG-3", "action": "close"}])]
    for kw in bad:
        with pytest.raises(tools.ToolError):
            tools.report_plan(db, 7, day="2026-11-05", headline="", recap="", summary="", **kw)
    with pytest.raises(tools.ToolError):
        tools.report_plan(db, None, day="2026-11-05", headline="", recap="", summary="",
                          picks=[{"identifier": "ENG-1", "why": "", "minutes": 5}])


def test_refs_to_unknown_issues_become_their_label():
    db = DB(load_settings().db_path)
    db.set_meta("open_issue_identifiers", ["ENG-1", "ENG-2"])
    text = ("Finish [the Globex grades](eng-1) before the review. [Hooli export](ENG-99) slipped; "
            "nudge Sam on [the deck](https://example.com/x). [Initech & Co data](ENG-2) is next.")
    clean = ("Finish [the Globex grades](ENG-1) before the review. Hooli export slipped; "
             "nudge Sam on the deck. [Initech & Co data](ENG-2) is next.")
    assert tools.clean_refs(text, {"ENG-1", "ENG-2"}) == clean
    assert tools.clean_refs("[x](ENG-7) and [y](not an id)", set()) == "[x](ENG-7) and y"   # no list: well-formed ones stay

    tools.report_plan(db, 7, day="2026-11-05", headline="H", recap=text, summary=text,
                      picks=[{"identifier": "ENG-1", "why": "", "minutes": 30}])
    saved = db.get_meta("plans")["2026-11-05"]
    assert saved["recap"] == clean and saved["summary"] == clean
    tools.report_wrapup(db, 7, day="2026-11-05", summary=text)
    assert db.get_meta("wrapups")["2026-11-05"]["summary"] == clean


def test_plan_recap_reads_the_last_working_day(monkeypatch):
    db = DB(load_settings().db_path)
    fake = FakeLinear()
    fake.completed = [make_issue("ENG-5", "Send Globex the scores", client="Globex", state="Done",
                                 completed="2026-11-06T20:00:00Z"),                 # Friday afternoon
                      make_issue("ENG-6", "Fix the export", state="Done", completed="2026-11-05T20:00:00Z"),   # Thursday
                      make_issue("ENG-7", "Review the Hooli deck", state="Done", completed="2026-11-09T13:30:00Z")]  # Monday
    monkeypatch.setattr(plan, "Linear", lambda key: fake)
    db.set_meta("wrapups", {"2026-11-06": {"summary": "[The Globex scores](ENG-5) went out. Sam hasn't answered."}})
    db.set_today("2026-11-09", ["id-ENG-2", "id-ENG-404"])                         # carried; the second one is closed

    ctx = plan.gather(load_settings(), db, datetime(2026, 11, 9, 8, 0, tzinfo=stats.TZ))   # Monday
    assert fake.completed_since == "2026-11-06T05:00:00+00:00"                     # from Friday, not Monday
    assert ctx["prev_day"] == date(2026, 11, 6) and [i["identifier"] for i in ctx["done_prev"]] == ["ENG-5"]
    assert ctx["done"] == 1                                                        # the week's balance starts Monday
    assert [i["identifier"] for i in ctx["on_today"]] == ["ENG-2"]
    text = plan.section(ctx, agenda_from_this_run=False)
    assert "Friday's wrap-up said: \"[The Globex scores](ENG-5) went out. Sam hasn't answered.\"" in text
    assert "Closed Friday:\n  - ENG-5 [client: Globex] Send Globex the scores" in text
    assert "carried over from Friday):\n  - ENG-2 [dev] Fix outcome report copy" in text
    assert "on Friday: how many issues he closed" in text

    ctx = plan.gather(load_settings(), db, datetime(2026, 11, 11, 8, 0, tzinfo=stats.TZ))  # Wednesday
    assert fake.completed_since == "2026-11-09T05:00:00+00:00"                     # the week's start
    assert ctx["prev_day"] == date(2026, 11, 10) and ctx["done_prev"] == []
    assert "No wrap-up was saved for Tuesday." in plan.section(ctx, agenda_from_this_run=False)


def test_free_minutes():
    agenda = [{"start": "09:30", "end": "10:00"}, {"start": "14:00", "end": "14:45"},
              {"start": "14:30", "end": "15:00"}, {"start": "07:00", "end": "08:45"}, {"start": "16:00", "end": None}]
    # 8:30–18:00 = 570 min; busy 8:30–8:45 (15), 9:30–10 (30), 14:00–15:00 (60), 16:00–16:30 (30); lunch 60
    assert plan.free_minutes(agenda) == 570 - 135 - 60
    assert plan.free_minutes([]) == 510 and plan.free_minutes(None) is None


def test_plan_due(db):
    ny = stats.TZ
    assert plan.plan_due(db, datetime(2026, 11, 5, 8, 0, tzinfo=ny))
    assert not plan.plan_due(db, datetime(2026, 11, 5, 11, 0, tzinfo=ny))      # too late
    assert not plan.plan_due(db, datetime(2026, 11, 7, 8, 0, tzinfo=ny))       # Saturday
    db.set_meta("plans", {"2026-11-05": {}})
    assert not plan.plan_due(db, datetime(2026, 11, 5, 8, 0, tzinfo=ny))       # already planned


def test_candidates_and_section():
    s = load_settings()
    today = date(2026, 11, 5)

    def shaped(ident, title, due=None, priority=0, state="Todo", stype="unstarted", client=None):
        i = make_issue(ident, title, client=client, due=due, priority=priority)
        i["state"] = {"id": "s", "name": state, "type": stype}
        from todohub.linear import shape_issue
        return shape_issue(i, s)

    issues = [shaped("ENG-1", "Grades", due="2026-11-05", priority=2, client="Globex"),
              shaped("ENG-2", "Far away", due="2026-12-01"),
              shaped("ENG-3", "Started", stype="started", state="In Progress"),
              shaped("ENG-4", "Waiting on Jordan: export", due="2026-11-04", state=s.waiting_state),
              shaped("ENG-5", "Waiting on Bo: data", due="2026-11-20", state=s.waiting_state),
              shaped("ENG-6", "Late one", due="2026-11-01")]
    picked = plan.candidates(issues, s.waiting_state, today)
    assert [i["identifier"] for i in picked] == ["ENG-6", "ENG-4", "ENG-1", "ENG-3"]
    ctx = {"today": today, "issues": picked, "waiting_state": s.waiting_state,
           "slips": {"id-ENG-6": {"count": 3}}, "agenda": [{"start": "14:00", "end": "14:45", "title": "Globex review", "external": True}],
           "free": 300, "client_done": 0, "done": 4, "prev_day": date(2026, 11, 4), "prev_wrapup_summary": None,
           "done_prev": [], "on_today": []}
    text = plan.section(ctx, agenda_from_this_run=False)
    assert "ENG-6 [dev] Late one | due 2026-11-01 (4 days late) | Todo | due date pushed 3×" in text
    assert "ENG-1 [client: Globex] Grades | due today | Todo | high" in text
    assert "a follow-up: he's waiting on someone" in text
    assert "14:00–14:45 Globex review (external)" in text and "about 300 minutes free" in text
    assert "0 of the 4 issues he closed this week were client work" in text
    assert "`summary`" in text and "`set_aside`" in text and "`recap`" in text and "[short label](IDENTIFIER)" in text
    assert "No wrap-up was saved for Wednesday." in text and "Closed Wednesday:\n  (none)" in text
    ctx["agenda"] = None
    assert "listed for `report_agenda` above" in plan.section(ctx, agenda_from_this_run=True)


FAKE_PLANNER = textwrap.dedent("""\
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
        tools.report_plan(db, int(env["TODOHUB_RUN_ID"]), day={day!r}, headline="H", recap="R", summary="S",
                          picks=[{{"identifier": "ENG-1", "why": "Globex is waiting.", "minutes": 60}}])
    print(json.dumps({{"type": "result", "subtype": "success", "is_error": False, "num_turns": 3,
                      "total_cost_usd": 0.03, "result": "1 pick", "permission_denials": []}}))
""")


def _planner(tmp_path, monkeypatch, save=True):
    fake = tmp_path / "claude"
    src = str(__import__("pathlib").Path(sweep.__file__).parent.parent)
    fake.write_text(FAKE_PLANNER.format(python=sys.executable, src=src, save=save,
                                        day=datetime.now(stats.TZ).date().isoformat()))
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setattr(sweep, "Linear", lambda key: FakeLinear())
    monkeypatch.setattr(plan, "Linear", lambda key: FakeLinear())
    s = load_settings()
    s.claude_path = str(fake)
    return s


def test_run_plan(tmp_path, monkeypatch):
    s = _planner(tmp_path, monkeypatch)
    run = sweep.run_plan(s)
    assert run["status"] == "ok" and run["trigger"] == "plan", run
    db = DB(s.db_path)
    today = datetime.now(stats.TZ).date().isoformat()
    assert db.get_meta("plans")[today]["picks"][0]["identifier"] == "ENG-1"
    assert db.latest_run("plan")["id"] == run["id"] and db.latest_run() is None   # not a sweep
    argv = json.loads((s.home / "argv.json").read_text())
    prompt = argv[argv.index("-p") + 1]
    assert "### Plan Thibault's day" in prompt and "$" not in prompt
    assert "## First: today's calendar" in prompt           # no agenda saved yet
    assert "mcp__todo-db__report_plan" in argv[argv.index("--allowedTools") + 1].split(",")


def test_run_plan_without_saving_is_an_error(tmp_path, monkeypatch):
    s = _planner(tmp_path, monkeypatch, save=False)
    run = sweep.run_plan(s)
    assert run["status"] == "error" and "without saving a plan" in run["error"]


def test_morning_sweep_plans_the_day(tmp_path, monkeypatch):
    s = _planner(tmp_path, monkeypatch)
    s.gh_path = "/nonexistent/gh"
    monkeypatch.setattr(plan, "plan_due", lambda db: True)
    sweep.run_sweep(s, "schedule")
    prompt = (lambda a: a[a.index("-p") + 1])(json.loads((s.home / "argv.json").read_text()))
    assert "### Plan Thibault's day" in prompt
    assert prompt.index("### Google Calendar") < prompt.index("### Plan Thibault's day")
    monkeypatch.setattr(plan, "plan_due", lambda db: False)
    sweep.run_sweep(s, "schedule")
    prompt = (lambda a: a[a.index("-p") + 1])(json.loads((s.home / "argv.json").read_text()))
    assert "### Plan Thibault's day" not in prompt
