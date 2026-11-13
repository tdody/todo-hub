# Connector Outage Error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a sweep can't load the claude.ai connectors because Anthropic's connector service is failing, each affected source says so, with the HTTP status and Anthropic's incident title.

**Architecture:** Each Claude run also writes Claude Code's connector-fetch debug lines (`--debug=claudeai-mcp --debug-file …`). A new `outage.py` reads those lines (`connector_failure`), looks up the newest open Claude Code incident on status.claude.com (`claude_code_incident`), and builds the message (`detail`). `run_sweep` rewrites the detail of each failed connector source with it, so the sidebar, the Inbox's problems banner and the Mac notification show it. The notification waits until the sweep has finished, so it shows the final message.

**Tech Stack:** Python 3 (FastAPI backend, but this is plain module code), httpx, pytest, uv.

**Spec:** `docs/superpowers/specs/2026-11-13-connector-outage-design.md`

**Rules for this repo:**
- Run backend tests from `backend/`: `uv run pytest -q`.
- Tests use fictional names only (Globex, Initech & Co, Hooli, `ENG-123`, `example.slack.com`). No employer or client names anywhere.
- Before each commit, run the privacy scan you were given (`python3 -I <privacy_scan.py>` from the repo root, on the staged files). It must print `client names: 0 | private words: 0`.
- End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Checked before writing this plan (2026-11-13):**
- `claude -p … --output-format json --debug=claudeai-mcp --debug-file X` still prints one JSON object on stdout, nothing on stderr, and writes only `[claudeai-mcp]` lines to X (`Fetching from …`, then `Fetched 14 servers`).
- During this morning's outage the lines were `Transient fetch error (503), retrying in 500ms (attempt 1/3)` and so on. Claude Code's other templates (from its binary): `Fetch failed (${status}) after ${n} attempt(s)` and `Connector-list fetch failed transiently; background retry ${i}/${n} in ${ms}ms`.

---

## File structure

- **Create `backend/src/todohub/outage.py`**: reading the connector-fetch lines, the status-page lookup, the message. No sweep or database code.
- **Create `backend/tests/test_outage.py`**: unit tests for those three functions.
- **Modify `backend/src/todohub/sweep.py`**: `_invoke_claude` (debug flags, log section, `connector_failure`), `run_sweep` (rewrite the failed connector sources), imports.
- **Modify `backend/tests/test_sweep.py`**: the fake `claude` copies a prepared debug file to `--debug-file`; one new end-to-end test.
- **Modify `app/src/main.ts`** (added in review): `sourceAlerts` waits until the sweep has finished and drops a trailing period from the detail.
- **Modify `README.md`**: one paragraph after the `--restricted` note.

---

### Task 1: `outage.py`

> **Changed in review** (commit 1d874a6): `fetch_failure` is `connector_failure` and treats a 4xx as no outage and `unknown` as no status; `open_incident` is `claude_code_incident` and picks the newest matching incident by `created_at`; `message` is `detail`. The code below is the first version; the committed module and its 18 tests are the reference.

**Files:**
- Create: `backend/src/todohub/outage.py`
- Test: `backend/tests/test_outage.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_outage.py`:

```python
import httpx
import pytest

from todohub import outage

# Claude Code's --debug=claudeai-mcp lines. The first three are from the 2026-11-13 outage; the last
# two follow Claude Code's message templates for giving up.
FETCHING = ("2026-11-13T13:49:14.868Z [DEBUG] [claudeai-mcp] Fetching from "
            "https://api.anthropic.com/v1/mcp_servers?limit=1000&include_additional_installs=true")
OUTAGE = [
    FETCHING,
    "2026-11-13T13:49:16.587Z [DEBUG] [claudeai-mcp] Transient fetch error (503), retrying in 500ms (attempt 1/3)",
    "2026-11-13T13:49:17.582Z [DEBUG] [claudeai-mcp] Transient fetch error (503), retrying in 1500ms (attempt 2/3)",
    "2026-11-13T13:49:19.301Z [DEBUG] [claudeai-mcp] Fetch failed (503) after 3 attempt(s)",
    "2026-11-13T13:49:19.302Z [DEBUG] [claudeai-mcp] Connector-list fetch failed transiently; background retry 1/3 in 4000ms",
]
FETCHED = "2026-11-13T14:41:46.119Z [DEBUG] [claudeai-mcp] Fetched 14 servers"


@pytest.mark.parametrize("lines, expected", [
    (OUTAGE, "HTTP 503"),                    # the last line has no status: the latest one counts
    ([FETCHING, FETCHED], None),             # a healthy start
    ([*OUTAGE, FETCHED], None),              # a background retry that worked
    ([FETCHING, "2026-11-13T13:49:19.301Z [DEBUG] [claudeai-mcp] Fetch failed (ECONNRESET) after 3 attempt(s)"],
     "ECONNRESET"),
    ([FETCHING, OUTAGE[-1]], ""),            # failed, with no status anywhere
    ([FETCHING, "2026-11-13T13:49:19.301Z [DEBUG] [claudeai-mcp] Something new"], None),  # wording it doesn't know
    ([], None),                              # no debug file
])
def test_fetch_failure(lines, expected):
    assert outage.fetch_failure(lines) == expected


# status.claude.com's summary.json during the outage, trimmed to what open_incident reads. The Microsoft
# 365 one comes first and doesn't list Claude Code, so it must be skipped.
SUMMARY = {"incidents": [
    {"name": "Elevated errors affecting the Microsoft 365 connector", "status": "identified",
     "components": [{"name": "claude.ai"}, {"name": "Claude Cowork"}]},
    {"name": "Elevated errors on claude.ai, the Claude API, and Claude Code", "status": "investigating",
     "components": [{"name": "claude.ai"}, {"name": "Claude API (api.anthropic.com)"}, {"name": "Claude Code"},
                    {"name": "Claude Cowork"}]},
]}


def fake_get(body=None, status=200, error=None):
    def get(url, timeout):
        assert url == outage.STATUS_URL and timeout == 5
        if error:
            raise error
        return httpx.Response(status, json=body, request=httpx.Request("GET", url))
    return get


def test_open_incident_names_the_one_listing_claude_code():
    assert outage.open_incident(fake_get(SUMMARY)) == "Elevated errors on claude.ai, the Claude API, and Claude Code"


@pytest.mark.parametrize("get", [
    fake_get({"incidents": []}),
    fake_get({}, status=503),
    fake_get(error=httpx.ConnectTimeout("slow")),
    fake_get(["not", "a", "summary"]),
])
def test_open_incident_is_none_without_one(get):
    assert outage.open_incident(get) is None


def test_message():
    assert outage.message("HTTP 503", None) == \
        "Anthropic's connector service didn't respond (HTTP 503), so it wasn't read."
    assert outage.message("", "Elevated errors on Claude Code") == (
        "Anthropic's connector service didn't respond, so it wasn't read. "
        'Anthropic reports "Elevated errors on Claude Code" (status.claude.com).')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `uv run pytest -q tests/test_outage.py`
Expected: collection error, `ImportError: cannot import name 'outage' from 'todohub'`.

- [ ] **Step 3: Write `outage.py`**

Create `backend/src/todohub/outage.py`:

```python
"""When a sweep couldn't load the claude.ai connectors: how Claude Code's connector fetch ended, and
whether Anthropic has posted an incident about it.

The fetch's lines come from ``claude --debug=claudeai-mcp --debug-file …``. Their wording is Claude
Code's, not a contract: when it changes, ``fetch_failure`` finds nothing and the sources keep the
sweep's own message."""

from __future__ import annotations

import logging
import re
from typing import Callable

import httpx

log = logging.getLogger("todohub.outage")

STATUS_PAGE = "status.claude.com"
STATUS_URL = f"https://{STATUS_PAGE}/api/v2/summary.json"
# "Transient fetch error (503)", "Fetch failed (503) after 3 attempt(s)", "fetch failed transiently"
FETCH_FAILED = re.compile(r"fetch (?:failed|error)(?: \(([^)]*)\))?", re.IGNORECASE)


def fetch_failure(lines: list[str]) -> str | None:
    """How the connector fetch ended: None when it worked or no line says, else its last status since
    the last success ("HTTP 503", "ECONNRESET", or "" when no line gave one)."""
    failure: str | None = None
    for line in lines:
        if "[claudeai-mcp]" not in line:
            continue
        if "] Fetched " in line:
            failure = None
        elif found := FETCH_FAILED.search(line):
            value = found.group(1)
            if value:
                failure = f"HTTP {value}" if re.fullmatch(r"\d{3}", value) else value
            elif failure is None:
                failure = ""
    return failure


def open_incident(get: Callable[..., httpx.Response] = httpx.get) -> str | None:
    """The name of the first unresolved incident on Anthropic's status page that lists Claude Code."""
    try:
        resp = get(STATUS_URL, timeout=5)
        resp.raise_for_status()
        incidents = resp.json().get("incidents") or []
        return next((i["name"] for i in incidents
                     if any(c.get("name") == "Claude Code" for c in i.get("components") or [])), None)
    except Exception as exc:    # the incident line is optional: never fail a sweep over it
        log.warning("Couldn't read Anthropic's status page: %s", exc)
        return None


def message(failure: str, incident: str | None) -> str:
    """A connector source's status after a sweep whose connector fetch failed."""
    text = f"Anthropic's connector service didn't respond{f' ({failure})' if failure else ''}, so it wasn't read."
    return f'{text} Anthropic reports "{incident}" ({STATUS_PAGE}).' if incident else text
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `backend/`): `uv run pytest -q tests/test_outage.py`
Expected: `13 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/outage.py backend/tests/test_outage.py
python3 -I <privacy_scan.py>
git commit -F - <<'EOF'
Outage: read Claude Code's connector-fetch lines and Anthropic's status page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Sweeps record the connector fetch and rewrite the failed connector sources

> **Changed in review** (commit 8f504fe and the final review): `from . import connectors` with `connectors.BUILTIN.values()` inline instead of a `CONNECTOR_SOURCES` constant; the names `debug_path`, `fetch_lines` and `detail`; the status page is read only when a connector source failed (with a test for it); `sourceAlerts` in `app/src/main.ts` returns while a sweep runs and drops a trailing period. The code below is the first version; the committed code is the reference.

**Files:**
- Modify: `backend/src/todohub/sweep.py` (imports near line 29, `_invoke_claude` at lines 427-463, `run_sweep` after line 531)
- Test: `backend/tests/test_sweep.py` (`FAKE_CLAUDE` at lines 15-36, one new test at the end)

- [ ] **Step 1: Let the fake `claude` write a prepared debug file**

In `backend/tests/test_sweep.py`, in `FAKE_CLAUDE`, after the line
`    open(os.path.join(os.environ["TODOHUB_HOME"], "argv.json"), "w").write(json.dumps(args))`
add:

```python
    debug = os.path.join(os.environ["TODOHUB_HOME"], "claudeai-debug.txt")
    if "--debug-file" in args and os.path.exists(debug):
        open(args[args.index("--debug-file") + 1], "w").write(open(debug).read())
```

(The fake is a `.format` template; these lines have no braces, so nothing needs doubling.)

- [ ] **Step 2: Write the failing test**

Append to `backend/tests/test_sweep.py`:

```python
def test_connector_outage_rewrites_the_failed_connector_sources(settings, monkeypatch):
    settings.home.mkdir(parents=True, exist_ok=True)
    (settings.home / "claudeai-debug.txt").write_text(
        "2026-11-13T13:00:20.101Z [DEBUG] [claudeai-mcp] Fetching from https://api.anthropic.com/v1/mcp_servers\n"
        "2026-11-13T13:00:21.587Z [DEBUG] [claudeai-mcp] Transient fetch error (503), retrying in 500ms (attempt 1/3)\n"
        "2026-11-13T13:00:24.302Z [DEBUG] [claudeai-mcp] Connector-list fetch failed transiently; "
        "background retry 1/3 in 4000ms\n")
    monkeypatch.setattr(sweep.outage, "claude_code_incident", lambda: "Elevated errors on Claude Code")
    run = sweep.run_sweep(settings, "schedule")
    by_source = {s["source"]: s for s in run["sources"]}
    down = ("Anthropic's connector service didn't respond (HTTP 503), so it wasn't read. "
            'Anthropic reports "Elevated errors on Claude Code" (status.claude.com).')
    # The fake reports only Slack; the other connector sources are unreported, so failed.
    assert {s for s, v in by_source.items() if v["detail"] == down} == {"gmail", "grain", "calendar", "hubspot"}
    assert by_source["slack"]["detail"] == "3 searches"           # it worked: untouched
    assert "Can't find gh" in by_source["github"]["detail"]       # not a connector: untouched
    assert by_source["linear"]["ok"]
    log = open(run["log_path"]).read()
    assert "--- claude.ai connectors ---\n" in log and "Transient fetch error (503)" in log
    assert not list(settings.sweep_dir.glob("claudeai-*.log"))    # the debug file is cleaned up
```

- [ ] **Step 3: Run it to verify it fails**

Run (from `backend/`): `uv run pytest -q tests/test_sweep.py -k connector_outage`
Expected: FAIL with `AttributeError: module 'todohub.sweep' has no attribute 'outage'`.

- [ ] **Step 4: Import `outage` and the connector sources in `sweep.py`**

In `backend/src/todohub/sweep.py`, replace

```python
from . import handled, mutes, note, plan, sources, wrapup
```

with

```python
from . import handled, mutes, note, outage, plan, sources, wrapup
from .connectors import BUILTIN as CONNECTOR_NAMES
```

and below the `log = logging.getLogger("todohub.sweep")` line add:

```python
CONNECTOR_SOURCES = set(CONNECTOR_NAMES.values())     # the sources a sweep reads through claude.ai connectors
```

(`connectors.py` imports only `.config` at module level, and imports from `.sweep` inside its functions, so this adds no import cycle.)

- [ ] **Step 5: Record the connector fetch in `_invoke_claude`**

Replace the whole `_invoke_claude` function (lines 427-463) with:

```python
def _invoke_claude(settings: Settings, run_id: int, prompt: str, log_path: Path, header: str) -> dict:
    """Run headless Claude Code once with the read-only allowlist. Never raises. ``connector_failure``
    is how its claude.ai connector fetch ended (``outage.connector_failure``)."""
    mcp_path = settings.sweep_dir / f"mcp-{run_id}.json"
    mcp_path.write_text(json.dumps(mcp_config(settings, run_id), indent=2))
    fetch_path = settings.sweep_dir / f"claudeai-{run_id}.log"
    out: dict = {"status": "error", "cost": None, "turns": None, "error": None, "result": {},
                 "connector_failure": None}
    try:
        proc = subprocess.run(
            [*claude_command(settings, prompt, mcp_path), "--debug=claudeai-mcp", "--debug-file", str(fetch_path)],
            cwd=settings.sweep_dir, env=_env(), capture_output=True, text=True, timeout=settings.timeout_minutes * 60,
        )
        fetch = fetch_path.read_text(errors="replace").splitlines() if fetch_path.exists() else []
        out["connector_failure"] = outage.connector_failure(fetch)
        log_path.write_text(
            f"$ claude -p <prompt> ({header})\n\n"
            f"--- prompt ---\n{prompt}\n\n--- stdout ---\n{proc.stdout}\n\n--- stderr ---\n{proc.stderr}\n"
            "\n--- claude.ai connectors ---\n" + "".join(f"{line}\n" for line in fetch)
        )
        try:
            result = json.loads(proc.stdout)
        except json.JSONDecodeError:
            out["error"] = f"Claude Code exited {proc.returncode} without JSON output: {proc.stderr.strip()[:500]}"
            return out
        out["result"] = result
        out["cost"], out["turns"] = result.get("total_cost_usd"), result.get("num_turns")
        denied = result.get("permission_denials") or []
        if proc.returncode == 0 and not result.get("is_error"):
            out["status"] = "ok"
            if denied:
                names = sorted({d.get("tool_name", "?") for d in denied})
                out["error"] = "Tools denied (add read-only ones to config.toml): " + ", ".join(names)
        else:
            out["error"] = (f"Claude Code ended with {result.get('subtype', 'an error')}: "
                            f"{str(result.get('result', ''))[:500]}")
    except FileNotFoundError:
        out["error"] = f"Can't find Claude Code at {settings.claude_path!r}. Set sweep.claude_path in config.toml."
    except subprocess.TimeoutExpired:
        out["error"] = f"Timed out after {settings.timeout_minutes} minutes."
    finally:
        mcp_path.unlink(missing_ok=True)
        fetch_path.unlink(missing_ok=True)
    return out
```

- [ ] **Step 6: Rewrite the failed connector sources in `run_sweep`**

In `run_sweep`, right after

```python
        reported = {s["source"] for s in (db.get_run(run_id, with_sources=True) or {}).get("sources", [])}
        for source in settings.enabled_sources():
            if source not in reported:
                db.report_source_status(run_id, source, False, "Not reported by the sweep.", None)
```

add:

```python
        if out["connector_failure"] is not None:
            # Claude Code couldn't load the claude.ai connectors: say so instead of Claude's guess.
            down = outage.detail(out["connector_failure"], outage.claude_code_incident())
            for s in (db.get_run(run_id, with_sources=True) or {}).get("sources", []):
                if not s["ok"] and s["source"] in CONNECTOR_SOURCES:
                    db.report_source_status(run_id, s["source"], False, down, s["items_scanned"])
```

- [ ] **Step 7: Run the sweep tests**

Run (from `backend/`): `uv run pytest -q tests/test_sweep.py`
Expected: all pass, including `test_connector_outage_rewrites_the_failed_connector_sources`. (Calendar is in the failed set because on a fresh database `meeting_prep_due` is true, so the sweep doesn't pre-report "Meeting prep already done today", and the fake never reports Calendar.)

- [ ] **Step 8: Run the whole backend suite**

Run (from `backend/`): `uv run pytest -q`
Expected: all pass (215 after Task 1 + 1 = 216).

- [ ] **Step 9: Commit**

```bash
git add backend/src/todohub/sweep.py backend/tests/test_sweep.py
python3 -I <privacy_scan.py>
git commit -F - <<'EOF'
Sweep: when Claude Code can't load the claude.ai connectors, the failed connector sources say so

Each run writes Claude Code's connector-fetch lines to the end of its log. When the fetch failed,
Slack, Gmail, Grain, Calendar and HubSpot sources that failed show the HTTP status and Anthropic's
open Claude Code incident instead of Claude's "tools not available".

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: README

**Files:**
- Modify: `README.md:112`

- [ ] **Step 1: Add the paragraph**

In `README.md`, after the paragraph that starts `If \`--restricted\` turns out to hide your claude.ai connectors`, add a blank line and:

```markdown
When Anthropic's connector service is down, the connector sources a sweep couldn't read (Slack, Gmail, Grain, HubSpot, and Calendar when it was due for meeting prep) each say "Anthropic's connector service didn't respond (HTTP 503), so it wasn't read", followed by Anthropic's incident title when status.claude.com has one. Nothing is lost: the next sweep reads each of them from its last success. The end of each sweep log (`logs/sweep-*.log`, section `--- claude.ai connectors ---`) shows how the connector fetch went.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
python3 -I <privacy_scan.py>
git commit -F - <<'EOF'
README: what a connector outage looks like

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Check against a real Claude Code run

No commit; this confirms the flags against the installed Claude Code, which the tests fake.

- [ ] **Step 1: Run one real one-source sweep**

From `backend/`: `uv run todohub-sweep --source slack` (or press ↻ next to Slack in the app).
Expected: the run finishes `ok`; Slack reports normally (the service is up).

- [ ] **Step 2: Read the end of its log**

```bash
tail -5 "$(ls -t "$HOME/Library/Application Support/TodoHub/logs"/sweep-*.log | head -1)"
```

Expected: `--- claude.ai connectors ---` followed by `… [claudeai-mcp] Fetching from …` and `… [claudeai-mcp] Fetched N servers`, and no `claudeai-*.log` left in `~/Library/Application Support/TodoHub/sweep/`.
