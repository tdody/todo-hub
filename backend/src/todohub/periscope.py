"""Periscope, the tmux dashboard: start Claude on a Linear issue's branch there, and bring periscope to
the front with that Claude selected. Periscope listens on 127.0.0.1 with no auth (``periscope_url``)."""

from __future__ import annotations

import re
import subprocess

import httpx

from .db import DB

BUNDLE_ID = "com.tom.periscope.app"
REPOS_KEY = "periscope_repos"            # meta: {"project:<name>" or "client:<label>": repo path}
LAST_REPO_KEY = "periscope_last_repo"    # meta: the repo last picked for any issue
TIMEOUT_SECONDS = 120                    # a start fetches, makes the worktree, then waits for Claude's screen
_TOKEN = re.compile(r"\{(identifier|title|url)\}")


class PeriscopeError(RuntimeError):
    """Periscope refused or didn't answer. ``status`` is 409 for its start guards, else 502."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


class Periscope:
    def __init__(self, url: str, transport: httpx.BaseTransport | None = None):
        self.http = httpx.Client(base_url=url.rstrip("/"), timeout=TIMEOUT_SECONDS, transport=transport)

    def close(self) -> None:
        self.http.close()

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        try:
            resp = self.http.request(method, path, json=body)
        except httpx.TimeoutException:
            raise PeriscopeError(f"Periscope didn't answer in {TIMEOUT_SECONDS} s.") from None
        except httpx.TransportError:
            raise PeriscopeError(f"Periscope is not running at {self.http.base_url.netloc.decode()}.") from None
        if resp.is_error:
            try:
                detail = resp.json().get("detail")
            except ValueError:
                detail = None
            raise PeriscopeError(str(detail or f"Periscope answered HTTP {resp.status_code}."),
                                 409 if resp.status_code == 409 else 502)
        return resp.json()

    def catalog(self) -> dict:
        """Its repos and worktrees: {repos: [{repo, label, …}], worktrees: [{path, repo, branch, …}], roots}."""
        return self._call("GET", "/api/open/catalog")

    def start(self, *, repo: str, branch: str, ticket: str, title: str, prompt: str) -> dict:
        """{mode: "spawned", pid, path, reused}, or {mode: "existing", pid} when a Claude is already on the branch."""
        return self._call("POST", "/api/linear/start",
                          {"repo": repo, "branch": branch, "ticket": ticket, "title": title, "prompt": prompt})

    def select(self, pid: str) -> None:
        self._call("POST", "/api/select", {"pid": pid})


def bring_to_front() -> None:
    try:
        subprocess.run(["open", "-b", BUNDLE_ID], check=True, capture_output=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        raise PeriscopeError("Could not bring Periscope to the front.") from None


def fill_prompt(template: str, issue: dict) -> str:
    """The template with {identifier}, {title} and {url} filled in; other braces stay as typed."""
    return _TOKEN.sub(lambda m: issue[m.group(1)], template)


def _memory_key(issue: dict) -> tuple[str, str] | None:
    """Where the repo for ``issue`` is remembered (its project, else its client label), and that name."""
    if issue["project"]:
        return f"project:{issue['project']}", issue["project"]
    if issue["client"]:
        return f"client:{issue['client']}", issue["client"]
    return None


def default_repo(db: DB, issue: dict, repos: list[str]) -> tuple[str | None, str]:
    """The repo the popover selects first, from ``repos`` (periscope's), and the hint that says why."""
    key = _memory_key(issue)
    remembered = db.get_meta(REPOS_KEY, {}) or {}
    if key and remembered.get(key[0]) in repos:
        return remembered[key[0]], f"Remembered for {key[1]}."
    last = db.get_meta(LAST_REPO_KEY)
    if last in repos:
        return last, "The last repo you used."
    return None, ""


def remember_repo(db: DB, issue: dict, repo: str) -> None:
    key = _memory_key(issue)
    if key:
        db.set_meta(REPOS_KEY, {**(db.get_meta(REPOS_KEY, {}) or {}), key[0]: repo})
    db.set_meta(LAST_REPO_KEY, repo)
