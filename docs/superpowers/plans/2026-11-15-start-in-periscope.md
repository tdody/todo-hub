# Start in periscope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From an issue in Today, Client or Dev, the ⋯ menu (or **p**) opens a popover that starts Claude on the issue's branch in periscope with a prompt; the toast's **Show** brings periscope forward with that Claude selected.

**Architecture:** The backend gets a small periscope client (`todohub/periscope.py`, shaped like `linear.py`) and three routes: the popover's data, the start, and Show. The repo remembered for each Linear project lives in the `meta` table; the prompt template lives in `settings.json` through the Settings page. The UI is a new module, `app/src/periscope.ts`, wired into the two reading panes the way `pane.ts` is.

**Tech Stack:** FastAPI, httpx (`MockTransport` in tests), pytest, TypeScript with the app's `h()` DOM helper, Vite, Tauri.

**Spec:** `docs/superpowers/specs/2026-11-15-start-in-periscope-design.md`. Periscope's side (`POST /api/linear/start`, `POST /api/select`) is a separate plan in the periscope repo: `docs/superpowers/plans/2026-11-15-linear-start.md`.

**Worktree:** `/Users/thibaultdody/dev/worktrees/todo-hub/start-in-periscope`, branch `thibaultdody/start-in-periscope`. Run every command from there.

---

## Conventions

**No private data.** Nothing about work clients goes in this repo: tests and examples use Globex, Initech & Co, `ENG-123`, `/dev/api`. Before every commit, run the privacy scan on the staged files. It lives outside the repo, next to the private settings:

```bash
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
```

Expected: `clean`. Its docstring lists the known false positives. Fix any other hit before the commit.

**Commit messages** name the area first, as the log does: `Backend: …`, `App: …`, `README: …`. End each with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File map

| File | Change |
|---|---|
| `backend/src/todohub/linear.py` | `branchName` in `ISSUE_FIELDS`. |
| `backend/src/todohub/config.py` | `periscope_url` (config.toml `[app]`), `periscope_prompt` (settings.json), `DEFAULT_PERISCOPE_PROMPT`. |
| `backend/src/todohub/periscope.py` | New: `Periscope` client, `PeriscopeError`, `bring_to_front`, `fill_prompt`, `default_repo`, `remember_repo`. |
| `backend/src/todohub/api.py` | Routes: `GET`/`POST /api/issues/{issue_id}/periscope`, `POST /api/periscope/show`, `PUT /api/settings/periscope`; `periscope` in the settings body. |
| `backend/tests/conftest.py` | `branchName` on `make_issue`. |
| `backend/tests/test_periscope.py` | New. |
| `backend/tests/test_settings.py`, `backend/tests/test_linear.py` | New cases. |
| `app/src/api.ts` | Types and the four calls. |
| `app/src/periscope.ts` | New: the menu item, the popover, Start and Show. |
| `app/src/pane.ts` | `p` in `PANE_KEYS`. |
| `app/src/main.ts` | Wiring: setup, both panes, outside click, Esc, the shortcuts sheet. |
| `app/src/settings.ts` | The **Periscope** section. |
| `app/src/styles.css` | Popover and prompt box styles. |
| `README.md`, the spec | Docs. |

---

### Task 0: Set up the worktree

- [ ] **Step 1: Install and check the baseline**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/start-in-periscope/backend && uv sync --extra dev && uv run pytest -q
cd /Users/thibaultdody/dev/worktrees/todo-hub/start-in-periscope/app && npm install && npm run build
```

Expected: the tests pass and the build succeeds. If something fails before any change, stop and report it.

---

### Task 1: Read Linear's branch name

**Files:**
- Modify: `backend/src/todohub/linear.py:15-22` (`ISSUE_FIELDS`)
- Modify: `backend/tests/conftest.py` (`make_issue`)
- Test: `backend/tests/test_linear.py`

- [ ] **Step 1: Write the failing test** (append to `backend/tests/test_linear.py`)

```python
def test_issues_carry_linears_branch_name():
    from todohub.linear import ISSUE_FIELDS

    assert "branchName" in ISSUE_FIELDS.split()
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && uv run pytest tests/test_linear.py::test_issues_carry_linears_branch_name -v`
Expected: FAIL (`assert 'branchName' in [...]`).

- [ ] **Step 3: Add the field.** In `backend/src/todohub/linear.py`, change the first line of `ISSUE_FIELDS` from

```python
    id identifier title url priority dueDate createdAt updatedAt completedAt canceledAt
```

to

```python
    id identifier title url branchName priority dueDate createdAt updatedAt completedAt canceledAt
```

In `backend/tests/conftest.py`, in `make_issue`'s returned dict, after the `"url": …` entry add:

```python
        "branchName": f"me/{identifier.lower()}",
```

- [ ] **Step 4: Run the backend suite**

Run: `cd backend && uv run pytest -q`
Expected: all pass.

- [ ] **Step 5: Scan, then commit**

```bash
git add backend/src/todohub/linear.py backend/tests/conftest.py backend/tests/test_linear.py
# run the privacy scan (Conventions); expect "clean"
git commit -m "Backend: read each issue's Linear branch name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Settings — periscope's address and the prompt template

**Files:**
- Modify: `backend/src/todohub/config.py` (docstring; a constant before `class Settings`; two `Settings` fields; `DEFAULT_CONFIG`'s `[app]`; `load_settings`; `apply_overrides`)
- Test: `backend/tests/test_settings.py`

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_settings.py`)

```python
def test_periscope_prompt_from_the_settings_page():
    assert load_settings().periscope_prompt == config.DEFAULT_PERISCOPE_PROMPT
    config.write_overrides({"periscope": {"prompt": "Read {identifier}."}})
    assert load_settings().periscope_prompt == "Read {identifier}."
    config.write_overrides({"periscope": {"prompt": "   "}})
    assert load_settings().periscope_prompt == config.DEFAULT_PERISCOPE_PROMPT


def test_periscope_url_from_config_toml(tmp_home):
    assert load_settings().periscope_url == "http://127.0.0.1:17374"
    cfg = tmp_home / "config.toml"
    cfg.write_text(cfg.read_text().replace("[app]\n", '[app]\nperiscope_url = "http://127.0.0.1:17375"\n'))
    assert load_settings().periscope_url == "http://127.0.0.1:17375"
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend && uv run pytest tests/test_settings.py -q -k periscope`
Expected: FAIL with `AttributeError: module 'todohub.config' has no attribute 'DEFAULT_PERISCOPE_PROMPT'`.

- [ ] **Step 3: Change `backend/src/todohub/config.py`**

In the module docstring, change

```
    settings.json    what the app's Settings page changed (sources, schedule, Daylight place);
```

to

```
    settings.json    what the app's Settings page changed (sources, schedule, Daylight place,
                     the periscope prompt);
```

Before `@dataclass` of `class Settings`, add:

```python
# Start in periscope: what the new Claude is told. {identifier}, {title} and {url} become the issue's.
DEFAULT_PERISCOPE_PROMPT = (
    "Read Linear ticket {identifier} ({url}) and its comments with the Linear tools. "
    "Sum up the ask, then propose a plan. Do not change code until I agree."
)
```

In `class Settings`, after `daylight_longitude: float | None = None`, add:

```python
    periscope_url: str = "http://127.0.0.1:17374"
    periscope_prompt: str = DEFAULT_PERISCOPE_PROMPT
```

In `DEFAULT_CONFIG`, after the line `# daylight_longitude = -73.23`, add:

```
# Periscope, for Start in periscope on an issue.
# periscope_url = "http://127.0.0.1:17374"
```

In `load_settings`, after `s.daylight_longitude = _coord(app.get("daylight_longitude"), 180)`, add:

```python
    s.periscope_url = str(app.get("periscope_url", s.periscope_url))
```

At the end of `apply_overrides`, add:

```python
    peri = data.get("periscope")
    if isinstance(peri, dict) and isinstance(peri.get("prompt"), str) and peri["prompt"].strip():
        s.periscope_prompt = peri["prompt"]
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_settings.py -q`
Expected: all pass.

- [ ] **Step 5: Scan, then commit**

```bash
git add backend/src/todohub/config.py backend/tests/test_settings.py
# run the privacy scan (Conventions); expect "clean"
git commit -m "Backend: periscope_url in config.toml and the periscope prompt in settings.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The periscope client and the remembered repos

**Files:**
- Create: `backend/src/todohub/periscope.py`
- Test: `backend/tests/test_periscope.py`

- [ ] **Step 1: Write the failing tests** (create `backend/tests/test_periscope.py`)

```python
import json
import subprocess
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from todohub import periscope
from todohub.api import create_app
from todohub.config import load_settings
from todohub.db import DB
from todohub.periscope import (LAST_REPO_KEY, REPOS_KEY, Periscope, PeriscopeError, default_repo, fill_prompt,
                               remember_repo)
from conftest import FakeLinear

URL = "http://127.0.0.1:17374"
CATALOG = {
    "repos": [{"repo": "/dev/api", "label": "api", "default_branch": "main", "branches": []},
              {"repo": "/dev/web", "label": "web", "default_branch": "main", "branches": []}],
    "worktrees": [{"path": "/dev/worktrees/web/me-eng-1", "repo": "/dev/web", "branch": "me/eng-1", "is_main": False}],
    "roots": ["/dev"],
}
SPAWNED = {"mode": "spawned", "pid": "k", "path": "/dev/worktrees/api/me-eng-1", "reused": False}


@pytest.fixture
def peri():
    """Periscope behind an httpx MockTransport. ``calls`` holds (method, path, body); set ``answer`` to change
    what POST /api/linear/start answers."""
    p = SimpleNamespace(calls=[], answer=httpx.Response(200, json=SPAWNED))

    def handler(request: httpx.Request) -> httpx.Response:
        p.calls.append((request.method, request.url.path, json.loads(request.content) if request.content else None))
        if request.url.path == "/api/open/catalog":
            return httpx.Response(200, json=CATALOG)
        if request.url.path == "/api/linear/start":
            return p.answer
        if request.url.path == "/api/select":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404, json={"detail": "Not Found"})

    p.transport = httpx.MockTransport(handler)
    return p


def test_client_calls(peri):
    client = Periscope(URL, transport=peri.transport)
    assert client.catalog() == CATALOG
    assert client.start(repo="/dev/api", branch="me/eng-1", ticket="ENG-1", title="Fix", prompt="Read.") == SPAWNED
    client.select("k")
    assert peri.calls == [
        ("GET", "/api/open/catalog", None),
        ("POST", "/api/linear/start",
         {"repo": "/dev/api", "branch": "me/eng-1", "ticket": "ENG-1", "title": "Fix", "prompt": "Read."}),
        ("POST", "/api/select", {"pid": "k"}),
    ]


def test_client_errors(peri):
    client = Periscope(URL, transport=peri.transport)
    peri.answer = httpx.Response(409, json={"detail": "start already running"})
    with pytest.raises(PeriscopeError, match="start already running") as e:
        client.start(repo="/dev/api", branch="b", ticket="ENG-1", title="", prompt="p")
    assert e.value.status == 409
    peri.answer = httpx.Response(502, json={"detail": "spawn failed: no server"})
    with pytest.raises(PeriscopeError, match="spawn failed: no server") as e:
        client.start(repo="/dev/api", branch="b", ticket="ENG-1", title="", prompt="p")
    assert e.value.status == 502
    peri.answer = httpx.Response(500, text="Internal Server Error")
    with pytest.raises(PeriscopeError, match="Periscope answered HTTP 500."):
        client.start(repo="/dev/api", branch="b", ticket="ENG-1", title="", prompt="p")


def test_client_when_periscope_is_down_or_slow():
    def refuse(request):
        raise httpx.ConnectError("refused")

    def slow(request):
        raise httpx.ReadTimeout("slow")

    with pytest.raises(PeriscopeError, match=r"Periscope is not running at 127\.0\.0\.1:17374\."):
        Periscope(URL, transport=httpx.MockTransport(refuse)).catalog()
    with pytest.raises(PeriscopeError, match="Periscope didn't answer in 120 s."):
        Periscope(URL, transport=httpx.MockTransport(slow)).catalog()


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


def test_default_repo_skips_a_repo_periscope_no_longer_lists():
    db = DB(load_settings().db_path)
    remember_repo(db, {"project": "Pipelines", "client": None}, "/dev/gone")
    assert default_repo(db, {"project": "Pipelines", "client": None}, ["/dev/api"]) == (None, "")


def test_bring_to_front_opens_the_app_by_bundle_id(monkeypatch):
    ran = []
    monkeypatch.setattr(periscope.subprocess, "run", lambda args, **kw: ran.append(args))
    periscope.bring_to_front()
    assert ran == [["open", "-b", "com.tom.periscope.app"]]


def test_bring_to_front_failure(monkeypatch):
    def fail(args, **kw):
        raise subprocess.CalledProcessError(1, args)

    monkeypatch.setattr(periscope.subprocess, "run", fail)
    with pytest.raises(PeriscopeError, match="Could not bring Periscope to the front."):
        periscope.bring_to_front()
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend && uv run pytest tests/test_periscope.py -q`
Expected: FAIL at collection: `ModuleNotFoundError: No module named 'todohub.periscope'`. (`TestClient`, `create_app` and `FakeLinear` are for Task 4's route tests in the same file.)

- [ ] **Step 3: Create `backend/src/todohub/periscope.py`**

```python
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
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_periscope.py -q`
Expected: 8 passed.

- [ ] **Step 5: Scan, then commit**

```bash
git add backend/src/todohub/periscope.py backend/tests/test_periscope.py
# run the privacy scan (Conventions); expect "clean"
git commit -m "Backend: a periscope client, the prompt fill and the repo remembered for each project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The routes

**Files:**
- Modify: `backend/src/todohub/api.py` (imports; request models; `create_app` parameters and body; `settings_body`; a settings route; three periscope routes after `GET /api/issues/{ident}/preview`, near line 861)
- Test: `backend/tests/test_periscope.py`, `backend/tests/test_settings.py`

- [ ] **Step 1: Write the failing route tests** (append to `backend/tests/test_periscope.py`)

```python
START = {"repo": "/dev/api", "branch": " me/eng-1 ", "prompt": "Read ENG-1."}


@pytest.fixture
def env(peri):
    settings = load_settings()
    db = DB(settings.db_path)
    fronted = []
    app = create_app(settings, db, linear_factory=FakeLinear,
                     periscope_factory=lambda: Periscope(URL, transport=peri.transport),
                     front_fn=lambda: fronted.append(True))
    return TestClient(app), db, fronted


def test_options_fill_the_popover(env):
    client, db, _ = env
    db.set_meta(REPOS_KEY, {"client:Globex": "/dev/web"})
    r = client.get("/api/issues/id-ENG-1/periscope")
    assert r.status_code == 200
    assert r.json() == {
        "repos": [{"repo": "/dev/api", "label": "api"}, {"repo": "/dev/web", "label": "web"}],
        "repo": "/dev/web",
        "hint": "Remembered for Globex.",
        "branch": "me/eng-1",
        "branch_worktrees": ["/dev/web"],
        "prompt": "Read Linear ticket ENG-1 (https://linear.app/x/issue/ENG-1) and its comments with the Linear "
                  "tools. Sum up the ask, then propose a plan. Do not change code until I agree.",
    }


def test_start_sends_the_issue_and_remembers_the_repo(env, peri):
    client, db, _ = env
    r = client.post("/api/issues/id-ENG-1/periscope", json=START)
    assert r.status_code == 200 and r.json() == SPAWNED
    assert peri.calls[-1] == ("POST", "/api/linear/start", {
        "repo": "/dev/api", "branch": "me/eng-1", "ticket": "ENG-1", "title": "Rebin Globex grades",
        "prompt": "Read ENG-1."})
    assert db.get_meta(REPOS_KEY) == {"client:Globex": "/dev/api"}
    assert db.get_meta(LAST_REPO_KEY) == "/dev/api"


def test_a_claude_already_on_the_branch_is_answered_and_the_repo_remembered(env, peri):
    client, db, _ = env
    peri.answer = httpx.Response(200, json={"mode": "existing", "pid": "p1"})
    r = client.post("/api/issues/id-ENG-2/periscope", json=START)
    assert r.json() == {"mode": "existing", "pid": "p1"}
    assert db.get_meta(REPOS_KEY) is None and db.get_meta(LAST_REPO_KEY) == "/dev/api"


def test_a_start_periscope_refuses_says_it_is_already_starting(env, peri):
    client, db, _ = env
    peri.answer = httpx.Response(409, json={"detail": "start already running"})
    r = client.post("/api/issues/id-ENG-1/periscope", json=START)
    assert r.status_code == 409 and r.json() == {"error": "Periscope is already starting ENG-1."}
    assert db.get_meta(LAST_REPO_KEY) is None


def test_other_periscope_errors_carry_its_detail(env, peri):
    client, db, _ = env
    peri.answer = httpx.Response(502, json={"detail": "spawn failed: no server"})
    r = client.post("/api/issues/id-ENG-1/periscope", json=START)
    assert r.status_code == 502 and r.json() == {"error": "spawn failed: no server"}
    assert db.get_meta(LAST_REPO_KEY) is None


def test_options_when_periscope_is_not_running():
    def refuse(request):
        raise httpx.ConnectError("refused")

    settings = load_settings()
    app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear,
                     periscope_factory=lambda: Periscope(URL, transport=httpx.MockTransport(refuse)))
    r = TestClient(app).get("/api/issues/id-ENG-1/periscope")
    assert r.status_code == 502 and r.json() == {"error": "Periscope is not running at 127.0.0.1:17374."}


def test_show_selects_the_pane_then_brings_periscope_forward(env, peri):
    client, _, fronted = env
    assert client.post("/api/periscope/show", json={"pid": "k"}).json() == {"ok": True}
    assert peri.calls[-1] == ("POST", "/api/select", {"pid": "k"}) and fronted == [True]
```

Append to `backend/tests/test_settings.py`:

```python
def test_settings_api_periscope_prompt():
    client, _, _ = client_for()
    default = {"prompt": config.DEFAULT_PERISCOPE_PROMPT, "default_prompt": config.DEFAULT_PERISCOPE_PROMPT}
    assert client.get("/api/settings").json()["periscope"] == default
    r = client.put("/api/settings/periscope", json={"prompt": "Read {identifier}."})
    assert r.status_code == 200 and r.json()["periscope"]["prompt"] == "Read {identifier}."
    assert client.put("/api/settings/periscope", json={"prompt": ""}).json()["periscope"] == default
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend && uv run pytest tests/test_periscope.py tests/test_settings.py -q`
Expected: the new route tests FAIL (`TypeError: create_app() got an unexpected keyword argument 'periscope_factory'`, and `KeyError: 'periscope'` in the settings test).

- [ ] **Step 3: Change `backend/src/todohub/api.py`**

Imports: change

```python
from .config import (SCHEDULE_DAYS, SCHEDULE_EVERY, SCHEDULE_FIRST, SCHEDULE_LAST, SOURCE_FIELDS, Settings,
                     get_linear_key, load_settings, read_overrides, source_state, write_overrides)
```

to

```python
from .config import (DEFAULT_PERISCOPE_PROMPT, SCHEDULE_DAYS, SCHEDULE_EVERY, SCHEDULE_FIRST, SCHEDULE_LAST,
                     SOURCE_FIELDS, Settings, get_linear_key, load_settings, read_overrides, source_state,
                     write_overrides)
```

and after `from .linear import …` add:

```python
from .periscope import Periscope, PeriscopeError, bring_to_front, default_repo, fill_prompt, remember_repo
```

After `class DaylightIn`, add the request models:

```python
class PeriscopePromptIn(BaseModel):
    prompt: str = Field(max_length=8000)       # empty: back to the default


class PeriscopeStartIn(BaseModel):
    repo: str = Field(min_length=1, max_length=500)       # a repo path from periscope's catalog
    branch: str = Field(min_length=1, max_length=250)
    prompt: str = Field(min_length=1, max_length=8000)


class PeriscopeShowIn(BaseModel):
    pid: str = Field(min_length=1, max_length=100)
```

In `create_app`'s parameters, after `draft_fn: …,` add:

```python
               periscope_factory: Callable[[], Periscope] | None = None,
               front_fn: Callable[[], None] | None = None,
```

After `linear_factory = linear_factory or (lambda: Linear(get_linear_key()))`, add:

```python
    periscope_factory = periscope_factory or (lambda: Periscope(settings.periscope_url))
    front = front_fn or bring_to_front
```

After the `linear_call` function, add:

```python
    def periscope_call(fn: Callable[[Periscope], object]):
        client = periscope_factory()
        try:
            return fn(client)
        except PeriscopeError as exc:
            raise HTTPException(exc.status, str(exc))
        finally:
            client.close()
```

In `settings_body`, after the `"daylight": {…},` entry, add:

```python
            "periscope": {"prompt": settings.periscope_prompt, "default_prompt": DEFAULT_PERISCOPE_PROMPT},
```

After the `set_daylight` route, add:

```python
    @app.put("/api/settings/periscope", dependencies=auth)
    def set_periscope(body: PeriscopePromptIn) -> dict:
        """The prompt Start in periscope sends; an empty one goes back to the default."""
        save_override("periscope", {"prompt": body.prompt.strip()})
        return settings_body()
```

After the `GET /api/issues/{ident}/preview` route, add:

```python
    # ---- Start in periscope -----------------------------------------------------------------
    @app.get("/api/issues/{issue_id}/periscope", dependencies=auth)
    def periscope_options(issue_id: str) -> dict:
        """What the popover shows first: periscope's repos, the one to select and why, Linear's branch, the
        repos with a worktree already on it, and the Settings page's prompt filled in for the issue."""
        raw = linear_call(lambda l: l.get_issue(issue_id))
        issue = shape_issue(raw, settings)
        catalog = periscope_call(lambda p: p.catalog())
        repos = [{"repo": r["repo"], "label": r["label"]} for r in catalog["repos"]]
        repo, hint = default_repo(db, issue, [r["repo"] for r in repos])
        branch = raw["branchName"]
        return {
            "repos": repos, "repo": repo, "hint": hint, "branch": branch,
            "branch_worktrees": sorted({w["repo"] for w in catalog["worktrees"] if w["branch"] == branch}),
            "prompt": fill_prompt(settings.periscope_prompt, issue),
        }

    @app.post("/api/issues/{issue_id}/periscope", dependencies=auth)
    def periscope_start(issue_id: str, body: PeriscopeStartIn) -> dict:
        """Ask periscope to start Claude on the branch with the prompt, then remember the repo for the issue's
        project (or client). A Claude already on the branch is answered as mode "existing"."""
        issue = shape_issue(linear_call(lambda l: l.get_issue(issue_id)), settings)
        try:
            result = periscope_call(lambda p: p.start(
                repo=body.repo, branch=body.branch.strip(), ticket=issue["identifier"], title=issue["title"],
                prompt=body.prompt))
        except HTTPException as exc:
            if exc.status_code == 409:
                raise HTTPException(409, f"Periscope is already starting {issue['identifier']}.")
            raise
        remember_repo(db, issue, body.repo)
        return result

    @app.post("/api/periscope/show", dependencies=auth)
    def periscope_show(body: PeriscopeShowIn) -> dict:
        """Select the pane in periscope, then bring periscope to the front."""
        periscope_call(lambda p: p.select(body.pid))
        try:
            front()
        except PeriscopeError as exc:
            raise HTTPException(502, str(exc))
        return {"ok": True}
```

- [ ] **Step 4: Run the backend suite**

Run: `cd backend && uv run pytest -q`
Expected: all pass.

- [ ] **Step 5: Scan, then commit**

```bash
git add backend/src/todohub/api.py backend/tests/test_periscope.py backend/tests/test_settings.py
# run the privacy scan (Conventions); expect "clean"
git commit -m "Backend: routes for the Start in periscope popover, the start, Show and the prompt setting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The app's API calls

**Files:**
- Modify: `app/src/api.ts` (`AppSettings`; new types; the `api` object)

- [ ] **Step 1: Types.** In `AppSettings`, after the `daylight: …;` line, add:

```ts
  periscope: { prompt: string; default_prompt: string };
```

After the `AppSettings` interface, add:

```ts
/** Start in periscope: what the popover shows first. */
export interface PeriscopeOptions {
  repos: { repo: string; label: string }[];   // periscope's repos
  repo: string | null;                          // the one to select first
  hint: string;                                 // why: "Remembered for Pipelines.", or ""
  branch: string;                               // Linear's branch name
  branch_worktrees: string[];                   // repos with a worktree already on that branch
  prompt: string;                               // the Settings page's template, filled in
}

export interface PeriscopeStart {
  mode: "spawned" | "existing";                 // existing: a Claude was already on the branch
  pid: string | null;
}
```

- [ ] **Step 2: Calls.** In the `api` object, after the `issuePreview: …` line, add:

```ts
  periscopeOptions: (issueId: string) =>
    call<PeriscopeOptions>("GET", `/api/issues/${encodeURIComponent(issueId)}/periscope`),
  startInPeriscope: (issueId: string, body: { repo: string; branch: string; prompt: string }) =>
    call<PeriscopeStart>("POST", `/api/issues/${encodeURIComponent(issueId)}/periscope`, body),
  showInPeriscope: (pid: string) => call<{ ok: boolean }>("POST", "/api/periscope/show", { pid }),
```

After the `setDaylightPlace: …` line, add:

```ts
  setPeriscopePrompt: (prompt: string) => call<AppSettings>("PUT", "/api/settings/periscope", { prompt }),
```

- [ ] **Step 3: Type-check**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/api.ts
# run the privacy scan (Conventions); expect "clean"
git commit -m "App: API calls for Start in periscope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The popover module

**Files:**
- Create: `app/src/periscope.ts`
- Modify: `app/src/styles.css` (append)

- [ ] **Step 1: Create `app/src/periscope.ts`**

```ts
// Start in periscope: the ⋯ menu item (or p) opens a popover with the repo, Linear's branch and the
// prompt; Start asks periscope to start Claude on that branch with the prompt. The toast's Show
// brings periscope to the front with that Claude selected.
import { api } from "./api";
import type { Issue, PeriscopeOptions } from "./api";
import { h } from "./dom";

export interface PeriscopeCtx {
  render: () => void;
  toast: (message: string, action?: { label: string; run: () => void }) => void;
  fail: (e: unknown) => void;
}

interface Popover {
  issueId: string;
  options: PeriscopeOptions | null;     // null while periscope is asked
  repo: string;
  branch: string;
  prompt: string;
  starting: boolean;
}

let ctx: PeriscopeCtx;
let open: Popover | null = null;

export function setupPeriscope(c: PeriscopeCtx) {
  ctx = c;
}

export function isPeriscopeOpen(): boolean {
  return open !== null;
}

export function closePeriscope() {
  if (!open) return;
  open = null;
  ctx.render();
}

/** A pointer down outside the popover closes it in place, not by a re-render, so the click still
 *  lands on its target. */
export function dismissPeriscope(target: Element) {
  if (!open || target.closest?.(".pp-pop")) return;
  open = null;
  document.querySelector(".pp-pop")?.remove();
}

/** The ⋯ menu item. p clicks it through paneKey (data-pane="periscope"). */
export function periscopeItem(i: Issue): HTMLElement {
  return h("button", {
    type: "button", "data-pane": "periscope",
    onclick: (e: Event) => {
      (e.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
      void openFor(i);
    },
  }, "Start in periscope", h("kbd", {}, "p"));
}

async function openFor(i: Issue) {
  if (open?.issueId === i.id) return;
  open = { issueId: i.id, options: null, repo: "", branch: "", prompt: "", starting: false };
  ctx.render();
  try {
    const o = await api.periscopeOptions(i.id);
    if (open?.issueId !== i.id) return;           // closed, or opened for another issue, meanwhile
    open = { ...open, options: o, repo: o.repo ?? "", branch: o.branch, prompt: o.prompt };
    ctx.render();
    const pop = document.querySelector<HTMLElement>(".pp-pop");
    pop?.scrollIntoView({ block: "nearest" });
    pop?.querySelector<HTMLElement>(open.repo ? ".pp-start" : ".pp-repo")?.focus();
  } catch (e) {
    if (open?.issueId === i.id) closePeriscope();
    ctx.fail(e);
  }
}

async function start(i: Issue) {
  const p = open;
  if (!p || p.issueId !== i.id || p.starting || !p.repo || !p.branch.trim() || !p.prompt.trim()) return;
  p.starting = true;
  ctx.render();
  try {
    const r = await api.startInPeriscope(i.id, { repo: p.repo, branch: p.branch.trim(), prompt: p.prompt });
    if (open === p) closePeriscope();
    const pid = r.pid;
    ctx.toast(r.mode === "existing" ? `${i.identifier} is already open in periscope` : `Started ${i.identifier} in periscope`,
      pid ? { label: "Show", run: () => void showPane(pid) } : undefined);
  } catch (e) {
    p.starting = false;
    if (open === p) ctx.render();
    ctx.fail(e);
  }
}

async function showPane(pid: string) {
  try {
    await api.showInPeriscope(pid);
  } catch (e) {
    ctx.fail(e);
  }
}

/** The popover under the pane's ⋯, when it is open for ``i``. */
export function periscopePopover(i: Issue): HTMLElement | "" {
  const p = open;
  if (!p || p.issueId !== i.id) return "";
  const label = `Start ${i.identifier} in periscope`;
  const o = p.options;
  if (!o) {
    return h("div", { class: "pp-pop", role: "dialog", "aria-label": label },
      h("div", { class: "pp-title" }, label), h("p", { class: "pp-wait" }, "Asking periscope…"));
  }
  const repo = h("select", {
    class: "pp-input pp-repo", "aria-label": "Repo", disabled: p.starting,
    onchange: (e: Event) => { p.repo = (e.target as HTMLSelectElement).value; ctx.render(); },
  },
    !p.repo && h("option", { value: "", selected: true, disabled: true }, "Pick a repo"),
    ...o.repos.map((r) => h("option", { value: r.repo, selected: r.repo === p.repo }, r.label)));
  const branch = h("input", {
    type: "text", class: "pp-input mono", value: p.branch, "aria-label": "Branch", "data-edit": "periscope-branch",
    disabled: p.starting, oninput: (e: Event) => { p.branch = (e.target as HTMLInputElement).value; },
  });
  const prompt = h("textarea", {
    class: "pp-input", rows: 4, value: p.prompt, "aria-label": "Prompt", "data-edit": "periscope-prompt",
    disabled: p.starting, oninput: (e: Event) => { p.prompt = (e.target as HTMLTextAreaElement).value; },
  });
  const repoHint = p.repo && p.repo === o.repo ? o.hint : "";
  const branchHint = o.branch_worktrees.includes(p.repo) && p.branch.trim() === o.branch
    ? "A worktree is already on this branch."
    : "From Linear. A new worktree, or the one already on this branch.";
  return h("div", {
    class: "pp-pop", role: "dialog", "aria-label": label,
    onkeydown: (e: KeyboardEvent) => {
      // The page's keys (m, d, ⌘↵ …) must not act on the issue behind the popover.
      e.stopPropagation();
      if (e.key === "Escape") { closePeriscope(); return; }
      if (e.key !== "Enter" || e.isComposing) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "BUTTON" || (tag === "TEXTAREA" && !e.metaKey && !e.ctrlKey)) return;
      e.preventDefault();
      void start(i);
    },
  },
    h("div", { class: "pp-title" }, label),
    h("label", { class: "pp-field" }, h("span", {}, "Repo"), repo),
    repoHint ? h("p", { class: "pp-hint" }, repoHint) : "",
    h("label", { class: "pp-field" }, h("span", {}, "Branch"), branch),
    h("p", { class: "pp-hint" }, branchHint),
    h("label", { class: "pp-field top" }, h("span", {}, "Prompt"), prompt),
    h("div", { class: "pp-acts" },
      h("button", { type: "button", class: "td-btn", onclick: () => closePeriscope() }, "Cancel", h("kbd", {}, "esc")),
      h("button", { type: "button", class: "td-btn primary pp-start", disabled: !p.repo || p.starting,
        onclick: () => void start(i) }, p.starting ? "Starting…" : "Start", h("kbd", {}, "↵"))));
}
```

Notes for the implementer:
- `h()` skips `false` props and children, and sets `value`, `selected` and `disabled` as properties.
- `data-edit` on the branch and prompt fields makes `rebuildKeepingPane` give them back the cursor after the app's periodic re-render. Do not put `data-edit` on the `select`: `restorePane` calls `setSelectionRange`, which a `select` does not have.

- [ ] **Step 2: Styles.** Append to `app/src/styles.css`:

```css
/* Start in periscope: the popover under the reading pane's ⋯ (Popover shadow, 12px corners). */
.pp-anchor { position: relative; display: inline-flex; align-items: center; gap: 6px; }
.pp-pop {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 6; width: 440px; max-width: calc(100vw - 48px);
  box-sizing: border-box; background: var(--surface); color: var(--ink); border: 1px solid var(--border);
  border-radius: 12px; box-shadow: 0 14px 34px rgba(0, 0, 0, .18); padding: 14px 16px;
  display: flex; flex-direction: column; gap: 8px; font-size: 13px; text-align: left; cursor: default;
}
.pp-title { font-size: 15px; font-weight: 600; margin-bottom: 2px; }
.pp-wait { margin: 0; color: var(--muted); }
.pp-field { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 8px; align-items: center; }
.pp-field.top { align-items: start; }
.pp-field > span { font-size: 12px; color: var(--muted); }
.pp-field.top > span { padding-top: 6px; }
.pp-input { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px;
  background: var(--surface); color: var(--ink); font: inherit; font-size: 13px; }
.pp-input:focus { outline: none; border-color: var(--accent); }
.pp-input.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
textarea.pp-input { resize: vertical; line-height: 1.5; }
.pp-hint { margin: -4px 0 2px 64px; font-size: 12px; color: var(--muted); }
.pp-acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
```

- [ ] **Step 3: Type-check**

Run: `cd app && npx tsc --noEmit`
Expected: no errors. (`periscope.ts` is not imported yet, but `tsc` checks every file under `src`.)

- [ ] **Step 4: Commit**

```bash
git add app/src/periscope.ts app/src/styles.css
# run the privacy scan (Conventions); expect "clean"
git commit -m "App: the Start in periscope popover

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wire it into the panes and the keys

**Files:**
- Modify: `app/src/pane.ts` (`PANE_KEYS` and its comment, near line 478)
- Modify: `app/src/main.ts` (imports; `stageBody`; `issuePane`; `setupPane` call; `SHORTCUTS`; the `pointerdown` handler; the `keydown` handler)

- [ ] **Step 1: `p` in `app/src/pane.ts`.** Change

```ts
/** e, ⇧E, ⇧S and ⇧C in Today, Client and Dev: rename, edit the description, add a sub-issue, comment. */
const PANE_KEYS: Record<string, string> = { e: "title", E: "description", S: "sub", C: "comment" };
```

to

```ts
/** e, ⇧E, ⇧S, ⇧C and p in Today, Client and Dev: rename, edit the description, add a sub-issue,
 *  comment, start in periscope. */
const PANE_KEYS: Record<string, string> = { e: "title", E: "description", S: "sub", C: "comment", p: "periscope" };
```

- [ ] **Step 2: Import in `app/src/main.ts`.** After the `import { detailBody, … } from "./pane";` line, add:

```ts
import { closePeriscope, dismissPeriscope, isPeriscopeOpen, periscopeItem, periscopePopover, setupPeriscope } from "./periscope";
```

- [ ] **Step 3: Today's pane (`stageBody`).** Change

```ts
    h("div", { class: "menu" },
      onToday ? h("button", { type: "button", onclick: () => void toggleToday(i.id) }, "Remove from Today") : "",
```

to

```ts
    h("div", { class: "menu" },
      periscopeItem(i),
      onToday ? h("button", { type: "button", onclick: () => void toggleToday(i.id) }, "Remove from Today") : "",
```

and change

```ts
    h("div", { class: "tl-fields" }, ...issueFields(i), h("span", { class: "tl-actions" }, more)),
```

to

```ts
    h("div", { class: "tl-fields" }, ...issueFields(i),
      h("span", { class: "tl-actions" }, h("span", { class: "pp-anchor" }, more, periscopePopover(i)))),
```

- [ ] **Step 4: Client and Dev pane (`issuePane`).** Change

```ts
      link("Open in Linear ↗", i.url, "menu-link"),
```

to

```ts
      link("Open in Linear ↗", i.url, "menu-link"),
      periscopeItem(i),
```

and change

```ts
          onclick: () => void toggleToday(i.id) }, "☆ Add to Today"),
        more)),
```

to

```ts
          onclick: () => void toggleToday(i.id) }, "☆ Add to Today"),
        h("span", { class: "pp-anchor" }, more, periscopePopover(i)))),
```

- [ ] **Step 5: Setup.** After the `setupPane({ … });` line, add:

```ts
setupPeriscope({ render, toast: (m, a) => void toast(m, a), fail });
```

- [ ] **Step 6: The shortcuts sheet.** In `SHORTCUTS`, after the `["⇧E · ⇧S · ⇧C", …]` entry, add:

```ts
  ["p", "Today, Client, Dev: start the issue in periscope (a worktree, Claude and a prompt)"],
```

- [ ] **Step 7: Outside click.** In the `document.addEventListener("pointerdown", …)` handler, after `pointerIsDown = true;`, add:

```ts
  dismissPeriscope(e.target as Element);
```

- [ ] **Step 8: Esc.** In the `document.addEventListener("keydown", …)` handler, change

```ts
  if (e.key === "Escape" && state.balanceOpen) { state.balanceOpen = false; render(); return; }
```

to

```ts
  if (e.key === "Escape" && state.balanceOpen) { state.balanceOpen = false; render(); return; }
  if (e.key === "Escape" && isPeriscopeOpen()) { closePeriscope(); return; }
```

(Keys typed inside the popover never reach this handler: the popover stops them. This line covers Esc while the focus is elsewhere, for example during "Asking periscope…".)

- [ ] **Step 9: Build**

Run: `cd app && npm run build`
Expected: `tsc` reports no errors and Vite writes `dist/`.

- [ ] **Step 10: Commit**

```bash
git add app/src/pane.ts app/src/main.ts
# run the privacy scan (Conventions); expect "clean"
git commit -m "App: Start in periscope in the ⋯ menu of Today, Client and Dev, and the p key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Settings page's Periscope section

**Files:**
- Modify: `app/src/settings.ts` (the `sections` list in `settingsView`; `sectionIcon`; a new section function)
- Modify: `app/src/styles.css` (append)

- [ ] **Step 1: Add the section.** In `settingsView`, change

```ts
    ["schedule", "Schedule", () => scheduleSection(data!.schedule, ctx)],
  ];
```

to

```ts
    ["schedule", "Schedule", () => scheduleSection(data!.schedule, ctx)],
    ["periscope", "Periscope", () => periscopeSection(ctx)],
  ];
```

In `sectionIcon`, change

```ts
  return h("span", { class: "set-ico", "aria-hidden": "true" }, id === "sources" ? "⇄" : "◷");
```

to

```ts
  return h("span", { class: "set-ico", "aria-hidden": "true" }, id === "sources" ? "⇄" : id === "periscope" ? "↗" : "◷");
```

At the end of the file, add:

```ts
// ---- periscope ----------------------------------------------------------------------------------
function periscopeSection(ctx: SettingsCtx): HTMLElement {
  const p = data!.periscope;
  const box = h("textarea", { class: "set-input set-prompt", rows: 4, value: p.prompt, "aria-label": "Prompt" });
  const saveBtn = h("button", {
    type: "button", class: "ghost small-btn", disabled: busy === "periscope",
    onclick: () => void save("periscope", ctx, () => api.setPeriscopePrompt(box.value), "Prompt saved"),
  }, busy === "periscope" ? "Saving…" : "Save");
  const reset = p.prompt !== p.default_prompt ? h("button", {
    type: "button", class: "link-btn small",
    onclick: () => void save("periscope", ctx, () => api.setPeriscopePrompt(""), "Prompt back to the default"),
  }, "Reset to default") : "";
  return card("periscope", "Periscope",
    "Start in periscope (⋯ or p on an issue) sends this prompt to the new Claude. {identifier}, {title} and {url} become the issue's.",
    "", box, h("div", { class: "set-row-inline" }, saveBtn, reset));
}
```

- [ ] **Step 2: Style.** Append to `app/src/styles.css`:

```css
.set-prompt { display: block; width: 100%; max-width: 640px; box-sizing: border-box; resize: vertical; font: inherit; line-height: 1.5; }
```

- [ ] **Step 3: Build**

Run: `cd app && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/settings.ts app/src/styles.css
# run the privacy scan (Conventions); expect "clean"
git commit -m "App, Settings: the prompt that Start in periscope sends

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Docs

**Files:**
- Modify: `README.md` (a new group before `## Safety model`; the Settings table)
- Modify: `docs/superpowers/specs/2026-11-15-start-in-periscope-design.md`

- [ ] **Step 1: README, the feature.** Before the line `## Safety model`, add:

```markdown
**Start in periscope**
- In Today, Client and Dev, an issue's **⋯** menu has **Start in periscope** (**p**). It opens a popover with three fields, all filled in:
  - **Repo** lists periscope's repos. It selects the repo you last used for the issue's Linear project (or its client, when it has no project), else the last repo you used.
  - **Branch** is Linear's branch name for the issue.
  - **Prompt** comes from the template on the Settings page. `{identifier}`, `{title}` and `{url}` become the issue's.
- **Start** (↵, or ⌘↵ in the prompt) asks periscope to make the worktree (or use the one on that branch), start Claude Code in it and send the prompt. The new card shows the issue. If a Claude is already on that branch, periscope starts nothing.
- The toast's **Show** brings periscope to the front with that Claude selected.
- Periscope must be running. Its address is `app.periscope_url` in config.toml.

```

- [ ] **Step 2: README, the Settings table.** After the `sweep.snitch_url` row, add:

```markdown
| `app.periscope_url` | `http://127.0.0.1:17374` | Where periscope listens, for Start in periscope |
```

In the `settings.json` row, change "sources added, paused or removed; the schedule; the Daylight place." to "sources added, paused or removed; the schedule; the Daylight place; the periscope prompt."

- [ ] **Step 3: Spec.** Make the spec match the code:
  - In "Changes" → `periscope.py`, replace the three bullets `catalog(settings, transport=None)…`, `start(settings, …)…` and `select(settings, pid, transport=None)…` with one bullet: "`Periscope(url, transport=None)`, shaped like `Linear`: `catalog()`, `start(...)` and `select(pid)`. The timeout is 120 s, because a start runs `git fetch` and makes the worktree (up to about 90 s on a large repo), then waits about 10 s for Claude's screen. A timeout gives "Periscope didn't answer in 120 s.""
  - In "Changes" → `api.py`, change `worktree_exists` to `branch_worktrees` (the repos with a worktree already on the branch; the popover shows the hint when the selected repo is one of them).
  - In "Tests", change "`worktree_exists`" to "`branch_worktrees`".
  - In "Changes", replace the `app/src/main.ts` bullet list with: "**New `app/src/periscope.ts`**: the menu item, the popover, Start and Show, set up from `main.ts` like `pane.ts`. **`app/src/main.ts`**: the menu item in `issuePane` and `stageBody`, the setup, outside click, Esc and the shortcuts sheet. **`app/src/pane.ts`**: `p` in `PANE_KEYS`."
  - In the Errors table, add a row: "Periscope does not answer within 120 s | "Periscope didn't answer in 120 s.""

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-11-15-start-in-periscope-design.md
# run the privacy scan (Conventions); expect "clean"
git commit -m "README: Start in periscope and app.periscope_url; the spec matches the code

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Check it all

- [ ] **Step 1: Tests and build**

Run: `cd backend && uv run pytest -q && cd ../app && npm run build`
Expected: all tests pass; the build has no errors.

- [ ] **Step 2: Check the UI against a stub periscope** (no real periscope needed). In one shell, start a stub that answers like periscope on port 17376:

```bash
python3 - <<'EOF'
import json, time
from http.server import BaseHTTPRequestHandler, HTTPServer
CAT = {"repos": [{"repo": "/dev/api", "label": "api", "default_branch": "main", "branches": []}], "worktrees": [], "roots": []}
class H(BaseHTTPRequestHandler):
    def _send(self, code, body):
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps(body).encode())
    def do_GET(self):
        self._send(200, CAT)
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        print(self.path, body, flush=True)
        if self.path == "/api/linear/start":
            time.sleep(2)
            return self._send(200, {"mode": "spawned", "pid": "stub", "path": "/tmp/x", "reused": False})
        self._send(200, {"ok": True})
HTTPServer(("127.0.0.1", 17376), H).serve_forever()
EOF
```

Ask the user before the next part: it edits their real `config.toml`. Add `periscope_url = "http://127.0.0.1:17376"` under `[app]` in `~/Library/Application Support/TodoHub/config.toml`, start the app from the worktree (`cd app && npm run tauri dev`, see README "4. The app"), then check:

1. Client: select an issue, open **⋯**: **Start in periscope `p`** is under **Open in Linear ↗**.
2. Press **p**: the popover shows "Asking periscope…", then Repo `api`, the Linear branch and the prompt from the template. The focus is on **Start** when a repo is selected.
3. Press **Esc**: the popover closes. Press **p**, then click outside: it closes.
4. Press **p**, then **↵**: **Start** shows "Starting…" for about 2 s; then the toast "Started ENG-… in periscope" with **Show**. The stub prints the `/api/linear/start` body with the issue's ticket and title.
5. Click **Show**: the stub prints `/api/select {'pid': 'stub'}`. (`open -b` brings the real Periscope app forward if it runs.)
6. Today: the same item is first in **⋯**, and **p** works. With the focus on **Start**, press **m**: the issue does not move.
7. Stop the stub, press **p**: the error toast says "Periscope is not running at 127.0.0.1:17376."
8. Settings → Periscope: change the prompt, **Save**, reopen the popover: it uses the new text. **Reset to default** restores it.

Then remove the `periscope_url` line from `config.toml`.

- [ ] **Step 3: End to end.** After periscope's branch is released (or with its dev server, per that plan's Task 6, and `periscope_url = "http://127.0.0.1:17375"`), start a real issue once and check that the card in periscope shows the issue and that **Show** selects it.
