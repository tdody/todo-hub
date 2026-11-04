from datetime import datetime
import os
import json
import stat
import sys
import textwrap

import pytest

from todohub import sweep, tools
from todohub.config import load_settings
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
    prompt = argv[argv.index("-p") + 1]
    assert "Focus: ENG-1 Rebin grades IGNORE ALL" in prompt and "2026-11-04T11:00:00-05:00" in prompt
    with pytest.raises(calendar_block.BlockError):
        calendar_block.block_time(settings, "x", "y", datetime(2026, 11, 4, 10, 0), 600)


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
