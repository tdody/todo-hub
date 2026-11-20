"""Start in Claude Code: a worktree on Linear's branch next to the repo, and a ``.command`` script that the
Mac's default app for ``.command`` files runs. The script starts Claude Code in the worktree with the prompt."""

from __future__ import annotations

import json
import logging
import shlex
import shutil
import subprocess
from pathlib import Path

from .config import Settings
from .start import StartError
from .sweep import _env

log = logging.getLogger("todohub.claude_code")

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
    """The absolute top folder of the git repo that ``path`` (``~`` allowed) is in, or None.
    A path in a linked worktree gives the main repo. A submodule gives itself.
    Git reads a path that is not absolute from the folder the backend runs in, so it gives None."""
    folder = Path(path).expanduser()
    if not folder.is_absolute():
        return None
    proc = _git(str(folder), "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir")
    if proc.returncode != 0:
        return None
    top, common = proc.stdout.splitlines()
    return str(Path(common).parent) if Path(common).name == ".git" else top


def worktrees(repo: str) -> dict[str, str]:
    """{branch: path} for the repo's worktrees that are on a branch. A repo that is gone gives {}."""
    found: dict[str, str] = {}
    for block in _git(repo, "worktree", "list", "--porcelain").stdout.split("\n\n"):
        lines = block.splitlines()
        if any(line.startswith("prunable") for line in lines):     # its folder was deleted by hand
            continue
        path = next((line.removeprefix("worktree ") for line in lines if line.startswith("worktree ")), "")
        for line in lines:
            if line.startswith("branch refs/heads/"):
                found[line.removeprefix("branch refs/heads/")] = path
    return found


def _has_ref(repo: str, ref: str) -> bool:
    return _git(repo, "show-ref", "--verify", "--quiet", ref).returncode == 0


def find_or_add_worktree(repo: str, branch: str) -> tuple[str, bool, list[str]]:
    """The worktree on ``branch``: the one already on it (reused), else a new one in
    ``<repo>-worktrees/<branch with - for />``. Also the warnings for the toast."""
    if repo_top(repo) is None:
        raise StartError(f"Not a git repo: {tilde(repo)}")
    _git(repo, "worktree", "prune")          # a worktree folder deleted by hand blocks the add
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


def start_command(settings: Settings, name: str, session_id: str, prompt: str) -> list[str]:
    """Finds ``claude`` on the PATH that the sweeps use. If it is not there, the terminal's PATH must find it.
    ``--`` ends the options, so a prompt that starts with ``-`` stays the prompt."""
    claude = shutil.which(settings.claude_path, path=_env()["PATH"]) or settings.claude_path
    return [claude, "--name", name, "--session-id", session_id, "--", prompt]


def write_script(folder: Path, identifier: str, worktree: str, command: list[str]) -> Path:
    """``<folder>/<identifier>.command``: it deletes itself, goes to the worktree, then runs ``command``.
    ``shlex`` quotes each value, so text from Linear stays text."""
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{identifier}.command"
    path.write_text(f'#!/bin/sh\nrm -f -- "$0"\ncd {shlex.quote(worktree)} || exit 1\nexec {shlex.join(command)}\n')
    path.chmod(0o700)
    return path


def open_script(path: Path) -> None:
    """Run the script in the Mac's default app for ``.command`` files (Terminal, unless you changed it)."""
    try:
        subprocess.run(["open", str(path)], check=True, capture_output=True, text=True, timeout=QUICK_SECONDS)
    except subprocess.CalledProcessError as exc:
        raise StartError(f"Could not open the start script: {(exc.stderr or '').strip() or exc}") from None
    except subprocess.TimeoutExpired as exc:
        raise StartError(f"Could not open the start script: {exc}") from None


def account_email(settings: Settings) -> str | None:
    """The signed-in Claude account's email, from ``claude auth status --json``; None when it gives none."""
    try:
        proc = subprocess.run([settings.claude_path, "auth", "status", "--json"], env=_env(), capture_output=True,
                              text=True, timeout=QUICK_SECONDS)
        return json.loads(proc.stdout).get("email") or None
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        log.warning("No Claude account email: %s", exc)
        return None
