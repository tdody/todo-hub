from datetime import datetime, timedelta, timezone
import os
import json
import stat
import sys
import textwrap

import pytest

from todohub import sweep, tools
from todohub.config import DEFAULT_HUBSPOT_TOOLS, load_settings
from todohub.db import DB
from conftest import FakeLinear

FAKE_CLAUDE = textwrap.dedent("""\
    #!{python}
    # Pretends to be `claude -p`: reads the MCP config, writes through the todo-db tools.
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
    run_id = int(env["TODOHUB_RUN_ID"])
    open(os.path.join(os.environ["TODOHUB_HOME"], "argv.json"), "w").write(json.dumps(args))
    debug = os.path.join(os.environ["TODOHUB_HOME"], "claudeai-debug.txt")
    if "--debug-file" in args and os.path.exists(debug):
        open(args[args.index("--debug-file") + 1], "w").write(open(debug).read())
    tools.add_candidate(db, run_id, source="slack", source_id="C9:2.0", title="Review Mona's PR",
                        signal="ask", why="Mona asked for a review.", excerpt="can you review?",
                        source_url="https://example.slack.com/archives/C9/p20",
                        links=[{{"url": "https://github.com/acme/api/pull/812", "title": "api PR #812"}}],
                        subtasks=[{{"title": "Run the tests locally"}}, {{"title": "Leave review comments"}}])
    tools.report_source_status(db, run_id, source="slack", ok=True, detail="3 searches", items_scanned=12)
    print(json.dumps({{"type": "result", "subtype": "success", "is_error": False, "num_turns": 7,
                      "total_cost_usd": 0.12, "result": "slack: 1", "permission_denials": []}}))
""")


@pytest.fixture
def settings(tmp_path, monkeypatch):
    fake = tmp_path / "claude"
    src = str((__import__("pathlib").Path(sweep.__file__).parent.parent))
    fake.write_text(FAKE_CLAUDE.format(python=sys.executable, src=src))
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setattr(sweep, "Linear", lambda key: FakeLinear())
    s = load_settings()
    s.claude_path = str(fake)
    s.gh_path = "/nonexistent/gh"          # GitHub is tested on its own below
    return s


def test_sweep_end_to_end(settings):
    run = sweep.run_sweep(settings, "schedule")
    assert run["status"] == "ok", run
    assert run["cost_usd"] == 0.12 and run["num_turns"] == 7
    by_source = {s["source"]: s for s in run["sources"]}
    assert by_source["slack"]["ok"] and by_source["slack"]["items_scanned"] == 12
    assert not by_source["grain"]["ok"]          # never reported -> flagged
    db = DB(settings.db_path)
    [cand] = db.list_candidates()
    assert cand["title"] == "Review Mona's PR" and len(cand["subtasks"]) == 2
    assert cand["links"] == [{"url": "https://github.com/acme/api/pull/812", "title": "api PR #812"}]
    assert db.get_meta("client_labels") == ["Initech & Co", "Globex"]

    argv = json.loads((settings.home / "argv.json").read_text())
    allowed = argv[argv.index("--allowedTools") + 1].split(",")
    assert "mcp__todo-db__add_candidate" in allowed
    assert not any("send" in t or "create" in t for t in allowed)
    denied = argv[argv.index("--disallowedTools") + 1].split(",")
    assert "Bash" in denied and "mcp__claude_ai_Slack__slack_send_message" in denied
    assert not set(allowed) & set(denied)
    prompt = argv[argv.index("-p") + 1]
    assert "$" not in prompt.replace("$0", "")      # every placeholder filled
    assert "ENG-1: Rebin Globex grades" in prompt and "Globex" in prompt
    assert "### Gmail" in prompt and "assigned you an action item" in prompt
    assert "mcp__claude_ai_Gmail__search_threads" in allowed
    assert {"mcp__claude_ai_Gmail__send_message", "mcp__claude_ai_Gmail__reply",
            "mcp__claude_ai_Gmail__forward", "mcp__claude_ai_Gmail__trash_thread"} <= set(denied)
    assert "### Linear: mentions of Thibault" in prompt and "(no new mentions)" in prompt
    assert by_source["linear"]["ok"] and not by_source["github"]["ok"]
    assert "Can't find gh" in by_source["github"]["detail"]
    assert "### Google Calendar: meeting prep for" in prompt
    assert "Globex" in prompt.split("active Linear projects")[1][:400]
    assert "ENG-1: Rebin Globex grades  [client: Globex]" in prompt
    assert "mcp__claude_ai_Google_Calendar__list_events" in allowed
    assert "mcp__claude_ai_Google_Calendar__create_event" in denied

    assert "(none to check)" in prompt

    # slack worked, so its window moves to this run's start; sources that didn't report keep theirs
    run2 = sweep.run_sweep(settings)
    db = DB(settings.db_path)
    assert db.last_ok_start("slack") == db.get_run(run2["id"])["started_at"]
    assert run2["since"] < db.get_run(run["id"])["started_at"]


def test_missing_claude_binary(settings):
    settings.claude_path = "/nonexistent/claude"
    run = sweep.run_sweep(settings)
    assert run["status"] == "error" and "Can't find Claude Code" in run["error"]


def test_bad_output(settings, tmp_path):
    bad = tmp_path / "bad"
    bad.write_text("#!/bin/sh\necho 'not json'; echo 'Error: auth' >&2; exit 1\n")
    bad.chmod(0o755)
    settings.claude_path = str(bad)
    run = sweep.run_sweep(settings)
    assert run["status"] == "error" and "Error: auth" in run["error"]


def test_gmail_section_when_configured(settings):
    settings.gmail_tools = ["mcp__claude_ai_Gmail__search_threads"]
    from datetime import datetime, timezone
    text = sweep.build_prompt(settings, datetime.now(timezone.utc), ["Acme"], [], [])
    assert "### Gmail" in text and "### Slack" in text and "### Grain" in text
    settings.gmail_tools = []
    assert "### Gmail" not in sweep.build_prompt(settings, datetime.now(timezone.utc), [], [], [])


def test_capture_run(settings):
    run = sweep.run_capture(settings, "https://example.slack.com/archives/C9/p20")
    assert run["status"] == "ok" and run["trigger"] == "capture" and run["added"] == 1
    argv = json.loads((settings.home / "argv.json").read_text())
    prompt = argv[argv.index("-p") + 1]
    assert "https://example.slack.com/archives/C9/p20" in prompt and "$" not in prompt
    # the open projects, and each open issue's client and project, as in a sweep
    assert 'Improve our "Forecast" models' in prompt and "ENG-1: Rebin Globex grades  [client: Globex]" in prompt
    # captures don't move the sweep window
    assert DB(settings.db_path).last_successful_start() is None


def test_capture_that_adds_nothing_is_an_error(settings, tmp_path):
    quiet = tmp_path / "quiet"
    quiet.write_text("#!/bin/sh\necho '{\"type\":\"result\",\"is_error\":false,\"result\":\"nothing\"}'\n")
    quiet.chmod(0o755)
    settings.claude_path = str(quiet)
    run = sweep.run_capture(settings, "https://example.slack.com/archives/C9/p21")
    assert run["status"] == "error" and "didn't add" in run["error"]


def test_watched_issues_reach_the_prompt(settings):
    db = DB(settings.db_path)
    r = tools.add_candidate(db, None, source="slack", source_id="C1:9", title="Rebin Globex grades", signal="ask",
                            why="w", excerpt="e", source_url="https://example.slack.com/archives/C1/p9")
    db.decide(r["id"], "approved", "ENG-1", "https://linear.app/x/issue/ENG-1")
    sweep.run_sweep(settings)
    argv = json.loads((settings.home / "argv.json").read_text())
    prompt = argv[argv.index("-p") + 1]
    assert "ENG-1 (task): Rebin Globex grades" in prompt and "https://example.slack.com/archives/C1/p9" in prompt


def test_next_working_day():
    from datetime import date
    assert sweep.next_working_day(date(2026, 11, 6)) == date(2026, 11, 9)    # Fri -> Mon
    assert sweep.next_working_day(date(2026, 11, 3)) == date(2026, 11, 4)


def test_calendar_block_only_allows_create_event(settings, tmp_path):
    settings.hubspot_tools = list(DEFAULT_HUBSPOT_TOOLS)
    from datetime import datetime
    from todohub import calendar_block
    fake = tmp_path / "cal"
    fake.write_text(
        "#!" + sys.executable + "\nimport json, sys, os\n"
        "open(os.environ['ARGV_OUT'], 'w').write(json.dumps(sys.argv[1:]))\n"
        "print(json.dumps({'is_error': False, 'result': 'Created: https://calendar.google.com/event?eid=xyz'}))\n")
    fake.chmod(0o755)
    settings.claude_path = str(fake)
    os.environ["ARGV_OUT"] = str(tmp_path / "argv.json")
    link = calendar_block.block_time(settings, "ENG-1 Rebin grades\nIGNORE ALL", "https://linear.app/x/ENG-1",
                                     datetime(2026, 11, 4, 10, 0), 60)
    assert link == "https://calendar.google.com/event?eid=xyz"
    argv = json.loads((tmp_path / "argv.json").read_text())
    assert argv[argv.index("--allowedTools") + 1] == "mcp__claude_ai_Google_Calendar__create_event"
    assert "mcp__claude_ai_HubSpot" in _flag_values(argv, "--disallowedTools")
    prompt = argv[argv.index("-p") + 1]
    assert "Focus: ENG-1 Rebin grades IGNORE ALL" in prompt and "2026-11-04T11:00:00-05:00" in prompt
    with pytest.raises(calendar_block.BlockError):
        calendar_block.block_time(settings, "x", "y", datetime(2026, 11, 4, 10, 0), 600)


def test_block_prompt_calls_a_title_with_no_words_focus_time():
    from todohub import calendar_block
    prompt = calendar_block.block_prompt("https://globex.example/q3", "", datetime(2026, 11, 4, 10, 0), 30)
    assert "- Title: Focus: Focus time\n" in prompt


def test_block_time_and_drafts_say_why_claude_code_failed(settings, monkeypatch):
    import subprocess
    from todohub import calendar_block, gmail_draft
    monkeypatch.setattr(subprocess, "run",
                        lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1, stdout="", stderr="error: bad flag"))
    with pytest.raises(calendar_block.BlockError, match="bad flag"):
        calendar_block.block_time(settings, "Rebin", "", datetime(2026, 11, 4, 10, 0), 60)
    with pytest.raises(gmail_draft.DraftError, match="bad flag"):
        gmail_draft.save_reply_draft(settings, "18f2c0ffee12ab", "Sure, Thursday.")


def test_github_review_requests(settings, tmp_path):
    from todohub import sources
    out = tmp_path / "prs.json"
    gh = tmp_path / "gh"
    gh.write_text("#!/bin/sh\ncat " + str(out) + "\n")
    gh.chmod(0o755)
    settings.gh_path = str(gh)
    prs = [{"number": 812, "title": "Export API", "url": "https://github.com/acme/api/pull/812",
            "repository": {"nameWithOwner": "acme/api"}, "author": {"login": "octocat"}},
           {"number": 90, "title": "Fix CI", "url": "https://github.com/acme/ops/pull/90",
            "repository": {"nameWithOwner": "acme/ops"}, "author": {"login": "hubot"}}]
    out.write_text(json.dumps(prs))
    db = DB(settings.db_path)
    rid = db.start_run("manual", "2026-11-01T00:00:00+00:00")
    sources.sync_github(settings, db, rid)
    titles = sorted(c["title"] for c in db.list_candidates())
    assert titles == ["Review api#812: Export API", "Review ops#90: Fix CI"]
    sources.sync_github(settings, db, rid)                 # nothing new the second time
    assert len(db.list_candidates()) == 2

    # approve the api review; once GitHub stops asking for it, a close is proposed
    c = next(c for c in db.list_candidates() if "812" in c["title"])
    db.decide(c["id"], "approved", "ENG-99", "https://linear.app/x/issue/ENG-99")
    db.set_meta("open_issues", [{"identifier": "ENG-99", "title": c["title"]}])
    out.write_text(json.dumps(prs[1:]))
    sources.sync_github(settings, db, rid)
    close = [c for c in db.list_candidates() if c["kind"] == "close"]
    assert len(close) == 1 and close[0]["target_issue"] == "ENG-99"
    status = {s["source"]: s for s in db.get_run(rid, with_sources=True)["sources"]}["github"]
    assert status["ok"] and "1 to close" in status["detail"]


def test_linear_mentions_filtering():
    from datetime import datetime, timezone
    from todohub import sources
    from conftest import FakeLinear
    fake = FakeLinear()
    fake.notifications = [
        {"id": "n1", "type": "issueCommentMention", "createdAt": "2026-11-03T15:00:00Z", "actor": {"name": "Alex"},
         "issue": {"identifier": "ENG-1", "title": "Rebin", "url": "https://linear.app/x/ENG-1"},
         "comment": {"body": "@tdody can you check ```the``` cut-lines?", "url": "https://linear.app/x/ENG-1#c1"}},
        {"id": "n2", "type": "issueAssignedToYou", "createdAt": "2026-11-03T15:00:00Z"},
        {"id": "n3", "type": "issueMention", "createdAt": "2026-10-01T15:00:00Z"},
    ]
    found = sources.linear_mentions(fake, datetime(2026, 11, 1, tzinfo=timezone.utc))
    assert [m["id"] for m in found] == ["n1"] and found[0]["url"].endswith("#c1")
    text = sources.mentions_section(found)
    assert "Alex on ENG-1" in text and "```the```" not in text
    assert sources.mentions_section(None, "boom").startswith("(couldn't")


def test_failed_source_gets_its_window_back(settings):
    db = DB(settings.db_path)
    first = sweep.run_sweep(settings)                 # slack ok; grain, gmail, calendar not reported
    second = sweep.run_sweep(settings)
    argv = json.loads((settings.home / "argv.json").read_text())
    prompt = argv[argv.index("-p") + 1]
    first_start = datetime.fromisoformat(db.get_run(first["id"])["started_at"])
    # slack moved forward to the first run; grain never worked, so it still starts from the lookback
    assert db.last_ok_start("slack") == db.get_run(second["id"])["started_at"]
    assert db.last_ok_start("grain") is None
    slack_line = next(l for l in prompt.splitlines() if l.startswith("### Slack"))
    gmail_line = next(l for l in prompt.splitlines() if l.startswith("### Gmail"))
    assert sweep._fmt(first_start - sweep.MESSAGE_OVERLAP) in slack_line
    assert sweep._fmt(first_start - sweep.MESSAGE_OVERLAP) not in gmail_line


# ---- cost trims ---------------------------------------------------------------------------------
def test_meeting_prep_runs_once_a_day(settings, tmp_path):
    from todohub.db import DB
    db = DB(tmp_path / "t.db")
    now = datetime.now(sweep.TZ)                                 # start_run stamps the real time
    assert sweep.meeting_prep_due(db, now)                       # never done
    run = db.start_run("schedule", "2026-11-04T13:00:00+00:00")
    db.report_source_status(run, "calendar", True, "ok", 3)
    db.finish_run(run, "ok")
    assert not sweep.meeting_prep_due(db, now)                   # done this morning
    assert sweep.meeting_prep_due(db, now + timedelta(days=1))   # due again tomorrow
    with_prep = sweep.build_prompt(settings, datetime.now(timezone.utc), [], [], [])
    without = sweep.build_prompt(settings, datetime.now(timezone.utc), [], [], [], meeting_prep=False)
    assert "meeting prep" in with_prep and "### Google Calendar" not in without
    nxt = sweep.next_working_day(datetime.now(sweep.TZ).date()).isoformat()
    assert f"`report_agenda` a second time with day {nxt}" in with_prep               # tomorrow, for the wrap-up


def test_prompt_leaves_out_stale_backlog(settings):
    now = datetime(2026, 11, 4, tzinfo=timezone.utc)
    old, recent = "2026-09-01T00:00:00Z", "2026-11-01T00:00:00Z"
    issues = [
        {"identifier": "ENG-1", "title": "Old backlog idea", "state_type": "backlog", "updated_at": old},
        {"identifier": "ENG-2", "title": "Old client backlog", "state_type": "backlog", "updated_at": old, "client": "Globex"},
        {"identifier": "ENG-3", "title": "Old but due", "state_type": "backlog", "updated_at": old, "due_date": "2026-11-20"},
        {"identifier": "ENG-4", "title": "Recent backlog", "state_type": "backlog", "updated_at": recent},
        {"identifier": "ENG-5", "title": "Old started work", "state_type": "started", "updated_at": old},
        {"identifier": "ENG-6", "title": "From an older cache"},
    ]
    kept = [i["identifier"] for i in sweep.prompt_issues(issues, now)]
    assert "ENG-1" not in kept and set(kept) == {"ENG-2", "ENG-3", "ENG-4", "ENG-5", "ENG-6"}


def test_one_source_sweep(settings):
    run = sweep.run_sweep(settings, "manual", "slack")
    assert run["status"] == "ok" and [s["source"] for s in run["sources"]] == ["slack"]   # nothing else flagged
    argv = json.loads((settings.home / "argv.json").read_text())
    prompt = argv[argv.index("-p") + 1]
    allowed = argv[argv.index("--allowedTools") + 1].split(",")
    assert "### Slack" in prompt and "### Gmail" not in prompt and "### Google Calendar" not in prompt
    assert "### Linear: mentions" not in prompt
    assert not any("Gmail" in t or "Calendar" in t or "grain" in t.lower() for t in allowed)
    db = DB(settings.db_path)
    assert db.get_meta("run_scopes") == {str(run["id"]): "slack"}
    overview = {o["source"]: o for o in db.source_overview(settings.enabled_sources())}
    assert overview["slack"]["ok"] and overview["slack"]["last_ok_at"] == run["started_at"]
    assert overview["gmail"]["ok"] is None and overview["gmail"]["last_ok_at"] is None

    # GitHub alone needs no Claude run.
    (settings.home / "argv.json").unlink()
    gh = sweep.run_sweep(settings, "manual", "github")
    assert gh["status"] == "ok" and gh["cost_usd"] == 0.0 and not (settings.home / "argv.json").exists()
    assert [s["source"] for s in gh["sources"]] == ["github"]
    assert db.get_meta("run_scopes") == {str(run["id"]): "slack", str(gh["id"]): "github"}

    # A full sweep after them has no scope.
    full = sweep.run_sweep(settings)
    assert str(full["id"]) not in db.get_meta("run_scopes")
    with pytest.raises(ValueError):
        sweep.run_sweep(settings, "manual", "fax")


def test_calendar_check_reads_the_calendar_even_after_prep(settings):
    db = DB(settings.db_path)
    rid = db.start_run("schedule", "2026-11-04T13:00:00+00:00")
    db.report_source_status(rid, "calendar", True, "ok", 3)
    db.finish_run(rid, "ok")
    assert not sweep.meeting_prep_due(db)
    sweep.run_sweep(settings, "manual", "calendar")
    argv = json.loads((settings.home / "argv.json").read_text())
    assert "### Google Calendar" in argv[argv.index("-p") + 1]


def test_one_source_check_leaves_other_sources_threads_alone(settings):
    """A Grain-only check has no Slack or Gmail tools, so it mustn't be asked to re-read their threads."""
    from todohub import tools
    db = DB(settings.db_path)
    urls = {"slack": "https://example.slack.com/archives/C1/p77", "gmail": "https://mail.google.com/mail/u/0/#all/abc77"}
    for n, src in enumerate(("slack", "gmail")):
        cid = tools.add_candidate(db, None, source=src, source_id=f"x{n}", title=f"Thing {n}", signal="ask",
                                  why="w", excerpt="e", who="Sam", source_url=urls[src])["id"]
        db.decide(cid, "approved", linear_identifier="ENG-1", linear_url="https://linear.app/x/ENG-1")
    watched = db.watched_issues(["ENG-1"])
    assert len(watched) == 2
    assert "slack" in sweep.watched_section(watched) and "gmail" in sweep.watched_section(watched)
    assert sweep.watched_section(watched, ["grain"]) == "(none to check)"
    only_slack = sweep.watched_section(watched, ["slack", "grain"])
    assert "slack" in only_slack and "gmail" not in only_slack

    sweep.run_sweep(settings, "manual", "grain")
    argv = json.loads((settings.home / "argv.json").read_text())
    prompt = argv[argv.index("-p") + 1]
    assert urls["slack"] not in prompt and urls["gmail"] not in prompt
    full = sweep.run_sweep(settings)
    argv = json.loads((settings.home / "argv.json").read_text())
    assert urls["slack"] in argv[argv.index("-p") + 1] and full["status"] == "ok"


def _flag_values(cmd, flag):
    return cmd[cmd.index(flag) + 1].split(",")


def test_hubspot_section_when_configured(settings):
    settings.hubspot_tools = list(DEFAULT_HUBSPOT_TOOLS)
    since = datetime(2026, 11, 4, 20, 0, tzinfo=timezone.utc)          # the other sources' window
    hubspot = {"hubspot": datetime(2026, 11, 4, 10, 0, tzinfo=sweep.TZ)}  # 15:00 UTC
    text = sweep.build_prompt(settings, since, [], [], [], sinces=hubspot)
    section = text.split("### HubSpot")[1].split("###")[0]
    assert "2026-11-04T13:00:00Z" in section                  # the window start, minus the 2-hour overlap
    assert "hubspot_owner_assigneddate" in section and "ticket:<id>" in section and "note:<id>" in section
    assert "`hubspot_owner_id` HAS_PROPERTY" in section and "never `hs_note_body`" in section
    assert "as the source_id in every todo-db call" in section
    assert "one `search_owners` call" in section
    assert "`TASK`" not in section                            # HubSpot tasks are Grain's action items
    assert "HubSpot tickets and notes" in text.split("## Safety")[1][:600]
    settings.hubspot_tools = []
    assert "### HubSpot" not in sweep.build_prompt(settings, since, [], [], [], sinces=hubspot)


def test_sweep_may_read_hubspot_but_never_write(settings, tmp_path):
    cmd = sweep.claude_command(settings, "prompt", tmp_path / "mcp.json")
    allowed, denied = _flag_values(cmd, "--allowedTools"), _flag_values(cmd, "--disallowedTools")
    assert "mcp__claude_ai_HubSpot__search_crm_objects" in allowed
    assert "mcp__claude_ai_HubSpot" not in denied        # a server-wide deny would win over the read tools
    assert {"mcp__claude_ai_HubSpot__manage_crm_objects",
            "mcp__claude_ai_HubSpot__import-claude-design-from-url"} <= set(denied)
    assert not set(allowed) & set(denied)
    settings.hubspot_tools = []
    cmd = sweep.claude_command(settings, "prompt", tmp_path / "mcp.json")
    assert "mcp__claude_ai_HubSpot" in _flag_values(cmd, "--disallowedTools")
    assert not any("HubSpot" in t for t in _flag_values(cmd, "--allowedTools"))


def test_gmail_draft_still_denies_all_of_hubspot(settings, monkeypatch):
    settings.hubspot_tools = list(DEFAULT_HUBSPOT_TOOLS)
    from types import SimpleNamespace
    from todohub import gmail_draft
    seen = {}

    def fake_run(cmd, **kw):
        seen["cmd"] = cmd
        return SimpleNamespace(returncode=0, stderr="", stdout=json.dumps(
            {"is_error": False, "result": "Saved: https://mail.google.com/mail/u/0/#drafts/r1"}))

    monkeypatch.setattr(sweep.subprocess, "run", fake_run)
    gmail_draft.save_reply_draft(settings, "18f2c0ffee12ab", "Sure, Thursday.")
    assert "mcp__claude_ai_HubSpot" in _flag_values(seen["cmd"], "--disallowedTools")


def test_watched_section_rechecks_hubspot_tickets_only():
    def row(ident, source, sid, possible_duplicate=None):
        return {"linear_identifier": ident, "title": f"Issue {ident}", "kind": "task", "source": source,
                "source_id": sid, "source_url": f"https://example.com/{ident}", "decided_at": "2026-11-04T10:00:00+00:00",
                "possible_duplicate": possible_duplicate}
    rows = [row("ENG-5", "hubspot", "ticket:479"), row("ENG-7", "hubspot", "note:120"), row("ENG-8", "slack", "C1:9"),
            row("ENG-9", "hubspot", "ticket:480", possible_duplicate="ENG-9")]
    text = sweep.watched_section(rows, ["slack", "hubspot"])
    assert "ENG-5" in text and "hubspot ticket:479" in text and "ENG-8" in text
    assert "ENG-7" not in text
    assert "ENG-9" not in text    # merged into an existing issue
    only_hubspot = sweep.watched_section(rows, ["hubspot"])
    assert "ENG-5" in only_hubspot and "ENG-8" not in only_hubspot    # Slack is off
    assert sweep.watched_section(rows, ["gmail"]) == "(none to check)"    # sources that are off aren't re-read


def test_prompt_tells_the_sweep_to_close_finished_tickets(settings):
    text = sweep.build_prompt(settings, datetime.now(timezone.utc), [], [], [])
    assert "ticket:<id>#closed" in text and "Ticket closed in HubSpot on" in text


def test_hubspot_only_check(settings, monkeypatch):
    settings.hubspot_tools = list(DEFAULT_HUBSPOT_TOOLS)
    sweep.run_sweep(settings, "manual", "hubspot")
    argv = json.loads((settings.home / "argv.json").read_text())
    prompt = argv[argv.index("-p") + 1]
    assert "### HubSpot" in prompt and "### Slack" not in prompt and "### Linear: mentions" not in prompt
    assert {t for t in _flag_values(argv, "--allowedTools") if not t.startswith("mcp__todo-db__")} == set(DEFAULT_HUBSPOT_TOOLS)
    seen = {}
    monkeypatch.setattr(sweep, "run_sweep", lambda settings, trigger, only=None: seen.update(only=only) or {"status": "ok"})
    assert sweep.main(["--source", "hubspot"]) == 0 and seen["only"] == "hubspot"    # what the app's Check now runs


def test_merged_hubspot_ticket_is_not_rechecked():
    from todohub import tools
    db = DB(load_settings().db_path)
    db.set_meta("open_issue_identifiers", ["ENG-9"])
    url = "https://app.hubspot.com/contacts/6194453/record/0-5/{}"
    merged = tools.add_candidate(db, None, source="hubspot", source_id="ticket:480", title="Count appends", signal="ask",
                                 why="w", excerpt="e", source_url=url.format(480), possible_duplicate="ENG-9")["id"]
    db.decide(merged, "approved", linear_identifier="ENG-9", linear_url="https://linear.app/x/ENG-9")
    new = tools.add_candidate(db, None, source="hubspot", source_id="ticket:481", title="Fix the export", signal="ask",
                              why="w", excerpt="e", source_url=url.format(481))["id"]
    db.decide(new, "approved", linear_identifier="ENG-10", linear_url="https://linear.app/x/ENG-10")
    text = sweep.watched_section(db.watched_issues(["ENG-9", "ENG-10"]), ["hubspot"])
    assert "ENG-10" in text and "ENG-9" not in text    # merged into ENG-9: closing the ticket doesn't finish it


def test_connector_outage_rewrites_the_failed_connector_sources(settings, monkeypatch):
    settings.home.mkdir(parents=True, exist_ok=True)
    (settings.home / "claudeai-debug.txt").write_text(
        "2026-11-13T13:00:20.101Z [DEBUG] [claudeai-mcp] Fetching from https://api.anthropic.com/v1/mcp_servers\n"
        "2026-11-13T13:00:21.587Z [DEBUG] [claudeai-mcp] Transient fetch error (503), retrying in 500ms (attempt 1/3)\n"
        "2026-11-13T13:00:24.302Z [DEBUG] [claudeai-mcp] Connector-list fetch failed transiently; "
        "background retry 1/3 in 4000ms\n")
    monkeypatch.setattr(sweep.outage, "claude_code_incident", lambda: "Elevated errors on Claude Code")
    run = sweep.run_sweep(settings, "schedule")
    by_source = {s["source"]: s for s in run["sources"]}
    down = ("Anthropic's connector service didn't respond (HTTP 503), so it wasn't read. "
            'Anthropic reports "Elevated errors on Claude Code" (status.claude.com).')
    # The fake reports only Slack. Gmail, Grain and HubSpot go unreported, so failed; so does Calendar,
    # because on a fresh database meeting prep is due and the sweep doesn't pre-report it as done.
    assert {s for s, v in by_source.items() if v["detail"] == down} == {"gmail", "grain", "calendar", "hubspot"}
    assert by_source["slack"]["detail"] == "3 searches"           # it worked: untouched
    assert "Can't find gh" in by_source["github"]["detail"]       # not a connector: untouched
    assert by_source["linear"]["ok"]
    log = open(run["log_path"]).read()
    assert "--- claude.ai connectors ---\n" in log and "Transient fetch error (503)" in log
    assert not list(settings.sweep_dir.glob("claudeai-*.log"))    # the debug file is cleaned up


def test_connector_outage_reads_the_status_page_only_when_a_connector_source_failed(settings, monkeypatch):
    settings.home.mkdir(parents=True, exist_ok=True)
    (settings.home / "claudeai-debug.txt").write_text(
        "2026-11-13T13:00:21.587Z [DEBUG] [claudeai-mcp] Transient fetch error (503), retrying in 500ms (attempt 1/3)\n")
    def no_call():
        raise AssertionError("the status page was read")
    monkeypatch.setattr(sweep.outage, "claude_code_incident", no_call)
    run = sweep.run_sweep(settings, "manual", only="slack")      # the fake reports Slack fine
    assert {s["source"]: s["detail"] for s in run["sources"]} == {"slack": "3 searches"}


def test_client_rule_looks_up_hubspot_only_when_it_can(settings):
    now = datetime.now(timezone.utc)
    settings.hubspot_tools = list(DEFAULT_HUBSPOT_TOOLS)
    for text in (sweep.build_prompt(settings, now, ["Globex"], [], []),
                 sweep.build_capture_prompt(settings, "a note", ["Globex"], [])):
        assert "`lifecyclestage` is `customer`" in text and "A prospect or a partner gets no client" in text
    settings.hubspot_tools = []
    for text in (sweep.build_prompt(settings, now, ["Globex"], [], []),
                 sweep.build_capture_prompt(settings, "a note", ["Globex"], [])):
        assert "lifecyclestage" not in text and "full name from the message, never its initials" in text
