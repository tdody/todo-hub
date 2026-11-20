import json
import shlex
import shutil
import subprocess
from pathlib import Path

import pytest

from types import SimpleNamespace

from fastapi.testclient import TestClient

from todohub import claude_code
from todohub.api import create_app
from todohub.config import load_settings
from todohub.db import DB
from todohub.linear import LinearError
from todohub.start import LAST_REPO_KEY, REPOS_KEY, StartError
from conftest import FakeLinear, git


def upstream(path: str) -> str | None:
    proc = subprocess.run(["git", "rev-parse", "--abbrev-ref", "@{upstream}"], cwd=path, capture_output=True, text=True)
    return proc.stdout.strip() if proc.returncode == 0 else None


def branch_of(path: str) -> str:
    return git("branch", "--show-current", cwd=Path(path)).strip()


def test_tilde_shows_the_home_folder_as_a_tilde(monkeypatch):
    monkeypatch.setenv("HOME", "/Users/you")
    assert claude_code.tilde("/Users/you/code/api") == "~/code/api"
    assert claude_code.tilde("/Users/you") == "~"
    assert claude_code.tilde("/Users/yourself/api") == "/Users/yourself/api"
    assert claude_code.tilde("/opt/api") == "/opt/api"


def test_repo_top_is_the_absolute_top_folder(git_repo, monkeypatch):
    (git_repo / "src").mkdir()
    assert claude_code.repo_top(str(git_repo / "src")) == str(git_repo)
    monkeypatch.setenv("HOME", str(git_repo.parent))
    assert claude_code.repo_top("~/api") == str(git_repo)


def test_repo_top_is_none_outside_a_repo(tmp_path):
    (tmp_path / "plain").mkdir()
    assert claude_code.repo_top(str(tmp_path / "plain")) is None
    assert claude_code.repo_top(str(tmp_path / "nothing")) is None


def test_repo_top_of_a_worktree_is_the_main_repo(git_repo):
    (git_repo / "src").mkdir()
    path, _, _ = claude_code.worktree_for(str(git_repo), "me/eng-1")
    (Path(path) / "src").mkdir()
    assert claude_code.repo_top(path) == str(git_repo)
    assert claude_code.repo_top(str(Path(path) / "src")) == str(git_repo)
    assert claude_code.repo_top(str(git_repo / "src")) == str(git_repo)


def test_repo_top_is_none_for_a_path_that_is_not_absolute(git_repo, monkeypatch):
    monkeypatch.chdir(git_repo.parent)
    assert claude_code.repo_top("api") is None
    monkeypatch.chdir(git_repo)
    assert claude_code.repo_top("") is None and claude_code.repo_top(".") is None


def test_worktrees_lists_each_branch_and_its_folder(git_repo):
    other = git_repo.parent / "other"
    git("worktree", "add", "-q", "-b", "me/eng-1", str(other), cwd=git_repo)
    assert claude_code.worktrees(str(git_repo)) == {"main": str(git_repo), "me/eng-1": str(other)}


def test_worktrees_leaves_out_a_folder_deleted_by_hand(git_repo):
    gone = git_repo.parent / "gone"
    git("worktree", "add", "-q", "-b", "me/eng-1", str(gone), cwd=git_repo)
    shutil.rmtree(gone)
    assert claude_code.worktrees(str(git_repo)) == {"main": str(git_repo)}
    assert "gone" in git("worktree", "list", cwd=git_repo)      # worktrees() does not prune


def test_a_worktree_already_on_the_branch_is_used(git_repo):
    other = git_repo.parent / "other"
    git("worktree", "add", "-q", "-b", "me/eng-1", str(other), cwd=git_repo)
    assert claude_code.worktree_for(str(git_repo), "me/eng-1") == (str(other), True, [])


def test_a_local_branch_gets_a_worktree_next_to_the_repo(git_repo):
    git("branch", "me/eng-1", cwd=git_repo)
    path, reused, warnings = claude_code.worktree_for(str(git_repo), "me/eng-1")
    assert path == str(git_repo.parent / "api-worktrees" / "me-eng-1")
    assert not reused and warnings == [] and branch_of(path) == "me/eng-1"


def test_a_branch_only_origin_has_gets_a_local_branch_that_tracks_it(git_repo):
    path, _, warnings = claude_code.worktree_for(str(git_repo), "me/eng-2")
    assert warnings == [] and branch_of(path) == "me/eng-2" and upstream(path) == "origin/me/eng-2"


def test_a_new_branch_starts_from_origin_head_with_no_upstream(git_repo):
    git("commit", "-q", "--allow-empty", "-m", "local", cwd=git_repo)
    path, _, warnings = claude_code.worktree_for(str(git_repo), "me/eng-3")
    assert warnings == [] and branch_of(path) == "me/eng-3"
    assert upstream(path) is None            # so a push cannot go to the default branch
    assert git("rev-parse", "HEAD", cwd=Path(path)) == git("rev-parse", "origin/HEAD", cwd=git_repo)


def test_a_branch_from_head_has_no_upstream_either(git_repo):
    git("remote", "set-head", "origin", "-d", cwd=git_repo)
    git("config", "remote.origin.followRemoteHEAD", "never", cwd=git_repo)   # a fetch must not bring it back
    git("config", "branch.autoSetupMerge", "inherit", cwd=git_repo)
    path, _, warnings = claude_code.worktree_for(str(git_repo), "me/eng-3")
    assert warnings == [f"{claude_code.tilde(str(git_repo))} has no origin/HEAD. The new branch starts from HEAD."]
    assert upstream(path) is None


def test_the_fetch_finds_a_branch_origin_got_after_the_clone(git_repo):
    git("branch", "me/eng-6", "main", cwd=git_repo.parent / "origin.git")
    path, _, warnings = claude_code.worktree_for(str(git_repo), "me/eng-6")
    assert warnings == [] and upstream(path) == "origin/me/eng-6"


def test_a_worktree_folder_deleted_by_hand_is_pruned_first(git_repo):
    stale = git_repo.parent / "api-worktrees" / "me-eng-1"
    git("worktree", "add", "-q", "-b", "me/eng-1", str(stale), cwd=git_repo)
    shutil.rmtree(stale)
    path, reused, _ = claude_code.worktree_for(str(git_repo), "me/eng-1")
    assert path == str(stale) and not reused and stale.is_dir()


def test_a_repo_with_no_origin_warns_and_starts_from_head(tmp_path):
    lone = tmp_path / "lone"
    lone.mkdir()
    git("init", "-q", "-b", "main", cwd=lone)
    git("commit", "-q", "--allow-empty", "-m", "one", cwd=lone)
    lone = lone.resolve()
    path, _, warnings = claude_code.worktree_for(str(lone), "me/eng-4")
    assert branch_of(path) == "me/eng-4"
    assert warnings == ["Could not fetch origin. The worktree uses the local branches.",
                        f"{claude_code.tilde(str(lone))} has no origin/HEAD. The new branch starts from HEAD."]


def test_a_folder_in_no_repo_is_an_error(tmp_path):
    with pytest.raises(StartError, match="Not a git repo: "):
        claude_code.worktree_for(str(tmp_path), "me/eng-1")


def test_a_git_worktree_add_error_carries_gits_message(git_repo):
    taken = git_repo.parent / "api-worktrees" / "me-eng-5"
    taken.mkdir(parents=True)
    (taken / "notes.txt").write_text("mine")
    with pytest.raises(StartError, match="already exists"):
        claude_code.worktree_for(str(git_repo), "me/eng-5")


TRICKY = "Fix 'quotes', \"doubles\", $(touch pwned) and `touch ticks`\nsecond line; touch semi -- --name x"


def test_the_script_runs_in_the_worktree_keeps_the_prompt_as_text_and_deletes_itself(tmp_path):
    worktree = tmp_path / "work tree"
    worktree.mkdir()
    command = ["sh", "-c", 'pwd -P; printf %s "$1"', "sh", TRICKY]
    script = claude_code.write_script(tmp_path / "start", "ENG-1", str(worktree), command)
    assert script == tmp_path / "start" / "ENG-1.command" and script.stat().st_mode & 0o777 == 0o700
    out = subprocess.run([str(script)], capture_output=True, text=True, check=True).stdout
    assert out == f"{worktree.resolve()}\n{TRICKY}"
    assert not script.exists()
    assert not (worktree / "pwned").exists() and not (worktree / "ticks").exists()
    assert not (worktree / "semi").exists()


def test_the_command_runs_claude_by_its_path_and_ends_the_options_before_the_prompt(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    claude = bin_dir / "claude"
    claude.write_text("#!/bin/sh\n")
    claude.chmod(0o755)
    monkeypatch.setenv("PATH", str(bin_dir))
    assert claude_code.start_command(load_settings(), "eng-1-fix", "sid", "-p hi") == [
        str(claude), "--name", "eng-1-fix", "--session-id", "sid", "--", "-p hi"]


def test_the_command_keeps_the_configured_claude_when_the_path_has_none(tmp_path, monkeypatch):
    (tmp_path / "bin").mkdir()
    monkeypatch.setenv("PATH", str(tmp_path / "bin"))
    settings = load_settings()
    settings.claude_path = "claude-not-installed"
    assert claude_code.start_command(settings, "n", "sid", "hi")[0] == "claude-not-installed"


def test_open_script_opens_it_with_the_default_app(monkeypatch, tmp_path):
    ran = []
    monkeypatch.setattr(subprocess, "run", lambda args, **kw: ran.append(args))
    claude_code.open_script(tmp_path / "ENG-1.command")
    assert ran == [["open", str(tmp_path / "ENG-1.command")]]


def test_open_script_failure(monkeypatch, tmp_path):
    def fail(args, **kw):
        raise subprocess.CalledProcessError(1, args, stderr="No application knows how to open it.\n")

    monkeypatch.setattr(subprocess, "run", fail)
    with pytest.raises(StartError, match="Could not open the start script: No application knows how to open it."):
        claude_code.open_script(tmp_path / "ENG-1.command")


def fake_claude(tmp_path, stdout: str) -> str:
    """An executable ``claude`` that prints ``stdout`` only when it gets ``auth status --json``."""
    path = tmp_path / "bin" / "claude"
    path.parent.mkdir(exist_ok=True)
    path.write_text(f"#!/bin/sh\n[ \"$*\" = \"auth status --json\" ] || exit 2\nprintf %s {shlex.quote(stdout)}\n")
    path.chmod(0o755)
    return str(path)


def test_account_email_reads_claude_auth_status(tmp_path):
    settings = load_settings()
    settings.claude_path = fake_claude(tmp_path, json.dumps({"loggedIn": True, "email": "you@example.com"}))
    assert claude_code.account_email(settings) == "you@example.com"


@pytest.mark.parametrize("stdout", ["not json", json.dumps({"loggedIn": False})])
def test_account_email_is_none_when_claude_gives_none(tmp_path, stdout):
    settings = load_settings()
    settings.claude_path = fake_claude(tmp_path, stdout)
    assert claude_code.account_email(settings) is None


def test_account_email_is_none_when_claude_is_missing(tmp_path):
    settings = load_settings()
    settings.claude_path = str(tmp_path / "nothing")
    assert claude_code.account_email(settings) is None


def test_account_email_is_none_when_claude_is_slow(monkeypatch):
    def run(cmd, **kw):
        raise subprocess.TimeoutExpired("claude", 15)

    monkeypatch.setattr(subprocess, "run", run)
    assert claude_code.account_email(load_settings()) is None


@pytest.fixture
def opened(monkeypatch):
    """The scripts the route opens. claude auth status gives you@example.com."""
    scripts = []
    monkeypatch.setattr(claude_code, "open_script", scripts.append)
    monkeypatch.setattr(claude_code, "account_email", lambda settings: "you@example.com")
    return scripts


@pytest.fixture
def env(git_repo, opened):
    settings = load_settings()
    settings.repos = [str(git_repo)]
    db = DB(settings.db_path)
    linear = FakeLinear()
    app = create_app(settings, db, linear_factory=lambda: linear,
                     name_fn=lambda issue: f"{issue['identifier'].lower()}-rebin")
    return SimpleNamespace(client=TestClient(app), db=db, linear=linear, settings=settings, repo=git_repo,
                           opened=opened, start={"repo": str(git_repo), "branch": " me/eng-1 ", "prompt": "Read ENG-1."})


def test_options_fill_the_popover(env, monkeypatch):
    monkeypatch.setenv("HOME", str(env.repo.parent))
    git("worktree", "add", "-q", "-b", "me/eng-1", str(env.repo.parent / "other"), cwd=env.repo)
    env.db.set_meta(REPOS_KEY, {"client:Globex": str(env.repo)})
    r = env.client.get("/api/issues/id-ENG-1/claude-code")
    assert r.status_code == 200
    assert r.json() == {
        "repos": [{"repo": str(env.repo), "label": "~/api"}],
        "repo": str(env.repo),
        "hint": "Remembered for Globex.",
        "branch": "me/eng-1",
        "branch_worktrees": [str(env.repo)],
        "prompt": "Read Linear ticket ENG-1 (https://linear.app/x/issue/ENG-1) and its comments with the Linear "
                  "tools. Sum up the ask, then propose a plan. Do not change code until I agree.",
    }


def test_start_makes_the_worktree_opens_the_script_and_records_the_session(env):
    r = env.client.post("/api/issues/id-ENG-1/claude-code", json=env.start)
    assert r.status_code == 200
    out = r.json()
    path = str(env.repo.parent / "api-worktrees" / "me-eng-1")
    assert out == {"path": path, "reused": False, "session_id": out["session_id"], "warnings": []}
    [script] = env.opened
    assert script == env.settings.home / "start" / "ENG-1.command"
    text = script.read_text()
    assert f"cd {path} || exit 1" in text
    assert f" --name eng-1-rebin --session-id {out['session_id']} -- 'Read ENG-1.'" in text
    assert env.db.get_meta(REPOS_KEY) == {"client:Globex": str(env.repo)}
    assert env.db.get_meta(LAST_REPO_KEY) == str(env.repo)
    [(issue_id, body)] = env.linear.comments
    assert issue_id == "id-ENG-1"
    assert body.split("\n")[1:] == ["- Claude account: you@example.com", f"- Claude session: `{out['session_id']}`"]


def test_a_second_start_uses_the_same_worktree(env):
    env.client.post("/api/issues/id-ENG-1/claude-code", json=env.start)
    r = env.client.post("/api/issues/id-ENG-1/claude-code", json=env.start)
    assert r.json()["reused"] is True and len(env.opened) == 2


def test_a_comment_that_fails_is_a_warning_not_an_error(env):
    def refuse(issue_id, body):
        raise LinearError("Can't reach Linear")

    env.linear.create_comment = refuse
    r = env.client.post("/api/issues/id-ENG-1/claude-code", json=env.start)
    assert r.status_code == 200
    assert r.json()["warnings"] == ["The Claude session was not added to ENG-1: Can't reach Linear"]


def test_a_repo_not_on_the_settings_list_is_a_400(env):
    r = env.client.post("/api/issues/id-ENG-1/claude-code", json={**env.start, "repo": "/elsewhere"})
    assert r.status_code == 400 and r.json() == {"error": "Pick a repo from the Settings list."}
    assert env.opened == []


def test_a_start_that_git_refuses_is_a_502_and_nothing_opens(env):
    taken = env.repo.parent / "api-worktrees" / "me-eng-1"
    taken.mkdir(parents=True)
    (taken / "notes.txt").write_text("mine")
    r = env.client.post("/api/issues/id-ENG-1/claude-code", json=env.start)
    assert r.status_code == 502 and "already exists" in r.json()["error"]
    assert env.opened == [] and env.db.get_meta(LAST_REPO_KEY) is None and env.linear.comments == []


def test_a_blank_branch_is_a_400(env):
    r = env.client.post("/api/issues/id-ENG-1/claude-code", json={**env.start, "branch": "  "})
    assert r.status_code == 400 and r.json() == {"error": "The branch is empty"}
    assert env.opened == []


def test_the_routes_answer_404_when_no_repo_is_set(opened):
    settings = load_settings()
    client = TestClient(create_app(settings, DB(settings.db_path), linear_factory=FakeLinear))
    off = {"error": "Start in Claude Code is off. Add a repo on the Settings page."}
    for r in (client.get("/api/issues/id-ENG-1/claude-code"),
              client.post("/api/issues/id-ENG-1/claude-code", json={"repo": "/x", "branch": "b", "prompt": "p"})):
        assert r.status_code == 404 and r.json() == off
    assert opened == []


def test_meta_says_whether_claude_code_is_on(git_repo):
    for repos, expected in (([], False), ([str(git_repo)], True)):
        settings = load_settings()
        settings.repos = repos
        app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear)
        assert TestClient(app).get("/api/meta").json()["claude_code"] is expected
