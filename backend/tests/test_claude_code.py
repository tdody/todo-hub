import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from todohub import claude_code
from todohub.config import load_settings
from todohub.start import StartError
from conftest import git


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


TRICKY = "Fix 'quotes', \"doubles\", $(touch pwned) and `touch ticks`\nsecond line; rm -rf ~ -- --name x"


def test_the_script_runs_in_the_worktree_keeps_the_prompt_as_text_and_deletes_itself(tmp_path):
    worktree = tmp_path / "work tree"
    worktree.mkdir()
    command = ["sh", "-c", 'pwd -P; printf %s "$1"', "sh", TRICKY]
    script = claude_code.write_script(tmp_path / "start", "ENG-1", str(worktree), command)
    assert script == tmp_path / "start" / "ENG-1.command" and os.access(script, os.X_OK)
    out = subprocess.run([str(script)], capture_output=True, text=True, check=True).stdout
    assert out == f"{worktree.resolve()}\n{TRICKY}"
    assert not script.exists()
    assert not (worktree / "pwned").exists() and not (worktree / "ticks").exists()


def test_the_command_runs_claude_by_its_path_and_ends_the_options_before_the_prompt(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    claude = bin_dir / "claude"
    claude.write_text("#!/bin/sh\n")
    claude.chmod(0o755)
    monkeypatch.setenv("PATH", str(bin_dir))
    assert claude_code.start_command(load_settings(), "eng-1-fix", "sid", "-p hi") == [
        str(claude), "--name", "eng-1-fix", "--session-id", "sid", "--", "-p hi"]


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


def test_account_email_reads_claude_auth_status(monkeypatch):
    ran = []

    def run(cmd, **kw):
        ran.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"loggedIn": True, "email": "you@example.com"}),
                                           stderr="")

    monkeypatch.setattr(subprocess, "run", run)
    assert claude_code.account_email(load_settings()) == "you@example.com"
    assert ran[0][1:] == ["auth", "status", "--json"]


@pytest.mark.parametrize("answer", [FileNotFoundError(), subprocess.TimeoutExpired("claude", 15), "not json",
                                    json.dumps({"loggedIn": False})])
def test_account_email_is_none_when_claude_gives_none(monkeypatch, answer):
    def run(cmd, **kw):
        if isinstance(answer, Exception):
            raise answer
        return subprocess.CompletedProcess(cmd, 1, stdout=answer, stderr="")

    monkeypatch.setattr(subprocess, "run", run)
    assert claude_code.account_email(load_settings()) is None
