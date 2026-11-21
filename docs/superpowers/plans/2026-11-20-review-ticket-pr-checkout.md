# Start a review ticket in periscope on the PR's code: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a ticket is a code review, **Start in periscope** starts Claude in the repo of the pull request, on the pull request's code.

**Architecture:** Periscope's catalog gives each repo its GitHub `slug` (`owner/name` of origin). `POST /api/linear/start` takes `pr` in place of `branch` and checks the PR out as `pr-<N>` with the PR helper that ⌘K uses. todo-hub reads a review ticket's Linear links, keeps the GitHub PR links whose repo periscope has, and shows them in a **PR** select. A PR start sends `pr` and the review prompt from the Settings page.

**Tech Stack:** periscope: Python 3.14, FastAPI, pytest with pytest-mock, `uv`, `bin/check` (ruff, ty, biome). todo-hub: Python, FastAPI, pytest, `uv`; app: TypeScript, `tsc`, no frontend test runner.

**Spec:** `docs/superpowers/specs/2026-11-19-review-ticket-pr-checkout-design.md`

---

## Rules for every task

- **Commit trailer.** End every commit message in both repos with this line, as written, also when a Sonnet or Haiku agent makes the commit:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

- **Public repos.** todo-hub (`tdody/todo-hub`) and periscope are public. Use only fictional names in code, tests and docs: Globex, Sam, `ENG-123`, `acme/api`, `example.com`. Do not copy anything from `~/Library/Application Support/TodoHub/`.
- **No push.** Do not push and do not open a PR. Task 13 asks the user first.

## File map

periscope (one PR to `tomplex/periscope`, branch `thibaultdody/linear-start-pr`):

| File | Change |
|---|---|
| `periscope/open_ops.py` | `build_catalog` gives each repo `slug`. |
| `periscope/routes/linear.py` | `StartBody` takes `pr`. A PR start uses or makes the `pr-<N>` worktree and links the PR. |
| `README.md` | `slug` and `pr`. |
| `tests/test_open_ops.py`, `tests/routes/test_linear.py` | Tests. |

todo-hub (this repo, branch `review-pr-checkout`):

| File | Change |
|---|---|
| `backend/src/todohub/linear.py` | `attachment_urls` returns a list in Linear's order. |
| `backend/src/todohub/api.py` | `shape_issues` (one place for an issue's type), the popover's `prs` and `pr_hint`, a PR start, the two prompts on the Settings page. |
| `backend/src/todohub/periscope.py` | `pr_links`, `review_prs`, `{pr}` in `fill_prompt`, `pr` in `Periscope.start`. |
| `backend/src/todohub/config.py` | `DEFAULT_PERISCOPE_REVIEW_PROMPT` and `Settings.periscope_review_prompt`. |
| `app/src/api.ts` | `PeriscopePr`, `prs`, `pr_hint`, `pr` in a start, `setPeriscopePrompts`. |
| `app/src/periscope.ts` | The **PR** select and its hint, the PR's repos, the prompt that follows the PR, `pr_hint`. |
| `app/src/settings.ts` | The **Review prompt** text area. |
| `app/src/styles.css` | `.pp-hint.lead` for `pr_hint`. |
| `README.md` | Review tickets, the review prompt. |
| `backend/tests/conftest.py`, `backend/tests/test_periscope.py`, `backend/tests/test_settings.py` | Tests. |

---

# Part A: periscope

Read `docs/unified-open.md` in periscope before you change `routes/linear.py` or `open_ops.py`. periscope's `CLAUDE.md` requires it.

### Task 1: A periscope worktree

- [ ] **Step 1: Make the worktree from `origin/main`**

The main checkout at `~/github/tomplex/periscope` is on a detached HEAD with local changes. Do not work there.

```bash
cd ~/github/tomplex/periscope
git fetch origin
git worktree add --no-track -b thibaultdody/linear-start-pr .claude/worktrees/linear-start-pr origin/main
cd .claude/worktrees/linear-start-pr
uv sync --python 3.14
```

A plain `uv sync` can pick Python 3.15, and `rpds-py` does not build for it.

- [ ] **Step 2: Run the two test files that this part changes**

Run: `uv run pytest tests/routes/test_linear.py tests/test_open_ops.py -q`
Expected: all pass.

### Task 2: A `slug` for each repo in the catalog

**Files:**
- Modify: `periscope/open_ops.py` (the `from periscope.gitutil import (…)` block and `build_catalog`)
- Test: `tests/test_open_ops.py`

- [ ] **Step 1: Write the failing test**

Add after `test_build_catalog_lists_repo_and_main_worktree` in `tests/test_open_ops.py` (`subprocess` is already imported there):

```python
def test_build_catalog_gives_each_repo_its_github_slug(tmp_git_repo, clean_state, monkeypatch):
    repo = str(tmp_git_repo)
    monkeypatch.setattr(open_ops, "discover_repos", lambda: {repo})
    assert open_ops.build_catalog()["repos"][0]["slug"] is None
    subprocess.run(["git", "-C", repo, "remote", "add", "origin", "git@github.com:acme/api.git"], check=True)
    assert open_ops.build_catalog()["repos"][0]["slug"] == "acme/api"
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run pytest tests/test_open_ops.py::test_build_catalog_gives_each_repo_its_github_slug -q`
Expected: FAIL with `KeyError: 'slug'`.

- [ ] **Step 3: Add `slug`**

In `periscope/open_ops.py`, add `github_slug` to the import from `periscope.gitutil`:

```python
from periscope.gitutil import (
    detect_default_branch,
    github_slug,
    resolve_repo,
    resolve_repo_and_branch,
)
```

In `build_catalog`, give each repo its slug:

```python
        repos_out.append(
            {
                "repo": repo,
                "label": os.path.basename(repo),
                "default_branch": detect_default_branch(repo),
                "branches": branches,
                # `owner/name` of origin on GitHub, or None: another app finds a pull request's repo by it.
                "slug": github_slug(repo),
            }
        )
```

In the `build_catalog` docstring, change `{repos:[...], worktrees:[...], roots:[...]}` to `{repos:[{repo, label, default_branch, branches, slug}], worktrees:[...], roots:[...]}`.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `uv run pytest tests/test_open_ops.py tests/routes/test_open.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add periscope/open_ops.py tests/test_open_ops.py
git commit -m "open: the catalog gives each repo the GitHub slug of its origin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: `POST /api/linear/start` takes `pr`

**Files:**
- Modify: `periscope/routes/linear.py` (all of it)
- Test: `tests/routes/test_linear.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/routes/test_linear.py`, after the `prepare` fixture:

```python
# A PR start: `pr` in place of `branch`. Periscope checks the PR out as `pr-812`.
PR_BODY = {**{k: v for k, v in BODY.items() if k != "branch"}, "pr": 812}
PR_KEY = ("api", "pr-812")


@pytest.fixture
def no_pr_worktree(mocker):
    """No worktree of the repo is on `pr-812` yet."""
    return mocker.patch("periscope.worktrees.for_branch", return_value=None)


@pytest.fixture
def fetch(mocker):
    from periscope import projects

    return mocker.patch(
        "periscope.projects.fetch_pr_into_worktree",
        return_value=projects.PRWorktree(
            path="/repos/api-pr",
            base_branch="main",
            is_fork=True,
            local_branch="pr-812",
            pr_state="OPEN",
            name="sam/retry-uploads",
        ),
    )
```

Add at the end of the file:

```python
def test_a_pr_start_checks_the_pr_out_and_links_it(client, no_pr_worktree, fetch, worktree, spawn, place):
    r = client.post("/api/linear/start", json=PR_BODY)
    assert r.status_code == 200
    assert r.json() == {
        "mode": "spawned",
        "pid": "k",
        "path": "/repos/api-pr",
        "reused": False,
        "session_id": SID,
        "email": "you@example.com",
    }
    no_pr_worktree.assert_called_once_with("/repos/api", "pr-812")
    fetch.assert_called_once_with("/repos/api", 812)
    worktree.assert_not_called()
    assert spawn.call_args.args == ("/repos/api-pr", "/repos/api", "Read Linear ticket ENG-1.")
    assert store.get_window("k") == {
        "linked_linear": "ENG-1",
        "linked_linear_title": "Fix it",
        "linked_pr": 812,
        "is_fork": True,
    }


def test_a_pr_start_uses_the_worktree_already_on_the_pr(client, mocker, fetch, spawn, place):
    mocker.patch("periscope.worktrees.for_branch", return_value="/repos/api-pr")
    r = client.post("/api/linear/start", json=PR_BODY)
    assert r.status_code == 200 and r.json()["path"] == "/repos/api-pr" and r.json()["reused"] is True
    fetch.assert_not_called()
    # Only a fetch asks GitHub whether the PR comes from a fork.
    assert store.get_window("k") == {"linked_linear": "ENG-1", "linked_linear_title": "Fix it", "linked_pr": 812}


def test_a_claude_on_the_pr_branch_is_reported(client, windows, no_pr_worktree, fetch, spawn):
    windows.return_value = [_win(branch="pr-812")]
    assert client.post("/api/linear/start", json=PR_BODY).json() == {"mode": "existing", "pid": "p1"}
    fetch.assert_not_called()
    spawn.assert_not_called()


def test_a_second_pr_start_before_the_claude_shows_is_refused(client, no_pr_worktree, fetch, spawn, place):
    assert client.post("/api/linear/start", json=PR_BODY).status_code == 200
    assert PR_KEY in branch_spawn._recent_spawn
    r = client.post("/api/linear/start", json=PR_BODY)
    assert r.status_code == 409 and spawn.call_count == 1


@pytest.mark.parametrize("target", [{"branch": "me/eng-1-fix-it", "pr": 812}, {}, {"branch": ""}])
def test_a_start_takes_a_branch_or_a_pr(client, worktree, fetch, spawn, target):
    body = {k: v for k, v in BODY.items() if k != "branch"} | target
    r = client.post("/api/linear/start", json=body)
    assert r.status_code == 400 and r.json()["detail"] == "send exactly one of branch and pr"
    worktree.assert_not_called()
    fetch.assert_not_called()
    spawn.assert_not_called()


def test_a_pr_fetch_conflict_is_400_and_a_missing_pr_stays_404(client, no_pr_worktree, fetch, spawn):
    # This route's 409 means only that a start is running.
    from fastapi import HTTPException

    fetch.side_effect = HTTPException(409, "local branch 'pr-812' already in use — remove the existing worktree")
    r = client.post("/api/linear/start", json=PR_BODY)
    assert r.status_code == 400 and "already in use" in r.json()["detail"]
    fetch.side_effect = HTTPException(404, "PR #812 not found in /repos/api: no pull requests found")
    assert client.post("/api/linear/start", json=PR_BODY).status_code == 404
    spawn.assert_not_called()
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `uv run pytest tests/routes/test_linear.py -q`
Expected: the new tests FAIL (422, because `branch` is required). The old tests pass.

- [ ] **Step 3: Write the route**

Replace `periscope/routes/linear.py` with:

```python
"""POST /api/linear/start — another app on this Mac starts Claude on a Linear issue's branch, or on a pull request.

The route makes the worktree, spawns Claude with a prompt through branch_spawn (the spawn path of
/api/reviews/prepare), and links the Linear issue to the new pane. With `pr` in place of `branch`, it checks the
pull request out as `pr-<N>` with ⌘K's PR helper, or uses the worktree already on `pr-<N>`, and links the PR too.
It answers with the new Claude's session id and the email of its Claude account. A `name` labels the new pane and
pins the label. A Claude already on the branch is only reported (mode "existing"): its prompt is never pasted
into a session that may be busy, and it keeps its name.
Selecting the pane is a separate request (POST /api/select), sent when the user asks for it.
"""

import asyncio
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from periscope import branch_spawn, projects, reviews, state_hub, store, worktree_spawn, worktrees

router = APIRouter()


class StartBody(BaseModel):
    repo: str = Field(min_length=1)  # a main checkout, as GET /api/open/catalog lists it
    branch: str = ""  # the branch to start on, or
    pr: int | None = Field(default=None, gt=0)  # a pull request on the repo's origin, checked out as `pr-<N>`
    ticket: str = Field(min_length=1)
    title: str = ""
    prompt: str = Field(min_length=1)
    name: str = ""  # the new pane's rail label, pinned; empty lets the narrator name it


@router.post("/api/linear/start")
async def linear_start(body: StartBody):
    if bool(body.branch) == (body.pr is not None):
        raise HTTPException(400, "send exactly one of branch and pr")
    repo = os.path.realpath(body.repo)
    branch = body.branch if body.pr is None else f"pr-{body.pr}"
    # Keyed on the label, as prepare is: it knows a repo only by its label, and the guard is shared.
    key = (os.path.basename(repo), branch)
    with branch_spawn.one_at_a_time(key):
        return await _start(body, repo, branch, key)


async def _start(body: StartBody, repo: str, branch: str, key: tuple[str, str]) -> dict:
    # Any Claude counts, attached or not: the route only reports it, and /api/select needs only a live pane.
    on_repo = [w for w in await state_hub.current_windows() if w.get("repo_key") == repo]
    claude = reviews.claude_on_branch(on_repo, {branch})
    branch_spawn.refuse_or_clear_recent_spawn(key, claude)
    if claude:
        return {"mode": "existing", "pid": claude["pid"]}
    if body.pr is None:
        try:
            wt = await asyncio.to_thread(worktree_spawn.spawn_worktree, repo, branch)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        path, reused, pr_fields = wt["path"], wt["reused"], {}
    else:
        path, reused, pr_fields = await _pr_worktree(repo, body.pr)
    spawned = await branch_spawn.spawn(key, path, body.prompt, body.name.strip() or None)
    store.set_window_fields(
        spawned["pid"], linked_linear=body.ticket, linked_linear_title=body.title or None, **pr_fields
    )
    email = await asyncio.to_thread(store.account_email, spawned["account"])
    return {
        "mode": "spawned",
        "pid": spawned["pid"],
        "path": path,
        "reused": reused,
        "session_id": spawned["session_id"],
        "email": email,
    }


async def _pr_worktree(repo: str, pr: int) -> tuple[str, bool, dict]:
    """The worktree on `pr-<N>`, whether it was there already, and the card fields for the PR. Only a fetch
    asks GitHub whether the PR comes from a fork. The fetch's 409s become 400: this route's 409 means only
    that a start is running."""
    existing = await asyncio.to_thread(worktrees.for_branch, repo, f"pr-{pr}")
    if existing:
        return existing, True, {"linked_pr": pr}
    try:
        prwt = await asyncio.to_thread(projects.fetch_pr_into_worktree, repo, pr)
    except HTTPException as e:
        if e.status_code == 409:
            raise HTTPException(400, e.detail) from e
        raise
    return prwt.path, False, {"linked_pr": pr, "is_fork": prwt.is_fork}
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `uv run pytest tests/routes/test_linear.py tests/routes/test_reviews.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add periscope/routes/linear.py tests/routes/test_linear.py
git commit -m "linear: /api/linear/start takes a pr and checks it out as pr-<N>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: periscope README and checks

**Files:**
- Modify: `README.md` (the paragraph that starts "Another app on this Mac can start work too.")

- [ ] **Step 1: Change the paragraph**

Replace the paragraph with:

```markdown
Another app on this Mac can start work too. `POST /api/linear/start` takes a
repo, a branch, a Linear issue and a prompt: periscope makes the worktree,
starts Claude, sends it the prompt and links the issue to the card. With a
pull request number (`pr`) in place of the branch, periscope checks the pull
request out as `pr-<N>`, as ⌘K does, or uses the worktree already on it, and
links the PR too. It answers with the new Claude's `session_id` and its
account's `email` (null when periscope cannot read it). If a Claude is already
on that branch, it reports that pane and starts nothing.
`GET /api/open/catalog` gives each repo's `slug`, the `owner/name` of its
origin on GitHub, so the app can find the repo of a pull request.
`POST /api/select` with a pane's `pid` makes the dashboard select it.
```

- [ ] **Step 2: Run the checks and the full suite**

Run: `bin/check`
Expected: zero violations. If ruff format changes a file, run `bin/check --fix`, then check the diff.

Run: `uv run pytest -q`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: /api/linear/start's pr and the catalog's slug

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Part B: todo-hub

Work in `/Users/thibaultdody/dev/worktrees/todo-hub/main-2`, on the branch `review-pr-checkout`. Run the backend tests from `backend/` with `uv run pytest -q`, and the app check from `app/` with `npx tsc --noEmit`.

### Task 5: `attachment_urls` keeps Linear's order

**Files:**
- Modify: `backend/src/todohub/linear.py` (`attachment_urls`)
- Modify: `backend/src/todohub/api.py` (the merge route's `have = …`)
- Modify: `backend/tests/conftest.py` (`FakeLinear.attachment_urls`)

The popover lists a ticket's PRs in the order Linear gives its links. A set loses that order. The merge route only checks if a link is in the list, so it works the same with a list.

- [ ] **Step 1: Return a list**

In `backend/src/todohub/linear.py`:

```python
    def attachment_urls(self, issue_id: str) -> list[str]:
        """The URLs of the issue's links, in the order Linear gives them."""
        data = self.gql("query($id: String!) { issue(id: $id) { attachments(first: 100) { nodes { url } } } }",
                        {"id": issue_id})
        return [a["url"] for a in ((data.get("issue") or {}).get("attachments") or {}).get("nodes", [])]
```

Keep the existing `gql` call text exactly as it is in the file. Change only the return type, the docstring and the last line.

In `backend/src/todohub/api.py`, in the merge route, change the two `set()` to `[]`:

```python
            try:
                have = client.attachment_urls(target["id"]) if links else []
            except LinearError:
                have = []
```

In `backend/tests/conftest.py`:

```python
    def attachment_urls(self, issue_id):
        return list(self.existing_links.get(issue_id, []))
```

- [ ] **Step 2: Run the full backend suite**

Run: `cd backend && uv run pytest -q`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add backend/src/todohub/linear.py backend/src/todohub/api.py backend/tests/conftest.py
git commit -m "Backend: attachment_urls keeps the order Linear gives

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: One place gives an issue's type

**Files:**
- Modify: `backend/src/todohub/api.py` (the `issues` route and a new `shape_issues` before it)

`GET /api/issues` applies the type you approved, and the popover route uses only the rules. Both must ask the same way.

- [ ] **Step 1: Add `shape_issues` and use it in `issues`**

In `backend/src/todohub/api.py`, under `# ---- Linear lists ---`, replace the `issues` route with:

```python
    def shape_issues(raw: list[dict]) -> list[dict]:
        """Linear issues shaped for the app. The issues TodoHub created keep the type you approved."""
        known = db.categories_by_identifier()
        shaped = [shape_issue(i, settings) for i in raw]
        for issue in shaped:
            issue["category"] = known.get(issue["identifier"], issue["category"])
        return shaped

    @app.get("/api/issues", dependencies=auth)
    def issues() -> list[dict]:
        return shape_issues(linear_call(lambda l: l.my_open_issues()))
```

- [ ] **Step 2: Run the type tests**

Run: `cd backend && uv run pytest tests/test_api.py -q -k categor`
Expected: `test_categories_in_candidates_and_issues` passes.

- [ ] **Step 3: Commit**

```bash
git add backend/src/todohub/api.py
git commit -m "Backend: shape_issues gives each issue the type you approved

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The popover route starts to use `shape_issues` in Task 9.

### Task 7: PR links, `{pr}` and the PR options

**Files:**
- Modify: `backend/src/todohub/periscope.py`
- Test: `backend/tests/test_periscope.py`

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_periscope.py`, change the import from `todohub.periscope` to:

```python
from todohub.periscope import (LAST_REPO_KEY, REPOS_KEY, Periscope, PeriscopeError, default_repo, fill_prompt,
                               pane_name, pr_links, remember_repo, review_prs)
```

Add after `SPAWNED = …`:

```python
# The catalog of a periscope that sends each repo's slug. web's slug has capitals: GitHub ignores case.
SLUGGED = {
    **CATALOG,
    "repos": [{**CATALOG["repos"][0], "slug": "acme/api"}, {**CATALOG["repos"][1], "slug": "Acme/Web"}],
    "worktrees": [*CATALOG["worktrees"],
                  {"path": "/dev/worktrees/api/pr-812", "repo": "/dev/api", "branch": "pr-812", "is_main": False}],
}
PR = "https://github.com/acme/api/pull/812"
```

Add after `test_fill_prompt_fills_three_tokens_and_keeps_other_braces`:

```python
def test_fill_prompt_fills_pr_only_when_it_is_given():
    issue = {"identifier": "ENG-1", "title": "Fix", "url": "https://linear.app/x/issue/ENG-1"}
    assert fill_prompt("Review {pr} for {identifier}.", issue, pr=PR) == f"Review {PR} for ENG-1."
    assert fill_prompt("Review {pr} for {identifier}.", issue) == "Review {pr} for ENG-1."


def test_pr_links_keeps_pull_requests_in_order_once():
    assert pr_links([
        "https://example.slack.com/archives/C1/p1",
        "https://github.com/acme/web/pull/455",
        "https://github.com/acme/api/issues/3",
        "https://github.com/acme/api/commit/abc123",
        f"{PR}/files",
        "https://github.com/acme/web/pull/455#discussion_r1",
    ]) == [("acme/web", 455), ("acme/api", 812)]


def test_review_prs_match_repos_by_origin_and_name_the_missing_ones():
    issue = {"identifier": "ENG-3", "title": "Review", "url": "https://linear.app/x/issue/ENG-3"}
    prs, hint = review_prs([("acme/web", 455), ("acme/api", 812)], SLUGGED, "Review {pr}.", issue)
    assert prs == [
        {"number": 455, "label": "acme/web#455", "url": "https://github.com/acme/web/pull/455",
         "repos": ["/dev/web"], "worktree_repos": [], "prompt": "Review https://github.com/acme/web/pull/455."},
        {"number": 812, "label": "acme/api#812", "url": PR,
         "repos": ["/dev/api"], "worktree_repos": ["/dev/api"], "prompt": f"Review {PR}."},
    ]
    assert hint == ""
    assert review_prs([("acme/ios", 7), ("acme/infra", 9), ("acme/ios", 8)], SLUGGED, "Review {pr}.", issue) == (
        [], "No periscope repo has acme/ios or acme/infra as its origin. This starts on the Linear branch.")
    # One PR with a repo is enough: the others are not offered, and there is no hint.
    prs, hint = review_prs([("acme/ios", 7), ("acme/api", 812)], SLUGGED, "Review {pr}.", issue)
    assert [p["label"] for p in prs] == ["acme/api#812"] and hint == ""
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd backend && uv run pytest tests/test_periscope.py -q`
Expected: FAIL with `ImportError: cannot import name 'pr_links'`.

- [ ] **Step 3: Write the code**

In `backend/src/todohub/periscope.py`, change `_TOKEN` and add `_PR_URL` under it:

```python
_TOKEN = re.compile(r"\{(identifier|title|url|pr)\}")
_PR_URL = re.compile(r"https://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)")
```

Replace `fill_prompt` with:

```python
def fill_prompt(template: str, issue: dict, pr: str = "") -> str:
    """The template with {identifier}, {title} and {url} filled in, and {pr} when a PR's URL is given. Other
    braces stay as typed."""
    values = {"identifier": issue["identifier"], "title": issue["title"], "url": issue["url"]}
    if pr:
        values["pr"] = pr
    return _TOKEN.sub(lambda m: values.get(m.group(1), m.group(0)), template)


def pr_links(urls: list[str]) -> list[tuple[str, int]]:
    """The GitHub repo (``owner/name``) and number of each pull request in ``urls``, in order, each once."""
    found: dict[tuple[str, int], None] = {}
    for url in urls:
        if m := _PR_URL.match(url):
            found.setdefault((m.group(1), int(m.group(2))), None)
    return list(found)


def review_prs(links: list[tuple[str, int]], catalog: dict, template: str, issue: dict) -> tuple[list[dict], str]:
    """The popover's PR options: each PR in ``links`` whose GitHub repo is the origin of a periscope repo, with
    ``template`` filled in for it. When none is, the hint that names the PRs' repos."""
    prs: list[dict] = []
    missing: dict[str, None] = {}
    for slug, number in links:
        repos = [r["repo"] for r in catalog["repos"] if (r.get("slug") or "").lower() == slug.lower()]
        if not repos:
            missing.setdefault(slug, None)
            continue
        url = f"https://github.com/{slug}/pull/{number}"
        prs.append({
            "number": number, "label": f"{slug}#{number}", "url": url, "repos": repos,
            "worktree_repos": sorted({w["repo"] for w in catalog["worktrees"]
                                      if w["repo"] in repos and w["branch"] == f"pr-{number}"}),
            "prompt": fill_prompt(template, issue, pr=url),
        })
    if prs or not missing:
        return prs, ""
    return [], f"No periscope repo has {' or '.join(missing)} as its origin. This starts on the Linear branch."
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd backend && uv run pytest tests/test_periscope.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/periscope.py backend/tests/test_periscope.py
git commit -m "Backend: a review ticket's PR links, matched to periscope's repos by their origin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: The review prompt in Settings

**Files:**
- Modify: `backend/src/todohub/config.py` (the default, `Settings`, `apply_overrides`)
- Modify: `backend/src/todohub/api.py` (`PeriscopePromptIn`, `save_override`, `settings_body`, `set_periscope`, the config import)
- Test: `backend/tests/test_settings.py`

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_settings.py`, add after `test_periscope_prompt_from_the_settings_page`:

```python
def test_periscope_review_prompt_from_the_settings_page():
    assert load_settings().periscope_review_prompt == config.DEFAULT_PERISCOPE_REVIEW_PROMPT
    config.write_overrides({"periscope": {"review_prompt": "Review {pr}."}})
    s = load_settings()
    assert s.periscope_review_prompt == "Review {pr}." and s.periscope_prompt == config.DEFAULT_PERISCOPE_PROMPT
    config.write_overrides({"periscope": {"review_prompt": "   "}})
    assert load_settings().periscope_review_prompt == config.DEFAULT_PERISCOPE_REVIEW_PROMPT
```

Replace `test_settings_api_periscope_prompt` with:

```python
def test_settings_api_periscope_prompts():
    client, _, _ = client_for()
    default = {"enabled": False,
               "prompt": config.DEFAULT_PERISCOPE_PROMPT, "default_prompt": config.DEFAULT_PERISCOPE_PROMPT,
               "review_prompt": config.DEFAULT_PERISCOPE_REVIEW_PROMPT,
               "default_review_prompt": config.DEFAULT_PERISCOPE_REVIEW_PROMPT}
    assert client.get("/api/settings").json()["periscope"] == default
    r = client.put("/api/settings/periscope", json={"prompt": "Read {identifier}.", "review_prompt": "Review {pr}."})
    assert r.status_code == 200
    assert r.json()["periscope"] == {**default, "prompt": "Read {identifier}.", "review_prompt": "Review {pr}."}
    # One prompt back to its default: the other stays as it was.
    assert client.put("/api/settings/periscope", json={"prompt": ""}).json()["periscope"] == \
        {**default, "review_prompt": "Review {pr}."}
    assert client.put("/api/settings/periscope", json={"review_prompt": ""}).json()["periscope"] == default
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd backend && uv run pytest tests/test_settings.py -q -k periscope`
Expected: FAIL with `AttributeError: module 'todohub.config' has no attribute 'DEFAULT_PERISCOPE_REVIEW_PROMPT'`.

- [ ] **Step 3: Add the review prompt to the settings**

In `backend/src/todohub/config.py`, after `DEFAULT_PERISCOPE_PROMPT = (…)`:

```python
DEFAULT_PERISCOPE_REVIEW_PROMPT = (
    "Read Linear ticket {identifier} ({url}) and its comments with the Linear tools. "
    "Then review {pr} in this worktree: sum up the change and list the problems you find. "
    "Do not post anything on GitHub."
)
```

In `Settings`, after `periscope_prompt`:

```python
    periscope_review_prompt: str = DEFAULT_PERISCOPE_REVIEW_PROMPT
```

In `apply_overrides`, replace the three `peri` lines with:

```python
    peri = data.get("periscope")
    if isinstance(peri, dict):
        for key, attr in (("prompt", "periscope_prompt"), ("review_prompt", "periscope_review_prompt")):
            if isinstance(peri.get(key), str) and peri[key].strip():
                setattr(s, attr, peri[key])
```

- [ ] **Step 4: Save and show both prompts**

In `backend/src/todohub/api.py`, add `DEFAULT_PERISCOPE_REVIEW_PROMPT` to the `from .config import (…)` list, after `DEFAULT_PERISCOPE_PROMPT`.

Replace `PeriscopePromptIn` with:

```python
class PeriscopePromptsIn(BaseModel):
    prompt: str | None = Field(default=None, max_length=8000)          # empty: back to the default
    review_prompt: str | None = Field(default=None, max_length=8000)   # left out: stays as it is
```

In `save_override`, merge the `periscope` section as `sources` is merged:

```python
        if isinstance(value, dict) and isinstance(data.get(section), dict) and section in ("sources", "periscope"):
```

In `settings_body`, replace the `"periscope"` entry with:

```python
            "periscope": {"enabled": settings.periscope_on, "prompt": settings.periscope_prompt,
                          "default_prompt": DEFAULT_PERISCOPE_PROMPT,
                          "review_prompt": settings.periscope_review_prompt,
                          "default_review_prompt": DEFAULT_PERISCOPE_REVIEW_PROMPT},
```

Replace `set_periscope` with:

```python
    @app.put("/api/settings/periscope", dependencies=auth)
    def set_periscope(body: PeriscopePromptsIn) -> dict:
        """The prompts Start in periscope sends. An empty one goes back to the default; one left out stays."""
        save_override("periscope", {k: v.strip() for k, v in body.model_dump().items() if v is not None})
        return settings_body()
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `cd backend && uv run pytest tests/test_settings.py -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/todohub/config.py backend/src/todohub/api.py backend/tests/test_settings.py
git commit -m "Backend: a review prompt for Start in periscope, saved apart from the prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: The popover's `prs` and `pr_hint`

**Files:**
- Modify: `backend/src/todohub/api.py` (the import from `.periscope`, `periscope_options`)
- Test: `backend/tests/test_periscope.py`

- [ ] **Step 1: Let the tests change the catalog**

In `backend/tests/test_periscope.py`, in the `peri` fixture, add `catalog=CATALOG` to the `SimpleNamespace`, and answer the catalog route with it:

```python
    p = SimpleNamespace(calls=[], answer=httpx.Response(200, json=SPAWNED), catalog=CATALOG)

    def handler(request: httpx.Request) -> httpx.Response:
        p.calls.append((request.method, request.url.path, json.loads(request.content) if request.content else None))
        if request.url.path == "/api/open/catalog":
            return httpx.Response(200, json=p.catalog)
```

Update the fixture docstring: "set ``answer`` to change what POST /api/linear/start answers, and ``catalog`` to change the catalog."

Change the imports at the top:

```python
from todohub import periscope, tools
from conftest import FakeLinear, make_issue
```

- [ ] **Step 2: Write the failing tests**

In `test_options_fill_the_popover`, add two keys to the expected answer, after `"prompt": …`:

```python
        "prs": [],
        "pr_hint": "",
```

Add after `test_options_fill_the_popover`:

```python
REVIEW_PROMPT = (f"Read Linear ticket ENG-3 (https://linear.app/x/issue/ENG-3) and its comments with the Linear tools. "
                 f"Then review {PR} in this worktree: sum up the change and list the problems you find. "
                 f"Do not post anything on GitHub.")


def review_issue(linear, links, identifier="ENG-3", title="Review acme/api#812: Retry stuck uploads"):
    """A review ticket with ``links``. make_issue's Bug label would make it a code ticket, so it has no label."""
    issue = make_issue(identifier, title)
    issue["labels"]["nodes"] = []
    linear.issues.append(issue)
    linear.existing_links = {issue["id"]: list(links)}
    return issue


def test_a_review_ticket_offers_its_pr(env, peri, linear):
    client, _, _ = env
    peri.catalog = SLUGGED
    review_issue(linear, ["https://example.slack.com/archives/C1/p1", f"{PR}/files"])
    o = client.get("/api/issues/id-ENG-3/periscope").json()
    assert o["prs"] == [{"number": 812, "label": "acme/api#812", "url": PR, "repos": ["/dev/api"],
                         "worktree_repos": ["/dev/api"], "prompt": REVIEW_PROMPT}]
    assert o["pr_hint"] == ""
    # The branch start stays, for "None: start on the Linear branch".
    assert o["branch"] == "me/eng-3" and o["prompt"].startswith("Read Linear ticket ENG-3")


def test_a_review_ticket_whose_pr_has_no_repo_gets_a_hint(env, peri, linear):
    client, _, _ = env
    peri.catalog = SLUGGED
    review_issue(linear, ["https://github.com/acme/ios/pull/7"])
    o = client.get("/api/issues/id-ENG-3/periscope").json()
    assert o["prs"] == []
    assert o["pr_hint"] == "No periscope repo has acme/ios as its origin. This starts on the Linear branch."


def test_a_ticket_that_is_not_a_review_does_not_read_its_links(env, peri, linear):
    client, _, _ = env
    peri.catalog = SLUGGED
    linear.attachment_urls = lambda issue_id: pytest.fail("read the links of a code ticket")
    o = client.get("/api/issues/id-ENG-1/periscope").json()
    assert o["prs"] == [] and o["pr_hint"] == ""


def test_a_ticket_you_approved_as_a_review_gets_its_pr(env, peri, linear):
    client, db, _ = env
    peri.catalog = SLUGGED
    linear.existing_links = {"id-ENG-1": [PR]}       # ENG-1's Bug label makes it a code ticket by the rules
    cid = tools.add_candidate(db, None, source="slack", source_id="C1:9", title="Rebin Globex grades",
                              signal="ask", why="Sam asked.", excerpt="can you look", category="review")["id"]
    db.decide(cid, "approved", "ENG-1", "https://linear.app/x/issue/ENG-1")
    assert [p["label"] for p in client.get("/api/issues/id-ENG-1/periscope").json()["prs"]] == ["acme/api#812"]


def test_an_older_periscope_gets_no_prs_and_no_hint(env, linear):
    client, _, _ = env                                 # CATALOG has no slug: that periscope cannot take a pr
    review_issue(linear, [PR])
    linear.attachment_urls = lambda issue_id: pytest.fail("read the links for a periscope that cannot take a pr")
    o = client.get("/api/issues/id-ENG-3/periscope").json()
    assert o["prs"] == [] and o["pr_hint"] == ""
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `cd backend && uv run pytest tests/test_periscope.py -q`
Expected: the new tests and `test_options_fill_the_popover` FAIL with `KeyError: 'prs'`.

- [ ] **Step 4: Add `prs` and `pr_hint` to the route**

In `backend/src/todohub/api.py`, change the import from `.periscope`:

```python
from .periscope import (Periscope, PeriscopeError, bring_to_front, default_repo, fill_prompt, pane_name,
                        pr_links, remember_repo, review_prs)
```

Replace `periscope_options` with:

```python
    @app.get("/api/issues/{issue_id}/periscope", dependencies=periscope_auth)
    def periscope_options(issue_id: str) -> dict:
        """What the popover shows first: periscope's repos, the one to select and why, Linear's branch, the
        repos with a worktree already on it and the Settings page's prompt filled in for the issue. For a review
        ticket, also its PRs that periscope can check out (``prs``), or why it has none (``pr_hint``)."""
        raw = linear_call(lambda l: l.get_issue(issue_id))
        [issue] = shape_issues([raw])
        catalog = periscope_call(lambda p: p.catalog())
        repos = [{"repo": r["repo"], "label": r["label"]} for r in catalog["repos"]]
        repo, hint = default_repo(db, issue, [r["repo"] for r in repos])
        branch = raw["branchName"]
        prs, pr_hint = [], ""
        # An older periscope sends no slug, and cannot check out a PR.
        if issue["category"] == "review" and any("slug" in r for r in catalog["repos"]):
            urls = linear_call(lambda l: l.attachment_urls(issue["id"]))
            prs, pr_hint = review_prs(pr_links(urls), catalog, settings.periscope_review_prompt, issue)
        return {
            "repos": repos, "repo": repo, "hint": hint, "branch": branch,
            "branch_worktrees": sorted({w["repo"] for w in catalog["worktrees"] if w["branch"] == branch}),
            "prompt": fill_prompt(settings.periscope_prompt, issue),
            "prs": prs, "pr_hint": pr_hint,
        }
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `cd backend && uv run pytest tests/test_periscope.py -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/todohub/api.py backend/tests/test_periscope.py
git commit -m "Backend: the periscope popover offers a review ticket's PRs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: A PR start

**Files:**
- Modify: `backend/src/todohub/periscope.py` (`Periscope.start`)
- Modify: `backend/src/todohub/api.py` (`PeriscopeStartIn`, `periscope_start`)
- Test: `backend/tests/test_periscope.py`

- [ ] **Step 1: Write the failing tests**

Add after `test_client_calls`:

```python
def test_client_start_with_a_pr_sends_no_branch(peri):
    Periscope(URL, transport=peri.transport).start(repo="/dev/api", pr=812, ticket="ENG-3", title="Review",
                                                   prompt="Review it.", name="eng-3")
    assert peri.calls == [("POST", "/api/linear/start", {"repo": "/dev/api", "pr": 812, "ticket": "ENG-3",
                                                         "title": "Review", "prompt": "Review it.", "name": "eng-3"})]
```

Add after `test_a_claude_already_on_the_branch_is_answered_and_the_repo_remembered`:

```python
def test_a_pr_start_sends_the_pr_and_keeps_the_remembered_repos(env, peri, linear):
    client, db, _ = env
    peri.answer = httpx.Response(200, json={**SPAWNED, "session_id": "3f2a9c1e-5b7d-4e2a-9f10-2c4d6e8a0b1c",
                                            "email": "you@example.com"})
    r = client.post("/api/issues/id-ENG-1/periscope", json={"repo": "/dev/api", "pr": 812, "prompt": "Review it."})
    assert r.status_code == 200
    assert peri.calls[-1] == ("POST", "/api/linear/start", {
        "repo": "/dev/api", "pr": 812, "ticket": "ENG-1", "title": "Rebin Globex grades",
        "prompt": "Review it.", "name": "eng-1-rebin"})
    # The PR chose the repo, not you.
    assert db.get_meta(REPOS_KEY) is None and db.get_meta(LAST_REPO_KEY) is None
    assert len(linear.comments) == 1
```

Replace `test_a_blank_branch_is_a_400_and_periscope_is_not_asked` with:

```python
@pytest.mark.parametrize("target", [{"branch": "me/eng-1", "pr": 812}, {}, {"branch": "   "}])
def test_a_start_needs_a_branch_or_a_pr(env, peri, target):
    client, _, _ = env
    r = client.post("/api/issues/id-ENG-1/periscope", json={"repo": "/dev/api", "prompt": "Read.", **target})
    assert r.status_code == 400 and r.json() == {"error": "Send a branch or a PR."}
    assert peri.calls == []
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd backend && uv run pytest tests/test_periscope.py -q`
Expected: the new tests FAIL (`TypeError: … unexpected keyword argument 'pr'` for the client test, 422 for the route tests).

- [ ] **Step 3: `Periscope.start` sends a branch or a PR**

In `backend/src/todohub/periscope.py`, replace `start` with:

```python
    def start(self, *, repo: str, ticket: str, title: str, prompt: str, name: str, branch: str = "",
              pr: int | None = None) -> dict:
        """Start Claude on ``branch``, or on pull request ``pr``, which periscope checks out as ``pr-<N>``.
        {mode: "spawned", pid, path, reused, session_id, email}, or {mode: "existing", pid} when a Claude is
        already on the branch. Periscope gives a spawned Claude ``name`` on its rail and pins it. ``email`` is None
        when periscope finds no email for the account, and an older periscope sends neither field."""
        target = {"pr": pr} if pr is not None else {"branch": branch}
        return self._call("POST", "/api/linear/start",
                          {"repo": repo, **target, "ticket": ticket, "title": title, "prompt": prompt, "name": name},
                          START_SECONDS)
```

- [ ] **Step 4: The route takes a branch or a PR**

In `backend/src/todohub/api.py`, replace `PeriscopeStartIn` with:

```python
class PeriscopeStartIn(BaseModel):
    repo: str = Field(min_length=1, max_length=500)       # a repo path from periscope's catalog
    branch: str = Field(default="", max_length=250)       # the branch to start on, or
    pr: int | None = Field(default=None, gt=0)            # a PR that periscope checks out as pr-<N>
    prompt: str = Field(min_length=1, max_length=8000)
```

In `periscope_start`, replace the docstring and the branch check:

```python
        """Ask periscope to start Claude on the branch, or on the PR, with the prompt and a name from Haiku. A branch
        start remembers the repo for the issue's project (or client); a PR start does not, because the PR chose
        the repo. A Claude already on the branch is answered as mode "existing". A new Claude's session goes into
        a comment on the issue; a comment that fails is a warning."""
        branch = body.branch.strip()
        if bool(branch) == (body.pr is not None):
            raise HTTPException(400, "Send a branch or a PR.")
```

Change the `p.start(…)` call to:

```python
            result = periscope_call(lambda p: p.start(
                repo=body.repo, branch=branch, pr=body.pr, ticket=issue["identifier"], title=issue["title"],
                prompt=body.prompt, name=name))
```

Change `remember_repo(db, issue, body.repo)` to:

```python
        if body.pr is None:
            remember_repo(db, issue, body.repo)
```

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && uv run pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/todohub/periscope.py backend/src/todohub/api.py backend/tests/test_periscope.py
git commit -m "Backend: Start in periscope sends a PR in place of a branch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: The popover's PR select and the Settings page

**Files:**
- Modify: `app/src/api.ts` (`AppSettings.periscope`, `PeriscopeOptions`, new `PeriscopePr`, `startInPeriscope`, `setPeriscopePrompt`)
- Modify: `app/src/periscope.ts` (all of it)
- Modify: `app/src/settings.ts` (`periscopeSection`)
- Modify: `app/src/styles.css` (after `.pp-hint`)

The app has no frontend test runner. `tsc` checks the types, and Task 12 checks the UI.

- [ ] **Step 1: The API types and calls**

In `app/src/api.ts`, change the `periscope` line of the settings type to:

```ts
  periscope: { enabled: boolean; prompt: string; default_prompt: string; review_prompt: string; default_review_prompt: string };
```

Before `export interface PeriscopeOptions`, add:

```ts
/** A review ticket's PR whose GitHub repo is the origin of a periscope repo. */
export interface PeriscopePr {
  number: number;
  label: string;                                // "acme/api#812"
  url: string;
  repos: string[];                              // periscope's repos whose origin is the PR's repo
  worktree_repos: string[];                     // the ones with a worktree already on pr-<N>
  prompt: string;                               // the review prompt, filled in for this PR
}
```

In `PeriscopeOptions`, after `prompt`, add:

```ts
  prs: PeriscopePr[];                           // a review ticket's PRs; empty for other tickets
  pr_hint: string;                              // "No periscope repo has acme/web as its origin. …", or ""
```

Replace `startInPeriscope`:

```ts
  /** Start on Linear's branch (``branch``) or on a PR (``pr``), never both. */
  startInPeriscope: (issueId: string, body: { repo: string; prompt: string; branch?: string; pr?: number }) =>
    call<PeriscopeStart>("POST", `/api/issues/${encodeURIComponent(issueId)}/periscope`, body),
```

Replace `setPeriscopePrompt`:

```ts
  /** An empty prompt goes back to its default; a prompt left out stays as it is. */
  setPeriscopePrompts: (prompts: { prompt?: string; review_prompt?: string }) =>
    call<AppSettings>("PUT", "/api/settings/periscope", prompts),
```

- [ ] **Step 2: The popover**

Replace `app/src/periscope.ts` with:

```ts
// Start in periscope: the ⋯ menu item (or p) opens a popover with the repo, Linear's branch and the
// prompt; Start asks periscope to start Claude on that branch with the prompt. For a review ticket, the
// popover selects one of its PRs, and periscope checks the PR out in place of the branch. The toast's
// Show brings periscope to the front with that Claude selected.
import { api } from "./api";
import type { Issue, PeriscopeOptions, PeriscopePr } from "./api";
import { h } from "./dom";

export interface PeriscopeCtx {
  render: () => void;
  toast: (message: string, action?: { label: string; run: () => void }) => void;
  fail: (e: unknown) => void;
}

interface Popover {
  issueId: string;
  options: PeriscopeOptions | null;     // null while periscope is asked
  pr: number | null;                    // the selected PR; null starts on the branch
  repo: string;
  branch: string;
  prompt: string;
  promptEdited: boolean;                // you typed in the prompt: a PR change keeps it
  starting: boolean;
}

let ctx: PeriscopeCtx;
let popover: Popover | null = null;

export function setupPeriscope(c: PeriscopeCtx) {
  ctx = c;
}

/** The popover is on the page. A refresh can take its issue off the page; the keys then go back to it. */
export function isPeriscopeOpen(): boolean {
  return popover !== null && document.querySelector(".pp-pop") !== null;
}

/** A tab switch takes the popover off the page; the switch renders, so this does not. */
export function forgetPeriscope() {
  popover = null;
}

export function closePeriscope() {
  if (!popover) return;
  popover = null;
  ctx.render();
}

/** A pointer down outside the popover closes it in place, not by a re-render, so the click still
 *  lands on its target. */
export function dismissPeriscope(target: Element) {
  if (!popover || target.closest?.(".pp-pop")) return;
  popover = null;
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

/** Select ``pr`` (null: Linear's branch): its first repo and its prompt, or the remembered repo and the
 *  normal prompt. A prompt you typed stays. */
function selectPr(p: Popover, o: PeriscopeOptions, pr: PeriscopePr | null) {
  p.pr = pr?.number ?? null;
  p.repo = pr ? pr.repos[0] : o.repo ?? "";
  if (!p.promptEdited) p.prompt = pr ? pr.prompt : o.prompt;
}

async function openFor(i: Issue) {
  if (popover?.issueId === i.id) return;
  popover = { issueId: i.id, options: null, pr: null, repo: "", branch: "", prompt: "", promptEdited: false,
    starting: false };
  ctx.render();
  try {
    const o = await api.periscopeOptions(i.id);
    if (popover?.issueId !== i.id) return;           // closed, or opened for another issue, meanwhile
    popover = { ...popover, options: o, branch: o.branch };
    selectPr(popover, o, o.prs[0] ?? null);
    ctx.render();
    const pop = document.querySelector<HTMLElement>(".pp-pop");
    pop?.scrollIntoView({ block: "nearest" });
    pop?.querySelector<HTMLElement>(popover.repo ? ".pp-start" : ".pp-repo")?.focus();
  } catch (e) {
    if (popover?.issueId === i.id) closePeriscope();
    ctx.fail(e);
  }
}

/** Start can run: a repo, a PR or a branch, and a prompt, and no start already running. */
function canStart(p: Popover): boolean {
  return !p.starting && !!p.repo && (p.pr !== null || !!p.branch.trim()) && !!p.prompt.trim();
}

async function start(i: Issue) {
  const p = popover;
  if (!p || p.issueId !== i.id || !canStart(p)) return;
  p.starting = true;
  ctx.render();
  try {
    const target = p.pr !== null ? { pr: p.pr } : { branch: p.branch };
    const r = await api.startInPeriscope(i.id, { repo: p.repo, prompt: p.prompt, ...target });
    if (popover === p) closePeriscope();
    ctx.toast(r.mode === "existing" ? `${i.identifier} is already open in periscope` : `Started ${i.identifier} in periscope`,
      { label: "Show", run: () => void api.showInPeriscope(r.pid).catch(ctx.fail) });
    for (const w of r.warnings) ctx.fail(w);
  } catch (e) {
    p.starting = false;
    if (popover === p) ctx.render();
    ctx.fail(e);
  }
}

/** The popover under the pane's ⋯, when it is open for ``i``. main.ts's keydown closes it on Esc and
 *  keeps the page's keys off the issue behind it. */
export function periscopePopover(i: Issue): HTMLElement | "" {
  const p = popover;
  if (!p || p.issueId !== i.id) return "";
  const label = `Start ${i.identifier} in periscope`;
  const o = p.options;
  if (!o) {
    return h("div", { class: "pp-pop", role: "dialog", "aria-label": label },
      h("div", { class: "pp-title" }, label), h("p", { class: "pp-wait" }, "Asking periscope…"));
  }
  const pr = o.prs.find((x) => x.number === p.pr) ?? null;
  const prSelect = o.prs.length ? h("select", {
    class: "pp-input", "aria-label": "PR", "data-focus": "periscope-pr", disabled: p.starting,
    onchange: (e: Event) => {
      const value = (e.target as HTMLSelectElement).value;
      selectPr(p, o, o.prs.find((x) => String(x.number) === value) ?? null);
      ctx.render();
    },
  },
    ...o.prs.map((x) => h("option", { value: String(x.number), selected: x.number === p.pr }, x.label)),
    h("option", { value: "", selected: p.pr === null }, "None: start on the Linear branch")) : null;
  const prHint = !pr ? ""
    : pr.worktree_repos.includes(p.repo) ? `A worktree is already on pr-${pr.number}.`
    : "Periscope checks out the PR in a new worktree.";
  // A PR's repos are the ones whose origin is the PR's repo: another repo would fetch another PR.
  const repos = pr ? o.repos.filter((r) => pr.repos.includes(r.repo)) : o.repos;
  const repo = h("select", {
    class: "pp-input pp-repo", "aria-label": "Repo", "data-focus": "periscope-repo", disabled: p.starting,
    onchange: (e: Event) => { p.repo = (e.target as HTMLSelectElement).value; ctx.render(); },
  },
    !p.repo && h("option", { value: "", selected: true, disabled: true }, "Pick a repo"),
    ...repos.map((r) => h("option", { value: r.repo, selected: r.repo === p.repo }, r.label)));
  const startButton = h("button", { type: "button", class: "td-btn primary pp-start", "data-focus": "periscope-start",
    onclick: () => void start(i) }, p.starting ? "Starting…" : "Start", h("kbd", {}, "↵"));
  const branchHint = h("p", { class: "pp-hint" });
  // Typing does not re-render: Start and the branch's hint follow the fields here.
  const update = () => {
    startButton.disabled = !canStart(p);
    const fromLinear = p.branch.trim() === o.branch;
    branchHint.textContent = fromLinear && o.branch_worktrees.includes(p.repo)
      ? "A worktree is already on this branch."
      : `${fromLinear ? "From Linear. " : ""}A new worktree, or the one already on this branch.`;
  };
  update();
  // Read-only, not disabled, while starting: the field keeps the focus and the cursor.
  const branch = h("input", {
    type: "text", class: "pp-input mono", value: p.branch, "aria-label": "Branch", "data-edit": "periscope-branch",
    readOnly: p.starting, oninput: (e: Event) => { p.branch = (e.target as HTMLInputElement).value; update(); },
  });
  const prompt = h("textarea", {
    class: "pp-input", rows: 4, value: p.prompt, "aria-label": "Prompt", "data-edit": "periscope-prompt",
    readOnly: p.starting,
    oninput: (e: Event) => { p.prompt = (e.target as HTMLTextAreaElement).value; p.promptEdited = true; update(); },
  });
  const repoHint = !pr && p.repo && p.repo === o.repo ? o.hint : "";
  return h("div", {
    class: "pp-pop", role: "dialog", "aria-label": label,
    onkeydown: (e: KeyboardEvent) => {
      // keyCode 229: WebKit's Enter that commits an IME composition, with isComposing false.
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "BUTTON" || (tag === "TEXTAREA" && !e.metaKey && !e.ctrlKey)) return;
      e.preventDefault();
      void start(i);
    },
  },
    h("div", { class: "pp-title" }, label),
    o.pr_hint ? h("p", { class: "pp-hint lead" }, o.pr_hint) : "",
    prSelect ? h("label", { class: "pp-field" }, h("span", {}, "PR"), prSelect) : "",
    prHint ? h("p", { class: "pp-hint" }, prHint) : "",
    h("label", { class: "pp-field" }, h("span", {}, "Repo"), repo),
    repoHint ? h("p", { class: "pp-hint" }, repoHint) : "",
    pr ? "" : h("label", { class: "pp-field" }, h("span", {}, "Branch"), branch),
    pr ? "" : branchHint,
    h("label", { class: "pp-field top" }, h("span", {}, "Prompt"), prompt),
    h("div", { class: "pp-acts" },
      h("button", { type: "button", class: "td-btn", "data-focus": "periscope-cancel", disabled: p.starting,
        onclick: () => closePeriscope() }, "Cancel", h("kbd", {}, "esc")),
      startButton));
}
```

- [ ] **Step 3: The hint under the title**

In `app/src/styles.css`, after the `.pp-hint` line:

```css
.pp-hint.lead { margin-left: 0; }
```

- [ ] **Step 4: The Settings page**

In `app/src/settings.ts`, replace `periscopeSection` with:

```ts
function periscopeSection(ctx: SettingsCtx): HTMLElement {
  const p = data!.periscope;
  const box = h("textarea", { class: "set-input set-prompt", rows: 4, value: p.prompt, "aria-label": "Prompt" });
  const reviewBox = h("textarea", { class: "set-input set-prompt", rows: 4, value: p.review_prompt,
    "aria-label": "Review prompt" });
  const saveBtn = h("button", {
    type: "button", class: "ghost small-btn", disabled: busy === "periscope",
    onclick: () => void save("periscope", ctx,
      () => api.setPeriscopePrompts({ prompt: box.value, review_prompt: reviewBox.value }), "Prompts saved"),
  }, busy === "periscope" ? "Saving…" : "Save");
  // Each reset sends only its own prompt, so the other one keeps its saved text.
  const reset = (changed: boolean, prompts: { prompt?: string; review_prompt?: string }, done: string) =>
    h("div", { class: "set-row-inline" }, changed ? h("button", {
      type: "button", class: "link-btn small",
      onclick: () => void save("periscope", ctx, () => api.setPeriscopePrompts(prompts), done),
    }, "Reset to default") : "");
  return card("periscope", "Periscope",
    "Start in periscope (⋯ or p on an issue) sends the prompt to the new Claude. {identifier}, {title} and {url} " +
      "become the issue's. A review ticket with a GitHub PR link gets the review prompt, where {pr} becomes the PR's link.",
    "",
    h("label", { class: "set-label" }, "Prompt"), box,
    reset(p.prompt !== p.default_prompt, { prompt: "" }, "Prompt back to the default"),
    h("label", { class: "set-label" }, "Review prompt"), reviewBox,
    reset(p.review_prompt !== p.default_review_prompt, { review_prompt: "" }, "Review prompt back to the default"),
    h("div", { class: "set-row-inline" }, saveBtn));
}
```

- [ ] **Step 5: Check the types**

Run: `cd app && npx tsc --noEmit`
Expected: no output. If `setPeriscopePrompt` is still named somewhere, rename that call to `setPeriscopePrompts`.

- [ ] **Step 6: Commit**

```bash
git add app/src/api.ts app/src/periscope.ts app/src/settings.ts app/src/styles.css
git commit -m "App: the periscope popover selects a review ticket's PR, and Settings has a review prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: README, and a check in the browser

**Files:**
- Modify: `README.md` (the **Periscope** bullet of the Settings page, "Start in periscope", the `settings.json` row)

- [ ] **Step 1: The README**

Replace the Settings page bullet that starts `  - **Periscope:**` with:

```markdown
  - **Periscope:** the prompt that Start in periscope sends, and the review prompt for a review ticket. **Save** keeps both. Each **Reset to default** brings back that prompt's default and leaves the other as it is.
```

In "Start in periscope", after the bullet that starts `  - **Prompt** comes from the template`, add these two bullets at the same level as `- **Start** (↵, …`:

```markdown
- A review ticket starts on its pull request. A review ticket has the type `review` and a GitHub PR link in Linear. Its popover has a **PR** field with each of its PRs whose repo periscope has, and "None: start on the Linear branch". **Repo** lists only the repos whose origin is the PR's repo. There is no **Branch** field: periscope checks the PR out as `pr-<N>` in a new worktree, or uses the worktree already on `pr-<N>`. **Prompt** comes from the review prompt on the Settings page, where `{pr}` becomes the PR's link. A PR start does not change the remembered repos.
- If no periscope repo has the PR's repo as its origin, the popover says so and starts on the Linear branch. A periscope that sends no repo `slug` gets no **PR** field.
```

In the `settings.json` row of the files table, change `the periscope prompt` to `the periscope prompts`.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "README: a review ticket starts in periscope on its PR

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Check the popover in a browser**

Do not use the user's running app, config or Linear data. Follow these steps:

1. Start periscope's dev instance from the periscope worktree of Task 1. It has its own state and does not bind the MCP socket: `PERISCOPE_PORT=17375 PERISCOPE_DEV=1 uv run server.py`. Never stop the instance on port 17374.
2. Make a scratch folder in the scratchpad. Copy `config.toml`, `settings.json`, `todohub.db` and `client_domains.json` from `~/Library/Application Support/TodoHub/` into it. In the copy's `config.toml`, set `app.periscope_url = "http://127.0.0.1:17375"`.
3. From `backend/`, run `TODOHUB_HOME=<scratch> TODOHUB_TOKEN=x uv run python -m todohub.api --port 8791`.
4. From `app/`, run `npx vite --port 1430 --strictPort`.
5. In Playwright, add a `window.__TAURI_INTERNALS__` shim whose `invoke("backend_info")` returns `{url: "http://127.0.0.1:8791", token: "x", error: null}`. Route the backend URL with `route.fetch()` and CORS headers. Answer every request that is not a GET with 500, so nothing changes in Linear.
6. Open a review ticket that has a GitHub PR link, and press **p**. Check:
   - the **PR** select, its hint, and a **Repo** select with only the PR's repo;
   - no **Branch** field, and the review prompt with the PR's link;
   - "None: start on the Linear branch" brings back Branch, all repos and the normal prompt, and selecting the PR again brings the PR's prompt back;
   - after you type in the prompt, a PR change keeps your text;
   - a ticket that is not a review shows the popover as before;
   - at a window width of 1120, the popover is not clipped.
7. Open Settings. Check the two text areas, the hint, and that each **Reset to default** shows only when its prompt differs from the default.
8. Delete the `.playwright-mcp/` folder that Playwright writes into the checkout. It can hold real client names.

- [ ] **Step 4: A real PR start (ask the user first)**

This step makes a real worktree and starts a Claude in periscope's dev instance. Ask the user before you do it, and name the repo and the PR you plan to use. If the user agrees, call periscope's dev instance directly, so no Linear comment is written:

```bash
curl -s -X POST http://127.0.0.1:17375/api/linear/start -H 'content-type: application/json' \
  -d '{"repo": "<repo path from the catalog>", "pr": <N>, "ticket": "ENG-123", "title": "Review check", "prompt": "Say hello, then stop."}'
```

Expected: `{"mode": "spawned", …, "reused": false, …}` and a new worktree on `pr-<N>`. The same request again gives `{"mode": "existing", …}`. Afterwards, stop that Claude and remove the worktree and the `pr-<N>` branch, with the user's agreement.

### Task 13: Finish

- [ ] **Step 1: Run every check**

Run in todo-hub: `cd backend && uv run pytest -q` and `cd app && npx tsc --noEmit`.
Run in periscope's worktree: `bin/check` and `uv run pytest -q`.
Expected: all pass, zero violations.

- [ ] **Step 2: Scan for client data**

In each repo, stage nothing new, and scan the branch's diff against `origin/main`:

```bash
git diff origin/main --name-only
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"   # in todo-hub, after git add of the changed files
```

Also check the diff for the client labels in `todohub.db` (`select value from meta where key='client_labels'`) and for work emails. Use Python `re`, not `git grep -E` with `\b`. Fix any hit first.

- [ ] **Step 3: Check the commit trailers**

Run in each repo: `git log origin/main..HEAD --format="%(trailers:key=Co-Authored-By,valueonly)" --no-merges | sort | uniq -c`
Expected: only `Claude Opus 5.5 <noreply@anthropic.com>`.

- [ ] **Step 4: Ask the user**

Ask before any push. The periscope branch goes to `origin` (`tomplex/periscope`), as `thibaultdody/linear-start-pr`, and Tom reviews it. The todo-hub branch goes to `origin` (`tdody/todo-hub`). Open a Linear ticket for the limitation in the spec: a reused `pr-<N>` worktree is not updated when the PR has new commits.

## Assumptions to list in the PR descriptions

- A periscope repo matches a PR only when its origin is the PR's repo. A clone whose origin is a fork does not match.
- The rules can give the type `review` to a ticket that is not a review. "None: start on the Linear branch" covers this.
- A reused `pr-<N>` worktree can be behind the PR. A Linear ticket tracks the fix.
- `fetch_pr_into_worktree` fetches `pull/<N>/head` from origin. That works because the matching repo's origin is the PR's repo.
