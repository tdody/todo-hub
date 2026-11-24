import json
import subprocess

import pytest

from todohub.config import DEFAULT_REVIEW_PROMPT, load_settings
from todohub.db import DB
from todohub.start import (LAST_REPO_KEY, REPOS_KEY, claude_name, default_repo, fill_prompt, fill_review_prompt,
                           remember_repo)

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


def test_fill_prompt_fills_pr_only_when_it_is_given():
    issue = {"identifier": "ENG-1", "title": "Fix", "url": "https://linear.app/x/issue/ENG-1"}
    pr = "https://github.com/acme/api/pull/812"
    assert fill_prompt("Review {pr} for {identifier}.", issue, pr=pr) == f"Review {pr} for ENG-1."
    assert fill_prompt("Review {pr} for {identifier}.", issue) == "Review {pr} for ENG-1."


PR = "https://github.com/acme/api/pull/812"


def test_the_review_prompt_of_a_pr_with_a_ticket_is_the_whole_prompt():
    issue = {"identifier": "ENG-1", "title": "Fix", "url": "https://linear.app/x/issue/ENG-1"}
    assert fill_review_prompt(DEFAULT_REVIEW_PROMPT, issue, PR) == fill_prompt(DEFAULT_REVIEW_PROMPT, issue, pr=PR)


@pytest.mark.parametrize("template, expected", [
    (DEFAULT_REVIEW_PROMPT, f"Then review {PR} in this worktree: sum up the change and list the problems you find. "
                            "Do not post anything on GitHub."),
    ("Review {pr}", f"Review {PR}"),
    # A dot inside a URL, "e.g." and a list number do not end a sentence.
    ("Use https://acme.dev/guide.html for {title}.\nReview {pr}, e.g. its tests.", f"Review {PR}, e.g. its tests."),
    ("Check the code, e.g. the callers of {title}. Review {pr}.", f"Review {PR}."),
    ("Check related code (e.g. {identifier}), then review {pr}.", ""),
    ("1. Read {url}.\n2. Review {pr}.\n3. Sum up.", f"2. Review {PR}.\n3. Sum up."),
    # The other lines stay lines.
    ("Review {pr}. Check {title}.\n- keep {identifier} in mind\n- be kind", f"Review {PR}.\n- be kind"),
    ("Review {pr}. Compare it with {identifier}.\n\nRules:\n- Do not post.", f"Review {PR}.\n\nRules:\n- Do not post."),
    ("Read {url}. Review {pr} for {identifier}!", ""),
])
def test_the_review_prompt_of_a_pr_with_no_ticket_leaves_the_ticket_out(template, expected):
    assert fill_review_prompt(template, None, PR) == expected


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

