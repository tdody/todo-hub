"""Start in Claude Code: a worktree on Linear's branch next to the repo, and a ``.command`` script that the
Mac's default app for ``.command`` files runs. The script starts Claude Code in the worktree with the prompt."""

from __future__ import annotations

import subprocess
from pathlib import Path

from .start import StartError
from .sweep import _env

QUICK_SECONDS = 15
FETCH_SECONDS = 30
ADD_SECONDS = 60


def tilde(path: str) -> str:
    """``path`` with the home folder shown as ``~``, for labels and messages."""
    home = str(Path.home())
    return "~" + path[len(home):] if path == home or path.startswith(home + "/") else path


def _git(repo: str, *args: str, timeout: int = QUICK_SECONDS) -> subprocess.CompletedProcess:
    # GIT_TERMINAL_PROMPT=0 stops HTTPS credential prompts. _env adds the Homebrew folders that hooks need.
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=timeout,
                          env={**_env(), "GIT_TERMINAL_PROMPT": "0"})


def repo_top(path: str) -> str | None:
    """The absolute top folder of the git repo that ``path`` (``~`` allowed) is in, or None."""
    proc = _git(str(Path(path).expanduser()), "rev-parse", "--show-toplevel")
    return proc.stdout.strip() if proc.returncode == 0 else None


def worktrees(repo: str) -> dict[str, str]:
    """{branch: path} for the repo's worktrees that are on a branch. A repo that is gone gives {}."""
    _git(repo, "worktree", "prune")          # a worktree folder deleted by hand still holds its branch
    found: dict[str, str] = {}
    path = ""
    for line in _git(repo, "worktree", "list", "--porcelain").stdout.splitlines():
        if line.startswith("worktree "):
            path = line.removeprefix("worktree ")
        elif line.startswith("branch refs/heads/"):
            found[line.removeprefix("branch refs/heads/")] = path
    return found


def _has_ref(repo: str, ref: str) -> bool:
    return _git(repo, "show-ref", "--verify", "--quiet", ref).returncode == 0


def worktree_for(repo: str, branch: str) -> tuple[str, bool, list[str]]:
    """The worktree on ``branch``: the one already on it (reused), else a new one in
    ``<repo>-worktrees/<branch with - for />``. Also the warnings for the toast."""
    if repo_top(repo) is None:
        raise StartError(f"Not a git repo: {tilde(repo)}")
    if branch in (checked_out := worktrees(repo)):
        return checked_out[branch], True, []
    warnings: list[str] = []
    try:
        fetched = _git(repo, "fetch", "--quiet", "origin", timeout=FETCH_SECONDS).returncode == 0
    except subprocess.TimeoutExpired:
        fetched = False
    if not fetched:
        warnings.append("Could not fetch origin. The worktree uses the local branches.")
    path = str(Path(repo).parent / f"{Path(repo).name}-worktrees" / branch.replace("/", "-"))
    if _has_ref(repo, f"refs/heads/{branch}"):
        args = [path, branch]
    elif _has_ref(repo, f"refs/remotes/origin/{branch}"):
        args = ["--track", "-b", branch, path, f"origin/{branch}"]
    elif _has_ref(repo, "refs/remotes/origin/HEAD"):
        args = ["--no-track", "-b", branch, path, "origin/HEAD"]      # no upstream, so a push cannot go to the default branch
    else:
        warnings.append(f"{tilde(repo)} has no origin/HEAD. The new branch starts from HEAD.")
        args = ["--no-track", "-b", branch, path, "HEAD"]
    try:
        proc = _git(repo, "worktree", "add", "--quiet", *args, timeout=ADD_SECONDS)
    except subprocess.TimeoutExpired:
        raise StartError(f"git worktree add took more than {ADD_SECONDS} s. It may still finish.") from None
    if proc.returncode != 0:
        raise StartError(proc.stderr.strip() or "git worktree add failed.")
    return path, False, warnings
