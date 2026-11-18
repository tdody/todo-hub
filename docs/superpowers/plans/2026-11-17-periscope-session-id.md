# Record the Claude session on the Linear issue: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When **Start in periscope** starts a new Claude, the Linear issue gets a comment with the start time, the Claude account email and the Claude session ID.

**Architecture:** Periscope chooses the session ID: each spawn starts `claude --session-id <uuid4>`. `POST /api/linear/start` sends back `session_id` and the account's `email`. todo-hub's start route writes the comment with `Linear.create_comment`, and reports a failed comment as a warning. Periscope's resurrect reads a captured `--session-id` as `--resume`, because Claude refuses a `--session-id` that is already in use.

**Tech Stack:** periscope: Python 3, FastAPI, pytest with pytest-mock, `uv`, `bin/check` (ruff, ty, biome). todo-hub: Python 3.11, FastAPI, pytest, `uv`; app: TypeScript, `tsc`.

**Spec:** `docs/superpowers/specs/2026-11-17-periscope-session-id-design.md`

> **After the reviews:** the review fixes changed some details after this plan was written. For example, the tests use account `"b"`, `account_email` logs a warning when it finds no email, and some test names, test data and wording are different. Where this plan and the code differ, the code is correct.

---

## File map

periscope (repo `~/github/tomplex/periscope`, one PR):

| File | Change |
|---|---|
| `periscope/config.py` | `build_agent_command` takes `session_id` and adds `--session-id`. |
| `periscope/channels.py` | `spawn_claude_with_prompt` makes a `uuid4` for each spawn. `Spawned` gets `session_id` and `account`. |
| `periscope/store.py` | New `account_email(account_id)`. |
| `periscope/routes/linear.py` | The "spawned" answer gets `session_id` and `email`. |
| `periscope/resurrect.py` | A captured `--session-id <uuid>` counts as `--resume <uuid>`. |
| `README.md`, `docs/tmux-persistence.md` | The 2 new answer fields; the resurrect rule. |
| `tests/test_config.py`, `tests/test_channels.py`, `tests/test_store.py`, `tests/routes/test_linear.py`, `tests/test_resurrect.py` | Tests. |

todo-hub (this repo, branch `periscope-session-id`, one PR):

| File | Change |
|---|---|
| `backend/src/todohub/api.py` | `periscope_start` writes the comment and returns `warnings`. |
| `backend/src/todohub/periscope.py` | `Periscope.start` docstring names the new fields. |
| `backend/tests/test_periscope.py` | A shared `FakeLinear`, and the comment tests. |
| `app/src/api.ts` | `PeriscopeStart.warnings`. |
| `app/src/periscope.ts` | Each warning shows as an error toast. |
| `README.md` | "Start in periscope" says what the comment holds. |

The 2 PRs can merge in any order.

---

## Part 1: periscope

### Task 1: Make a periscope worktree

**Files:** none

- [ ] **Step 1: Make the worktree from `origin/main`**

The main checkout `~/github/tomplex/periscope` is on a detached HEAD with local changes. Do not work there.

```bash
cd ~/github/tomplex/periscope
git fetch origin
git worktree add .claude/worktrees/linear-start-session-id -b thibaultdody/linear-start-session-id origin/main
cd .claude/worktrees/linear-start-session-id
uv sync --python 3.14
```

Expected: `Preparing worktree (new branch 'thibaultdody/linear-start-session-id')`, then `uv sync` ends with no error. Give `--python 3.14`: a plain `uv sync` can pick Python 3.15, and `rpds-py` does not build for it yet.

- [ ] **Step 2: Run the suite once, to know the starting state**

Run: `uv run pytest -q`
Expected: all tests pass (about 1,868). If some fail before any change, write them down and tell the user. Do not fix them in this PR.

All later periscope steps run in `~/github/tomplex/periscope/.claude/worktrees/linear-start-session-id`.

### Task 2: `build_agent_command` adds `--session-id`

**Files:**
- Modify: `periscope/config.py` (`build_agent_command`, about line 173)
- Test: `tests/test_config.py`

- [ ] **Step 1: Write the failing test**

Add to the end of `tests/test_config.py`:

```python
def test_build_agent_command_names_a_new_claude_session():
    sid = "3f2a9c1e-5b7d-4e2a-9f10-2c4d6e8a0b1c"
    assert config.build_agent_command("claude", cwd="/x", session_id=sid)[-2:] == ["--session-id", sid]
    assert "--session-id" not in config.build_agent_command("claude", cwd="/x")
    assert "--session-id" not in config.build_agent_command("codex", cwd="/x", session_id=sid)
```

- [ ] **Step 2: Run the test to see it fail**

Run: `uv run pytest -q tests/test_config.py::test_build_agent_command_names_a_new_claude_session`
Expected: FAIL with `TypeError: build_agent_command() got an unexpected keyword argument 'session_id'`

- [ ] **Step 3: Add the argument**

In `periscope/config.py`, replace the signature, docstring and claude branch of `build_agent_command`:

```python
def build_agent_command(
    agent: Literal["claude", "codex"],
    *,
    cwd: str,
    resume_id: str | None = None,
    effort: str | None = None,
    session_id: str | None = None,
) -> list[str]:
    """Build a typed agent argv. Shell serialization belongs at the tmux edge.
    `effort` is the pin value and `session_id` names a new Claude session; codex has no equivalent of either
    and ignores them."""
    if agent == "claude":
        argv = shlex.split(claude_exec())
        if resume_id:
            argv.extend(["--resume", resume_id])
        if session_id:
            argv.extend(["--session-id", session_id])
        if level := effort_level(effort):
            argv.extend(["--effort", level])
        return argv
```

Leave the codex branch as it is.

- [ ] **Step 4: Run the config tests**

Run: `uv run pytest -q tests/test_config.py`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add periscope/config.py tests/test_config.py
git commit -m "config: build_agent_command takes a session_id and gives claude --session-id" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Each spawn gets a session ID, and `Spawned` reports it with the account

**Files:**
- Modify: `periscope/channels.py` (`Spawned` about line 517, `spawn_claude_with_prompt` about lines 525-662)
- Test: `tests/test_channels.py` (`test_spawn_claude_with_prompt_pastes_and_tags`, about line 2040)

- [ ] **Step 1: Change the test to expect the new fields**

In `tests/test_channels.py`, replace `test_spawn_claude_with_prompt_pastes_and_tags` with:

```python
def test_spawn_claude_with_prompt_pastes_and_tags(mocker, bracketed_paste, tmux_checked):
    import uuid

    from periscope import channels, usage
    from periscope.launch_policy import Launch

    mocker.patch.object(usage, "choose_launch", return_value=Launch("default", None, ""))

    tmux = mocker.patch("periscope.channels.tmux", return_value="%9")
    mocker.patch("periscope.channels._run", return_value=(0, ""))  # has-session ok
    mocker.patch("periscope.channels._tmux_mutate", return_value=(True, "4"))
    mocker.patch("periscope.channels.asyncio.sleep", new=AsyncMock())
    mocker.patch("periscope.channels._plain_pane_snapshot", return_value="auto mode on")
    mocker.patch("periscope.channels.note_focus")
    mocker.patch("periscope.channels.note_action")
    mocker.patch("periscope.channels.stamp_new_window", return_value="kid42")
    mocker.patch("periscope.channels.set_window_fields")
    move = mocker.patch("periscope.channels.tracks.move_pane")

    out = asyncio.run(channels.spawn_claude_with_prompt("/tmp/wt", "/dev/repo", "do the thing", session="sess"))

    sid = out.pop("session_id")
    assert str(uuid.UUID(sid)) == sid
    assert out == {
        "target": "sess:4",
        "session": "sess",
        "index": 4,
        "pid": "kid42",
        "pane_id": "%9",
        "account": "default",
    }
    # The claude command line starts the session the spawn reports.
    claude_lines = [c.args[3] for c in tmux.call_args_list if c.args[0] == "send-keys" and len(c.args) == 5]
    assert len(claude_lines) == 1 and f"--session-id {sid}" in claude_lines[0]
    bracketed_paste.assert_called_once_with("sess:4", "do the thing")
    assert [c.args for c in tmux_checked.call_args_list] == [("send-keys", "-t", "sess:4", "Enter")]
    move.assert_called_once_with("kid42", "/dev/repo")
```

- [ ] **Step 2: Run the test to see it fail**

Run: `uv run pytest -q tests/test_channels.py::test_spawn_claude_with_prompt_pastes_and_tags`
Expected: FAIL with `KeyError: 'session_id'`

- [ ] **Step 3: Add the fields to `Spawned`**

In `periscope/channels.py`, replace `class Spawned`:

```python
class Spawned(TypedDict):
    target: str
    session: str  # the tmux session
    index: int
    pid: str
    pane_id: str
    session_id: str  # the Claude session, started with --session-id
    account: str  # the account id the Claude runs on
```

- [ ] **Step 4: Make the ID and return both fields**

In `spawn_claude_with_prompt`:

1. Add one sentence to the end of the docstring's first paragraph, after "tag the pane into `track_id`.": `Claude starts with a new --session-id, which the answer reports.`
2. Replace the line that builds `claude_cmd`:

```python
    session_id = str(uuid.uuid4())
    claude_cmd = shlex.join(config.build_agent_command("claude", cwd=cwd, effort=launch.effort, session_id=session_id))
```

3. Replace the `return` at the end of the function:

```python
    return {
        "target": target,
        "session": session,
        "index": index,
        "pid": pid,
        "pane_id": pane_id,
        "session_id": session_id,
        "account": launch.account,
    }
```

`uuid` is already imported in `channels.py`.

- [ ] **Step 5: Run the channel and spawn tests**

Run: `uv run pytest -q tests/test_channels.py tests/routes/test_linear.py tests/routes/test_reviews.py tests/routes/test_sessions.py`
Expected: all pass. The route tests mock the spawn, so the new keys do not reach them yet.

- [ ] **Step 6: Commit**

```bash
git add periscope/channels.py tests/test_channels.py
git commit -m "spawn: each spawned Claude starts with a new --session-id; Spawned reports it and the account" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: `store.account_email`

**Files:**
- Modify: `periscope/store.py` (after `account_config_dir`, about line 428)
- Test: `tests/test_store.py` (after `test_account_config_dir_resolves`, about line 459)

- [ ] **Step 1: Write the failing tests**

Add after `test_account_config_dir_resolves` in `tests/test_store.py`:

```python
def test_account_email_reads_each_accounts_claude_json(clean_state, tmp_path, monkeypatch):
    import json

    import periscope.store as store

    monkeypatch.setenv("HOME", str(tmp_path))
    other = tmp_path / ".claude-c"
    other.mkdir()
    clean_state["accounts"] = [
        {"id": "default", "label": "A", "config_dir": ""},
        {"id": "c", "label": "C", "config_dir": str(other)},
    ]
    (tmp_path / ".claude.json").write_text(json.dumps({"oauthAccount": {"emailAddress": "a@example.com"}}))
    (other / ".claude.json").write_text(json.dumps({"oauthAccount": {"emailAddress": "c@example.com"}}))
    assert store.account_email("default") == "a@example.com"
    assert store.account_email("c") == "c@example.com"


def test_account_email_is_none_when_the_account_is_not_logged_in(clean_state, tmp_path, monkeypatch):
    import periscope.store as store

    monkeypatch.setenv("HOME", str(tmp_path))
    assert store.account_email("default") is None  # no .claude.json
    (tmp_path / ".claude.json").write_text('{"userID": "x"}')
    assert store.account_email("default") is None  # no oauthAccount
    (tmp_path / ".claude.json").write_text("{not json")
    assert store.account_email("default") is None
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `uv run pytest -q tests/test_store.py -k account_email`
Expected: 2 FAIL with `AttributeError: module 'periscope.store' has no attribute 'account_email'`

- [ ] **Step 3: Add the function**

In `periscope/store.py`, after `account_config_dir`:

```python
def account_email(account_id: str | None) -> str | None:
    """The email the account is logged in with, from its `.claude.json` (`~/.claude.json` for the
    default account), or None when the account is not logged in."""
    config_dir = account_config_dir(account_id)
    path = Path(config_dir) / ".claude.json" if config_dir else Path.home() / ".claude.json"
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return (data.get("oauthAccount") or {}).get("emailAddress") or None
```

`json` and `Path` are already imported in `store.py`.

- [ ] **Step 4: Run the store tests**

Run: `uv run pytest -q tests/test_store.py`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add periscope/store.py tests/test_store.py
git commit -m "store: account_email reads the email an account is logged in with" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: `/api/linear/start` answers with `session_id` and `email`

**Files:**
- Modify: `periscope/routes/linear.py`
- Test: `tests/routes/test_linear.py`

- [ ] **Step 1: Change the tests**

In `tests/routes/test_linear.py`:

1. Replace the `SPAWNED` line:

```python
SID = "3f2a9c1e-5b7d-4e2a-9f10-2c4d6e8a0b1c"
SPAWNED = {
    "target": "api-wt:2",
    "session": "api-wt",
    "index": 2,
    "pid": "k",
    "pane_id": "%5",
    "session_id": SID,
    "account": "default",
}
```

2. Add this fixture after the `_env` fixture:

```python
@pytest.fixture(autouse=True)
def email(mocker):
    """The spawned Claude's account email; never the real ~/.claude.json."""
    return mocker.patch("periscope.store.account_email", return_value="you@example.com")
```

3. In `test_start_spawns_claude_in_the_worktree`, add `email` to the arguments, and replace its first 2 asserts:

```python
def test_start_spawns_claude_in_the_worktree(client, worktree, spawn, place, email):
    r = client.post("/api/linear/start", json=BODY)
    assert r.status_code == 200
    assert r.json() == {
        "mode": "spawned",
        "pid": "k",
        "path": "/repos/api-wt",
        "reused": False,
        "session_id": SID,
        "email": "you@example.com",
    }
    email.assert_called_once_with("default")
```

Keep the rest of the test as it is.

- [ ] **Step 2: Run the test to see it fail**

Run: `uv run pytest -q tests/routes/test_linear.py::test_start_spawns_claude_in_the_worktree`
Expected: FAIL. The answer has no `session_id` or `email`.

- [ ] **Step 3: Change the route**

In `periscope/routes/linear.py`:

1. Add one sentence to the module docstring, after "links the Linear issue to the new pane.": `It answers with the new Claude's session id and the email of its Claude account.`
2. Replace the last line of `_start`:

```python
    email = await asyncio.to_thread(store.account_email, spawned["account"])
    return {
        "mode": "spawned",
        "pid": spawned["pid"],
        "path": wt["path"],
        "reused": wt["reused"],
        "session_id": spawned["session_id"],
        "email": email,
    }
```

`~/.claude.json` can be a few hundred KB, so the read runs off the event loop, as the worktree step does.

- [ ] **Step 4: Run the route tests**

Run: `uv run pytest -q tests/routes/test_linear.py`
Expected: all pass. The "existing" answers stay `{"mode": "existing", "pid": "p1"}`.

- [ ] **Step 5: Commit**

```bash
git add periscope/routes/linear.py tests/routes/test_linear.py
git commit -m "linear: /api/linear/start answers with the new Claude's session id and its account email" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: resurrect reads a captured `--session-id` as `--resume`

Claude refuses to start twice with one `--session-id` (`Error: Session ID … is already in use.`). A pane with no `pane_sessions` row keeps its captured command, so after a reboot that pane would have no Claude. With this change it resumes its session.

**Files:**
- Modify: `periscope/resurrect.py` (regexes about line 50, `_line_session` about line 138, `_rewrite_line` about line 148)
- Test: `tests/test_resurrect.py`

- [ ] **Step 1: Write the failing tests**

In `tests/test_resurrect.py`:

1. Add 2 cases to the `parametrize` list of `test_a_line_renders_the_session_it_is_grouped_by` (after `("claude", None),`):

```python
        (f"claude --session-id {OLD_SID} --effort high", None),  # a spawn's id, no row
        (f"claude --session-id {OLD_SID}", SID),  # the row wins over the spawn's id
```

2. Add after `test_demoted_line_with_nothing_to_change_is_untouched`:

```python
def test_captured_session_id_resumes_without_a_row():
    line = _pane_line("s", "1", "1", f"claude --session-id {SID} --effort high")
    out, changed = resurrect._rewrite_line(line, {"s:1.1": "%56"}, {})
    assert changed
    assert out.split("\t")[10] == f":claude --resume {SID} --effort high"


def test_demoted_line_loses_its_session_id():
    line = _pane_line("s", "1", "1", f"claude --session-id {SID} --effort high")
    out, changed = resurrect._rewrite_line(line, *_maps(), demote=True)
    assert changed
    assert out.split("\t")[10] == ":claude --effort high"


def test_a_captured_session_id_counts_as_a_resume_for_duplicates():
    lines = [
        _pane_line("p", "1", "0", f"claude --resume {SID}"),
        _pane_line("p", "2", "0", f"claude --session-id {SID}"),
    ]
    assert resurrect._duplicate_resumes(lines, {}, {}, {}) == {1}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `uv run pytest -q tests/test_resurrect.py`
Expected: the 3 new tests FAIL (for example, `assert changed` fails because the line comes back unchanged).

- [ ] **Step 3: Add the regex and the rewrite**

In `periscope/resurrect.py`, after the `_RESUME_ARG_RE` line:

```python
# A periscope spawn starts Claude with `--session-id <uuid>`, which Claude refuses once that Claude
# session exists ("Session ID … is already in use"). Restored, it must resume that Claude session instead.
_SESSION_ID_ARG_RE = re.compile(r"--session-id[= ]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b")
```

Above `_line_session`:

```python
def _session_id_as_resume(cmd: str) -> str:
    """`cmd` with its `--session-id <uuid>` read as `--resume <uuid>`."""
    return _SESSION_ID_ARG_RE.sub(r"--resume \1", cmd)
```

- [ ] **Step 4: Use it in `_line_session` and `_rewrite_line`**

In `_line_session`, replace:

```python
    m = _RESUME_ARG_RE.search(parts[10])
```

with:

```python
    m = _RESUME_ARG_RE.search(_session_id_as_resume(parts[10]))
```

In `_rewrite_line`, replace:

```python
    captured = parts[10][1:]
    cmd = _RESUME_ARG_RE.sub("", captured) if demote else captured
```

with:

```python
    captured = parts[10][1:]
    cmd = _session_id_as_resume(captured)
    if demote:
        cmd = _RESUME_ARG_RE.sub("", cmd)
```

The early return (`cmd == captured`) does not change. `captured` stays the command as saved, so a `--session-id` read as `--resume` counts as a change. Update the `_line_session` docstring and the `_rewrite_line` comment that say the captured command is "kept whole".

- [ ] **Step 5: Run the resurrect tests**

Run: `uv run pytest -q tests/test_resurrect.py tests/test_resurrect_save.py`
Expected: all pass, including `test_idempotent` and `test_unresolved_session_untouched`.

- [ ] **Step 6: Commit**

```bash
git add periscope/resurrect.py tests/test_resurrect.py
git commit -m "resurrect: a captured --session-id restores as --resume, since Claude refuses it twice" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: periscope docs

**Files:**
- Modify: `README.md` ("Opening work", about line 55)
- Modify: `docs/tmux-persistence.md` (after the first paragraph, about line 14)

- [ ] **Step 1: README**

In `README.md`, replace:

```markdown
starts Claude, sends it the prompt and links the issue to the card. If a
Claude is already on that branch, it reports that pane and starts nothing.
```

with:

```markdown
starts Claude, sends it the prompt and links the issue to the card. It
answers with the new Claude's `session_id` and its account's `email` (null
when periscope cannot read it). If a Claude is already on that branch, it
reports that pane and starts nothing.
```

In `README.md`, "Agents talk back", after the paragraph that ends "it's how a finished task lands in READY with a reason attached.", add:

```markdown
A Claude that periscope starts with a prompt (a `spawn_claude` worker, a
review pane, a Linear start) starts with `--session-id <uuid>`, so periscope
knows its Claude session from the first moment. The command lands in the
pane's shell history, and Claude refuses one `--session-id` twice: after the
Claude exits, Up+Enter fails with "Session ID … is already in use". Run
`claude --resume <uuid>` to continue that conversation, or `claude` to start a
new one.
```

The + New tab launcher and the resume path do not pass `--session-id`, so the README does not say "every Claude".

In `periscope/channels.py`, `spawn_claude_with_prompt`, above `tmux("send-keys", "-t", target, claude_cmd, "Enter")`, add:

```python
    # The command lands in the shell history, where a re-run fails: Claude refuses one --session-id twice.
```

- [ ] **Step 2: `docs/tmux-persistence.md`**

After the paragraph that ends "`periscope.activity` would drag in the Anthropic SDK.", add:

```markdown
**A captured `--session-id` restores as `--resume`.** A Claude that periscope
starts with a prompt (`channels.spawn_claude_with_prompt`) gets
`--session-id <uuid>`, and Claude refuses to start twice with one ID ("Session
ID … is already in use"). A pane with no `pane_sessions` row keeps its
captured command, so without this it would come back with no Claude. The
rewrite reads the flag as `--resume <uuid>` everywhere it reads a captured
`--resume`: the duplicate grouping, the row-less line and the demoted line.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/tmux-persistence.md periscope/channels.py
git commit -m "docs: /api/linear/start's session_id and email; the --session-id rules for resurrect and shell history" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Check periscope and open its PR

**Files:** none

- [ ] **Step 1: Run the full suite and the linters**

Run: `uv run pytest -q && bin/check`
Expected: all tests pass, and `bin/check` reports zero violations. If `bin/check` reports format issues only, run `bin/check --fix`, look at the diff, and commit it as `style: ruff format`.

- [ ] **Step 2: Try it on the dev instance**

```bash
PERISCOPE_PORT=17375 PERISCOPE_DEV=1 uv run server.py
```

In a second shell, start a Claude on a throwaway branch of a repo in the catalog:

```bash
curl -s -X POST http://127.0.0.1:17375/api/linear/start -H 'content-type: application/json' \
  -d '{"repo": "<a repo path from GET /api/open/catalog>", "branch": "tmp/session-id-check", "ticket": "TEST-1", "prompt": "Reply with ok."}'
```

Expected: an answer with `"mode": "spawned"`, a `session_id` and your email. Then check that the new pane runs that session: `ls ~/.claude/projects/*/<session_id>.jsonl` finds one file. Close the pane, then remove the worktree and the branch that the check made.

- [ ] **Step 3: Ask the user before the push**

Show the user `git log --oneline origin/main..` and ask for the OK to push and open the PR. Do not push without it.

- [ ] **Step 4: Push and open the PR (after the OK)**

```bash
git push -u origin thibaultdody/linear-start-session-id
gh pr create --repo tomplex/periscope --base main --title "linear: /api/linear/start answers with the session id and the account email" --body "$(cat <<'EOF'
## Summary
- Each spawned Claude starts with `--session-id <uuid4>`. `Spawned` reports `session_id` and `account`.
- `store.account_email` reads the email from the account's `.claude.json`.
- `/api/linear/start` answers mode "spawned" with `session_id` and `email`. todo-hub writes them to the Linear issue.
- `/api/reviews/prepare` returns `**spawned`, so its answer also gains `session_id` and `account`. Nothing reads them yet.
- resurrect reads a captured `--session-id` as `--resume`. Claude refuses a `--session-id` that is already in use, so a row-less pane would come back with no Claude.

## Behavior change
- The spawn's `claude … --session-id <uuid>` command goes into the pane's shell history. After that Claude exits, Up+Enter fails with "Session ID … is already in use". `claude --resume <uuid>` continues the conversation. The README says so.
- The alternative was to read the ID after the spawn from Claude's session file, with no flag. That keeps history re-runs working, but the ID can be missing when Claude starts slowly.

## Assumptions
- Claude Code accepts `--session-id <uuid>` in interactive mode.
- Claude Code refuses a reused `--session-id` ("Session ID … is already in use"). Checked with 2 runs of `claude -p` and one ID.
- The email is `oauthAccount.emailAddress` in `~/.claude.json` (default account) or `<config_dir>/.claude.json`. When periscope cannot read an email (for example, the account is not logged in), the answer sends `null`.

## Test plan
- [x] `uv run pytest -q`
- [x] `bin/check`
- [x] Dev instance: `/api/linear/start` answered with a `session_id` whose transcript exists.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: a PR URL.

---

## Part 2: todo-hub

All todo-hub steps run in `~/github/tdody/todo-hub` on the branch `periscope-session-id`.

### Task 9: The start route writes the comment

**Files:**
- Modify: `backend/src/todohub/api.py` (`periscope_start`, about line 977)
- Modify: `backend/src/todohub/periscope.py` (`Periscope.start` docstring, about line 67)
- Test: `backend/tests/test_periscope.py`

- [ ] **Step 1: Share one `FakeLinear` in the test app**

In `backend/tests/test_periscope.py`:

1. Add `import re` to the imports at the top, and add `from todohub.linear import LinearError` after `from todohub.db import DB`.
2. Replace the `env` fixture:

```python
@pytest.fixture
def linear():
    return FakeLinear()


@pytest.fixture
def env(peri, linear):
    settings = settings_on()
    db = DB(settings.db_path)
    fronted = []
    app = create_app(settings, db, linear_factory=lambda: linear,
                     periscope_factory=lambda: Periscope(URL, transport=peri.transport),
                     front_fn=fronted.append, name_fn=lambda issue: f"{issue['identifier'].lower()}-rebin")
    return TestClient(app), db, fronted
```

- [ ] **Step 2: Change the 2 tests whose answer gets `warnings`**

In `test_start_sends_the_issue_and_its_name_and_remembers_the_repo`, replace:

```python
    assert r.status_code == 200 and r.json() == SPAWNED
```

with:

```python
    assert r.status_code == 200 and r.json() == {**SPAWNED, "warnings": []}
```

In `test_a_claude_already_on_the_branch_is_answered_and_the_repo_remembered`, replace:

```python
    assert r.json() == {"mode": "existing", "pid": "p1"}
```

with:

```python
    assert r.json() == {"mode": "existing", "pid": "p1", "warnings": []}
```

- [ ] **Step 3: Write the new tests**

Add after `test_a_claude_already_on_the_branch_is_answered_and_the_repo_remembered`:

```python
SID = "3f2a9c1e-5b7d-4e2a-9f10-2c4d6e8a0b1c"
WITH_SESSION = {**SPAWNED, "session_id": SID, "email": "you@example.com"}
STARTED = re.compile(r"- Started: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}")


def test_a_new_claude_s_session_goes_into_a_comment(env, peri, linear):
    client, _, _ = env
    peri.answer = httpx.Response(200, json=WITH_SESSION)
    r = client.post("/api/issues/id-ENG-1/periscope", json=START)
    assert r.status_code == 200 and r.json() == {**WITH_SESSION, "warnings": []}
    [(issue_id, body)] = linear.comments
    started, account, session = body.split("\n")
    assert issue_id == "id-ENG-1"
    assert STARTED.fullmatch(started)
    assert account == "- Claude account: you@example.com"
    assert session == f"- Claude session: `{SID}`"


def test_a_session_without_an_email_says_unknown(env, peri, linear):
    client, _, _ = env
    peri.answer = httpx.Response(200, json={**WITH_SESSION, "email": None})
    client.post("/api/issues/id-ENG-1/periscope", json=START)
    assert "- Claude account: unknown" in linear.comments[0][1].split("\n")


def test_no_comment_without_a_session_id(env, peri, linear):
    # An older periscope, or a Claude already on the branch: nothing to record.
    client, _, _ = env
    for answer in (SPAWNED, {"mode": "existing", "pid": "p1"}):
        peri.answer = httpx.Response(200, json=answer)
        assert client.post("/api/issues/id-ENG-1/periscope", json=START).json()["warnings"] == []
    assert linear.comments == []


def test_a_comment_that_fails_is_a_warning_not_an_error(env, peri, linear):
    # Claude is already running, so the start still succeeds.
    client, db, _ = env
    peri.answer = httpx.Response(200, json=WITH_SESSION)

    def refuse(issue_id, body):
        raise LinearError("Linear is down")

    linear.create_comment = refuse
    r = client.post("/api/issues/id-ENG-1/periscope", json=START)
    assert r.status_code == 200
    assert r.json()["warnings"] == ["The Claude session was not added to ENG-1: Linear is down"]
    assert db.get_meta(LAST_REPO_KEY) == "/dev/api"
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `cd backend && uv run pytest -q tests/test_periscope.py`
Expected: the 2 changed tests and the 4 new tests FAIL (no `warnings` key, no comment).

- [ ] **Step 5: Write the comment in the route**

In `backend/src/todohub/api.py`, replace `periscope_start` with:

```python
    @app.post("/api/issues/{issue_id}/periscope", dependencies=periscope_auth)
    def periscope_start(issue_id: str, body: PeriscopeStartIn) -> dict:
        """Ask periscope to start Claude on the branch with the prompt and a name from Haiku, then remember the
        repo for the issue's project (or client). A Claude already on the branch is answered as mode "existing".
        A new Claude's session goes into a comment on the issue; a comment that fails is a warning."""
        branch = body.branch.strip()
        if not branch:
            raise HTTPException(400, "The branch is empty")
        issue = shape_issue(linear_call(lambda l: l.get_issue(issue_id)), settings)
        name = name_claude(issue)
        try:
            result = periscope_call(lambda p: p.start(
                repo=body.repo, branch=branch, ticket=issue["identifier"], title=issue["title"],
                prompt=body.prompt, name=name))
        except HTTPException as exc:
            if exc.status_code == 409:
                raise HTTPException(409, f"Periscope is already starting {issue['identifier']}.")
            raise
        remember_repo(db, issue, body.repo)
        warnings: list[str] = []
        if result.get("session_id"):
            comment = (f"- Started: {datetime.now(stats.TZ).replace(microsecond=0).isoformat()}\n"
                       f"- Claude account: {result.get('email') or 'unknown'}\n"
                       f"- Claude session: `{result['session_id']}`")
            client = linear_factory()
            try:
                client.create_comment(issue["id"], comment)
            except LinearError as exc:
                warnings.append(f"The Claude session was not added to {issue['identifier']}: {exc}")
            finally:
                client.close()
        return {**result, "warnings": warnings}
```

Only mode "spawned" has a `session_id`, so the one check covers mode "existing" and an older periscope. `datetime`, `stats`, `LinearError` and `linear_factory` are already in scope in `api.py`.

- [ ] **Step 6: Update the `Periscope.start` docstring**

In `backend/src/todohub/periscope.py`, replace the docstring of `Periscope.start`:

```python
        """{mode: "spawned", pid, path, reused, session_id, email}, or {mode: "existing", pid} when a Claude is
        already on the branch. Periscope gives a spawned Claude ``name`` on its rail and pins it. ``email`` is None
        when the Claude account is not logged in, and an older periscope sends neither field."""
```

- [ ] **Step 7: Run the periscope tests**

Run: `cd backend && uv run pytest -q tests/test_periscope.py`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add backend/src/todohub/api.py backend/src/todohub/periscope.py backend/tests/test_periscope.py
git commit -m "$(cat <<'EOF'
Backend: Start in periscope adds the Claude session to the issue

When periscope starts a new Claude, the start route adds a comment with
the start time, the Claude account email and the session ID. A comment
that fails is a warning, because Claude is already running.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 10: The app shows the warnings

**Files:**
- Modify: `app/src/api.ts` (`PeriscopeStart`, about line 326)
- Modify: `app/src/periscope.ts` (`start`, about line 96)

- [ ] **Step 1: Add `warnings` to the type**

In `app/src/api.ts`, replace `PeriscopeStart`:

```ts
export interface PeriscopeStart {
  mode: "spawned" | "existing";                 // existing: a Claude was already on the branch
  pid: string;                                  // periscope always gives the pane's id
  warnings: string[];                           // the session comment that Linear refused
}
```

- [ ] **Step 2: Show each warning as an error toast**

In `app/src/periscope.ts`, in `start`, add one line after the `ctx.toast(...)` call:

```ts
    ctx.toast(r.mode === "existing" ? `${i.identifier} is already open in periscope` : `Started ${i.identifier} in periscope`,
      { label: "Show", run: () => void api.showInPeriscope(r.pid).catch(ctx.fail) });
    for (const w of r.warnings) ctx.fail(w);
```

`ctx.fail` shows a string as an error toast (`main.ts`, `fail`).

- [ ] **Step 3: Type-check**

Run: `cd app && npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/src/api.ts app/src/periscope.ts
git commit -m "$(cat <<'EOF'
App: a session comment that Linear refused shows as an error toast

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 11: todo-hub README

**Files:**
- Modify: `README.md` ("Start in periscope", about lines 125-135)

- [ ] **Step 1: Add the comment bullet**

In `README.md`, after the bullet that starts "- The toast's **Show** selects that Claude in periscope.", add:

```markdown
- When periscope starts a new Claude, todo-hub adds a comment to the issue: the start time, the email of the Claude account and the Claude session ID. To open that conversation again, run `claude --resume <id>` in the issue's worktree, or use `resume_session` in periscope. With a Claude already on the branch, todo-hub adds no comment. If Linear refuses the comment, the start still counts, and an error toast says so.
```

- [ ] **Step 2: Name the older periscope**

In the bullet that starts "- Periscope must be running.", replace:

```markdown
A periscope that does not know the `name` field starts Claude without it.
```

with:

```markdown
A periscope that does not know the `name` field starts Claude without it. A periscope that sends no session ID gets no comment.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
README: Start in periscope adds the Claude session to the issue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 12: Check todo-hub and open its PR

**Files:** none

- [ ] **Step 1: Run what CI runs**

Run: `cd backend && uv run pytest -q` and `cd app && npx tsc --noEmit`
Expected: all tests pass, and `tsc` gives no output.

- [ ] **Step 2: Scan the diff for private data**

The repo is public. Run:

```bash
git diff main --stat
git diff main | grep -n -i -E "@[a-z0-9-]+\.(com|ai|io)|/Users/" | grep -v -i "example\.com\|noreply@anthropic\.com"
```

Expected: the second command prints nothing. If it prints a line, remove that data before the push.

- [ ] **Step 3: Try it end to end (needs the periscope PR on the dev instance)**

With periscope from Task 8 on port 17375, set `app.periscope_url = "http://127.0.0.1:17375"` in a scratch `TODOHUB_HOME` config, start a throwaway issue in periscope from the app, and check that the issue gets the comment. Delete the comment and the throwaway worktree after the check. If the dev periscope is not running, skip this step and say so in the PR.

- [ ] **Step 4: Ask the user before the push**

Show the user `git log --oneline main..` and ask for the OK to push and open the PR. Do not push without it.

- [ ] **Step 5: Push and open the PR (after the OK)**

```bash
git push -u origin periscope-session-id
gh pr create --base main --title "Start in periscope adds the Claude session to the issue" --body "$(cat <<'EOF'
## Summary
- When periscope starts a new Claude, the start route adds a comment to the Linear issue: the start time, the Claude account email and the Claude session ID.
- No comment for a Claude already on the branch, or for a periscope that sends no session ID.
- A comment that fails is a warning: the start still succeeds, and the app shows an error toast.
- Needs the periscope PR that adds `session_id` and `email` to `/api/linear/start`. Without it, todo-hub adds no comment.

## Assumptions
- Periscope answers mode "spawned" with `session_id` and `email` (`email` is `null` when periscope cannot read it).
- The time is todo-hub's time when periscope answers, in America/New_York, as the plans and wrap-ups use.

## Test plan
- [x] `cd backend && uv run pytest -q`
- [x] `cd app && npx tsc --noEmit`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: a PR URL.
