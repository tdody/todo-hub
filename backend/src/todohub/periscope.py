"""Periscope, the tmux dashboard: start Claude on a Linear issue's branch there, and bring periscope to
the front with that Claude selected. Periscope listens on 127.0.0.1 with no auth (``periscope_url``)."""

from __future__ import annotations

import subprocess

import httpx

QUICK_SECONDS = 15
START_SECONDS = 120                      # a start fetches, makes the worktree, then waits for Claude's screen


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
            except ValueError:
                detail = None
            raise PeriscopeError(str(detail or f"Periscope answered HTTP {resp.status_code}."),
                                 409 if resp.status_code == 409 else 502)
        return resp.json()

    def catalog(self) -> dict:
        """Its repos and worktrees: {repos: [{repo, label, …}], worktrees: [{path, repo, branch, …}], roots}."""
        return self._call("GET", "/api/open/catalog")

    def start(self, *, repo: str, branch: str, ticket: str, title: str, prompt: str, name: str) -> dict:
        """{mode: "spawned", pid, path, reused, session_id, email}, or {mode: "existing", pid} when a Claude is
        already on the branch. Periscope gives a spawned Claude ``name`` on its rail and pins it. ``email`` is None
        when periscope finds no email for the account, and an older periscope sends neither field."""
        return self._call("POST", "/api/linear/start",
                          {"repo": repo, "branch": branch, "ticket": ticket, "title": title, "prompt": prompt,
                           "name": name},
                          START_SECONDS)

    def select(self, pid: str) -> None:
        self._call("POST", "/api/select", {"pid": pid})


def bring_to_front(app_id: str) -> None:
    try:
        subprocess.run(["open", "-b", app_id], check=True, capture_output=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        raise PeriscopeError("Could not bring Periscope to the front.") from None
