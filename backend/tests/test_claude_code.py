import shutil
import subprocess
from pathlib import Path

import pytest

from todohub import claude_code
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
    path, _, warnings = claude_code.worktree_for(str(git_repo), "me/eng-3")
    assert warnings == [] and branch_of(path) == "me/eng-3"
    assert upstream(path) is None            # so a push cannot go to main


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
    git("config", "core.hooksPath", "/dev/null", cwd=lone)
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
