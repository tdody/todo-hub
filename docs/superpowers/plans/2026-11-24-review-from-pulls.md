# Review a pull request from To review: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each row of **Pull requests → To review** gets a **Review** button that starts Claude on the pull request's code, in periscope or in Claude Code.

**Architecture:** One backend route gives the popover's options for both targets, and two routes start the review. The routes reuse the issue starts: periscope's `/api/linear/start` with `pr`, and Claude Code's start script in a worktree that todo-hub checks out as `pr-<N>`. `start.ts` owns the popover for issues and for pull requests, and `pulls.ts` shows it under the row. Periscope's `ticket` becomes optional first, so that a pull request with no Linear ticket can start there.

**Tech Stack:** Python 3.11+ (FastAPI, pydantic, pytest, git), TypeScript with no framework (Vite, Tauri), periscope (Python 3.14, FastAPI, pytest, ruff).

**Spec:** `docs/superpowers/specs/2026-11-24-review-from-pulls-design.md`

---

## Rules for each task

- todo-hub's worktree is `~/dev/worktrees/todo-hub/review-from-pulls`, on the branch `review-from-pulls`. Work only there, not in the main checkout.
- The repo is public. Use only fictional names: Globex, Initech & Co, Hooli, Sam, `ENG-123`, `acme/api`. Put no client, team, colleague or company name in code, tests, docs or commit messages.
- Each code block below is a diff. You can save it to a file and run `git apply <file>` at the repo's top. Read the code around it first. If a hunk does not apply, make the same change by hand and say so.
- End each commit message with this line, and with no other attribution:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

- Do not push, and do not open a pull request. Task 9 does that after the user agrees.
- Do not stop, restart or send a request to the periscope on port 17374. It is the user's.
- Backend tests: `cd backend && uv sync -q --extra dev && uv run pytest -q`. Without `--extra dev`, `uv run pytest` takes another pytest from the PATH and fails. The baseline is 382 passed.
- Type check: `cd app && node_modules/.bin/tsc --noEmit`. If `app/node_modules` is missing, run `npm ci` in `app`.

## Files

| File | Change |
|---|---|
| periscope `periscope/routes/linear.py`, `tests/routes/test_linear.py`, `README.md` | `ticket` is optional |
| `backend/src/todohub/start.py` | `fill_review_prompt`: the review prompt with or with no ticket |
| `backend/src/todohub/claude_code.py` | `github_slug`, `find_or_add_pr_worktree` |
| `backend/src/todohub/periscope.py` | `pr_repos`; `Periscope.start` with no ticket |
| `backend/src/todohub/api.py` | 3 routes under `/api/pulls/{owner}/{name}/{number}`; the parts that the issue routes share with them |
| `app/src/api.ts` | `StartTarget`, `PullStartOptions`, `PullStartTarget`, 3 calls |
| `app/src/start.ts` | Review's popover; the parts that both popovers share |
| `app/src/pulls.ts` | the button, **p**, the popover's place, the focus |
| `app/src/main.ts` | the meta for the tab, the shortcut list |
| `app/src/styles.css` | the button and the popover's place |
| `app/src/settings.ts`, `README.md` | the text |

---

### Task 1: periscope: a start with no ticket

**Files:**
- Modify: `periscope/routes/linear.py` (module docstring, `StartBody.ticket`, `_start`)
- Modify: `README.md` (the `/api/linear/start` paragraph)
- Test: `tests/routes/test_linear.py`

Work in a new worktree of periscope, from `origin/main`. The main checkout is the user's running periscope. `$PERISCOPE` is its path.

- [ ] **Step 1: Make the worktree**

```bash
cd "$PERISCOPE"
git fetch -q origin
git worktree add --no-track -b start-without-ticket .claude/worktrees/start-without-ticket origin/main
cd .claude/worktrees/start-without-ticket
uv sync --python 3.14
```

- [ ] **Step 2: Write the failing test**

````diff
diff --git a/tests/routes/test_linear.py b/tests/routes/test_linear.py
index ea28907..5979a50 100644
--- a/tests/routes/test_linear.py
+++ b/tests/routes/test_linear.py
@@ -315,6 +315,13 @@ def test_a_pr_start_checks_the_pr_out_and_links_it(client, no_pr_worktree, fetch
     }
 
 
+def test_a_pr_start_with_no_ticket_links_only_the_pr(client, no_pr_worktree, fetch, worktree, spawn, place):
+    body = {k: v for k, v in PR_BODY.items() if k not in ("ticket", "title")}
+    r = client.post("/api/linear/start", json=body)
+    assert r.status_code == 200 and r.json()["mode"] == "spawned"
+    assert store.get_window("k") == {"linked_pr": 812, "is_fork": True}
+
+
 def test_a_branch_start_answers_the_worktree_warning(client, worktree, spawn, place):
     worktree.return_value = {**worktree.return_value, "warning": "fetch failed: origin/main may be stale ('offline')"}
     r = client.post("/api/linear/start", json=BODY)
````

- [ ] **Step 3: Run it to make sure it fails**

Run: `uv run pytest -q tests/routes/test_linear.py`
Expected: `1 failed, 31 passed`. The failure is `test_a_pr_start_with_no_ticket_links_only_the_pr`, with status 422.

- [ ] **Step 4: Make `ticket` optional**

`store.set_window_fields` removes a field whose value is None, so an empty ticket writes no `linked_linear`. `git_pr.linear_ticket_fields` then finds the ticket in the PR's title or the branch.

````diff
diff --git a/README.md b/README.md
index 6f560f0..cb53b22 100644
--- a/README.md
+++ b/README.md
@@ -63,7 +63,8 @@ the worktree as it is. It answers with the new Claude's `session_id` and its
 account's `email` (null when periscope cannot read it). A `warning` in the
 answer tells of a problem that did not stop the start, for example a worktree
 that stays behind its PR. If a Claude is already on that branch, it reports
-that pane and starts nothing.
+that pane and starts nothing. A start with no Linear issue (`ticket`) links
+none: the card shows the ticket that the PR's title or the branch names, if any.
 `GET /api/open/catalog` gives each repo's `slug`, the `owner/name` of its
 origin on GitHub, so the app can find the repo of a pull request.
 `POST /api/select` with a pane's `pid` makes the dashboard select it.
diff --git a/periscope/routes/linear.py b/periscope/routes/linear.py
index 951329c..a23c0a0 100644
--- a/periscope/routes/linear.py
+++ b/periscope/routes/linear.py
@@ -1,10 +1,11 @@
 """POST /api/linear/start — another app on this Mac starts Claude on a Linear issue's branch, or on a pull request.
 
 The route makes the worktree, spawns Claude with a prompt through branch_spawn (the spawn path of
-/api/reviews/prepare), and links the Linear issue to the new pane. With `pr` in place of `branch`, it checks the
-pull request out as `pr-<N>` with ⌘K's PR helper, or fast-forwards the worktree already on `pr-<N>` to the PR's
-head, and links the PR too. It answers with the new Claude's session id and the email of its Claude account, and
-with a `warning` when a worktree problem did not stop the start. A `name` labels the new pane and pins the label.
+/api/reviews/prepare), and links the Linear issue to the new pane. With no `ticket`, the pane gets no Linear link.
+With `pr` in place of `branch`, it checks the pull request out as `pr-<N>` with ⌘K's PR helper, or fast-forwards the
+worktree already on `pr-<N>` to the PR's head, and links the PR too. It answers with the new Claude's session id and
+the email of its Claude account, and with a `warning` when a worktree problem did not stop the start. A `name` labels
+the new pane and pins the label.
 A Claude already on the branch is only reported (mode "existing"): its prompt is never pasted into a session that
 may be busy, and it keeps its name.
 Selecting the pane is a separate request (POST /api/select), sent when the user asks for it.
@@ -28,7 +29,7 @@ class StartBody(BaseModel):
     # Exactly one of: the branch to start on, or a pull request on the repo's origin, checked out as `pr-<N>`.
     branch: str = ""
     pr: int | None = Field(default=None, gt=0)
-    ticket: str = Field(min_length=1)
+    ticket: str = ""  # empty: the card shows the ticket that the PR's title or the branch names, if any
     title: str = ""
     prompt: str = Field(min_length=1)
     name: str = ""  # the new pane's rail label, pinned; empty lets the narrator name it
@@ -63,7 +64,7 @@ async def _start(body: StartBody, repo: str, branch: str, key: tuple[str, str])
         path, reused, pr_fields, warning = await asyncio.to_thread(_pr_worktree, repo, body.pr, branch)
     spawned = await branch_spawn.spawn(key, path, body.prompt, body.name.strip() or None)
     store.set_window_fields(
-        spawned["pid"], linked_linear=body.ticket, linked_linear_title=body.title or None, **pr_fields
+        spawned["pid"], linked_linear=body.ticket or None, linked_linear_title=body.title or None, **pr_fields
     )
     email = await asyncio.to_thread(store.account_email, spawned["account"])
     return {
````

- [ ] **Step 5: Run the tests and the checks**

Run: `uv run pytest -q tests/routes/test_linear.py`
Expected: `32 passed`

Run: `bin/check`
Expected: no violation. If a tool that `bin/check` needs is missing (biome needs `npm ci`), run `uv run ruff check . && uv run ruff format --check .` and say so.

- [ ] **Step 6: Commit**

```bash
git add periscope/routes/linear.py tests/routes/test_linear.py README.md
git commit -m "linear start: a start can have no ticket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: the review prompt with no ticket

**Files:**
- Modify: `backend/src/todohub/start.py`
- Test: `backend/tests/test_start.py`

- [ ] **Step 1: Write the failing tests**

````diff
diff --git a/backend/tests/test_start.py b/backend/tests/test_start.py
index ab454db..e9f62d4 100644
--- a/backend/tests/test_start.py
+++ b/backend/tests/test_start.py
@@ -3,9 +3,10 @@ import subprocess
 
 import pytest
 
-from todohub.config import load_settings
+from todohub.config import DEFAULT_REVIEW_PROMPT, load_settings
 from todohub.db import DB
-from todohub.start import LAST_REPO_KEY, REPOS_KEY, claude_name, default_repo, fill_prompt, remember_repo
+from todohub.start import (LAST_REPO_KEY, REPOS_KEY, claude_name, default_repo, fill_prompt, fill_review_prompt,
+                           remember_repo)
 
 NAMED = {"identifier": "ENG-1", "title": "Rebin Globex grades for jane@globex.com"}
 
@@ -78,6 +79,27 @@ def test_fill_prompt_fills_pr_only_when_it_is_given():
     assert fill_prompt("Review {pr} for {identifier}.", issue) == "Review {pr} for ENG-1."
 
 
+PR = "https://github.com/acme/api/pull/812"
+
+
+def test_the_review_prompt_of_a_pr_with_a_ticket_is_the_whole_prompt():
+    issue = {"identifier": "ENG-1", "title": "Fix", "url": "https://linear.app/x/issue/ENG-1"}
+    assert fill_review_prompt(DEFAULT_REVIEW_PROMPT, issue, PR) == fill_prompt(DEFAULT_REVIEW_PROMPT, issue, pr=PR)
+
+
+@pytest.mark.parametrize("template, expected", [
+    (DEFAULT_REVIEW_PROMPT, f"Then review {PR} in this worktree: sum up the change and list the problems you find. "
+                            "Do not post anything on GitHub."),
+    ("Review {pr}", f"Review {PR}"),
+    # A dot inside a URL or "e.g." does not end a sentence, and a list keeps its other lines.
+    ("Use https://acme.dev/guide.html for {title}.\nReview {pr}, e.g. its tests.\n\n- keep {identifier} in mind\n- be kind",
+     f"Review {PR}, e.g. its tests.\n\n- be kind"),
+    ("Read {url}. Review {pr} for {identifier}!", ""),
+])
+def test_the_review_prompt_of_a_pr_with_no_ticket_leaves_the_ticket_out(template, expected):
+    assert fill_review_prompt(template, None, PR) == expected
+
+
 def test_default_repo_project_then_client_then_last():
     db = DB(load_settings().db_path)
     repos = ["/dev/api", "/dev/web"]
````

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd backend && uv run pytest -q tests/test_start.py`
Expected: `1 error during collection`, with `ImportError: cannot import name 'fill_review_prompt'`.

- [ ] **Step 3: Write `fill_review_prompt`**

````diff
diff --git a/backend/src/todohub/start.py b/backend/src/todohub/start.py
index 1fb5b6e..a9cee38 100644
--- a/backend/src/todohub/start.py
+++ b/backend/src/todohub/start.py
@@ -19,6 +19,8 @@ LAST_REPO_KEY = "start_last_repo"    # meta: the repo last picked for any issue
 NAME_SECONDS = 30
 _TOKEN = re.compile(r"\{(identifier|title|url|pr)\}")
 _WORD = re.compile(r"[a-z0-9]+")
+_SENTENCE = re.compile(r"\S.*?(?:[.!?](?=\s)|\n|\Z)\s*")
+_TICKET_TOKEN = re.compile(r"\{(identifier|title|url)\}")
 
 
 class StartError(Exception):
@@ -61,6 +63,15 @@ def fill_prompt(template: str, issue: dict, pr: str = "") -> str:
     return _TOKEN.sub(lambda m: values.get(m.group(1), m.group(0)), template)
 
 
+def fill_review_prompt(template: str, issue: dict | None, pr: str) -> str:
+    """The review prompt for the PR at the URL ``pr``, and for ``issue``, its ticket. With no ticket, each sentence
+    that names one is left out. A sentence ends at . ! or ? before a space, or at a line end."""
+    if issue:
+        return fill_prompt(template, issue, pr=pr)
+    kept = [s for s in _SENTENCE.findall(template) if not _TICKET_TOKEN.search(s)]
+    return "".join(kept).strip().replace("{pr}", pr)
+
+
 def _memory_key(issue: dict) -> tuple[str, str] | None:
     """Where the repo for ``issue`` is remembered (its project, else its client label), and that name."""
     if issue["project"]:
````

- [ ] **Step 4: Run all the backend tests**

Run: `cd backend && uv run pytest -q`
Expected: `387 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/start.py backend/tests/test_start.py
git commit -m "Backend: the review prompt for a PR with no ticket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Claude Code's checkout of a pull request

**Files:**
- Modify: `backend/src/todohub/claude_code.py`
- Test: `backend/tests/test_claude_code.py`

The fetch has no `--quiet`: with it, git gives no reason when the local branch `pr-<N>` diverged. `advice.diverging=false` keeps the reason on one line. `git merge --ff-only` refuses to overwrite local changes, and it changes nothing when the worktree is ahead of the PR.

- [ ] **Step 1: Write the failing tests**

````diff
diff --git a/backend/tests/test_claude_code.py b/backend/tests/test_claude_code.py
index c7a2e86..372c966 100644
--- a/backend/tests/test_claude_code.py
+++ b/backend/tests/test_claude_code.py
@@ -143,6 +143,101 @@ def test_a_folder_in_no_repo_is_an_error(tmp_path):
         claude_code.find_or_add_worktree(str(tmp_path), "me/eng-1")
 
 
+@pytest.mark.parametrize("url, slug", [
+    ("git@github.com:acme/api.git", "acme/api"),
+    ("https://github.com/acme/api.git", "acme/api"),
+    ("https://github.com/acme/api", "acme/api"),
+    ("ssh://git@github.com/acme/api.git", "acme/api"),
+    ("https://gitlab.com/acme/api.git", None),
+])
+def test_github_slug_is_the_owner_and_name_of_origin(git_repo, url, slug):
+    git("remote", "set-url", "origin", url, cwd=git_repo)
+    assert claude_code.github_slug(str(git_repo)) == slug
+
+
+def test_github_slug_is_none_with_no_origin_and_no_folder(git_repo):
+    git("remote", "remove", "origin", cwd=git_repo)
+    assert claude_code.github_slug(str(git_repo)) is None
+    assert claude_code.github_slug(str(git_repo.parent / "gone")) is None
+
+
+@pytest.fixture
+def push_pr(git_repo):
+    """``push_pr(text)`` adds a commit that writes ``text`` in ``f`` to PR 812 on origin, and gives its sha."""
+    author = git_repo.parent / "author"
+    git("clone", "-q", str(git_repo.parent / "origin.git"), str(author), cwd=git_repo.parent)
+
+    def push(text: str) -> str:
+        (author / "f").write_text(text)
+        git("add", "f", cwd=author)
+        git("commit", "-q", "-m", text, cwd=author)
+        git("push", "-q", "--force", "origin", "HEAD:refs/pull/812/head", cwd=author)
+        return git("rev-parse", "HEAD", cwd=author).strip()
+
+    return push
+
+
+def head_of(path: str) -> str:
+    return git("rev-parse", "HEAD", cwd=Path(path)).strip()
+
+
+def test_a_pr_gets_a_worktree_on_its_head(git_repo, push_pr):
+    sha = push_pr("one")
+    path, reused, warnings = claude_code.find_or_add_pr_worktree(str(git_repo), 812)
+    assert path == str(git_repo.parent / "api-worktrees" / "pr-812") and not reused and warnings == []
+    assert branch_of(path) == "pr-812" and head_of(path) == sha
+    assert upstream(path) is None            # so a push has no default target
+
+
+def test_a_worktree_already_on_the_pr_moves_to_its_head(git_repo, push_pr):
+    push_pr("one")
+    path, _, _ = claude_code.find_or_add_pr_worktree(str(git_repo), 812)
+    sha = push_pr("two")
+    assert claude_code.find_or_add_pr_worktree(str(git_repo), 812) == (path, True, [])
+    assert head_of(path) == sha
+
+
+def test_local_changes_that_block_the_fast_forward_stay(git_repo, push_pr):
+    old = push_pr("one")
+    path, _, _ = claude_code.find_or_add_pr_worktree(str(git_repo), 812)
+    push_pr("two")
+    (Path(path) / "f").write_text("mine")
+    _, reused, [warning] = claude_code.find_or_add_pr_worktree(str(git_repo), 812)
+    assert reused and warning.startswith("pr-812 may be behind #812: error: Your local changes")
+    assert (Path(path) / "f").read_text() == "mine" and head_of(path) == old
+
+
+def test_a_pr_worktree_that_diverged_stays(git_repo, push_pr):
+    push_pr("one")
+    path, _, _ = claude_code.find_or_add_pr_worktree(str(git_repo), 812)
+    git("commit", "-q", "--allow-empty", "-m", "mine", cwd=Path(path))
+    mine = head_of(path)
+    push_pr("two")
+    assert claude_code.find_or_add_pr_worktree(str(git_repo), 812) == (
+        path, True, ["pr-812 may be behind #812: fatal: Not possible to fast-forward, aborting."])
+    assert head_of(path) == mine
+
+
+def test_a_pr_that_cannot_be_fetched_uses_the_local_branch(git_repo, push_pr):
+    sha = push_pr("one")
+    path, _, _ = claude_code.find_or_add_pr_worktree(str(git_repo), 812)
+    git("worktree", "remove", path, cwd=git_repo)
+    git("remote", "set-url", "origin", str(git_repo.parent / "gone.git"), cwd=git_repo)
+    again, reused, [warning] = claude_code.find_or_add_pr_worktree(str(git_repo), 812)
+    assert again == path and not reused and head_of(path) == sha
+    assert warning.startswith("pr-812 may be behind #812: fatal: ")
+
+
+def test_a_pr_that_cannot_be_fetched_and_has_no_local_branch_is_an_error(git_repo):
+    with pytest.raises(StartError, match="couldn't find remote ref pull/9/head"):
+        claude_code.find_or_add_pr_worktree(str(git_repo), 9)
+
+
+def test_a_pr_in_a_folder_in_no_repo_is_an_error(tmp_path):
+    with pytest.raises(StartError, match="Not a git repo: "):
+        claude_code.find_or_add_pr_worktree(str(tmp_path), 812)
+
+
 def test_a_git_worktree_add_error_carries_gits_message(git_repo):
     taken = git_repo.parent / "api-worktrees" / "me-eng-5"
     taken.mkdir(parents=True)
````

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd backend && uv run pytest -q tests/test_claude_code.py`
Expected: `13 failed, 37 passed`, each failure with `has no attribute 'github_slug'` or `has no attribute 'find_or_add_pr_worktree'`.

- [ ] **Step 3: Write the code**

`_checked_out`, `_new_path` and `_add_worktree` come out of `find_or_add_worktree`, which keeps its behavior and its messages.

````diff
diff --git a/backend/src/todohub/claude_code.py b/backend/src/todohub/claude_code.py
index 9cf3cbb..db15212 100644
--- a/backend/src/todohub/claude_code.py
+++ b/backend/src/todohub/claude_code.py
@@ -1,10 +1,12 @@
-"""Start in Claude Code: a worktree on Linear's branch next to the repo, and a ``.command`` script that the
-Mac's default app for ``.command`` files runs. The script starts Claude Code in the worktree with the prompt."""
+"""Start in Claude Code: a worktree on Linear's branch, or on a pull request, next to the repo, and a ``.command``
+script that the Mac's default app for ``.command`` files runs. The script starts Claude Code in the worktree with
+the prompt."""
 
 from __future__ import annotations
 
 import json
 import logging
+import re
 import shlex
 import shutil
 import subprocess
@@ -19,6 +21,7 @@ log = logging.getLogger("todohub.claude_code")
 QUICK_SECONDS = 15
 FETCH_SECONDS = 30
 ADD_SECONDS = 60
+_GITHUB_ORIGIN = re.compile(r"github\.com[:/]+([^/]+/[^/]+?)(?:\.git)?/?$")
 
 
 def tilde(path: str) -> str:
@@ -33,6 +36,21 @@ def _git(repo: str, *args: str, timeout: int = QUICK_SECONDS) -> subprocess.Comp
                           env={**_env(), "GIT_TERMINAL_PROMPT": "0"})
 
 
+def _git_problem(repo: str, *args: str, timeout: int) -> str:
+    """Why git did not do it, on one line, or ""."""
+    try:
+        proc = _git(repo, "-c", "advice.diverging=false", *args, timeout=timeout)
+    except subprocess.TimeoutExpired:
+        return f"git {args[0]} took more than {timeout} s."
+    return "" if proc.returncode == 0 else " ".join(proc.stderr.split()) or f"git {args[0]} failed."
+
+
+def github_slug(repo: str) -> str | None:
+    """The ``owner/name`` of the repo's origin on GitHub, or None."""
+    m = _GITHUB_ORIGIN.search(_git(repo, "remote", "get-url", "origin").stdout.strip())
+    return m.group(1) if m else None
+
+
 def repo_top(path: str) -> str | None:
     """The absolute top folder of the git repo that ``path`` (``~`` allowed) is in, or None.
     A path in a linked worktree gives the main repo. A submodule gives itself.
@@ -65,22 +83,36 @@ def _has_ref(repo: str, ref: str) -> bool:
     return _git(repo, "show-ref", "--verify", "--quiet", ref).returncode == 0
 
 
+def _checked_out(repo: str) -> dict[str, str]:
+    """``worktrees(repo)``, after a prune: a worktree folder deleted by hand blocks a new one."""
+    if repo_top(repo) is None:
+        raise StartError(f"Not a git repo: {tilde(repo)}")
+    _git(repo, "worktree", "prune")
+    return worktrees(repo)
+
+
+def _new_path(repo: str, branch: str) -> str:
+    return str(Path(repo).parent / f"{Path(repo).name}-worktrees" / branch.replace("/", "-"))
+
+
+def _add_worktree(repo: str, *args: str) -> None:
+    try:
+        proc = _git(repo, "worktree", "add", "--quiet", *args, timeout=ADD_SECONDS)
+    except subprocess.TimeoutExpired:
+        raise StartError(f"git worktree add took more than {ADD_SECONDS} s. It may still finish.") from None
+    if proc.returncode != 0:
+        raise StartError(proc.stderr.strip() or "git worktree add failed.")
+
+
 def find_or_add_worktree(repo: str, branch: str) -> tuple[str, bool, list[str]]:
     """The worktree on ``branch``: the one already on it (reused), else a new one in
     ``<repo>-worktrees/<branch with - for />``. Also the warnings for the toast."""
-    if repo_top(repo) is None:
-        raise StartError(f"Not a git repo: {tilde(repo)}")
-    _git(repo, "worktree", "prune")          # a worktree folder deleted by hand blocks the add
-    if branch in (checked_out := worktrees(repo)):
+    if branch in (checked_out := _checked_out(repo)):
         return checked_out[branch], True, []
     warnings: list[str] = []
-    try:
-        fetched = _git(repo, "fetch", "--quiet", "origin", timeout=FETCH_SECONDS).returncode == 0
-    except subprocess.TimeoutExpired:
-        fetched = False
-    if not fetched:
+    if _git_problem(repo, "fetch", "--quiet", "origin", timeout=FETCH_SECONDS):
         warnings.append("Could not fetch origin. The worktree uses the local branches.")
-    path = str(Path(repo).parent / f"{Path(repo).name}-worktrees" / branch.replace("/", "-"))
+    path = _new_path(repo, branch)
     if _has_ref(repo, f"refs/heads/{branch}"):
         args = [path, branch]
     elif _has_ref(repo, f"refs/remotes/origin/{branch}"):
@@ -90,15 +122,28 @@ def find_or_add_worktree(repo: str, branch: str) -> tuple[str, bool, list[str]]:
     else:
         warnings.append(f"{tilde(repo)} has no origin/HEAD. The new branch starts from HEAD.")
         args = ["--no-track", "-b", branch, path, "HEAD"]
-    try:
-        proc = _git(repo, "worktree", "add", "--quiet", *args, timeout=ADD_SECONDS)
-    except subprocess.TimeoutExpired:
-        raise StartError(f"git worktree add took more than {ADD_SECONDS} s. It may still finish.") from None
-    if proc.returncode != 0:
-        raise StartError(proc.stderr.strip() or "git worktree add failed.")
+    _add_worktree(repo, *args)
     return path, False, warnings
 
 
+def find_or_add_pr_worktree(repo: str, number: int) -> tuple[str, bool, list[str]]:
+    """The worktree on pull request ``number`` as the branch ``pr-<N>``: the one already on it, brought up to the PR
+    by a fast-forward (reused), else a new one in ``<repo>-worktrees/pr-<N>``. Also the warnings for the toast."""
+    branch, head = f"pr-{number}", f"pull/{number}/head"
+    path = _checked_out(repo).get(branch)
+    reused = path is not None
+    if path:
+        problem = (_git_problem(path, "fetch", "origin", head, timeout=FETCH_SECONDS)
+                   or _git_problem(path, "merge", "--ff-only", "FETCH_HEAD", timeout=ADD_SECONDS))
+    else:
+        problem = _git_problem(repo, "fetch", "origin", f"{head}:{branch}", timeout=FETCH_SECONDS)
+        if problem and not _has_ref(repo, f"refs/heads/{branch}"):
+            raise StartError(problem)
+        path = _new_path(repo, branch)
+        _add_worktree(repo, path, branch)
+    return path, reused, [f"{branch} may be behind #{number}: {problem}"] if problem else []
+
+
 def start_command(settings: Settings, name: str, session_id: str, prompt: str) -> list[str]:
     """Finds ``claude`` on the PATH that the sweeps use. If it is not there, the terminal's PATH must find it.
     ``--`` ends the options, so a prompt that starts with ``-`` stays the prompt."""
````

- [ ] **Step 4: Run all the backend tests**

Run: `cd backend && uv run pytest -q`
Expected: `400 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/claude_code.py backend/tests/test_claude_code.py
git commit -m "Backend: Claude Code's worktree on a pull request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: periscope's repos for a pull request, and a start with no ticket

**Files:**
- Modify: `backend/src/todohub/periscope.py`
- Test: `backend/tests/test_periscope.py`

- [ ] **Step 1: Write the failing tests**

````diff
diff --git a/backend/tests/test_periscope.py b/backend/tests/test_periscope.py
index 07b2d22..ba24e1d 100644
--- a/backend/tests/test_periscope.py
+++ b/backend/tests/test_periscope.py
@@ -12,7 +12,7 @@ from todohub.api import create_app
 from todohub.config import load_settings
 from todohub.db import DB
 from todohub.linear import LinearError
-from todohub.periscope import Periscope, PeriscopeError, pr_links, review_prs
+from todohub.periscope import Periscope, PeriscopeError, pr_links, pr_repos, review_prs
 from todohub.start import LAST_REPO_KEY, REPOS_KEY
 from conftest import FakeLinear, make_issue
 
@@ -79,6 +79,12 @@ def test_client_start_with_a_pr_sends_no_branch(peri):
                                                          "title": "Review", "prompt": "Review it.", "name": "eng-3"})]
 
 
+def test_client_start_with_no_ticket_sends_none(peri):
+    Periscope(URL, transport=peri.transport).start(repo="/dev/api", pr=812, prompt="Review it.", name="pr-812")
+    assert peri.calls == [("POST", "/api/linear/start", {"repo": "/dev/api", "pr": 812, "prompt": "Review it.",
+                                                         "name": "pr-812"})]
+
+
 def test_client_errors(peri):
     client = Periscope(URL, transport=peri.transport)
     peri.answer = httpx.Response(409, json={"detail": "start already running"})
@@ -139,6 +145,13 @@ def test_review_prs_match_repos_by_origin_and_name_the_missing_ones():
     assert [p["label"] for p in prs] == ["acme/api#812"] and hint == ""
 
 
+def test_pr_repos_are_the_ones_whose_origin_is_the_prs_repo():
+    assert pr_repos(SLUGGED, "ACME/api", 812) == ([{"repo": "/dev/api", "label": "api"}], ["/dev/api"])
+    assert pr_repos(SLUGGED, "acme/web", 812) == ([{"repo": "/dev/web", "label": "web"}], [])
+    assert pr_repos(SLUGGED, "acme/ios", 7) == ([], [])
+    assert pr_repos(CATALOG, "acme/api", 812) == ([], [])          # an older periscope sends no slug
+
+
 def test_bring_to_front_opens_the_app_by_its_id(monkeypatch):
     ran = []
     monkeypatch.setattr(periscope.subprocess, "run", lambda args, **kw: ran.append(args))
````

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd backend && uv run pytest -q tests/test_periscope.py`
Expected: `1 error during collection`, with `ImportError: cannot import name 'pr_repos'`.

- [ ] **Step 3: Write the code**

`review_prs` now asks `pr_repos`, so one function matches a PR's repo.

````diff
diff --git a/backend/src/todohub/periscope.py b/backend/src/todohub/periscope.py
index a8859d6..798ca1f 100644
--- a/backend/src/todohub/periscope.py
+++ b/backend/src/todohub/periscope.py
@@ -51,18 +51,19 @@ class Periscope:
         """Its repos and worktrees: {repos: [{repo, label, …}], worktrees: [{path, repo, branch, …}], roots}."""
         return self._call("GET", "/api/open/catalog")
 
-    def start(self, *, repo: str, ticket: str, title: str, prompt: str, name: str, branch: str = "",
+    def start(self, *, repo: str, prompt: str, name: str, ticket: str = "", title: str = "", branch: str = "",
               pr: int | None = None) -> dict:
-        """Start Claude on ``branch``, or on pull request ``pr``, which periscope checks out as ``pr-<N>``.
+        """Start Claude on ``branch``, or on pull request ``pr``, which periscope checks out as ``pr-<N>``. The card
+        shows ``ticket`` and its ``title``. With no ticket, an older periscope answers 422.
         {mode: "spawned", pid, path, reused, session_id, email}, or {mode: "existing", pid} when a Claude is
         already on the branch. Periscope gives a spawned Claude ``name`` on its rail and pins it. ``email`` is None
         when periscope finds no email for the account, and an older periscope sends neither field. A spawned start
         also has ``warning`` when a worktree problem did not stop it, for example a PR worktree that stays behind
         the PR."""
         target = {"pr": pr} if pr is not None else {"branch": branch}
+        linked = {"ticket": ticket, "title": title} if ticket else {}
         return self._call("POST", "/api/linear/start",
-                          {"repo": repo, **target, "ticket": ticket, "title": title, "prompt": prompt, "name": name},
-                          START_SECONDS)
+                          {"repo": repo, **target, **linked, "prompt": prompt, "name": name}, START_SECONDS)
 
     def select(self, pid: str) -> None:
         self._call("POST", "/api/select", {"pid": pid})
@@ -86,21 +87,29 @@ def pr_links(urls: list[str]) -> list[tuple[str, int]]:
     return list(found.values())
 
 
+def pr_repos(catalog: dict, slug: str, number: int) -> tuple[list[dict], list[str]]:
+    """The catalog's repos whose origin is the GitHub repo ``slug``, and the ones with a worktree on ``pr-<N>``."""
+    repos = [{"repo": r["repo"], "label": r["label"]} for r in catalog["repos"]
+             if (r.get("slug") or "").lower() == slug.lower()]
+    paths = {r["repo"] for r in repos}
+    return repos, sorted({w["repo"] for w in catalog["worktrees"]
+                          if w["repo"] in paths and w["branch"] == f"pr-{number}"})
+
+
 def review_prs(links: list[tuple[str, int]], catalog: dict, template: str, issue: dict) -> tuple[list[dict], str]:
     """The popover's PR options: each PR in ``links`` whose GitHub repo is the origin of a periscope repo, with
     ``template`` filled in for it. When none is, the hint that names the PRs' repos."""
     prs: list[dict] = []
     missing: dict[str, None] = {}
     for slug, number in links:
-        repos = [r["repo"] for r in catalog["repos"] if (r.get("slug") or "").lower() == slug.lower()]
+        repos, branch_worktrees = pr_repos(catalog, slug, number)
         if not repos:
             missing.setdefault(slug, None)
             continue
         url = f"https://github.com/{slug}/pull/{number}"
         prs.append({
-            "number": number, "label": f"{slug}#{number}", "url": url, "repos": repos,
-            "branch_worktrees": sorted({w["repo"] for w in catalog["worktrees"]
-                                        if w["repo"] in repos and w["branch"] == f"pr-{number}"}),
+            "number": number, "label": f"{slug}#{number}", "url": url, "repos": [r["repo"] for r in repos],
+            "branch_worktrees": branch_worktrees,
             "prompt": fill_prompt(template, issue, pr=url),
         })
     if prs or not missing:
````

- [ ] **Step 4: Run all the backend tests**

Run: `cd backend && uv run pytest -q`
Expected: `402 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/periscope.py backend/tests/test_periscope.py
git commit -m "Backend: periscope's repos for a PR, and a start with no ticket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: the routes

**Files:**
- Modify: `backend/src/todohub/api.py` (imports, request models, the two start sections, a new section before `pull_week_cache`)
- Test: `backend/tests/test_periscope.py`, `backend/tests/test_claude_code.py`

`start_in_periscope` and `start_in_claude_code` come out of the issue routes, which keep their behavior and their messages. No route of this task adds a Linear comment or remembers a repo.

- [ ] **Step 1: Write the failing tests**

````diff
diff --git a/backend/tests/test_claude_code.py b/backend/tests/test_claude_code.py
index 372c966..feb496c 100644
--- a/backend/tests/test_claude_code.py
+++ b/backend/tests/test_claude_code.py
@@ -453,3 +453,53 @@ def test_meta_says_whether_claude_code_is_on(git_repo):
         settings.repos = repos
         app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear)
         assert TestClient(app).get("/api/meta").json()["claude_code"] is expected
+
+
+PULL = "/api/pulls/acme/api/812"
+
+
+def test_pull_options_list_the_settings_repos_of_the_pr(env, monkeypatch):
+    monkeypatch.setenv("HOME", str(env.repo.parent))
+    git("remote", "set-url", "origin", "git@github.com:Acme/api.git", cwd=env.repo)
+    here = {"repos": [{"repo": str(env.repo), "label": "~/api"}], "branch_worktrees": [], "error": ""}
+    assert env.client.get(f"{PULL}/start").json()["targets"] == {"claude-code": here}
+    git("worktree", "add", "-q", "-b", "pr-812", str(env.repo.parent / "other"), cwd=env.repo)
+    assert env.client.get(f"{PULL}/start").json()["targets"] == {
+        "claude-code": {**here, "branch_worktrees": [str(env.repo)]}}
+    assert env.client.get("/api/pulls/acme/web/812/start").json()["targets"] == {
+        "claude-code": {"repos": [], "branch_worktrees": [], "error": ""}}
+
+
+def test_pull_start_opens_claude_code_on_the_pr(env, push_pr):
+    sha = push_pr("one")
+    r = env.client.post(f"{PULL}/claude-code", json={"repo": str(env.repo), "prompt": "Review it.", "title": "Retry"})
+    assert r.status_code == 200
+    out = r.json()
+    path = str(env.repo.parent / "api-worktrees" / "pr-812")
+    assert out == {"path": path, "reused": False, "session_id": out["session_id"], "warnings": []}
+    assert head_of(path) == sha
+    [script] = env.opened
+    assert script == env.settings.home / "start" / "api-pr-812.command"
+    assert f" --name pr-812-rebin --session-id {out['session_id']} -- 'Review it.'" in script.read_text()
+    # The ticket can be the PR author's, and the PR chose the repo.
+    assert env.linear.comments == []
+    assert env.db.get_meta(REPOS_KEY) is None and env.db.get_meta(LAST_REPO_KEY) is None
+
+
+def test_pull_start_in_a_repo_not_on_the_settings_list_is_a_400(env):
+    r = env.client.post(f"{PULL}/claude-code", json={"repo": "/elsewhere", "prompt": "Review it.", "title": "Retry"})
+    assert r.status_code == 400 and r.json() == {"error": "Pick a repo from the Settings list."}
+    assert env.opened == []
+
+
+def test_pull_start_that_git_refuses_is_a_502_and_nothing_opens(env):
+    r = env.client.post(f"{PULL}/claude-code", json={"repo": str(env.repo), "prompt": "Review it.", "title": "Retry"})
+    assert r.status_code == 502 and "couldn't find remote ref pull/812/head" in r.json()["error"]
+    assert env.opened == []
+
+
+def test_pull_start_is_404_when_no_repo_is_set(opened):
+    settings = load_settings()
+    client = TestClient(create_app(settings, DB(settings.db_path), linear_factory=FakeLinear))
+    r = client.post(f"{PULL}/claude-code", json={"repo": "/x", "prompt": "p", "title": "t"})
+    assert r.status_code == 404 and opened == []
diff --git a/backend/tests/test_periscope.py b/backend/tests/test_periscope.py
index ba24e1d..cd37d43 100644
--- a/backend/tests/test_periscope.py
+++ b/backend/tests/test_periscope.py
@@ -460,3 +460,103 @@ def test_show_when_periscope_is_not_running_does_not_bring_it_forward():
     r = TestClient(app).post("/api/periscope/show", json={"pid": "k"})
     assert r.status_code == 502 and r.json() == {"error": "Periscope is not running at 127.0.0.1:17374."}
     assert fronted == []
+
+
+PULL = "/api/pulls/acme/api/812"
+PULL_START = {"repo": "/dev/api", "prompt": "Review it.", "title": "Retry stuck uploads"}
+
+
+def test_pull_options_with_a_ticket(env, peri):
+    client, _, _ = env
+    peri.catalog = SLUGGED
+    r = client.get(f"{PULL}/start?ticket=ENG-1")
+    assert r.status_code == 200 and r.json() == {
+        "ticket": {"identifier": "ENG-1", "title": "Rebin Globex grades"},
+        "ticket_hint": "",
+        "prompt": REVIEW_PROMPT.replace("ENG-3", "ENG-1"),
+        "targets": {"periscope": {"repos": [{"repo": "/dev/api", "label": "api"}], "branch_worktrees": ["/dev/api"],
+                                  "error": ""}},
+    }
+
+
+def test_pull_options_with_no_ticket(env, peri):
+    client, _, _ = env
+    peri.catalog = SLUGGED
+    o = client.get("/api/pulls/acme/ios/7/start").json()
+    assert o["ticket"] is None and o["ticket_hint"] == ""
+    assert o["prompt"].startswith("Then review https://github.com/acme/ios/pull/7 in this worktree")
+    assert o["targets"] == {"periscope": {"repos": [], "branch_worktrees": [], "error": ""}}
+
+
+def test_pull_options_when_linear_does_not_give_the_ticket(env, peri):
+    client, _, _ = env
+    peri.catalog = SLUGGED
+    o = client.get(f"{PULL}/start?ticket=ENG-9").json()
+    assert o["ticket"] is None
+    assert o["ticket_hint"] == "The prompt leaves ENG-9 out: Issue ENG-9 not found."
+    assert o["prompt"].startswith(f"Then review {PR}")
+
+
+def test_pull_options_when_periscope_is_not_running():
+    def refuse(request):
+        raise httpx.ConnectError("refused")
+
+    settings = settings_on()
+    app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear,
+                     periscope_factory=lambda: Periscope(URL, transport=httpx.MockTransport(refuse)))
+    r = TestClient(app).get(f"{PULL}/start")
+    assert r.status_code == 200
+    assert r.json()["targets"] == {"periscope": {"repos": [], "branch_worktrees": [],
+                                                 "error": "Periscope is not running at 127.0.0.1:17374."}}
+
+
+def test_pull_start_sends_the_pr_and_its_ticket(env, peri, linear):
+    client, db, _ = env
+    peri.answer = httpx.Response(200, json=WITH_SESSION)
+    r = client.post(f"{PULL}/periscope", json={**PULL_START, "ticket": "ENG-1", "ticket_title": "Rebin Globex grades"})
+    assert r.status_code == 200 and r.json() == {**WITH_SESSION, "warnings": []}
+    assert peri.calls == [("POST", "/api/linear/start", {
+        "repo": "/dev/api", "pr": 812, "ticket": "ENG-1", "title": "Rebin Globex grades", "prompt": "Review it.",
+        "name": "pr-812-rebin"})]
+    # The ticket can be the PR author's, and the PR chose the repo.
+    assert linear.comments == []
+    assert db.get_meta(REPOS_KEY) is None and db.get_meta(LAST_REPO_KEY) is None
+
+
+def test_pull_start_with_no_ticket_sends_none(env, peri):
+    client, _, _ = env
+    assert client.post(f"{PULL}/periscope", json=PULL_START).status_code == 200
+    assert peri.calls == [("POST", "/api/linear/start", {
+        "repo": "/dev/api", "pr": 812, "prompt": "Review it.", "name": "pr-812-rebin"})]
+
+
+def test_pull_start_names_the_claude_for_the_pr(peri):
+    settings, named = settings_on(), []
+    app = create_app(settings, DB(settings.db_path), linear_factory=FakeLinear,
+                     periscope_factory=lambda: Periscope(URL, transport=peri.transport),
+                     name_fn=lambda issue: named.append(issue) or "pr-812")
+    TestClient(app).post(f"{PULL}/periscope", json=PULL_START)
+    assert named == [{"identifier": "PR-812", "title": "Retry stuck uploads"}]
+
+
+def test_pull_start_carries_periscopes_warning(env, peri):
+    client, _, _ = env
+    behind = "pr-812 may be behind PR #812: the worktree has local changes"
+    peri.answer = httpx.Response(200, json={**SPAWNED, "warning": behind})
+    assert client.post(f"{PULL}/periscope", json=PULL_START).json() == {**SPAWNED, "warnings": [behind]}
+
+
+def test_pull_start_that_periscope_refuses(env, peri):
+    client, _, _ = env
+    peri.answer = httpx.Response(409, json={"detail": "start already running"})
+    r = client.post(f"{PULL}/periscope", json=PULL_START)
+    assert r.status_code == 409 and r.json() == {"error": "Periscope is already starting #812."}
+
+
+def test_pull_start_is_404_when_periscope_is_off(peri):
+    settings = load_settings()
+    client = TestClient(create_app(settings, DB(settings.db_path), linear_factory=FakeLinear,
+                                   periscope_factory=lambda: Periscope(URL, transport=peri.transport)))
+    assert client.post(f"{PULL}/periscope", json=PULL_START).status_code == 404
+    assert client.get(f"{PULL}/start").json()["targets"] == {}
+    assert peri.calls == []
````

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd backend && uv run pytest -q tests/test_periscope.py tests/test_claude_code.py`
Expected: `14 failed, 87 passed`. The new routes answer 404 or 405.

- [ ] **Step 3: Write the routes**

````diff
diff --git a/backend/src/todohub/api.py b/backend/src/todohub/api.py
index f2ef846..fc77e2a 100644
--- a/backend/src/todohub/api.py
+++ b/backend/src/todohub/api.py
@@ -34,10 +34,10 @@ from .config import (DEFAULT_CHAT_PROMPT, DEFAULT_CODE_PROMPT, DEFAULT_REVIEW_PR
                      read_overrides, source_state, write_overrides)
 from .db import DB
 from .linear import Linear, LinearError, TeamMeta, client_labels_of, is_linear_upload, matching_client_labels, shape_issue
-from .periscope import Periscope, PeriscopeError, bring_to_front, pr_links, review_prs
+from .periscope import Periscope, PeriscopeError, bring_to_front, pr_links, pr_repos, review_prs
 from .selfcmd import self_command
 from .sources import SourceError
-from .start import StartError, claude_name, default_repo, fill_prompt, remember_repo
+from .start import StartError, claude_name, default_repo, fill_prompt, fill_review_prompt, remember_repo
 from .sweep import _env, next_working_day
 from .tools import ToolError
 
@@ -130,6 +130,17 @@ class PeriscopeStartIn(BaseModel):
     prompt: str = Field(min_length=1, max_length=8000)
 
 
+class PullStartIn(BaseModel):
+    repo: str = Field(min_length=1, max_length=500)       # a repo path from the popover's options
+    prompt: str = Field(min_length=1, max_length=8000)
+    title: str = Field(max_length=500)                    # the PR's title, for Claude's name
+
+
+class PullPeriscopeStartIn(PullStartIn):
+    ticket: str = Field(default="", max_length=50)        # the ticket on periscope's card, or ""
+    ticket_title: str = Field(default="", max_length=500)
+
+
 class PeriscopeShowIn(BaseModel):
     pid: str = Field(min_length=1, max_length=100)
 
@@ -1056,6 +1067,17 @@ def create_app(settings: Settings | None = None, db: DB | None = None,
 
     periscope_auth = [*auth, Depends(require_periscope)]
 
+    def start_in_periscope(what: str, **start) -> dict:
+        """Periscope's answer to a start, with its warning in ``warnings``. ``what`` names the start in the 409."""
+        try:
+            result = periscope_call(lambda p: p.start(**start))
+        except HTTPException as exc:
+            if exc.status_code == 409:
+                raise HTTPException(409, f"Periscope is already starting {what}.")
+            raise
+        warning = result.pop("warning", None)
+        return {**result, "warnings": [warning] if warning else []}
+
     @app.get("/api/issues/{issue_id}/periscope", dependencies=periscope_auth)
     def periscope_options(issue_id: str) -> dict:
         """What the popover shows first: periscope's repos, the one to select and why, Linear's branch, the
@@ -1089,22 +1111,14 @@ def create_app(settings: Settings | None = None, db: DB | None = None,
         if bool(branch) == (body.pr is not None):
             raise HTTPException(400, "Send a branch or a PR.")
         issue = shape_issue(linear_call(lambda l: l.get_issue(issue_id)), settings)
-        name = name_claude(issue)
-        try:
-            result = periscope_call(lambda p: p.start(
-                repo=body.repo, branch=branch, pr=body.pr, ticket=issue["identifier"], title=issue["title"],
-                prompt=body.prompt, name=name))
-        except HTTPException as exc:
-            if exc.status_code == 409:
-                raise HTTPException(409, f"Periscope is already starting {issue['identifier']}.")
-            raise
+        result = start_in_periscope(
+            issue["identifier"], repo=body.repo, branch=branch, pr=body.pr, ticket=issue["identifier"],
+            title=issue["title"], prompt=body.prompt, name=name_claude(issue))
         if body.pr is None:
             remember_repo(db, issue, body.repo)
-        warning = result.pop("warning", None)
-        warnings = [warning] if warning else []
         if result.get("session_id"):
-            warnings += add_session_comment(issue, result.get("email"), result["session_id"])
-        return {**result, "warnings": warnings}
+            result["warnings"] += add_session_comment(issue, result.get("email"), result["session_id"])
+        return result
 
     @app.post("/api/periscope/show", dependencies=periscope_auth)
     def periscope_show(body: PeriscopeShowIn) -> dict:
@@ -1124,6 +1138,24 @@ def create_app(settings: Settings | None = None, db: DB | None = None,
 
     claude_code_auth = [*auth, Depends(require_claude_code)]
 
+    def start_in_claude_code(named: dict, script_name: str, body: StartIn | PullStartIn,
+                             find_worktree: Callable[[str], tuple[str, bool, list[str]]]) -> dict:
+        """Open a script that starts Claude Code with the prompt in the worktree that ``find_worktree`` gives for the
+        repo. Haiku names the Claude for the issue or PR ``named``."""
+        session_id = str(uuid.uuid4())
+        try:
+            path, reused, warnings = find_worktree(body.repo)
+            command = claude_code.start_command(settings, name_claude(named), session_id, body.prompt)
+            claude_code.open_script(claude_code.write_script(settings.home / "start", script_name, path, command))
+        except StartError as exc:
+            raise HTTPException(502, str(exc))
+        return {"path": path, "reused": reused, "session_id": session_id, "warnings": warnings}
+
+    def require_listed(repo: str) -> None:
+        """Git and the start script run only in a repo you listed."""
+        if repo not in settings.repos:
+            raise HTTPException(400, "Pick a repo from the Settings list.")
+
     @app.get("/api/issues/{issue_id}/claude-code", dependencies=claude_code_auth)
     def claude_code_options(issue_id: str) -> dict:
         """What the popover shows first: the Settings repos, the one to select and why, Linear's branch, the
@@ -1146,20 +1178,13 @@ def create_app(settings: Settings | None = None, db: DB | None = None,
         branch = body.branch.strip()
         if not branch:
             raise HTTPException(400, "The branch is empty")
-        if body.repo not in settings.repos:       # git and the script run only in a repo you listed
-            raise HTTPException(400, "Pick a repo from the Settings list.")
+        require_listed(body.repo)
         issue = shape_issue(linear_call(lambda l: l.get_issue(issue_id)), settings)
-        session_id = str(uuid.uuid4())
-        try:
-            path, reused, warnings = claude_code.find_or_add_worktree(body.repo, branch)
-            command = claude_code.start_command(settings, name_claude(issue), session_id, body.prompt)
-            script = claude_code.write_script(settings.home / "start", issue["identifier"], path, command)
-            claude_code.open_script(script)
-        except StartError as exc:
-            raise HTTPException(502, str(exc))
+        result = start_in_claude_code(issue, issue["identifier"], body,
+                                      lambda repo: claude_code.find_or_add_worktree(repo, branch))
         remember_repo(db, issue, body.repo)
-        warnings += add_session_comment(issue, claude_code.account_email(settings), session_id)
-        return {"path": path, "reused": reused, "session_id": session_id, "warnings": warnings}
+        result["warnings"] += add_session_comment(issue, claude_code.account_email(settings), result["session_id"])
+        return result
 
     # ---- Start in Claude Desktop --------------------------------------------------------------
     def require_claude_desktop() -> None:
@@ -1219,6 +1244,59 @@ def create_app(settings: Settings | None = None, db: DB | None = None,
             pull_cache["data"] = pulls.updated(pull_cache["data"], f"{owner}/{name}", number, pr)
             return pulls_payload()
 
+    # ---- Review a pull request ------------------------------------------------------------------
+    # No session comment: the ticket that a PR names can be its author's, and a comment can notify them.
+    def named_pull(number: int, title: str) -> dict:
+        """What Haiku names the Claude for: ``pr-812`` and up to three words for the PR's title."""
+        return {"identifier": f"PR-{number}", "title": title}
+
+    @app.get("/api/pulls/{owner}/{name}/{number}/start", dependencies=auth)
+    def pull_start_options(owner: str, name: str, number: int, ticket: str = "") -> dict:
+        """What Review's popover shows first: the ticket that the PR's row shows, the review prompt filled in, and for
+        each target that is on, its repos whose origin is the PR's repo and the ones with a worktree on pr-<N>."""
+        slug = f"{owner}/{name}"
+        issue, ticket_hint = None, ""
+        if ticket:
+            try:
+                issue = shape_issue(linear_call(lambda l: l.get_issue(ticket)), settings)
+            except HTTPException as exc:
+                ticket_hint = f"The prompt leaves {ticket} out: {exc.detail}"
+        targets = {}
+        if settings.periscope_on:
+            repos, branch_worktrees, error = [], [], ""
+            try:
+                repos, branch_worktrees = pr_repos(periscope_call(lambda p: p.catalog()), slug, number)
+            except HTTPException as exc:
+                error = exc.detail
+            targets["periscope"] = {"repos": repos, "branch_worktrees": branch_worktrees, "error": error}
+        if settings.claude_code_on:
+            repos = [r for r in repo_labels() if (claude_code.github_slug(r["repo"]) or "").lower() == slug.lower()]
+            targets["claude-code"] = {
+                "repos": repos, "error": "",
+                "branch_worktrees": [r["repo"] for r in repos if f"pr-{number}" in claude_code.worktrees(r["repo"])]}
+        return {
+            "ticket": {"identifier": issue["identifier"], "title": issue["title"]} if issue else None,
+            "ticket_hint": ticket_hint,
+            "prompt": fill_review_prompt(settings.review_prompt, issue, f"https://github.com/{slug}/pull/{number}"),
+            "targets": targets,
+        }
+
+    @app.post("/api/pulls/{owner}/{name}/{number}/periscope", dependencies=periscope_auth)
+    def pull_periscope_start(owner: str, name: str, number: int, body: PullPeriscopeStartIn) -> dict:
+        """Ask periscope to start Claude on the PR with the prompt and a name from Haiku. The repo is one of the
+        options, whose origin is the PR's repo. A Claude already on pr-<N> is answered as mode "existing"."""
+        return start_in_periscope(
+            f"#{number}", repo=body.repo, pr=number, ticket=body.ticket, title=body.ticket_title, prompt=body.prompt,
+            name=name_claude(named_pull(number, body.title)))
+
+    @app.post("/api/pulls/{owner}/{name}/{number}/claude-code", dependencies=claude_code_auth)
+    def pull_claude_code_start(owner: str, name: str, number: int, body: PullStartIn) -> dict:
+        """Find or make the worktree on pr-<N>, then open a script that starts Claude Code there with the prompt and a
+        name from Haiku."""
+        require_listed(body.repo)
+        return start_in_claude_code(named_pull(number, body.title), f"{name}-pr-{number}", body,
+                                    lambda repo: claude_code.find_or_add_pr_worktree(repo, number))
+
     pull_week_cache: dict = {"at": 0.0, "data": None}
 
     @app.get("/api/pulls/weekly", dependencies=auth)
````

- [ ] **Step 4: Run all the backend tests**

Run: `cd backend && uv run pytest -q`
Expected: `417 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/api.py backend/tests/test_periscope.py backend/tests/test_claude_code.py
git commit -m "Backend: routes that start a review of a pull request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Review's popover

**Files:**
- Modify: `app/src/api.ts`, `app/src/start.ts`

The app has no test runner. The type check is this task's check, and Task 8 runs the popover in a browser. `frame`, `repoField`, `promptField`, `startButton` and `actions` come out of `startPopover`, which must look and work as before.

- [ ] **Step 1: Write the types, the calls and the popover**

````diff
diff --git a/app/src/api.ts b/app/src/api.ts
index aaf53ce..b1f7b19 100644
--- a/app/src/api.ts
+++ b/app/src/api.ts
@@ -350,6 +350,23 @@ export interface StartOptions {
   pr_hint?: string;                             // periscope only: "No periscope repo has acme/web as its origin. …", or ""
 }
 
+/** Where Claude starts, from a popover. */
+export type StartTarget = "periscope" | "claude-code";
+
+/** Review in To review: what its popover shows first. */
+export interface PullStartOptions {
+  ticket: { identifier: string; title: string } | null;   // the PR's ticket, as Linear gives it
+  ticket_hint: string;                          // why the prompt leaves the row's ticket out, or ""
+  prompt: string;                               // the review prompt, filled in
+  targets: Partial<Record<StartTarget, PullStartTarget>>;   // only the ones that are on
+}
+
+export interface PullStartTarget {
+  repos: { repo: string; label: string }[];     // the ones whose origin is the PR's repo
+  branch_worktrees: string[];                   // the ones with a worktree already on pr-<N>
+  error: string;                                // periscope's, when its repos cannot be read; else ""
+}
+
 export interface PeriscopeStart {
   mode: "spawned" | "existing";                 // existing: a Claude was already on the branch
   pid: string;                                  // periscope always gives the pane's id
@@ -630,6 +647,12 @@ export const api = {
   slips: (refresh = false) => call<Slips>("GET", `/api/slips${refresh ? "?refresh=true" : ""}`),
   pulls: (refresh = false) => call<Pulls>("GET", `/api/pulls${refresh ? "?refresh=true" : ""}`),
   pull: (repo: string, number: number) => call<Pulls>("POST", `/api/pulls/${repo}/${number}`),
+  pullStartOptions: (p: PullRequest, ticket: string) =>
+    call<PullStartOptions>("GET", `/api/pulls/${p.repo}/${p.number}/start?ticket=${encodeURIComponent(ticket)}`),
+  reviewInPeriscope: (p: PullRequest, body: { repo: string; prompt: string; title: string; ticket: string; ticket_title: string }) =>
+    call<PeriscopeStart>("POST", `/api/pulls/${p.repo}/${p.number}/periscope`, body),
+  reviewInClaudeCode: (p: PullRequest, body: { repo: string; prompt: string; title: string }) =>
+    call<ClaudeCodeStart>("POST", `/api/pulls/${p.repo}/${p.number}/claude-code`, body),
   pullWeeks: () => call<PullWeeks>("GET", "/api/pulls/weekly"),
   editIssue: (id: string, edit: IssueEdit) => call<Issue>("PATCH", `/api/issues/${encodeURIComponent(id)}`, edit),
   /** Move an issue to Linear's trash (restorable there for 30 days); it also leaves Today. */
diff --git a/app/src/start.ts b/app/src/start.ts
index fb2ca06..0b3da12 100644
--- a/app/src/start.ts
+++ b/app/src/start.ts
@@ -1,11 +1,14 @@
-// Start Claude on an issue, from its ⋯ menu. Start in periscope and Start in Claude Code open a popover with
-// the repo, Linear's branch and the code prompt; Start asks periscope, or todo-hub, to start Claude on that
-// branch. For a review ticket, Start in periscope's popover selects one of its PRs, and periscope checks the PR
-// out in place of the branch. Start in Claude Desktop opens a new chat with the chat prompt in its message box.
-// Periscope's toast has Show, which brings periscope to the front with that Claude selected.
+// Start Claude on an issue, from its ⋯ menu, or on a pull request, from Review in To review. Start in periscope
+// and Start in Claude Code open a popover with the repo, Linear's branch and the code prompt; Start asks
+// periscope, or todo-hub, to start Claude on that branch. For a review ticket, Start in periscope's popover
+// selects one of its PRs, and periscope checks the PR out in place of the branch. Start in Claude Desktop opens a
+// new chat with the chat prompt in its message box. Review's popover picks periscope or Claude Code, a repo of the
+// PR and the review prompt, and Start checks the PR out there. Periscope's toast has Show, which brings periscope
+// to the front with that Claude selected.
 import { api } from "./api";
-import type { Issue, Meta, PeriscopePr, StartOptions } from "./api";
+import type { Issue, Meta, PeriscopePr, PeriscopeStart, PullRequest, PullStartOptions, StartOptions, StartTarget } from "./api";
 import { h } from "./dom";
+import type { Child } from "./dom";
 
 export interface StartCtx {
   render: () => void;
@@ -13,49 +16,63 @@ export interface StartCtx {
   fail: (e: unknown) => void;
 }
 
-type Target = "periscope" | "claude-code";
+interface Fields {
+  repo: string;
+  prompt: string;
+  starting: boolean;
+}
 
-interface Popover {
+interface Popover extends Fields {
   issueId: string;
-  target: Target;
+  target: StartTarget;
   options: StartOptions | null;         // null while they load
   pr: PeriscopePr | null;               // the selected PR (periscope only); null starts on the branch
-  repo: string;
   branch: string;
-  prompt: string;
   promptEdited: boolean;                // you typed in the prompt: a PR change keeps it
-  starting: boolean;
 }
 
+interface Review extends Fields {
+  pull: PullRequest;
+  targets: StartTarget[];               // the ones that are on
+  options: PullStartOptions | null;     // null while they load
+  target: StartTarget | null;           // null: no target that is on has the PR's repo
+}
+
+const TARGET_NAME: Record<StartTarget, string> = { "periscope": "periscope", "claude-code": "Claude Code" };
+
 let ctx: StartCtx;
-let popover: Popover | null = null;
-const runningStarts = new Set<string>();    // `${target}:${issueId}` while a start request runs, even if its popover is closed
+let popover: Popover | null = null;         // an issue's
+let review: Review | null = null;           // a pull request's; at most one of the two is open
+// `${target}:${issueId}` or `${target}:${PR url}` while a start request runs, even if its popover is closed
+const runningStarts = new Set<string>();
 
 export function setupStart(c: StartCtx) {
   ctx = c;
 }
 
-/** The popover is on the page. A refresh can take its issue off the page; the keys then go back to it. */
+const hasPopover = () => popover !== null || review !== null;
+
+/** The popover is on the page. A refresh can take its issue or PR off the page; the keys then go back to it. */
 export function isStartOpen(): boolean {
-  return popover !== null && document.querySelector(".start-pop") !== null;
+  return hasPopover() && document.querySelector(".start-pop") !== null;
 }
 
 /** A tab switch takes the popover off the page; the switch renders, so this does not. */
 export function forgetStart() {
-  popover = null;
+  popover = review = null;
 }
 
 export function closeStart() {
-  if (!popover) return;
-  popover = null;
+  if (!hasPopover()) return;
+  forgetStart();
   ctx.render();
 }
 
 /** A pointer down outside the popover closes it in place, not by a re-render, so the click still
  *  lands on its target. */
 export function dismissStart(target: Element) {
-  if (!popover || target.closest?.(".start-pop")) return;
-  popover = null;
+  if (!hasPopover() || target.closest?.(".start-pop")) return;
+  forgetStart();
   document.querySelector(".start-pop")?.remove();
 }
 
@@ -103,8 +120,9 @@ function selectPr(p: Popover, o: StartOptions, pr: PeriscopePr | null) {
   if (!p.promptEdited) p.prompt = pr ? pr.prompt : o.prompt;
 }
 
-async function openFor(i: Issue, target: Target) {
+async function openFor(i: Issue, target: StartTarget) {
   if (popover?.issueId === i.id && popover.target === target) return;
+  review = null;
   const mine: Popover = popover = { issueId: i.id, target, options: null, pr: null, repo: "", branch: "", prompt: "",
     promptEdited: false, starting: runningStarts.has(`${target}:${i.id}`) };
   ctx.render();
@@ -123,6 +141,12 @@ async function openFor(i: Issue, target: Target) {
   }
 }
 
+function toastPeriscope(what: string, r: PeriscopeStart) {
+  ctx.toast(r.mode === "existing" ? `${what} is already open in periscope` : `Started ${what} in periscope`,
+    { label: "Show", run: () => void api.showInPeriscope(r.pid).catch(ctx.fail) });
+  for (const w of r.warnings) ctx.fail(w);
+}
+
 /** Start can run: a repo, a PR or a branch, and a prompt, and no start already running. */
 function canStart(p: Popover): boolean {
   return !p.starting && !!p.repo && (p.pr !== null || !!p.branch.trim()) && !!p.prompt.trim();
@@ -142,9 +166,7 @@ async function start(i: Issue) {
     if (p.target === "periscope") {
       const r = await api.startInPeriscope(i.id, p.pr ? { repo: p.repo, prompt: p.prompt, pr: p.pr.number } : body);
       if (isOpen()) closeStart();
-      ctx.toast(r.mode === "existing" ? `${i.identifier} is already open in periscope` : `Started ${i.identifier} in periscope`,
-        { label: "Show", run: () => void api.showInPeriscope(r.pid).catch(ctx.fail) });
-      for (const w of r.warnings) ctx.fail(w);
+      toastPeriscope(i.identifier, r);
     } else {
       const r = await api.startInClaudeCode(i.id, body);
       if (isOpen()) closeStart();
@@ -159,18 +181,59 @@ async function start(i: Issue) {
   }
 }
 
+/** A start popover: its title, its fields, and ↵ (⌘↵ in the prompt) for ``run``. */
+function frame(label: string, run: () => void, ...fields: Child[]): HTMLElement {
+  return h("div", {
+    class: "start-pop", role: "dialog", "aria-label": label,
+    onkeydown: (e: KeyboardEvent) => {
+      // keyCode 229: WebKit's Enter that commits an IME composition, with isComposing false.
+      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
+      const tag = (e.target as HTMLElement).tagName;
+      if (tag === "BUTTON" || (tag === "TEXTAREA" && !e.metaKey && !e.ctrlKey)) return;
+      e.preventDefault();
+      run();
+    },
+  }, h("div", { class: "start-title" }, label), ...fields);
+}
+
+function repoField(p: Fields, repos: { repo: string; label: string }[]): HTMLElement {
+  return h("label", { class: "start-field" }, h("span", {}, "Repo"), h("select", {
+    class: "start-input start-repo", "aria-label": "Repo", "data-focus": "start-repo", disabled: p.starting,
+    onchange: (e: Event) => { p.repo = (e.target as HTMLSelectElement).value; ctx.render(); },
+  },
+    !p.repo && h("option", { value: "", selected: true, disabled: true }, "Pick a repo"),
+    ...repos.map((r) => h("option", { value: r.repo, selected: r.repo === p.repo }, r.label))));
+}
+
+/** Read-only, not disabled, while starting: the field keeps the focus and the cursor. */
+function promptField(p: Fields, typed: () => void): HTMLElement {
+  return h("label", { class: "start-field top" }, h("span", {}, "Prompt"), h("textarea", {
+    class: "start-input", rows: 4, value: p.prompt, "aria-label": "Prompt", "data-edit": "start-prompt",
+    readOnly: p.starting, oninput: (e: Event) => { p.prompt = (e.target as HTMLTextAreaElement).value; typed(); },
+  }));
+}
+
+function startButton(p: Fields, run: () => void): HTMLButtonElement {
+  return h("button", { type: "button", class: "td-btn primary start-go", "data-focus": "start-go", onclick: run },
+    p.starting ? "Starting…" : "Start", h("kbd", {}, "↵"));
+}
+
+function actions(p: Fields, go: HTMLElement): HTMLElement {
+  return h("div", { class: "start-acts" },
+    h("button", { type: "button", class: "td-btn start-cancel", "data-focus": "start-cancel", disabled: p.starting,
+      onclick: () => closeStart() }, "Cancel", h("kbd", {}, "esc")),
+    go);
+}
+
 /** The popover under the pane's ⋯, when it is open for ``i``. main.ts's keydown closes it on Esc and
  *  keeps the page's keys off the issue behind it. */
 export function startPopover(i: Issue): HTMLElement | "" {
   const p = popover;
   if (!p || p.issueId !== i.id) return "";
-  const label = `Start ${i.identifier} in ${p.target === "periscope" ? "periscope" : "Claude Code"}`;
+  const label = `Start ${i.identifier} in ${TARGET_NAME[p.target]}`;
+  const run = () => void start(i);
   const o = p.options;
-  if (!o) {
-    return h("div", { class: "start-pop", role: "dialog", "aria-label": label },
-      h("div", { class: "start-title" }, label),
-      h("p", { class: "start-wait" }, p.target === "periscope" ? "Asking periscope…" : "Loading…"));
-  }
+  if (!o) return frame(label, run, h("p", { class: "start-wait" }, p.target === "periscope" ? "Asking periscope…" : "Loading…"));
   const pr = p.pr;
   const prs = o.prs ?? [];
   const prSelect = prs.length ? h("select", {
@@ -188,20 +251,13 @@ export function startPopover(i: Issue): HTMLElement | "" {
     : "Periscope checks out the PR in a new worktree.";
   // A PR's repos are the ones whose origin is the PR's repo: another repo would fetch another PR.
   const repos = pr ? o.repos.filter((r) => pr.repos.includes(r.repo)) : o.repos;
-  const repo = h("select", {
-    class: "start-input start-repo", "aria-label": "Repo", "data-focus": "start-repo", disabled: p.starting,
-    onchange: (e: Event) => { p.repo = (e.target as HTMLSelectElement).value; ctx.render(); },
-  },
-    !p.repo && h("option", { value: "", selected: true, disabled: true }, "Pick a repo"),
-    ...repos.map((r) => h("option", { value: r.repo, selected: r.repo === p.repo }, r.label)));
-  const startButton = h("button", { type: "button", class: "td-btn primary start-go", "data-focus": "start-go",
-    onclick: () => void start(i) }, p.starting ? "Starting…" : "Start", h("kbd", {}, "↵"));
+  const go = startButton(p, run);
   const branchHint = h("p", { class: "start-hint" });
   const newWorktreeHint = p.target === "periscope" ? "A new worktree, or the one already on this branch."
     : "A new worktree next to the repo, or the one already on this branch.";
   // Typing does not re-render: Start and the branch's hint follow the fields here.
   const update = () => {
-    startButton.disabled = !canStart(p);
+    go.disabled = !canStart(p);
     const fromLinear = p.branch.trim() === o.branch;
     branchHint.textContent = fromLinear && o.branch_worktrees.includes(p.repo)
       ? "A worktree is already on this branch."
@@ -213,34 +269,127 @@ export function startPopover(i: Issue): HTMLElement | "" {
     type: "text", class: "start-input mono", value: p.branch, "aria-label": "Branch", "data-edit": "start-branch",
     readOnly: p.starting, oninput: (e: Event) => { p.branch = (e.target as HTMLInputElement).value; update(); },
   });
-  const prompt = h("textarea", {
-    class: "start-input", rows: 4, value: p.prompt, "aria-label": "Prompt", "data-edit": "start-prompt",
-    readOnly: p.starting,
-    oninput: (e: Event) => { p.prompt = (e.target as HTMLTextAreaElement).value; p.promptEdited = true; update(); },
-  });
   const repoHint = !pr && p.repo && p.repo === o.repo ? o.hint : "";
-  return h("div", {
-    class: "start-pop", role: "dialog", "aria-label": label,
-    onkeydown: (e: KeyboardEvent) => {
-      // keyCode 229: WebKit's Enter that commits an IME composition, with isComposing false.
-      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
-      const tag = (e.target as HTMLElement).tagName;
-      if (tag === "BUTTON" || (tag === "TEXTAREA" && !e.metaKey && !e.ctrlKey)) return;
-      e.preventDefault();
-      void start(i);
-    },
-  },
-    h("div", { class: "start-title" }, label),
+  return frame(label, run,
     o.pr_hint ? h("p", { class: "start-hint lead" }, o.pr_hint) : "",
     prSelect ? h("label", { class: "start-field" }, h("span", {}, "PR"), prSelect) : "",
     worktreeHint ? h("p", { class: "start-hint" }, worktreeHint) : "",
-    h("label", { class: "start-field" }, h("span", {}, "Repo"), repo),
+    repoField(p, repos),
     repoHint ? h("p", { class: "start-hint" }, repoHint) : "",
     pr ? "" : h("label", { class: "start-field" }, h("span", {}, "Branch"), branch),
     pr ? "" : branchHint,
-    h("label", { class: "start-field top" }, h("span", {}, "Prompt"), prompt),
-    h("div", { class: "start-acts" },
-      h("button", { type: "button", class: "td-btn", "data-focus": "start-cancel", disabled: p.starting,
-        onclick: () => closeStart() }, "Cancel", h("kbd", {}, "esc")),
-      startButton));
+    promptField(p, () => { p.promptEdited = true; update(); }),
+    actions(p, go));
+}
+
+// ---- Review, in Pull requests → To review ------------------------------------------------------------
+/** The targets that are on, in the order of Where. Review shows when there is one. */
+export function reviewTargets(meta: Meta | null): StartTarget[] {
+  return (["periscope", "claude-code"] as const).filter((t) => (t === "periscope" ? meta?.periscope : meta?.claude_code));
+}
+
+/** Select ``target``, with its repo that has a worktree already on pr-<N>, else its first one. */
+function selectTarget(r: Review, o: PullStartOptions, target: StartTarget) {
+  const t = o.targets[target]!;
+  r.target = target;
+  r.repo = t.branch_worktrees[0] ?? t.repos[0].repo;
+  r.starting = runningStarts.has(`${target}:${r.pull.url}`);
+}
+
+/** ``ticket`` is the Linear issue that the PR's row shows, or "". */
+export async function openReview(pull: PullRequest, ticket: string, targets: StartTarget[]) {
+  if (review?.pull.url === pull.url) return;
+  popover = null;
+  const mine: Review = review = { pull, targets, options: null, target: null, repo: "", prompt: "", starting: false };
+  ctx.render();
+  try {
+    const o = await api.pullStartOptions(pull, ticket);
+    if (review !== mine) return;      // closed, or opened for another PR, meanwhile
+    mine.options = o;
+    mine.prompt = o.prompt;
+    const first = targets.find((t) => o.targets[t]?.repos.length);
+    if (first) selectTarget(mine, o, first);
+    ctx.render();
+    // After the tab has put the popover under its row.
+    queueMicrotask(() => {
+      const pop = document.querySelector<HTMLElement>(".start-pop");
+      pop?.scrollIntoView({ block: "nearest" });
+      pop?.querySelector<HTMLElement>(canReview(mine) ? ".start-go" : ".start-cancel")?.focus();
+    });
+  } catch (e) {
+    if (review === mine) closeStart();
+    ctx.fail(e);
+  }
+}
+
+/** Start can run: a target with a repo, and a prompt, and no start already running there. */
+function canReview(r: Review): boolean {
+  return !r.starting && r.target !== null && !!r.prompt.trim();
+}
+
+async function startReview() {
+  const r = review;
+  if (!r?.options || !r.target || !canReview(r)) return;
+  const { pull, target, repo, prompt } = r, { ticket } = r.options;
+  const key = `${target}:${pull.url}`;
+  runningStarts.add(key);
+  r.starting = true;
+  ctx.render();
+  // The popover can be closed, or opened again, while the request runs: act on the one that is open now.
+  const isOpen = () => review?.pull.url === pull.url && review.target === target;
+  try {
+    if (target === "periscope") {
+      const s = await api.reviewInPeriscope(pull, { repo, prompt, title: pull.title,
+        ticket: ticket?.identifier ?? "", ticket_title: ticket?.title ?? "" });
+      if (isOpen()) closeStart();
+      toastPeriscope(`#${pull.number}`, s);
+    } else {
+      const s = await api.reviewInClaudeCode(pull, { repo, prompt, title: pull.title });
+      if (isOpen()) closeStart();
+      ctx.toast(`Started #${pull.number} in Claude Code`);
+      for (const w of s.warnings) ctx.fail(w);
+    }
+  } catch (e) {
+    if (review && isOpen()) { review.starting = false; ctx.render(); }
+    ctx.fail(e);
+  } finally {
+    runningStarts.delete(key);
+  }
+}
+
+/** The PR that Review's popover is open for. */
+export const reviewedPull = (): PullRequest | null => review?.pull ?? null;
+
+/** Review's popover. The tab puts it under its PR's row. */
+export function reviewPopover(): HTMLElement | "" {
+  const r = review;
+  if (!r) return "";
+  const n = r.pull.number, o = r.options, only = r.targets.length === 1;
+  const label = `Review #${n}${only ? ` in ${TARGET_NAME[r.targets[0]]}` : ""}`;
+  const run = () => void startReview();
+  if (!o) return frame(label, run, h("p", { class: "start-wait" }, "Loading…"));
+  const go = startButton(r, run);
+  const update = () => { go.disabled = !canReview(r); };
+  update();
+  const where = only ? "" : h("div", { class: "start-field" }, h("span", {}, "Where"),
+    h("span", { class: "segmented", role: "group", "aria-label": "Where" }, ...r.targets.map((t) => h("button", {
+      type: "button", class: `seg${r.target === t ? " on" : ""}`, "aria-pressed": String(r.target === t),
+      "data-focus": `start-${t}`, disabled: !o.targets[t]?.repos.length,
+      onclick: () => { selectTarget(r, o, t); ctx.render(); },
+    }, TARGET_NAME[t]))));
+  const selected = r.target && o.targets[r.target];
+  const hint = !selected ? ""
+    : selected.branch_worktrees.includes(r.repo) ? `A worktree is already on pr-${n}.`
+    : r.target === "periscope" ? "Periscope checks out the PR in a new worktree."
+    : `A new worktree next to the repo, on pr-${n}.`;
+  const reasons = r.targets.filter((t) => !o.targets[t]?.repos.length).map((t) => h("p", { class: "start-hint off" },
+    o.targets[t]?.error || `No repo in ${t === "periscope" ? "periscope" : "Settings"} has ${r.pull.repo} as its origin.`));
+  return frame(label, run,
+    o.ticket_hint ? h("p", { class: "start-hint lead" }, o.ticket_hint) : "",
+    where,
+    hint ? h("p", { class: "start-hint" }, hint) : "",
+    ...reasons,
+    selected ? repoField(r, selected.repos) : "",
+    selected ? promptField(r, update) : "",
+    actions(r, go));
 }
````

- [ ] **Step 2: Type check**

Run: `cd app && node_modules/.bin/tsc --noEmit; echo $?`
Expected: `0`

- [ ] **Step 3: Commit**

```bash
git add app/src/api.ts app/src/start.ts
git commit -m "App: Review's popover

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: the button in To review, and the text

**Files:**
- Modify: `app/src/pulls.ts`, `app/src/main.ts`, `app/src/styles.css`
- Modify: `app/src/settings.ts`, `README.md`

- [ ] **Step 1: Add the button, the key, the popover's place and the focus**

`paint()` and `render()` rebuild the tab, so `focusNow` and `refocus` learn the popover's fields, and `placeReview` puts the popover under its row again. The popover is in `.pr-wrap`, not in the row: a click in it does not fold or select the row, and its width comes from the table.

````diff
diff --git a/app/src/main.ts b/app/src/main.ts
index 4aa003e..0496cf6 100644
--- a/app/src/main.ts
+++ b/app/src/main.ts
@@ -14,7 +14,7 @@ import { CATEGORIES, CATEGORY_NAME, categoryIcon, clientLogo, ensureLogos, group
 import type { Category } from "./avatars";
 import { closedType, dueLabel, isoDay, isOpen, localToday, when } from "./issues";
 import { detailBody, details, loadDetail, paneKey, postToUndoIn, rebuildKeepingPane, setDescription, setupPane, titleField } from "./pane";
-import { closeStart, dismissStart, forgetStart, isStartOpen, setupStart, startItems, startPopover } from "./start";
+import { closeStart, dismissStart, forgetStart, isStartOpen, reviewTargets, setupStart, startItems, startPopover } from "./start";
 import { renderMarkdown } from "./markdown";
 import { installUpdate, RELEASES_URL, update, watchForUpdates } from "./update";
 
@@ -3460,6 +3460,7 @@ setupPulls({
   rerender: () => { if (state.tab === "pulls" && !editing()) render(); else renderHeader(); },
   toast: (m) => void toast(m),
   issues: () => state.issues,
+  meta: () => state.meta,
 });
 
 const settingsCtx: SettingsCtx = {
@@ -3580,7 +3581,8 @@ async function submitCapture() {
 }
 
 // ---- keyboard -----------------------------------------------------------------------------------
-const SHORTCUTS: [string, string][] = [
+// The third part says when the key is on; a key without one always is.
+const SHORTCUTS: [string, string, (() => boolean)?][] = [
   ["j / k", "Next / previous task or pull request"],
   ["a or ⌘↩", "Approve (or close / post / track); on a linked card, do its pick"],
   ["d, then 1–5", "Drop, with a reason (on a linked card: pick Drop)"],
@@ -3592,7 +3594,8 @@ const SHORTCUTS: [string, string][] = [
   ["⇧⌘R", "Reload: restart the backend and the window after a code change"],
   ["e", "Edit the title (an Inbox card, or the issue in Today, Client and Dev)"],
   ["⇧E · ⇧S · ⇧C", "Today, Client, Dev: edit the description · add a sub-issue · comment (⌘↵ posts)"],
-  ["p", "Today, Client, Dev: start the issue in periscope (a worktree, Claude and a prompt)"],
+  ["p", "Today, Client, Dev: start the issue in periscope (a worktree, Claude and a prompt)", () => !!state.meta?.periscope],
+  ["p", "Pull requests (To review): review the selected pull request (a worktree, Claude and a prompt)", () => reviewTargets(state.meta).length > 0],
   ["c", "Capture a task"],
   ["/", "Filter"],
   ["⌘1 – ⌘7", "Inbox, Today, Client, Dev, Pull requests, Insights, Settings (also ⌘,)"],
@@ -3641,7 +3644,7 @@ function focusedCard(): HTMLElement | null {
 
 function showShortcuts() {
   modal("Keyboard shortcuts", h("table", { class: "stats" },
-    h("tbody", {}, ...SHORTCUTS.filter(([k]) => k !== "p" || state.meta?.periscope).map(([k, v]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, v))))));
+    h("tbody", {}, ...SHORTCUTS.filter(([, , isOn]) => !isOn || isOn()).map(([k, v]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, v))))));
 }
 
 // Swapping what's under the pointer before it's released would lose the click.
diff --git a/app/src/pulls.ts b/app/src/pulls.ts
index d10f9cd..2f7f861 100644
--- a/app/src/pulls.ts
+++ b/app/src/pulls.ts
@@ -3,10 +3,11 @@
 // from GitHub data only. A stack (pull requests built on each other) sorts and shows as one unit.
 import { openUrl } from "@tauri-apps/plugin-opener";
 import { api, ApiError } from "./api";
-import type { Issue, PullRequest, Pulls } from "./api";
+import type { Issue, Meta, PullRequest, Pulls } from "./api";
 import { groupMark } from "./avatars";
 import type { Group } from "./avatars";
 import { h, loadPref, pageHead, savePref, svg } from "./dom";
+import { forgetStart, openReview, reviewedPull, reviewPopover, reviewTargets } from "./start";
 
 export interface PullsCtx {
   /** Render the page again when this tab shows, else only the sidebar (for its count). */
@@ -14,6 +15,7 @@ export interface PullsCtx {
   toast: (message: string) => void;
   /** Your open Linear issues: the one a branch or title names shows with its status and due date. */
   issues: () => Issue[];
+  meta: () => Meta | null;
 }
 let ctx: PullsCtx;
 export function setupPulls(c: PullsCtx) { ctx = c; }
@@ -276,10 +278,15 @@ function commentsCell(comments: number, open: number): Node {
   return h("span", {}, icon("msg", "i mute"), String(comments), open > 0 && " · ", open > 0 && h("span", { class: "open-n" }, `${open} open`));
 }
 
+/** Review shows in To review when periscope or Claude Code can start one. */
+const hasReview = () => st.side === "review" && reviewTargets(ctx.meta()).length > 0;
+
 function stepCell(p: PullRequest): Node {
   if (st.side === "review") {
     const ms = since(p.asked_at);
-    return h("span", { class: ms >= 3 * DAY ? "step amb" : "mute" }, long(ms));
+    return h("div", { class: "rv-line" }, h("span", { class: ms >= 3 * DAY ? "step amb" : "mute" }, long(ms)),
+      hasReview() && h("button", { type: "button", class: "rv-btn", "data-act": "review", tabindex: "-1",
+        "aria-haspopup": "dialog", "aria-label": `Review #${p.number}` }, "Review"));
   }
   const s = stepOf(p);
   return h("span", { class: `step ${s.tone}`, title: s.label }, s.label);
@@ -367,7 +374,7 @@ function prRow(p: PullRequest, u: Unit, grp?: HTMLElement): HTMLElement[] {
         "aria-controls": open ? `${domId(key)}-d` : undefined }, p.title),
       metaLine(p, u)),
     grp,
-    h("td", { class: "st" }, stepCell(p)),
+    h("td", { class: st.side === "review" ? "st rv" : "st" }, stepCell(p)),
     h("td", { class: "ci" }, ciCell(p)),
     h("td", { class: "cm" }, commentsCell(p.comments, p.open_threads)),
     h("td", { class: "sz r c-size" }, `+${num(p.additions)} −${num(p.deletions)}`),
@@ -618,6 +625,7 @@ function panel(): HTMLElement {
   const order = [...listed.flatMap((u) => (isFolded(u) ? [] : u.all)), ...(st.fold ? folded : [])].map(keyOf);
   if (!st.sel || !order.includes(st.sel)) st.sel = order[0] ?? null;
 
+  const reviewed = reviewedPull(), isReviewed = side === "review" && !!reviewed && order.includes(keyOf(reviewed));
   const rows = us.length > 0 || folded.length > 0;
   const empty = !d ? (st.loading ? [h("span", { class: "spinner" }), "Reading your pull requests from GitHub…"] : [])
     : q ? [`No pull request matches “${st.filter.trim()}”.`, h("br"), h("button", { class: "secondary", "data-clear": "" }, "Clear the filter")]
@@ -627,17 +635,24 @@ function panel(): HTMLElement {
   return h("div", { id: "pr-panel", role: "tabpanel", "aria-labelledby": `tab-${side}` },
     banner(),
     strip(base, !!d),
-    rows ? table(us, folded, secs) : h("div", { class: "empty pr-empty" }, ...empty),
-    rows && h("p", { class: "pr-hint" }, kbd("j"), kbd("k"), " move · ", kbd("Space"), " opens or closes · ", kbd("o"), " GitHub · ",
+    rows ? h("div", { class: "pr-wrap" }, table(us, folded, secs), isReviewed && reviewPopover())
+      : h("div", { class: "empty pr-empty" }, ...empty),
+    rows && h("p", { class: "pr-hint" }, kbd("j"), kbd("k"), " move · ", kbd("Space"), " opens or closes · ",
+      hasReview() && kbd("p"), hasReview() && " review · ", kbd("o"), " GitHub · ",
       kbd("l"), " Linear · ", side === "mine" && kbd("g"), side === "mine" && " groups · ",
       kbd("1"), "–", kbd(String(VIEWS[side].length)), " pick a view · ", kbd("?"), " all keys"));
 }
 
 type Focus = { on: "filter"; from: number | null; to: number | null } | { on: "act"; act: string; key: string | null }
+  | { on: "start"; field: string; from: number | null; to: number | null }
   | { on: "stack"; id: string } | { on: "section"; key: string } | { on: "table" } | { on: "tab" } | null;
 function focusNow(): Focus {
   const a = document.activeElement;
   if (a === filterInput) return { on: "filter", from: filterInput.selectionStart, to: filterInput.selectionEnd };
+  if (a instanceof HTMLElement && a.closest(".start-pop")) {
+    const text = a instanceof HTMLTextAreaElement ? a : null;
+    return { on: "start", field: a.dataset.focus ?? a.dataset.edit ?? "", from: text?.selectionStart ?? null, to: text?.selectionEnd ?? null };
+  }
   if (a instanceof HTMLElement && a.dataset.act && root?.contains(a)) {
     return { on: "act", act: a.dataset.act, key: a.closest<HTMLElement>("tr")?.dataset.key ?? null };
   }
@@ -653,6 +668,12 @@ function refocus(f: Focus) {
   if (f?.on === "filter") {
     filterInput.focus();
     if (f.from !== null) filterInput.setSelectionRange(f.from, f.to);
+  } else if (f?.on === "start") {
+    const pop = root?.querySelector(".start-pop"), field = CSS.escape(f.field);
+    if (!pop) return focusSel(false);
+    const el = pop.querySelector<HTMLElement>(`[data-focus="${field}"], [data-edit="${field}"]`);
+    el?.focus({ preventScroll: true });
+    if (el instanceof HTMLTextAreaElement && f.from !== null) el.setSelectionRange(f.from, f.to);
   } else if (f?.on === "act") {
     const row = f.key ? `tr[data-key="${CSS.escape(f.key)}"] ` : "";
     root?.querySelector<HTMLElement>(`${row}[data-act="${f.act}"]`)?.focus();
@@ -677,15 +698,26 @@ export function pullsView(): HTMLElement {
   if (!st.loading && Date.now() - lastRead() > READ_EVERY && Date.now() - st.askedAt > MIN) void loadPulls();
   const f = focusNow();
   root = h("div", { class: "prs", onclick: onClick, onmouseover: onHover, onmouseleave: onHover, onfocusin: onFocusIn }, head(), panel());
-  queueMicrotask(() => refocus(f));           // once the page is in the window
+  queueMicrotask(() => { placeReview(); refocus(f); });      // once the page is in the window
   return root;
 }
 
+/** Put Review's popover under its row, and let the page grow to show all of it. */
+function placeReview() {
+  const pop = root?.querySelector<HTMLElement>(".pr-wrap > .start-pop"), p = reviewedPull();
+  const row = p && root?.querySelector<HTMLElement>(`tr.pr-row[data-key="${CSS.escape(keyOf(p))}"]`);
+  if (!pop || !row) return;
+  const top = row.offsetTop + row.offsetHeight - 4;
+  pop.style.top = `${top}px`;
+  pop.parentElement!.style.setProperty("--pop-bottom", `${top + pop.offsetHeight}px`);
+}
+
 /** Draw the tab again in place, keeping the focus where it was. */
 function paint() {
   if (!root?.isConnected) return;
   const f = focusNow();
   root.replaceChildren(head(), panel());
+  placeReview();
   refocus(f);
 }
 
@@ -786,6 +818,7 @@ function setGrouped(on: boolean) {
 function pickView(id: string) { st.view[st.side] = id; st.note = false; paint(); }
 function switchSide(side: Side) {
   if (side === st.side) return;
+  forgetStart();
   st.side = side;
   st.note = false;
   st.open.clear();
@@ -800,6 +833,9 @@ function act(kind: string, p: PullRequest | undefined) {
     const lin = linearOf(p);
     if (lin?.url) void openUrl(lin.url);
     else ctx.toast("No Linear issue in the branch name or title.");
+  } else if (kind === "review") {
+    st.sel = keyOf(p);
+    void openReview(p, linearOf(p)?.ident ?? "", reviewTargets(ctx.meta()));
   } else if (kind === "refresh") void refreshOne(p);
   else if (kind === "copy") {
     navigator.clipboard.writeText(p.head).then(() => ctx.toast(`Copied ${p.head}`), () => ctx.toast("Could not copy the branch name."));
@@ -888,6 +924,10 @@ export function pullsKey(e: KeyboardEvent): boolean {
       else return false;
       paint();
       return true;
+    case "p":
+      if (!hasReview()) return false;
+      act("review", prOf(st.sel));
+      return true;
     case "o": act("gh", prOf(st.sel)); return true;
     case "l": act("lin", prOf(st.sel)); return true;
     default: return false;
diff --git a/app/src/styles.css b/app/src/styles.css
index f131ded..bd6cb85 100644
--- a/app/src/styles.css
+++ b/app/src/styles.css
@@ -1734,6 +1734,18 @@ tr.pr-row.open > td:not(.rail), .pr-table tr.detail > td:not(.rail) { background
 .fold-b:hover { color: var(--ink); }
 .fold-b .i { margin: 0 0 0 auto; transition: transform .12s; }
 .fold-b[aria-expanded="true"] .i { transform: rotate(90deg); }
+/* To review: the row's Review button (it keeps its space, so the row does not move) and its popover, which
+   placeReview puts under the row. The page grows to --pop-bottom, so the last row's popover can scroll into view. */
+.pr-wrap { position: relative; }
+.pr-wrap:has(> .start-pop) { min-height: var(--pop-bottom); }
+.pr-table td.st.rv { overflow: visible; }
+.rv-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
+.prs .rv-btn { margin: -3px 0 -4px; border-radius: 6px; padding: 0 10px; font-size: 12px; font-weight: 600; line-height: 24px;
+  background: var(--surface); border: 1px solid var(--border); color: var(--ink); cursor: pointer; opacity: 0; }
+tr.pr-row:hover .rv-btn, tr.pr-row.sel .rv-btn { opacity: 1; }
+.pr-wrap > .start-pop { top: 0; right: 148px; }
+@container (max-width: 920px) { .pr-wrap > .start-pop { right: 30px; } }
+@container (max-width: 720px) { .pr-wrap > .start-pop { right: 0; } }
 /* the row, opened in place */
 .pr-table tr.detail > td { padding: 2px 12px 14px 0; white-space: normal; }
 .pr-table tr.detail > td.rail { padding: 0; }
@@ -1823,6 +1835,8 @@ tr.pr-row.open > td:not(.rail), .pr-table tr.detail > td:not(.rail) { background
 textarea.start-input { resize: vertical; line-height: 1.5; }
 .start-hint { margin: -4px 0 2px 64px; font-size: 12px; color: var(--muted); }
 .start-hint.lead { margin-left: 0; }
+.start-hint.off { color: var(--warn-ink); }
+.start-pop .segmented { justify-self: start; }
 .start-acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
 .set-prompt { display: block; width: 100%; max-width: 640px; box-sizing: border-box; resize: vertical; font: inherit; line-height: 1.5; }
 /* Settings → Start Claude: the repo rows, the + Add field and the two prompts. .set-label gives each part its top
````

- [ ] **Step 2: Type check and build**

Run: `cd app && node_modules/.bin/tsc --noEmit && node_modules/.bin/vite build | tail -1`
Expected: `✓ built in …`

- [ ] **Step 3: Commit**

```bash
git add app/src/pulls.ts app/src/main.ts app/src/styles.css
git commit -m "App: Review in To review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Update the Settings text and the README**

````diff
diff --git a/README.md b/README.md
index a08a84d..48a16f9 100644
--- a/README.md
+++ b/README.md
@@ -93,6 +93,7 @@ launchd (weekdays 8, 10, 12, 14, 16)        TodoHub.app (Tauri) + menu-bar item,
     - **Group** (next to Refresh all, or **g**) splits Mine into one section for each client or project, with the heading of Client and Dev: "5 open · 2 need you · 1 CI failing". The rows sort inside each section. Sorted by Next step, the section with the most urgent first row comes first; "No client or project" always comes last. Click a heading to fold its section until the app restarts. In a section, a stack member in another client or project names it under its title. The app remembers whether the groups are on.
   - **Stacks:** a pull request whose base branch is another of yours is built on it. A stack shows as one unit: a summary row with the merge order and the values it sorts by, then its pull requests on a rail. The ones the view leaves out stay in grey, so a stack never splits. Point at one to light up the whole stack. Click the rail or the summary row to fold the stack to its summary row, with its count on the rail; click again to unfold it. A folded stack stays folded until the app restarts.
   - **A row, opened in place** (click, or Space; j/k move): failing checks with their run time, the open threads, the Linear issue the branch or title names (its status and due date when it's one of your open issues), and the reviews. **Open in GitHub** (**o**), **Open ENG-123** (**l**), **Copy branch name**, and **Refresh**, which reads that one pull request from GitHub again (1 point). A merged or closed one leaves the list.
+  - **Review** (To review only): each row has **Review** after its waiting time, on hover and on the selected row (**p**). It starts Claude on the pull request's code, in periscope or in Claude Code (see **Review a pull request** below). It shows when Start in periscope or Start in Claude Code is on.
   - **Reading GitHub:** when the app starts, and while the tab shows, about every 5 minutes after the last read (a read costs about 20 of the 5,000 points an hour GitHub allows). **Refresh all** (or **⌘R**) reads now and starts the 5 minutes again. When `gh` fails, a banner says why and the page keeps the last read. The sidebar count is Needs you plus To review.
 - **Insights:** two views, **Overview** and **Weekly digest**; the app remembers which you used.
   - **Tiles** (top of Overview): closed this week (and last week), lines merged this week (added and removed, in how many pull requests, and last week's figures), open issues pushed 2+ times, and sweep cost over the last 7 days. Hover a tile for how it's counted; click it to jump to the chart behind it (the sweep-cost tile opens the sweep history).
@@ -109,7 +110,7 @@ launchd (weekdays 8, 10, 12, 14, 16)        TodoHub.app (Tauri) + menu-bar item,
   - **Appearance:** the four styles as small pictures (the theme button and **t** change the same setting), and where Daylight follows the sun: a place name with latitude and longitude, or **Use my time zone**. It shows today's sunrise and sunset there.
   - **Sources:** the sources the sweep reads, each with its status ("OK · read 10:02", or the problem in red, with **Open claude.ai ↗** for a connector), **Check now**, and a tick box: untick to pause it (it stays in the list, and sweeps skip it). **Remove** (on hover) takes it off the list; **+ Add a source** lists the supported sources you don't use and adds one back with its read-only tools. A source TodoHub doesn't support yet (Zoom, another mail service) can't be added from here. **Check all now** sweeps every source that's on.
   - **Schedule:** every 1, 2, 3 or 4 hours, between a first and last hour, on weekdays or every day, with a week grid that marks the sweep that writes the morning plan (the first between 6am and 11am) and the one that writes the wrap-up (the first at 3pm or later); if none qualifies, it says so. Saving rewrites the Mac's launchd schedule and reloads it, so the new hours apply at once; if the schedule isn't installed, **Set it up** installs it. The sidebar's "next 12pm" follows these hours.
-  - **Start Claude:** the repos for Start in Claude Code, the code prompt (Start in periscope and Start in Claude Code), the review prompt (Start in periscope, for a review ticket's PR) and the chat prompt (Start in Claude Desktop). **+ Add** takes a full path, such as `~/code/api`, and saves the repo's top folder; for a path inside a worktree, it saves the main repo. A relative path gives "Not a git repo". **Remove** shows on hover. **Save** keeps a prompt, and **Reset to default** brings back its default. The chat prompt cannot start with `/`.
+  - **Start Claude:** the repos for Start in Claude Code, the code prompt (Start in periscope and Start in Claude Code), the review prompt (Review in To review, and Start in periscope for a review ticket's PR) and the chat prompt (Start in Claude Desktop). **+ Add** takes a full path, such as `~/code/api`, and saves the repo's top folder; for a path inside a worktree, it saves the main repo. A relative path gives "Not a git repo". **Remove** shows on hover. **Save** keeps a prompt, and **Reset to default** brings back its default. The chat prompt cannot start with `/`.
 - **Status and priority pills:** status and priority show as colored pills everywhere you can change them (Client, Dev, the Today pane, and priority on Inbox cards). The status menu lists every status your Linear team has, in Linear's order (backlog, not started, started, done, canceled, duplicate): Backlog (dashed), Todo and other not-started ones (grey), Pending (purple), In Progress and other started ones (blue), Done (green), Canceled and Duplicate (struck through). Done, Canceled and Duplicate take the issue off the open lists, with **Undo**. Priority: Urgent (solid red), High (orange), Medium (sand), Low (outline), none (plain text). Click a pill for a menu; number keys pick. Urgent rows get a red left edge and a light tint, High rows an orange edge; in the Today list, Urgent and High also show as a pill in the row's details.
 - **Quiet empty fields:** an unset due date, priority, client or project shows nothing, and a set date shows as text ("Nov 9", "Today", red when late). The field appears when you hover the row or card, or tab to it; on an Inbox card the empty ones take no room until then. The reading panes always show an empty priority, client and project; Client and Dev's pane shows an empty due date too.
 - **Zoom:** ⌘+ (or ⌘=) and ⌘− make the window's text and layout bigger or smaller, in steps of 20%. ⌘0 goes back to 100%.
@@ -123,7 +124,7 @@ launchd (weekdays 8, 10, 12, 14, 16)        TodoHub.app (Tauri) + menu-bar item,
 - **A source that keeps failing:** a sweep can finish fine while one source fails (an expired Gmail or Slack sign-in, a connector that won't connect). When the same source fails in two sweeps in a row (scheduled or Check now), a Mac notification names it, with its error and since when; at most once a day per source. Settings → Sources shows "failed N sweeps in a row" on that row. Nothing is lost meanwhile: the source reads back to its last good sweep once it works again.
 
 **Start in periscope**
-- This feature is off until you set `app.periscope_url` in config.toml. While it is off, the app shows no menu item and no **p** shortcut.
+- This feature is off until you set `app.periscope_url` in config.toml. While it is off, the app shows no menu item and no **p** shortcut for an issue.
 - In Today, Client and Dev, an issue's **⋯** menu has **Start in periscope** (**p**). It opens a popover with three fields. Each field is filled in, except Repo when no repo is remembered. Then Repo shows "Pick a repo".
   - **Repo** lists periscope's repos. It selects the repo you last used for the issue's Linear project (or its client, when it has no project), else the last repo you used.
   - **Branch** is Linear's branch name for the issue.
@@ -144,13 +145,23 @@ launchd (weekdays 8, 10, 12, 14, 16)        TodoHub.app (Tauri) + menu-bar item,
 - todo-hub adds the session comment to the issue, as for periscope. To open that conversation again, run `claude --resume <id>` in the worktree.
 - **Start in Claude Desktop** is in the menu when Claude Desktop is installed. todo-hub checks at most every 10 minutes, and on ⌘R. After you install it, the item shows within 10 minutes, or at once after ⌘R. It opens a new chat with the chat prompt in the message box. Claude Desktop does not send it: change it or send it there. It adds no comment.
 
+**Review a pull request**
+- In **Pull requests → To review**, **Review** (**p** for the selected row) opens a popover under the row.
+  - **Where** picks periscope or Claude Code, when both are on. A target with no repo whose origin is the PR's repo cannot be picked, and a line says why. Periscope comes first.
+  - **Repo** lists the target's repos whose origin is the PR's repo. It selects one with a worktree already on `pr-<N>` if there is one.
+  - **Prompt** is the review prompt on the Settings page, filled in for the PR and the Linear issue that its row shows. For a PR with no issue, or when Linear does not give it, the prompt leaves out each sentence that names `{identifier}`, `{title}` or `{url}`.
+- **Start** (↵, or ⌘↵ in the prompt) checks the PR out as `pr-<N>`. Periscope does it in its own worktrees. For Claude Code, todo-hub adds the worktree `<repo>-worktrees/pr-<N>`, or brings the worktree already on `pr-<N>` up to the PR by a fast-forward. If the fetch or the fast-forward fails, todo-hub uses the worktree or the local branch as it is, and an error toast says why. Your local changes stay.
+- Haiku names the new Claude: `pr-<N>` and up to three words. Periscope's toast has **Show**. With a Claude already on `pr-<N>`, periscope starts nothing.
+- A review adds no comment to the Linear issue, because the issue can be the PR author's. It does not change the remembered repos.
+- A periscope that still needs a ticket answers a review of a PR with no ticket with an error.
+
 ## Safety model
 
 - **Read-only sweeps.** Sweeps and captures run Claude Code with `--restricted --permission-mode dontAsk`. That ignores `~/.claude` settings, so no "allow" rule or bypass mode applies, and it denies anything not explicitly allowed.
   - The allowlist has only read tools for Slack, Gmail, Grain, Calendar and HubSpot, plus the `todo-db` tools.
   - Every known write tool of those connectors, and every other MCP server (Linear, Drive, browser…), is also denied by name. Block time and Save as Gmail draft deny all of HubSpot as well. Add your own servers to `sweep.extra_denied_servers`.
 - **Untrusted input.** Messages are treated as data. The `todo-db` tools validate every field: unknown labels and projects, bad dates, non-https links and issues that aren't yours are rejected or dropped.
-- **Writes need a click.** Nothing a sweep finds reaches Linear until you click Approve, and a candidate can't be approved twice. **Block time** is a write too: it runs only on your click, can call only the calendar's create-event tool, and gets a cleaned title with no addresses or links in it. Start in periscope and Start in Claude Code also add a session comment to the Linear issue, on your click.
+- **Writes need a click.** Nothing a sweep finds reaches Linear until you click Approve, and a candidate can't be approved twice. **Block time** is a write too: it runs only on your click, can call only the calendar's create-event tool, and gets a cleaned title with no addresses or links in it. Start in periscope and Start in Claude Code also add a session comment to the Linear issue, on your click. Review adds none.
 - **Start in Claude Code runs only in your repos.** It runs git and its script only in a repo on the Settings list. It adds branches and worktrees in those repos. The script quotes each value, so an issue's title stays text.
 - **Local API.** It listens on 127.0.0.1 only, needs a random per-launch token, and rejects non-loopback `Host` headers. It also exits by itself if the app goes away.
 - **No HTML from data.** The UI never inserts HTML built from data.
diff --git a/app/src/settings.ts b/app/src/settings.ts
index 9ccc951..235eec4 100644
--- a/app/src/settings.ts
+++ b/app/src/settings.ts
@@ -380,7 +380,7 @@ function startSection(ctx: SettingsCtx): HTMLElement {
       "aria-label": `Remove ${r.label}`, onclick: () => removeRepo(r, ctx) },
       busy === `repo-${r.repo}` ? "Removing…" : "Remove")));
   return card("start", "Start Claude",
-    "How the ⋯ menu's start items start Claude on an issue. In the prompts, {identifier}, {title} and {url} become the issue's.",
+    "How the ⋯ menu's start items start Claude on an issue, and Review starts it on a pull request. In the prompts, {identifier}, {title} and {url} become the issue's.",
     "",
     h("div", { class: "set-start-part" },
       h("div", { class: "set-label" }, "Repos"),
@@ -392,7 +392,7 @@ function startSection(ctx: SettingsCtx): HTMLElement {
       repoError ? h("p", { class: "set-sub bad", role: "alert" }, repoError) : ""),
     promptField("code", "Code prompt", "Start in periscope and Start in Claude Code send it to the new Claude.", ctx),
     promptField("review", "Review prompt",
-      "Start in periscope sends it for a review ticket whose GitHub PR is in a periscope repo. {pr} becomes the PR's link.", ctx),
+      "Review in To review sends it, and Start in periscope for a review ticket whose GitHub PR is in a periscope repo. {pr} becomes the PR's link. For a PR with no ticket, Review leaves out each sentence that names {identifier}, {title} or {url}.", ctx),
     promptField("chat", "Chat prompt", "Start in Claude Desktop puts it in a new chat. It cannot start with /.", ctx));
 }
 
````

- [ ] **Step 5: Type check and commit**

Run: `cd app && node_modules/.bin/tsc --noEmit; echo $?`
Expected: `0`

```bash
git add app/src/settings.ts README.md
git commit -m "Docs: Review a pull request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: check it in a browser, with a real periscope

**Files:** none in the repo. Put the scripts and the screenshots in the scratchpad. Fix what you find in the files of Tasks 2 to 7, each fix with its own commit.

Set up, with no real data:

- [ ] **Step 1: Serve the app and a backend with fake data**

Build `app` and serve `dist` on 127.0.0.1:1430. Start `create_app` from a small script with a scratch `TODOHUB_HOME`, `FakeLinear` and the fake GitHub read below, and `api.TAURI_ORIGINS.append("http://127.0.0.1:1430")`. In the browser, set `window.__TAURI_INTERNALS__` before the page loads, with an `invoke` that answers `backend_info` with `{url, token: "", error: null}`.

The fake GitHub read replaces `todohub.pulls.read` and gives 12 pull requests in `review`: `acme/api#812` with the ref `ENG-1`, `acme/api#790` with no ref, `acme/web#455` (only periscope has the repo), `acme/infra#61` (no target has the repo), and 8 more from `acme/api` to make a long table. Each one has the fields of `PullRequest` in `app/src/api.ts`.

- [ ] **Step 2: Start an isolated periscope from Task 1's worktree**

Run it with `env -i`, a scratch `HOME` and `XDG_CONFIG_HOME`, `PERISCOPE_PORT=17399`, `PERISCOPE_NO_RECLAIM=1`, and stubs for `tmux` (a short `-S` socket path), `claude`, `gh` and `security` first on the PATH. A bare repo at `<scratch>/github.com/acme/api.git` gives it the slug `acme/api`. Push `refs/pull/812/head` and `refs/pull/790/head` to that repo. Point `settings.periscope_url` at 17399. Never use port 17374.

- [ ] **Step 3: Check each line at 1120 px and 760 px, in light and dark**

| Check | Expected |
|---|---|
| Rows, no pointer | Only the selected row shows **Review**; no row moves on hover; no horizontal scroll |
| **p** on #812 | The popover opens under the row, the focus is on **Start**, the prompt names ENG-1 and the PR |
| **p** on #790 | The prompt starts with "Then review", and names no ticket |
| #455 | periscope is selected; Claude Code is disabled; "No repo in Settings has acme/web as its origin." |
| #61 | Both are disabled, each with its reason; no Repo, no Prompt; **Start** is disabled; the focus is on **Cancel** |
| Only periscope on; only Claude Code on; none on | The title names the target and **Where** hides; with none on, no button, no "p review", and **p** does nothing |
| Change **Where** after you type | The text stays; **Repo** and the hint follow |
| Esc, Cancel, a click outside | The popover closes, the page's keys work again, and the space below the table goes away |
| ↵ in **Repo**, ⌘↵ in **Prompt**, ↵ in **Prompt** | Start, start, new line |
| A GitHub read ends while you type in **Prompt** (Refresh all from the console) | The text, the focus and the cursor stay, and the popover stays under its row |
| A filter that hides the row, then **j** | The popover is gone, and **j** moves the selection |
| Mine, then To review again | No popover |
| The last row of the long table | All of the popover can scroll into view |
| A click on the prompt's text | The row does not fold or open |
| The keyboard list (**?**) | It has the new **p** line only when a target is on |
| The issue popovers (Today, Client) | Start in periscope and Start in Claude Code look and work as before |

- [ ] **Step 4: Start reviews**

| Check | Expected |
|---|---|
| #812 in periscope | "Started #812 in periscope", **Show** selects the pane, the card has the ticket and the PR, no Linear comment |
| #812 in periscope again | "#812 is already open in periscope" (after the 60 s guard) |
| #790 in periscope | It starts, and the card has the PR and no ticket |
| #790 in Claude Code | The worktree `<repo>-worktrees/pr-790` is at the PR's head, and the script has `--name pr-790…` and the prompt. Replace `open_script` with a recorder, so that no terminal opens |
| Stop periscope, then **p** | periscope is disabled with "Periscope is not running at 127.0.0.1:17399.", and Claude Code works |

- [ ] **Step 5: Clean up**

Stop the servers and the isolated periscope by the PIDs that you started. Delete `.playwright-mcp/` if it is in the repo. `git status` must be clean.

---

### Task 9: review, scan and hand over

- [ ] **Step 1: Review the whole change**

Run the review of `superpowers:requesting-code-review` on `origin/main..review-from-pulls`, and on the periscope branch. Fix what holds.

- [ ] **Step 2: Run all the checks again**

Run: `cd backend && uv run pytest -q` and `cd app && node_modules/.bin/tsc --noEmit`
Expected: 417 passed or more, and exit code 0.

- [ ] **Step 3: Scan for private names**

Scan `git diff origin/main...review-from-pulls` and the commit messages for each client label and project in `todohub.db` (read-only), the team key, the work email, and the names of colleagues and the company. Expected: no hit.

- [ ] **Step 4: Ask the user**

Ask the user before each push. Then push the periscope branch to `origin` and open its PR. It must merge, and the user's periscope must get it, before the todo-hub PR merges. The todo-hub PR lists the spec's assumptions.
