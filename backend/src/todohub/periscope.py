"""Periscope, the tmux dashboard: start Claude on a Linear issue's branch there, find the Claude on a branch, and
bring periscope to the front with that Claude selected. Periscope listens on 127.0.0.1 with no auth (``periscope_url``)."""

from __future__ import annotations

import re
import subprocess

import httpx

from .start import fill_review_prompt

QUICK_SECONDS = 15
START_SECONDS = 120                      # a start fetches, makes the worktree, then waits for Claude's screen
_PR_URL = re.compile(r"https://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)")


class PeriscopeError(RuntimeError):
    """Periscope refused, did not answer, or could not be brought to the front. ``status`` is 409 for its start guards, else 502."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


class Periscope:
    def __init__(self, url: str, transport: httpx.BaseTransport | None = None):
        self._client = httpx.Client(base_url=url.rstrip("/"), transport=transport)

    def close(self) -> None:
        self._client.close()

    def _call(self, method: str, path: str, body: dict | None = None, timeout: int = QUICK_SECONDS) -> dict:
        try:
            resp = self._client.request(method, path, json=body, timeout=timeout)
        except httpx.TimeoutException:
            late = " It may still start Claude." if timeout == START_SECONDS else ""
            raise PeriscopeError(f"Periscope didn't answer in {timeout} s.{late}") from None
        except httpx.TransportError:
            raise PeriscopeError(f"Periscope is not running at {self._client.base_url.netloc.decode()}.") from None
        if resp.is_error:
            try:
                detail = resp.json().get("detail")
                if isinstance(detail, list):     # FastAPI's 422: an item for each field, with the whole body in it
                    detail = "; ".join(f"{'.'.join(map(str, d['loc'][1:]))}: {d['msg']}" for d in detail)
            except ValueError:
                detail = None
            raise PeriscopeError(str(detail or f"Periscope answered HTTP {resp.status_code}."),
                                 409 if resp.status_code == 409 else 502)
        return resp.json()

    def catalog(self) -> dict:
        """Its repos and worktrees: {repos: [{repo, label, …}], worktrees: [{path, repo, branch, …}], roots}."""
        return self._call("GET", "/api/open/catalog")

    def start(self, *, repo: str, prompt: str, name: str, ticket: str = "", title: str = "", branch: str = "",
              pr: int | None = None) -> dict:
        """Start Claude on ``branch``, or on pull request ``pr``, which periscope checks out as ``pr-<N>``. The card
        shows ``ticket`` and its ``title``. With no ticket, an older periscope answers 422.
        {mode: "spawned", pid, path, reused, session_id, email}, or {mode: "existing", pid} when a Claude is
        already on the branch. Periscope gives a spawned Claude ``name`` on its rail and pins it. ``email`` is None
        when periscope finds no email for the account, and an older periscope sends neither field. A spawned start
        also has ``warning`` when a worktree problem did not stop it, for example a PR worktree that stays behind
        the PR."""
        target = {"pr": pr} if pr is not None else {"branch": branch}
        linked = {"ticket": ticket, "title": title} if ticket else {}
        return self._call("POST", "/api/linear/start",
                          {"repo": repo, **target, **linked, "prompt": prompt, "name": name}, START_SECONDS)

    def select(self, pid: str) -> None:
        self._call("POST", "/api/select", {"pid": pid})

    def state(self) -> dict:
        """Its dashboard's state: {windows: [{pid, agent, repo_slug, branch, activity, …}], …}."""
        # shortcut: periscope's own dashboard data, not an API for other apps; switch when periscope answers "the Claude
        # on this branch" itself.
        return self._call("GET", "/api/state")


def bring_to_front(app_id: str) -> None:
    try:
        subprocess.run(["open", "-b", app_id], check=True, capture_output=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        raise PeriscopeError("Could not bring Periscope to the front.") from None


def pr_links(urls: list[str]) -> list[tuple[str, int]]:
    """The GitHub repo (``owner/name``) and number of each pull request in ``urls``, in order, each once. GitHub
    ignores the case of ``owner/name``, so the first spelling stays."""
    found: dict[tuple[str, int], tuple[str, int]] = {}
    for url in urls:
        if m := _PR_URL.match(url):
            slug, number = m.group(1), int(m.group(2))
            found.setdefault((slug.lower(), number), (slug, number))
    return list(found.values())


def claudes(state: dict) -> list[dict]:
    """The Claudes in periscope's ``state`` on a branch of a repo whose origin is on GitHub: {repo (``owner/name``),
    branch, pid}. One for each branch: the most recently active, as periscope picks it for a start. A state with no
    ``windows`` raises, so a change in periscope shows in the log."""
    found: dict[tuple[str, str], dict] = {}
    for w in state["windows"]:
        if w.get("agent") != "claude" or not w.get("repo_slug") or not w.get("branch"):
            continue
        key = (w["repo_slug"].lower(), w["branch"])
        if key not in found or (w.get("activity") or 0) > (found[key].get("activity") or 0):
            found[key] = w
    return [{"repo": w["repo_slug"], "branch": w["branch"], "pid": w["pid"]} for w in found.values()]


def pr_repos(catalog: dict, slug: str, branch: str) -> dict:
    """{repos, branch_worktrees}: the catalog's repos whose origin is the GitHub repo ``slug``, and the ones with a
    worktree on ``branch``."""
    repos = [{"repo": r["repo"], "label": r["label"]} for r in catalog["repos"]
             if (r.get("slug") or "").lower() == slug.lower()]
    paths = {r["repo"] for r in repos}
    return {"repos": repos,
            "branch_worktrees": sorted({w["repo"] for w in catalog["worktrees"]
                                        if w["repo"] in paths and w["branch"] == branch})}


def review_prs(links: list[tuple[str, int]], catalog: dict, template: str, issue: dict) -> tuple[list[dict], str]:
    """The popover's PR options: each PR in ``links`` whose GitHub repo is the origin of a periscope repo, with
    ``template`` filled in for it. When none is, the hint that names the PRs' repos."""
    prs: list[dict] = []
    missing: dict[str, None] = {}
    for slug, number in links:
        found = pr_repos(catalog, slug, f"pr-{number}")
        if not found["repos"]:
            missing.setdefault(slug, None)
            continue
        url = f"https://github.com/{slug}/pull/{number}"
        prs.append({
            "number": number, "label": f"{slug}#{number}", "url": url, "repos": [r["repo"] for r in found["repos"]],
            "branch_worktrees": found["branch_worktrees"],
            "prompt": fill_review_prompt(template, issue, url),
        })
    if prs or not missing:
        return prs, ""
    return [], f"No periscope repo has {' or '.join(missing)} as its origin. This starts on the Linear branch."
