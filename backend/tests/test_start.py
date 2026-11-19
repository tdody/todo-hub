import json
import subprocess
from datetime import datetime, timedelta, timezone

import pytest

from todohub.config import load_settings
from todohub.db import DB
from todohub.start import (LAST_REPO_KEY, REPOS_KEY, claude_name, default_repo, fill_prompt, remember_repo,
                           session_comment)

NAMED = {"identifier": "ENG-1", "title": "Rebin Globex grades for jane@globex.com"}


def haiku(monkeypatch, *, stdout="", stderr="", returncode=0, raises=None):
    """Claude Code behind a patched subprocess.run; returns the commands it was given."""
    ran = []

    def run(cmd, **kw):
        ran.append(cmd)
        if raises:
            raise raises
        return subprocess.CompletedProcess(cmd, returncode, stdout=stdout, stderr=stderr)

    monkeypatch.setattr(subprocess, "run", run)
    return ran


def test_claude_name_is_the_id_and_up_to_three_of_haikus_words(monkeypatch):
    ran = haiku(monkeypatch, stdout=json.dumps({"result": "`Globex-Grades rebin` now"}))
    assert claude_name(load_settings(), NAMED) == "eng-1-globex-grades-rebin"
    cmd = ran[0]
    assert cmd[cmd.index("--model") + 1] == "haiku" and cmd[cmd.index("--tools") + 1] == ""
    assert "--strict-mcp-config" in cmd    # no MCP server loads, so the run can only answer with text
    assert "Rebin Globex grades for" in cmd[2] and "jane@" not in cmd[2]


def test_claude_name_folds_accented_letters(monkeypatch):
    haiku(monkeypatch, stdout=json.dumps({"result": "export-données"}))
    assert claude_name(load_settings(), NAMED) == "eng-1-export-donnees"


def test_claude_name_is_the_id_alone_when_the_title_has_no_words(monkeypatch):
    ran = haiku(monkeypatch, stdout=json.dumps({"result": "focus-time"}))
    assert claude_name(load_settings(), {"identifier": "ENG-1", "title": "https://globex.example/q3-report"}) == "eng-1"
    assert ran == []


@pytest.mark.parametrize("answer", [
    {"raises": FileNotFoundError()},
    {"raises": subprocess.TimeoutExpired("claude", 30)},
    {"stdout": "not json", "returncode": 1},
    {"stdout": json.dumps({"is_error": True, "result": "Credit balance is too low"}), "returncode": 1},
    {"stdout": json.dumps({"is_error": True, "result": "API Error overloaded"}), "returncode": 0},
    {"stdout": json.dumps({"result": "grade-rebin"}), "returncode": 1},
    {"stdout": json.dumps({"result": "—"})},
])
def test_claude_name_is_the_id_alone_when_haiku_gives_no_words(monkeypatch, caplog, answer):
    haiku(monkeypatch, **answer)
    assert claude_name(load_settings(), NAMED) == "eng-1"
    assert "ENG-1" in caplog.text


def test_claude_name_logs_why_claude_code_failed(monkeypatch, caplog):
    haiku(monkeypatch, stderr="error: unknown option '--strict-mcp-config'", returncode=1)
    assert claude_name(load_settings(), NAMED) == "eng-1"
    assert "unknown option" in caplog.text


def test_fill_prompt_fills_three_tokens_and_keeps_other_braces():
    issue = {"identifier": "ENG-1", "title": "Fix {url} in {that}", "url": "https://linear.app/x/issue/ENG-1"}
    assert fill_prompt("Read {identifier}: {title} at {url}. Keep {this}.", issue) == \
        "Read ENG-1: Fix {url} in {that} at https://linear.app/x/issue/ENG-1. Keep {this}."


def test_default_repo_project_then_client_then_last():
    db = DB(load_settings().db_path)
    repos = ["/dev/api", "/dev/web"]
    in_project = {"project": "Pipelines", "client": "Globex"}
    client_only = {"project": None, "client": "Globex"}
    neither = {"project": None, "client": None}
    assert default_repo(db, in_project, repos) == (None, "")
    remember_repo(db, client_only, "/dev/web")
    assert default_repo(db, client_only, repos) == ("/dev/web", "Remembered for Globex.")
    assert default_repo(db, in_project, repos) == ("/dev/web", "The last repo you used.")
    remember_repo(db, in_project, "/dev/api")
    assert default_repo(db, in_project, repos) == ("/dev/api", "Remembered for Pipelines.")
    assert default_repo(db, neither, repos) == ("/dev/api", "The last repo you used.")
    assert db.get_meta(REPOS_KEY) == {"client:Globex": "/dev/web", "project:Pipelines": "/dev/api"}
    assert db.get_meta(LAST_REPO_KEY) == "/dev/api"


def test_the_repo_memory_has_start_keys():
    assert (REPOS_KEY, LAST_REPO_KEY) == ("start_repos", "start_last_repo")


def test_default_repo_skips_a_repo_no_longer_listed():
    db = DB(load_settings().db_path)
    remember_repo(db, {"project": "Pipelines", "client": None}, "/dev/gone")
    assert default_repo(db, {"project": "Pipelines", "client": None}, ["/dev/api"]) == (None, "")


def test_session_comment_names_the_start_the_account_and_the_session():
    started = datetime(2026, 11, 19, 9, 30, 15, 123456, tzinfo=timezone(timedelta(hours=-5)))
    assert session_comment(started, "you@example.com", "sid") == (
        "- Started: 2026-11-19T09:30:15-05:00\n- Claude account: you@example.com\n- Claude session: `sid`")
    assert session_comment(started, None, "sid").split("\n")[1] == "- Claude account: unknown"
