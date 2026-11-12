# Edit issues from TodoHub: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename an issue, rewrite its description, change its client or project, add and tick sub-issues, and post comments from Today's focus pane and the Client/Dev reading pane, each with ⌘Z undo.

**Architecture:** The backend speaks TodoHub's words (names and text) and turns them into Linear's (`removedLabelIds`, `addedLabelIds`, `projectId`, `children`), so the UI never sees Linear ids. The UI keeps unsaved text in one map (`paneDrafts`) that every re-render rebuilds the fields from, and `render()` hands the cursor back to the field that had it. Editors live in the shared pane body, so Today and Client/Dev behave the same.

**Tech stack:** Python 3 + FastAPI + pytest (`backend/`, run with `uv`); TypeScript + Vite, no framework (`app/`, DOM built with `h()` from `app/src/dom.ts`).

**Spec:** `docs/superpowers/specs/2026-11-10-edit-issues-design.md`. **Branch:** `edit-issues`.

---

## Conventions for every task

- Backend tests: `cd backend && uv run pytest -q` (179 pass before this plan starts).
- Frontend check: `cd app && npx tsc --noEmit`. The full build is `cd app && npm run build`.
- The app has no frontend test runner. Frontend tasks are checked with `tsc`, then all together in the browser in Task 11.
- Test data uses fictional names only: Globex, Initech & Co, Hooli, Sam, `ENG-123`, `acme/api`. Never a real client, colleague or the work team key.
- **Before every commit**, run the private-names scan on what's staged and fix anything it finds: `python3 -I "$SCAN"`, where `$SCAN` is the scan script the controller gives you. It lives outside the repo because its word list is private, and it prints counts, never names. Expected: `client names: 0 | private words: 0`.
- Commit messages follow the repo's style: a short plain sentence, then the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `app/src/main.ts` is large (about 3,600 lines). Find code by the quoted text, not by line number.

## Files

| File | Change |
| --- | --- |
| `backend/src/todohub/linear.py` | `client_labels()` helper; the preview query reads `children`; `update_issue` docstring |
| `backend/src/todohub/api.py` | `IssueEdit` gains title, description, client, project; preview adds `sub_issues`; new comment and sub-issue endpoints |
| `backend/tests/conftest.py` | `FakeLinear.issue_preview` returns `children` |
| `backend/tests/test_linear.py`, `backend/tests/test_api.py` | Tests |
| `app/src/api.ts` | `IssueEdit`, `SubIssue`, `IssuePreview.sub_issues`, three API calls |
| `app/src/main.ts` | Pane drafts and focus keeping in `render()`; `editIssue` for the new fields; title, fields row, description, sub-issues, comments; keys |
| `app/src/styles.css` | Editors in the pane |
| `README.md` | The reading pane bullets |
| Scratchpad `preview/mock_backend.py` | The browser preview's fake backend learns the new endpoints (not committed) |

---

### Task 1: Linear client: client labels helper and sub-issues in the preview query

**Files:**
- Modify: `backend/src/todohub/linear.py` (`issue_preview`, `update_issue`, `client_label_of`)
- Test: `backend/tests/test_linear.py`

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_linear.py`, change the import line

```python
from todohub.linear import Linear, LinearError, shape_issue
```

to

```python
from todohub.linear import Linear, LinearError, client_labels, shape_issue
```

and add at the end of the file:

```python
def test_client_labels_are_the_ones_in_the_client_group():
    issue = make_issue("ENG-1", "Rebin Globex grades", client="Globex")
    assert [l["id"] for l in client_labels(issue, "client")] == ["l-Globex"]
    assert client_labels(make_issue("ENG-2", "Fix the copy"), "client") == []
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && uv run pytest tests/test_linear.py -q`
Expected: an `ImportError` for `client_labels`.

- [ ] **Step 3: Implement**

In `backend/src/todohub/linear.py`, replace

```python
def client_label_of(issue: dict, client_group: str) -> str | None:
    for label in issue["labels"]["nodes"]:
        parent = label.get("parent")
        if parent and parent["name"] == client_group:
            return label["name"]
    return None
```

with

```python
def client_labels(issue: dict, client_group: str) -> list[dict]:
    """The issue's labels in the client label group (normally one)."""
    return [l for l in issue["labels"]["nodes"] if (l.get("parent") or {}).get("name") == client_group]


def client_label_of(issue: dict, client_group: str) -> str | None:
    found = client_labels(issue, client_group)
    return found[0]["name"] if found else None
```

In `issue_preview`, replace the docstring and the query body lines

```python
        """An issue with its description, assignee and recent comments, for a quick look."""
```

```python
                comments(first: 50) {{ nodes {{ body createdAt user {{ name }} }} }}
```

with

```python
        """An issue with its description, assignee, recent comments and sub-issues, for a quick look."""
```

```python
                comments(first: 50) {{ nodes {{ body createdAt user {{ name }} }} }}
                children(first: 50) {{ nodes {{ {ISSUE_FIELDS} assignee {{ name }} }} }}
```

In `update_issue`, replace the docstring

```python
        """``changes`` uses Linear's field names: stateId, priority, dueDate (None clears it)."""
```

with

```python
        """``changes`` uses Linear's IssueUpdateInput names: stateId, priority, dueDate, title, description,
        projectId, addedLabelIds, removedLabelIds. None clears a field."""
```

(Linear's public schema has all of these on `IssueUpdateInput`, and `children` on `Issue`. They were checked against `packages/sdk/src/schema.graphql` in `linear/linear` on 2026-11-10.)

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest -q`
Expected: 180 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/linear.py backend/tests/test_linear.py
# run the scan from Conventions
git commit -m "Linear: client labels helper; the preview reads sub-issues" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: PATCH an issue's title, description, client and project

**Files:**
- Modify: `backend/src/todohub/api.py` (`IssueEdit`, `edit_issue`, imports)
- Test: `backend/tests/test_api.py`

- [ ] **Step 1: Write the failing tests**

Add after `test_issue_lists_and_edits` in `backend/tests/test_api.py`:

```python
def test_edit_issue_title_and_description(env):
    client, _, fake, _ = env
    assert client.patch("/api/issues/id-ENG-2", json={"title": "  Fix the report copy "}).status_code == 200
    assert fake.updated[-1] == ("id-ENG-2", {"title": "Fix the report copy"})
    assert client.patch("/api/issues/id-ENG-2", json={"description": "## Steps\n\n- one"}).status_code == 200
    assert fake.updated[-1] == ("id-ENG-2", {"description": "## Steps\n\n- one"})
    client.patch("/api/issues/id-ENG-2", json={"description": None})
    assert fake.updated[-1] == ("id-ENG-2", {"description": ""})
    r = client.patch("/api/issues/id-ENG-2", json={"title": "   "})
    assert r.status_code == 400 and r.json()["error"] == "The title can't be empty"
    assert client.patch("/api/issues/id-ENG-2", json={"title": "x" * 201}).status_code == 422
    assert len(fake.updated) == 3


def test_edit_issue_client_swaps_only_the_client_label(env):
    client, _, fake, _ = env
    r = client.patch("/api/issues/id-ENG-1", json={"client": "Initech & Co"})
    assert r.status_code == 200, r.text
    # ENG-1 has Bug and Globex; only Globex (in the client group) goes.
    assert fake.updated[-1] == ("id-ENG-1", {"removedLabelIds": ["l-Globex"], "addedLabelIds": ["l-Initech & Co"]})
    client.patch("/api/issues/id-ENG-1", json={"client": None})          # to Dev
    assert fake.updated[-1] == ("id-ENG-1", {"removedLabelIds": ["l-Globex"]})
    client.patch("/api/issues/id-ENG-2", json={"client": "Globex"})      # from Dev
    assert fake.updated[-1] == ("id-ENG-2", {"addedLabelIds": ["l-Globex"]})
    r = client.patch("/api/issues/id-ENG-1", json={"client": "Vandelay"})
    assert r.status_code == 400 and r.json()["error"] == "No client label 'Vandelay' in Linear"
    assert len(fake.updated) == 3


def test_edit_issue_project(env):
    client, _, fake, _ = env
    client.patch("/api/issues/id-ENG-2", json={"project": "Globex"})
    assert fake.updated[-1] == ("id-ENG-2", {"projectId": "p-globex"})
    client.patch("/api/issues/id-ENG-2", json={"project": None})
    assert fake.updated[-1] == ("id-ENG-2", {"projectId": None})
    r = client.patch("/api/issues/id-ENG-2", json={"project": "Old thing"})
    assert r.status_code == 400 and r.json()["error"] == "No open project 'Old thing' in Linear"
    assert len(fake.updated) == 2
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd backend && uv run pytest tests/test_api.py -q -k "edit_issue"`
Expected: the three new tests fail (the new fields are ignored, so the PATCH says "Nothing to change" with a 400).

- [ ] **Step 3: Implement**

In `backend/src/todohub/api.py`, change the import

```python
from .linear import Linear, LinearError, TeamMeta, is_linear_upload, shape_issue
```

to

```python
from .linear import Linear, LinearError, TeamMeta, client_labels, is_linear_upload, shape_issue
```

Replace `IssueEdit`

```python
class IssueEdit(BaseModel):
    state_id: str | None = None
    priority: int | None = Field(default=None, ge=0, le=4)
    due_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
```

with

```python
class IssueEdit(BaseModel):
    state_id: str | None = None
    priority: int | None = Field(default=None, ge=0, le=4)
    due_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    title: str | None = Field(default=None, max_length=200)
    description: str | None = None      # Markdown; empty or null clears it
    client: str | None = None           # a client label's name; null makes it a Dev issue
    project: str | None = None          # an open project's name; null takes it out of its project
```

Inside `create_app`, right after `def team_meta(...)` and its body, add:

```python
    def id_by_name(items: list[dict], name: str | None, what: str) -> str | None:
        """The id of the client label or project called ``name`` (None for none); a 400 if Linear has none."""
        if name is None:
            return None
        found = next((x for x in items if x["name"] == name), None)
        if not found:
            raise HTTPException(400, f"No {what} {name!r} in Linear")
        return found["id"]
```

Replace the body of `edit_issue` (from `fields = edit.model_fields_set` to `return shape_issue(issue, settings)`) with:

```python
        fields = edit.model_fields_set
        if not fields:
            raise HTTPException(400, "Nothing to change")
        changes: dict = {}
        if "state_id" in fields:
            if not edit.state_id:
                raise HTTPException(400, "state_id can't be empty")
            changes["stateId"] = edit.state_id
        if "priority" in fields:
            changes["priority"] = edit.priority or 0
        if "due_date" in fields:
            changes["dueDate"] = edit.due_date   # None clears it
        if "title" in fields:
            title = (edit.title or "").strip()
            if not title:
                raise HTTPException(400, "The title can't be empty")
            changes["title"] = title
        if "description" in fields:
            changes["description"] = edit.description or ""
        if "project" in fields:
            changes["projectId"] = id_by_name(team_meta().projects, edit.project, "open project")
        new_client = id_by_name(team_meta().client_labels, edit.client, "client label") if "client" in fields else None

        def run(l: Linear) -> dict:
            # A client change swaps the label in the client group and keeps every other label.
            if "client" in fields:
                old = [x["id"] for x in client_labels(l.get_issue(issue_id), settings.client_label_group)]
                new = [new_client] if new_client else []
                if removed := [x for x in old if x not in new]:
                    changes["removedLabelIds"] = removed
                if added := [x for x in new if x not in old]:
                    changes["addedLabelIds"] = added
            return l.update_issue(issue_id, changes)

        return shape_issue(linear_call(run), settings)
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest -q`
Expected: 183 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/api.py backend/tests/test_api.py
# run the scan from Conventions
git commit -m "API: edit an issue's title, description, client and project" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sub-issues in the issue preview

**Files:**
- Modify: `backend/src/todohub/api.py` (`issue_preview`)
- Modify: `backend/tests/conftest.py` (`FakeLinear.issue_preview`)
- Test: `backend/tests/test_api.py`

- [ ] **Step 1: Write the failing test**

Add after `test_issue_preview` in `backend/tests/test_api.py`:

```python
def test_issue_preview_lists_sub_issues(env):
    client, _, fake, _ = env
    parent = {"id": "id-ENG-1", "identifier": "ENG-1", "title": "Rebin Globex grades"}
    mine = make_issue("ENG-5", "Check the CSV", state="Done")
    mine.update(parent=parent, team={"id": "team-eng"}, assignee={"name": "Sam"})
    other = make_issue("OPS-7", "Rotate the key")
    other.update(parent=parent, team={"id": "team-ops"})
    fake.issues += [mine, other]
    subs = client.get("/api/issues/ENG-1/preview").json()["sub_issues"]
    assert [(s["identifier"], s["state"]["name"], s["assignee"], s["own_team"]) for s in subs] == [
        ("ENG-5", "Done", "Sam", True), ("OPS-7", "Todo", None, False)]
    assert client.get("/api/issues/ENG-2/preview").json()["sub_issues"] == []
```

In `backend/tests/conftest.py`, in `FakeLinear.issue_preview`, add the `children` the real query now returns. Replace

```python
                     comments={"nodes": [{"body": f"note {n}", "createdAt": f"2026-11-0{n}T09:00:00Z",
                                          "user": {"name": "Jordan"}} for n in (4, 2, 3, 1)]})
        return issue
```

with

```python
                     comments={"nodes": [{"body": f"note {n}", "createdAt": f"2026-11-0{n}T09:00:00Z",
                                          "user": {"name": "Jordan"}} for n in (4, 2, 3, 1)]},
                     children={"nodes": [i for i in self.issues if (i.get("parent") or {}).get("id") == issue["id"]]})
        return issue
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && uv run pytest tests/test_api.py -q -k preview`
Expected: `test_issue_preview_lists_sub_issues` fails with `KeyError: 'sub_issues'`.

- [ ] **Step 3: Implement**

In `issue_preview` in `backend/src/todohub/api.py`, replace

```python
        description = (raw.get("description") or "").strip()
        return {
```

with

```python
        description = (raw.get("description") or "").strip()
        own_team = team_meta().team_id
        return {
```

and after the `"comments": [ ... ],` entry (before the closing `}` of the returned dict), add:

```python
            # Done ones too. A sub-issue in another team has statuses the app doesn't know, so the
            # pane shows its status without a checkbox.
            "sub_issues": [
                {**shape_issue(n, settings), "assignee": (n.get("assignee") or {}).get("name"),
                 "own_team": (n.get("team") or {}).get("id") == own_team}
                for n in (raw.get("children") or {}).get("nodes", [])
            ],
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest -q`
Expected: 184 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/api.py backend/tests/conftest.py backend/tests/test_api.py
# run the scan from Conventions
git commit -m "API: the issue preview lists its sub-issues" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Post and delete a comment

**Files:**
- Modify: `backend/src/todohub/api.py`
- Test: `backend/tests/test_api.py`

- [ ] **Step 1: Write the failing test**

Add after `test_edit_issue_project`:

```python
def test_post_and_delete_comment(env):
    client, _, fake, _ = env
    r = client.post("/api/issues/id-ENG-1/comments", json={"body": "  Sent the file to Sam.  "})
    assert r.status_code == 200 and r.json() == {"id": "comment-1"}
    assert fake.comments == [("id-ENG-1", "Sent the file to Sam.")]
    assert client.delete("/api/comments/comment-1").json() == {"deleted": "comment-1"}
    assert fake.deleted_comments == ["comment-1"]
    r = client.post("/api/issues/id-ENG-1/comments", json={"body": "   "})
    assert r.status_code == 400 and r.json()["error"] == "The comment is empty"
    assert client.post("/api/issues/id-ENG-1/comments", json={"body": "x" * 2001}).status_code == 422
    assert len(fake.comments) == 1
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && uv run pytest tests/test_api.py -q -k comment`
Expected: FAIL, the POST returns 404 or 405.

- [ ] **Step 3: Implement**

In `backend/src/todohub/api.py`, add after `class RestoreIn`:

```python
class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
```

Add after the `restore_issue` endpoint inside `create_app`:

```python
    @app.post("/api/issues/{issue_id}/comments", dependencies=auth)
    def add_comment(issue_id: str, body: CommentIn) -> dict:
        """Post a comment as you. Returns its id, so Undo can delete it."""
        text = body.body.strip()
        if not text:
            raise HTTPException(400, "The comment is empty")
        return {"id": linear_call(lambda l: l.create_comment(issue_id, text))}

    @app.delete("/api/comments/{comment_id}", dependencies=auth)
    def delete_comment(comment_id: str) -> dict:
        linear_call(lambda l: l.delete_comment(comment_id))
        return {"deleted": comment_id}
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest -q`
Expected: 185 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/api.py backend/tests/test_api.py
# run the scan from Conventions
git commit -m "API: post a comment on an issue, and delete it for undo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Add a sub-issue

**Files:**
- Modify: `backend/src/todohub/api.py`
- Test: `backend/tests/test_api.py`

- [ ] **Step 1: Write the failing test**

Add after `test_post_and_delete_comment`:

```python
def test_add_sub_issue_takes_the_parents_client_project_and_priority(env):
    client, _, fake, _ = env
    fake.issues[0].update(priority=2, project={"id": "p-globex", "name": "Globex"})
    r = client.post("/api/issues/id-ENG-1/sub-issues", json={"title": " Check the CSV "})
    assert r.status_code == 200, r.text
    assert r.json()["parent"]["id"] == "id-ENG-1"
    assert fake.created[-1] == {
        "team_id": "team-eng", "title": "Check the CSV", "description": "Part of ENG-1: Rebin Globex grades",
        "assignee_id": "me", "state_id": "s-Todo", "priority": 2, "due_date": None,
        "label_ids": ["l-Globex"], "parent_id": "id-ENG-1", "project_id": "p-globex",
    }
    # a Dev parent without a project: no labels, no project
    client.post("/api/issues/id-ENG-2/sub-issues", json={"title": "Read the logs"})
    assert fake.created[-1]["label_ids"] == [] and fake.created[-1]["project_id"] is None
    r = client.post("/api/issues/id-ENG-1/sub-issues", json={"title": "   "})
    assert r.status_code == 400 and r.json()["error"] == "The title can't be empty"
    assert client.post("/api/issues/id-ENG-1/sub-issues", json={"title": "x" * 201}).status_code == 422
    assert len(fake.created) == 2
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && uv run pytest tests/test_api.py -q -k sub_issue`
Expected: FAIL, 404 or 405.

- [ ] **Step 3: Implement**

Add after `class CommentIn`:

```python
class SubIssueIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
```

Add after the `delete_comment` endpoint:

```python
    @app.post("/api/issues/{issue_id}/sub-issues", dependencies=auth)
    def add_sub_issue(issue_id: str, body: SubIssueIn) -> dict:
        """A sub-issue made the way Inbox makes sub-tasks: your team, assigned to you, in Todo, with
        the parent's client label, project and priority. Undo deletes it like any issue."""
        title = body.title.strip()
        if not title:
            raise HTTPException(400, "The title can't be empty")
        m = team_meta()
        todo = next((s for s in m.states if s["name"] == settings.todo_state), None)
        if not todo:
            raise HTTPException(500, f"Team {settings.team_key} has no {settings.todo_state!r} status")

        def run(l: Linear) -> dict:
            parent = l.get_issue(issue_id)
            return l.create_issue(
                team_id=m.team_id, title=title, description=f"Part of {parent['identifier']}: {parent['title']}",
                assignee_id=m.viewer_id, state_id=todo["id"], priority=parent["priority"], due_date=None,
                label_ids=[x["id"] for x in client_labels(parent, settings.client_label_group)],
                parent_id=parent["id"], project_id=(parent.get("project") or {}).get("id"),
            )

        return shape_issue(linear_call(run), settings)
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest -q`
Expected: 186 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/api.py backend/tests/test_api.py
# run the scan from Conventions
git commit -m "API: add a sub-issue with its parent's client, project and priority" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: App API types and calls

**Files:**
- Modify: `app/src/api.ts`

- [ ] **Step 1: Types**

Replace

```ts
export interface IssueEdit {
  state_id?: string;
  priority?: number;
  due_date?: string | null;
}
```

with

```ts
export interface IssueEdit {
  state_id?: string;
  priority?: number;
  due_date?: string | null;
  title?: string;
  /** Markdown; empty clears it. */
  description?: string;
  /** A client label's name; null makes it a Dev issue. */
  client?: string | null;
  /** An open project's name; null takes it out of its project. */
  project?: string | null;
}

/** A sub-issue in the reading pane. ``own_team``: it's in TodoHub's team, so the app's statuses apply. */
export interface SubIssue extends Issue {
  assignee: string | null;
  own_team: boolean;
}
```

In `export interface IssuePreview extends Issue {`, add a last field after `comments: ...;`:

```ts
  sub_issues: SubIssue[];
```

- [ ] **Step 2: Calls**

In `export const api = {`, after the `restoreIssue: ...` entry, add:

```ts
  /** Post a comment as you; the id lets Undo delete it. */
  addComment: (issueId: string, body: string) =>
    call<{ id: string }>("POST", `/api/issues/${encodeURIComponent(issueId)}/comments`, { body }),
  deleteComment: (id: string) => call<{ deleted: string }>("DELETE", `/api/comments/${encodeURIComponent(id)}`),
  /** A sub-issue with the parent's client, project and priority, assigned to you, in Todo. */
  addSubIssue: (parentId: string, title: string) =>
    call<Issue>("POST", `/api/issues/${encodeURIComponent(parentId)}/sub-issues`, { title }),
```

- [ ] **Step 3: Check**

Run: `cd app && npx tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add app/src/api.ts
# run the scan from Conventions
git commit -m "App API: issue edits, sub-issues, comments" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Drafts that survive re-renders, editIssue for the new fields, rename in place, client and project

**Files:**
- Modify: `app/src/main.ts`

Why this exists: `render()` rebuilds the whole page (`main.replaceChildren`) after most actions, when a sweep finishes, and when async loads land. A field built from the DOM alone would lose its text and focus. So unsaved text lives in `paneDrafts`, the fields are rebuilt from it, and `render()` hands the cursor back. A field that loses focus to a re-render, or to a switch to another app, must not save: `isLeaving(e)` tells them apart (`rebuilding` covers a blur during the rebuild, `isConnected` a blur fired after the node was removed, `document.hasFocus()` an app switch). A save that starts from a blur never calls `render()` before its request, or the click that moved the focus would be lost.

- [ ] **Step 1: Imports**

In the `import type { ... } from "./api";` line, add `IssueEdit` to the list.

- [ ] **Step 2: Drafts, focus keeping, and the preview reload**

Find the reading pane block:

```ts
type Detail = { at: number; loading?: true; error?: string; issue?: IssuePreview };
const details = new Map<string, Detail>();           // reading pane content, by issue id
```

Immediately after those two lines, add:

```ts
// Text typed in the pane, by "<issue id>:<field>" (title, description, comment, sub), until it's
// saved. Re-renders rebuild the fields from it, so a sweep finishing or the list reloading never
// loses what you typed. A title or description draft also means its editor is open.
const paneDrafts = new Map<string, string>();
let rebuilding = false;        // render() is replacing the page

/** A field lost focus because you left it: not because a re-render removed it, and not because you
 *  switched to another app (the field gets the focus back when you return). */
function isLeaving(e: Event): boolean {
  return !rebuilding && (e.target as Element).isConnected && document.hasFocus();
}

/** Open the title or description editor with ``text``, cursor at the end. */
function openEdit(key: string, text: string) {
  paneDrafts.set(key, text);
  render();
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-edit="${CSS.escape(key)}"]`);
  el?.focus();
  el?.setSelectionRange(el.value.length, el.value.length);
}

interface PaneKeep { edit: string | null; start: number | null; end: number | null; pane: string | null; scroll: number }

/** Before a re-render: the pane field holding the cursor, and how far the reading pane is scrolled. */
function paneKeep(): PaneKeep {
  const a = document.activeElement as HTMLInputElement | null;
  const pane = document.querySelector<HTMLElement>(".td-st, .tl-pane");
  const edit = a?.dataset?.edit ?? null;
  return { edit, start: edit ? a!.selectionStart : null, end: edit ? a!.selectionEnd : null,
    pane: pane?.getAttribute("aria-label") ?? null, scroll: pane?.scrollTop ?? 0 };
}

/** After a re-render: the same field gets the cursor back, and the same issue's pane its scroll. */
function paneRestore(k: PaneKeep) {
  const pane = document.querySelector<HTMLElement>(".td-st, .tl-pane");
  if (pane && k.pane && pane.getAttribute("aria-label") === k.pane) pane.scrollTop = k.scroll;
  if (!k.edit) return;
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-edit="${CSS.escape(k.edit)}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (k.start !== null) el.setSelectionRange(k.start, k.end ?? k.start);
}

/** Keep the pane's copy of a description in step with a save or an undo. */
function setDescription(id: string, text: string) {
  const d = details.get(id);
  if (d?.issue) d.issue = { ...d.issue, description: text };
}
```

In `loadDetail`, replace

```ts
    .finally(() => {
      document.querySelectorAll<HTMLElement>(`.tl-detail[data-id="${id}"]`).forEach((el) => el.replaceWith(detailBody(id)));
    });
```

with

```ts
    .finally(() => {
      const shown = [...document.querySelectorAll<HTMLElement>(`.tl-detail[data-id="${id}"]`)];
      // While you type in it, re-render the page instead: that keeps your cursor where it was.
      if (shown.some((el) => el.contains(document.activeElement))) render();
      else shown.forEach((el) => el.replaceWith(detailBody(id)));
    });
```

- [ ] **Step 3: render() keeps the cursor and the pane's scroll**

At the end of `function render()`, replace

```ts
  main.replaceChildren(
    head,
    state.error ? h("div", { class: "banner error" }, state.error) : "",
    state.tab === "inbox" && state.run.status !== "running" && problems.length
      ? h("div", { class: "banner warn" },
          ...problems.map((p) => h("div", {}, `${SOURCE_NAME[p.source]}: ${p.detail ?? "problem during the last sweep"}`)))
      : "",
    state.tab === "inbox" ? captureBar : "",
    h("div", { class: "content" }, view()),
  );
}
```

with

```ts
  const keep = paneKeep();
  rebuilding = true;
  try {
    main.replaceChildren(
      head,
      state.error ? h("div", { class: "banner error" }, state.error) : "",
      state.tab === "inbox" && state.run.status !== "running" && problems.length
        ? h("div", { class: "banner warn" },
            ...problems.map((p) => h("div", {}, `${SOURCE_NAME[p.source]}: ${p.detail ?? "problem during the last sweep"}`)))
        : "",
      state.tab === "inbox" ? captureBar : "",
      h("div", { class: "content" }, view()),
    );
  } finally {
    rebuilding = false;
  }
  paneRestore(keep);
}
```

- [ ] **Step 4: editIssue handles the new fields and says whether it worked**

Replace the whole `async function editIssue(issue: Issue, change: Parameters<typeof api.editIssue>[1]) { ... }` (from that line through its closing `}` before the `/** Delete an issue after a confirm` comment) with:

```ts
/** Change an issue in Linear, with Undo. For a description edit ``issue`` is the pane's preview:
 *  its text is what Undo puts back. Returns whether Linear took the change. */
async function editIssue(issue: Issue | IssuePreview, change: IssueEdit): Promise<boolean> {
  try {
    const updated = await api.editIssue(issue.id, change);
    const status = state.meta?.states.find((s) => s.id === updated.state.id);
    const closed = closedType(status?.type ?? updated.state.type);
    // In Client or Dev, an issue that moved to the other list leaves this one: select the next row.
    const kind = state.tab === "client" || state.tab === "dev" ? state.tab : null;
    if (kind && !state.pickedProject && updated.list !== issue.list && state.listSel[kind] === issue.id) {
      const at = listOrder.indexOf(issue.id);
      state.listSel[kind] = listOrder[at + 1] ?? listOrder[at - 1] ?? null;
    }
    state.issues = closed ? state.issues.filter((i) => i.id !== issue.id)
      : state.issues.map((i) => (i.id === issue.id ? updated : i));
    if (change.description !== undefined) setDescription(issue.id, change.description);
    // The reverse change: put back whatever this edit replaced.
    const before: IssueEdit = {};
    if ("state_id" in change) before.state_id = issue.state.id;
    if ("priority" in change) before.priority = issue.priority;
    if ("due_date" in change) before.due_date = issue.due_date;
    if ("title" in change) before.title = issue.title;
    if ("client" in change) before.client = issue.client;
    if ("project" in change) before.project = issue.project;
    if ("description" in change && "description" in issue) before.description = issue.description;
    const what = "state_id" in change ? `moved to ${status?.name ?? updated.state.name}`
      : "priority" in change ? `priority set to ${priorityName(updated.priority)}`
      : "title" in change ? "renamed"
      : "description" in change ? "description saved"
      : "client" in change ? `moved to ${updated.client ?? "Dev"}`
      : "project" in change ? (updated.project ? `project set to ${updated.project}` : "project cleared")
      : updated.due_date ? `due ${updated.due_date}` : "due date cleared";
    offerUndo(`${issue.identifier} ${what}`, `${issue.identifier} change reverted`, async () => {
      const restored = await api.editIssue(issue.id, before);
      state.issues = state.issues.some((i) => i.id === issue.id)
        ? state.issues.map((i) => (i.id === issue.id ? restored : i))
        : [restored, ...state.issues];
      if (before.description !== undefined) setDescription(issue.id, before.description);
    });
    return true;
  } catch (e) {
    fail(e);
    return false;
  } finally {
    render();
  }
}
```

- [ ] **Step 5: The title field and the shared fields row**

Add right after the `setDescription` function from Step 2:

```ts
/** The issue's title in a reading pane. Click it (or press e) to rename it in place; Enter or
 *  leaving the field saves, Esc cancels. */
function titleField(i: Issue, tag: "h2" | "h3"): HTMLElement {
  const key = `${i.id}:title`;
  const draft = paneDrafts.get(key);
  if (draft === undefined) {
    return h(tag, { class: "pane-title", "data-pane": "title", title: "Rename (e)", onclick: () => openEdit(key, i.title) }, i.title);
  }
  return h(tag, { class: "pane-title editing" }, h("input", {
    class: "pane-title-input", value: draft, maxLength: 200, readOnly: state.busy.has(key), "aria-label": "Title", "data-edit": key,
    oninput: (e: Event) => { paneDrafts.set(key, (e.target as HTMLInputElement).value); },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); void saveTitle(i, tag, e.target as HTMLInputElement); }
      if (e.key === "Escape") { e.stopPropagation(); paneDrafts.delete(key); render(); }
    },
    onblur: (e: Event) => { if (isLeaving(e)) void saveTitle(i, tag, e.target as HTMLInputElement); },
  }));
}

async function saveTitle(i: Issue, tag: "h2" | "h3", input: HTMLInputElement) {
  const key = `${i.id}:title`;
  const title = paneDrafts.get(key)?.trim();
  if (title === undefined || state.busy.has(key)) return;
  if (!title || title === i.title) {          // unchanged or empty: close the editor where it sits
    paneDrafts.delete(key);
    input.closest(".pane-title")?.replaceWith(titleField(i, tag));
    return;
  }
  // No render() before the request: this can run from a blur, and rebuilding the page under the
  // pointer would swallow the click that moved the focus. editIssue renders when Linear answers.
  state.busy.add(key);
  input.readOnly = true;
  await editIssue(i, { title });
  state.busy.delete(key);
  paneDrafts.delete(key);
  render();
}

/** Status, priority, due date, client and project: the fields both reading panes edit in place. */
function issueFields(i: Issue): HTMLElement[] {
  return [
    statusPill(i, (id) => { details.delete(i.id); void editIssue(i, { state_id: id }); }),
    priorityPill(i.priority, (v) => void editIssue(i, { priority: v })),
    dateInput(i.due_date, (v) => void editIssue(i, { due_date: v }), dueClass(i.due_date)),
    clientSelect(i.client, (v) => void editIssue(i, { client: v })),
    projectSelect(i.project, (v) => void editIssue(i, { project: v })),
  ];
}
```

- [ ] **Step 6: Use them in Today's stage**

In `stageBody`, replace

```ts
    h("div", { class: "tl-fields" },
      statusPill(i, (id) => { details.delete(i.id); void editIssue(i, { state_id: id }); }),
      priorityPill(i.priority, (v) => void editIssue(i, { priority: v })),
      dateInput(i.due_date, (v) => void editIssue(i, { due_date: v }), dueClass(i.due_date)),
      h("span", { class: "spacer" }), more),
```

with

```ts
    h("div", { class: "tl-fields" }, ...issueFields(i), h("span", { class: "spacer" }), more),
```

Then check that the stage title appears exactly three times (in `focusStage`, `wrapStage` and `offStage`):

Run: `grep -c 'h("h2", {}, i.title),' app/src/main.ts`
Expected: `3`

Replace all three `    h("h2", {}, i.title),` with `    titleField(i, "h2"),` (the Edit tool with `replace_all`).

- [ ] **Step 7: Use them in the Client/Dev pane**

In `issuePane`, replace

```ts
    h("h3", {}, i.title),
    // One row: status, priority, due date, then Block time (or Add to Today) and ⋯.
    h("div", { class: "tl-fields" },
      statusPill(i, (id) => { details.delete(i.id); void editIssue(i, { state_id: id }); }),
      priorityPill(i.priority, (v) => void editIssue(i, { priority: v })),
      dateInput(i.due_date, (v) => void editIssue(i, { due_date: v }), dueClass(i.due_date)),
      h("span", { class: "spacer" }),
```

with

```ts
    titleField(i, "h3"),
    // One row: status, priority, due date, client, project, then Block time (or Add to Today) and ⋯.
    h("div", { class: "tl-fields" }, ...issueFields(i),
      h("span", { class: "spacer" }),
```

- [ ] **Step 8: Show a completed project as the current value**

Linear only offers open projects to pick, so an issue in a completed project would otherwise show "No project". In `projectSelect`, replace

```ts
  const projects = state.meta?.projects ?? [];
```

with

```ts
  // The list holds open projects only; an issue in a completed one still shows it.
  const open = state.meta?.projects ?? [];
  const projects = value && !open.includes(value) ? [value, ...open] : open;
```

- [ ] **Step 9: Check**

Run: `cd app && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add app/src/main.ts
# run the scan from Conventions
git commit -m "App: pane drafts survive re-renders; rename an issue in place; client and project in the pane's fields" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Description, sub-issues and comments in the pane body

**Files:**
- Modify: `app/src/main.ts`

- [ ] **Step 1: Import SubIssue**

In the `import type { ... } from "./api";` line, add `SubIssue` to the list.

- [ ] **Step 2: Replace detailBody with three sections**

Replace the whole `function detailBody(id: string): HTMLElement { ... }` with:

```ts
function detailBody(id: string): HTMLElement {
  const d = details.get(id);
  const i = d?.issue;
  if (!i) return h("div", { class: "tl-detail", "data-id": id },
    h("p", { class: "muted small" }, d?.error ? `Couldn't load the details: ${d.error}` : "Loading…"));
  return h("div", { class: "tl-detail", "data-id": id }, descriptionSection(i), subIssuesSection(i), commentsSection(i));
}

/** Rows for a description box: one per line (about 70 characters a row), between 4 and 24. */
function rowsFor(text: string): number {
  const rows = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 70)), 0);
  return Math.min(24, Math.max(4, rows + 1));
}

/** The description as Markdown. Click it (not a link or image) or press ⇧E to edit the Markdown in
 *  place; leaving the box, ⌘↵ or Esc saves. A description cut off at the pane's limit is edited in Linear. */
function descriptionSection(i: IssuePreview): HTMLElement {
  const key = `${i.id}:description`;
  const head = h("h4", {}, "Description");
  const draft = paneDrafts.get(key);
  if (draft !== undefined) {
    const busy = state.busy.has(key);
    return h("section", {}, head,
      h("textarea", {
        class: "desc-input", value: draft, rows: rowsFor(draft), readOnly: busy, "aria-label": "Description", "data-edit": key,
        oninput: (e: Event) => {
          const el = e.target as HTMLTextAreaElement;
          paneDrafts.set(key, el.value);
          el.rows = rowsFor(el.value);
        },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            e.stopPropagation();
            void saveDescription(i, e.target as HTMLTextAreaElement);
          }
        },
        onblur: (e: Event) => { if (isLeaving(e)) void saveDescription(i, e.target as HTMLTextAreaElement); },
      }),
      h("p", { class: "muted small" }, busy ? "Saving…" : "Markdown. Saves when you leave the box (or ⌘↵)."));
  }
  const text = () => renderMarkdown(i.description, { image: linearImageNode });
  if (i.description_truncated) {
    return h("section", {}, head, h("div", { class: "tl-desc md" }, ...text()), link("Edit in Linear ↗", i.url, "link small"));
  }
  const open = (e: Event) => {
    if ((e.target as HTMLElement).closest("a, img") || window.getSelection()?.toString()) return;
    openEdit(key, i.description);
  };
  return h("section", {}, head, i.description.trim()
    ? h("div", { class: "tl-desc md editable", "data-pane": "description", title: "Edit (⇧E)", onclick: open }, ...text())
    : h("button", { class: "add-text", "data-pane": "description", onclick: open }, "Add a description"));
}

async function saveDescription(i: IssuePreview, box: HTMLTextAreaElement) {
  const key = `${i.id}:description`;
  const text = paneDrafts.get(key);
  if (text === undefined || state.busy.has(key)) return;
  if (text.trim() === i.description.trim()) {     // unchanged: close the editor where it sits
    paneDrafts.delete(key);
    box.closest("section")?.replaceWith(descriptionSection(i));
    return;
  }
  // No render() before the request (see saveTitle): this can run from a blur.
  state.busy.add(key);
  box.readOnly = true;
  box.nextElementSibling?.replaceChildren("Saving…");
  const saved = await editIssue(i, { description: text });
  state.busy.delete(key);
  if (saved) paneDrafts.delete(key);          // a failed save keeps the box open with your text
  render();
}

/** The issue's sub-issues from Linear, done ones too. Tick one to mark it done (untick: back to
 *  Todo); a sub-issue in another team shows its status without a box. Type in "Add sub-issue"
 *  (⇧S) and press Enter; the box stays ready for the next. */
function subIssuesSection(i: IssuePreview): HTMLElement {
  const today = localToday();
  const key = `${i.id}:sub`;
  const subs = i.sub_issues;
  return h("section", {},
    subs.length ? h("h4", {}, `Sub-issues · ${subs.length}`) : "",
    subs.length ? h("ul", { class: "tl-subs" }, ...subs.map((s) => {
      const done = s.state.type === "completed";
      return h("li", { class: done ? "done" : "" },
        s.own_team
          ? h("input", { type: "checkbox", checked: done, title: done ? "Reopen" : "Mark done",
              "aria-label": `${done ? "Reopen" : "Mark done"}: ${s.identifier}`, onchange: () => void tickSubIssue(i, s) })
          : h("span", { class: "sub-gap", "aria-hidden": "true" }),
        link(s.identifier, s.url, "ident"),
        h("span", { class: "dtitle" }, s.title),
        !done && s.due_date && s.due_date < today
          ? h("span", { class: "late small" }, dueLabel(s.due_date, today).replace("overdue", "late")) : "",
        h("span", { class: "muted small" }, s.assignee && s.assignee !== i.assignee ? `${s.state.name} · ${s.assignee}` : s.state.name));
    })) : "",
    h("input", {
      class: "sub-add", placeholder: "+ Add sub-issue", value: paneDrafts.get(key) ?? "", readOnly: state.busy.has(key),
      "aria-label": `Add a sub-issue to ${i.identifier}`, "data-pane": "sub", "data-edit": key,
      oninput: (e: Event) => { paneDrafts.set(key, (e.target as HTMLInputElement).value); },
      onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void addSubIssue(i); } },
    }));
}

/** Tick: the team's first done status, as Mark done uses; untick: its first not-started one (Todo). */
async function tickSubIssue(parent: IssuePreview, sub: SubIssue) {
  const done = sub.state.type !== "completed";
  const to = state.meta?.states.find((s) => s.type === (done ? "completed" : "unstarted"));
  if (!to) { toast(`Couldn't find a ${done ? "done" : "to-do"} status for this team`); render(); return; }
  if (done) state.briefAt = 0;               // the wrap-up's "done today" should include it
  const reload = async () => { loadDetail(parent.id, true); await loadIssues().catch(() => undefined); };
  try {
    await api.editIssue(sub.id, { state_id: to.id });
    offerUndo(`${sub.identifier} ${done ? "done" : `moved to ${to.name}`}`, `${sub.identifier} back to ${sub.state.name}`, async () => {
      await api.editIssue(sub.id, { state_id: sub.state.id });
      await reload();
    });
    await reload();
  } catch (e) {
    fail(e);
  }
  render();
}

async function addSubIssue(parent: IssuePreview) {
  const key = `${parent.id}:sub`;
  const title = paneDrafts.get(key)?.trim();
  if (!title || state.busy.has(key)) return;
  state.busy.add(key);
  render();
  try {
    const sub = await api.addSubIssue(parent.id, title);
    paneDrafts.delete(key);
    state.issues = [sub, ...state.issues];
    loadDetail(parent.id, true);
    offerUndo(`${sub.identifier} added under ${parent.identifier}`, `${sub.identifier} deleted`, async () => {
      await api.deleteIssue(sub.id);
      state.issues = state.issues.filter((x) => x.id !== sub.id);
      loadDetail(parent.id, true);
    });
  } catch (e) {
    fail(e);                                   // the title stays in the box
  } finally {
    state.busy.delete(key);
    render();
  }
}

const COMMENT_MAX = 2000;      // the backend's limit, the same as an Inbox comment

/** A box to comment as you (⇧C; ⌘↵ posts), then the latest comments, newest first. */
function commentsSection(i: IssuePreview): HTMLElement {
  const key = `${i.id}:comment`;
  const busy = state.busy.has(key);
  const count = h("span", { class: "small" });
  const showCount = (text: string) => {
    const room = COMMENT_MAX - text.length;
    count.textContent = room <= 200 ? String(room) : "";
    count.className = `small ${room < 0 ? "late" : "muted"}`;
  };
  const draft = paneDrafts.get(key) ?? "";
  showCount(draft);
  const shown = [...i.comments].sort((x, y) => (y.created_at ?? "").localeCompare(x.created_at ?? ""));
  const older = i.comment_count - shown.length;
  return h("section", {}, h("h4", {}, `Comments${i.comment_count ? ` · ${i.comment_count}` : ""}`),
    h("div", { class: "comment-box" },
      h("textarea", {
        class: "comment-input", rows: 2, placeholder: "Comment…", value: draft, readOnly: busy,
        "aria-label": `Comment on ${i.identifier}`, "data-pane": "comment", "data-edit": key,
        oninput: (e: Event) => {
          const v = (e.target as HTMLTextAreaElement).value;
          paneDrafts.set(key, v);
          showCount(v);
        },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void postComment(i); }
        },
      }),
      h("span", { class: "comment-hint muted small" }, busy ? "Posting…" : "⌘↵ posts it, as you", count)),
    shown.length ? h("div", {}, ...shown.map((c) => h("div", { class: "tl-comment" },
      h("span", {}, h("b", {}, c.author), " ", h("span", { class: "muted small" }, c.created_at ? when(c.created_at) : "")),
      h("div", { class: "tl-comment-body md" }, ...renderMarkdown(c.body, { image: linearImageNode }))))) : "",
    older > 0 ? link(`${older} older in Linear ↗`, i.url, "link small") : "");
}

async function postComment(i: IssuePreview) {
  const key = `${i.id}:comment`;
  const body = paneDrafts.get(key)?.trim();
  if (!body || body.length > COMMENT_MAX || state.busy.has(key)) return;
  state.busy.add(key);
  render();
  try {
    const { id } = await api.addComment(i.id, body);
    paneDrafts.delete(key);
    loadDetail(i.id, true);
    offerUndo(`Comment posted on ${i.identifier}`, `comment on ${i.identifier} deleted`, async () => {
      await api.deleteComment(id);
      paneDrafts.set(key, body);               // back in the box, to fix and post again
      loadDetail(i.id, true);
    });
  } catch (e) {
    fail(e);                                   // the text stays in the box
  } finally {
    state.busy.delete(key);
    render();
  }
}
```

- [ ] **Step 3: Drop the old sub-issue list from the Client/Dev pane**

In `issuePane`, replace

```ts
function issuePane(i: Issue): HTMLElement {
  const today = state.brief?.day ?? isoDay(new Date());
  const t = state.today.find((x) => x.issue_id === i.id);
  loadDetail(i.id);
  const subs = state.issues.filter((x) => x.parent?.id === i.id);
```

with

```ts
function issuePane(i: Issue): HTMLElement {
  const t = state.today.find((x) => x.issue_id === i.id);
  loadDetail(i.id);
```

and delete these lines (the pane body's sub-issues section now shows them, from Linear):

```ts
    subs.length ? h("section", {}, h("h4", {}, `Sub-issues · ${subs.length}`),
      h("ul", { class: "tl-subs" }, ...subs.map((x) => h("li", {}, link(x.identifier, x.url, "ident"),
        h("span", { class: "dtitle" }, x.title),
        x.due_date && x.due_date < today ? h("span", { class: "late small" }, dueLabel(x.due_date, today).replace("overdue", "late")) : "",
        h("span", { class: "muted small" }, x.state.name))))) : "",
```

- [ ] **Step 4: Check**

Run: `cd app && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app/src/main.ts
# run the scan from Conventions
git commit -m "App: edit the description, add and tick sub-issues, and comment from the pane" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Keys and the shortcuts sheet

**Files:**
- Modify: `app/src/main.ts`

- [ ] **Step 1: paneKey**

Add after `postComment` (from Task 8):

```ts
/** e, ⇧E, ⇧S and ⇧C in Today, Client and Dev: rename, edit the description, add a sub-issue, comment. */
const PANE_KEYS: Record<string, string> = { e: "title", E: "description", S: "sub", C: "comment" };

function paneKey(key: string): boolean {
  const target = PANE_KEYS[key];
  const el = target ? document.querySelector<HTMLElement>(`:is(.td-st, .tl-pane) [data-pane="${target}"]`) : null;
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus();
  else el.click();
  return true;
}
```

- [ ] **Step 2: Call it from the global key handler**

In the `document.addEventListener("keydown", ...)` handler, find

```ts
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".overlay")) return;
```

and add right after it:

```ts
  // preventDefault: the key must not also type into the field it just focused.
  if ((state.tab === "today" || issueList) && paneKey(e.key)) { e.preventDefault(); return; }
```

(`issueList` is the `const` defined a few lines above, for Client and Dev. Today's own keys run earlier in `todayKey` and never use e, E, S or C. Keys typed in a field never get here: the handler returns early while typing.)

- [ ] **Step 3: The shortcuts sheet**

In `SHORTCUTS`, replace

```ts
  ["e", "Edit the title"],
```

with

```ts
  ["e", "Edit the title (an Inbox card, or the issue in Today, Client and Dev)"],
  ["⇧E · ⇧S · ⇧C", "Today, Client, Dev: edit the description · add a sub-issue · comment (⌘↵ posts)"],
```

- [ ] **Step 4: Check**

Run: `cd app && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app/src/main.ts
# run the scan from Conventions
git commit -m "App: e, ⇧E, ⇧S and ⇧C edit the issue in the pane" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Styles for the editors

**Files:**
- Modify: `app/src/styles.css`

Read `.impeccable/surfaces/app-src-main-ts.md` and the "The Today list and pane" section of `DESIGN.md` first. The editors must keep the heading's and the Markdown's type so nothing jumps when a field opens. Use only existing color tokens.

- [ ] **Step 1: Let the fields row wrap**

In the "Reading pane: the controls in one row" block, delete this line (the earlier `.tl-fields` rule already wraps; with client and project the row no longer fits on one line in a narrow pane):

```css
.tl-fields { flex-wrap: nowrap; }
```

- [ ] **Step 2: Add the editors' styles**

Right after `.tl-fields .qdate { min-width: 0; }` (the end of that block), add:

```css
/* ---- Reading pane: editing in place ------------------------------------------------------------ */
/* The title and description read as text and become fields where they sit, in the same type. */
.pane-title { cursor: text; border-radius: 6px; }
.pane-title:not(.editing):hover { background: var(--surface-2); box-shadow: 0 0 0 4px var(--surface-2); }
.pane-title-input { display: block; box-sizing: border-box; width: calc(100% + 14px); margin: -3px -7px; padding: 2px 6px;
  border: 1px solid var(--accent); border-radius: 6px; background: var(--surface); font: inherit; color: inherit; outline: none; }
.tl-desc.editable { cursor: text; border-radius: 6px; }
.tl-desc.editable:hover { background: var(--surface-2); box-shadow: 0 0 0 6px var(--surface-2); }
.desc-input { display: block; box-sizing: border-box; width: calc(100% + 14px); margin: -5px -7px 0; padding: 4px 6px;
  border: 1px solid var(--accent); border-radius: 6px; background: var(--surface); color: var(--ink);
  font: inherit; font-size: 13px; line-height: 1.55; resize: vertical; outline: none; }
.desc-input + p { margin: 6px 0 0; }
.add-text { padding: 0; border: 0; background: none; font: inherit; font-size: 13px; color: var(--muted); cursor: text; }
.add-text:hover { color: var(--ink); }
.tl-subs li { align-items: center; }
.tl-subs input[type="checkbox"] { flex: none; width: 14px; height: 14px; margin: 0; accent-color: var(--accent); }
.tl-subs .sub-gap { flex: none; width: 14px; }
.tl-subs li.done .dtitle { color: var(--muted); text-decoration: line-through; }
.sub-add { display: block; box-sizing: border-box; width: calc(100% + 12px); margin: 4px -6px 0; padding: 4px 6px;
  border: 1px solid transparent; border-radius: 6px; background: transparent; font: inherit; font-size: 13px; }
.sub-add:hover { border-color: var(--border); }
.sub-add:focus { border-color: var(--accent); background: var(--surface); outline: none; }
.comment-box { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
.comment-box .comment-input { margin: 0; font-size: 13px; }
.comment-hint { display: flex; justify-content: space-between; gap: 8px; }
/* Client and project show in a reading pane even when unset: they're how an issue moves. */
:is(.tl-pane, .td-st) select.quiet-empty { opacity: 1; }
```

- [ ] **Step 3: Build**

Run: `cd app && npm run build`
Expected: `tsc` passes and Vite prints its `dist/` summary with no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/styles.css
# run the scan from Conventions
git commit -m "Styles: the reading pane's editors" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Check it in the browser against the preview mock

The browser preview lives in this session's scratchpad (not the repo):
`/private/tmp/claude-501/-Users-thibaultdody-github-tdody-todo-hub/64270720-2aa9-47aa-ac6c-5997a9c87f82/scratchpad/preview/`. Its `README.md` explains how to start it, the scenarios, and the Playwright clock. Call it `$PREVIEW` below. Nothing in this task is committed.

**Files:**
- Modify: `$PREVIEW/mock_backend.py`

- [ ] **Step 1: Teach the mock the new fields and endpoints**

a. Projects as a constant. Above `def get_meta`, add `PROJECTS = ["acme/api", "Scoring service"]` and use it in `get_meta` (`"projects": PROJECTS,`).

b. Sub-issues of ENG-412: one of yours (open), one Sam finished, one in another team. Add after the `OPEN = [...]` list:

```python
def sub_issue(ident, title, status, assignee=None, team="ENG", mine=True):
    i = issue(ident, title, "Globex", status, priority=2, category="analysis")
    i.update(parent={"id": uid("ENG-412"), "identifier": "ENG-412", "title": "Send Globex the scoring file for the October cohort"},
             _assignee=assignee, _team=team, _mine=mine)
    return i


SUBS = [
    sub_issue("ENG-422", "Check the October row count", "Todo"),
    sub_issue("ENG-423", "Export the scores to Globex's bucket", "Done", assignee="Sam", mine=False),
    sub_issue("OPS-31", "Open the Globex bucket to the new key", "In Progress", assignee="Sam", team="OPS", mine=False),
]
```

In `load_scenario`, change `issues = {i["id"]: copy.deepcopy(i) for i in OPEN}` to `issues = {i["id"]: copy.deepcopy(i) for i in OPEN + SUBS}`.

In `get_issues`, list only your open issues: `return 200, [shape(i) for i in S["issues"].values() if is_open(i) and i.get("_mine", True)]`.

c. `patch_issue`: widen the accepted fields and apply the new ones. Change the first line to

```python
    fields = {k: body[k] for k in ("state_id", "priority", "due_date", "title", "description", "client", "project") if k in body}
```

and before `i["updated_at"] = iso(now())` add:

```python
    if "title" in fields:
        title = (fields["title"] or "").strip()
        if not title:
            raise ApiError(400, "The title can't be empty")
        i["title"] = title
    if "description" in fields:
        i["_desc"] = fields["description"] or ""
    if "client" in fields:
        c = fields["client"]
        if c is not None and c not in CLIENTS:
            raise ApiError(400, f"No client label {c!r} in Linear")
        i["client"], i["list"] = c, "client" if c else "dev"
    if "project" in fields:
        p = fields["project"]
        if p is not None and p not in PROJECTS:
            raise ApiError(400, f"No open project {p!r} in Linear")
        i["project"] = p
```

d. `get_preview`: add the sub-issues. Add to the returned dict:

```python
                 "sub_issues": [{**shape(x), "assignee": x.get("_assignee"), "own_team": x.get("_team", "ENG") == "ENG"}
                                for x in S["issues"].values() if (x["parent"] or {}).get("id") == i["id"]],
```

e. New endpoints. Add these functions after `get_preview`:

```python
def post_comment(q, body, issue_id):
    text = (body.get("body") or "").strip()
    if not text:
        raise ApiError(400, "The comment is empty")
    i = find_issue(issue_id)
    cid = f"c-{uuid.uuid4().hex[:8]}"
    i["_comments"].append({"id": cid, "author": "Me", "created_at": iso(now()), "body": text})
    return 200, {"id": cid}


def delete_comment(q, body, comment_id):
    for i in S["issues"].values():
        i["_comments"] = [c for c in i["_comments"] if c.get("id") != comment_id]
    return 200, {"deleted": comment_id}


def post_sub_issue(q, body, issue_id):
    title = (body.get("title") or "").strip()
    if not title:
        raise ApiError(400, "The title can't be empty")
    p = find_issue(issue_id)
    n = sum(1 for x in S["issues"].values() if x["identifier"].startswith("ENG-43"))
    new = issue(f"ENG-43{n}", title, p["client"], "Todo", priority=p["priority"], project=p["project"], category=p["category"])
    new["parent"] = {"id": p["id"], "identifier": p["identifier"], "title": p["title"]}
    S["issues"][new["id"]] = new
    return 200, shape(new)


def delete_issue(q, body, issue_id):
    i = find_issue(issue_id)
    del S["issues"][i["id"]]
    at = next((n for n, t in enumerate(S["today"]) if t["issue_id"] == i["id"]), None)
    S["today"] = [t for t in S["today"] if t["issue_id"] != i["id"]]
    return 200, {"deleted": i["id"], "today_position": at}
```

and add their routes to `ROUTES`, **before** `("PATCH", r"/api/issues/([^/]+)", patch_issue)`:

```python
    ("POST", r"/api/issues/([^/]+)/comments", post_comment),
    ("DELETE", r"/api/comments/([^/]+)", delete_comment),
    ("POST", r"/api/issues/([^/]+)/sub-issues", post_sub_issue),
    ("DELETE", r"/api/issues/([^/]+)", delete_issue),
```

Run: `python3 -I -m py_compile $PREVIEW/mock_backend.py`
Expected: no output.

- [ ] **Step 2: Start the preview**

Start both in the background (Bash `run_in_background`), from `$PREVIEW`:
`python3 mock_backend.py` (port 8799) and
`node /Users/thibaultdody/github/tdody/todo-hub/app/node_modules/vite/bin/vite.js --config ./vite.config.mjs` (port 1421).

- [ ] **Step 3: Today, afternoon, 1120×800**

With Playwright MCP (`browser_run_code_unsafe`): load the `afternoon` scenario, install the clock at `2026-11-11T15:00:00-05:00`, open `http://127.0.0.1:1421/`, press ⌘2, clear `localStorage` if a stale theme or view shows, and select ENG-412 in the Today list. Then check each of these, with a screenshot where it says so:

1. **e** opens the title in place, in the heading's type (screenshot). Type " (Oct)", press Enter: the toast says "ENG-412 renamed" and the list row shows the new title. Press ⌘Z: the old title is back.
2. **e**, type, then **Esc**: the edit is dropped and nothing is sent (no toast).
3. **⇧E** opens the description as Markdown in a box of the same width (screenshot). Add a line and press ⌘↵: the toast says "description saved", the pane shows the new text, and ⌘Z puts the old text back.
4. Change **client** to Hooli: ENG-412 moves under Hooli in the Today list and stays selected. Change it to "Dev / internal": it moves to the Dev section. ⌘Z twice brings it back to Globex.
5. Change **project** to acme/api, then back to "No project".
6. **Sub-issues · 3:** ENG-422 has a box, ENG-423 is ticked and struck through with "Done · Sam", and OPS-31 has no box (screenshot). Tick ENG-422: the toast says "ENG-422 done" and it shows as Done. ⌘Z: back to Todo.
7. **⇧S**, type "Send the row count to Sam", Enter: ENG-430 appears under the sub-issues and the box is empty, still focused. Type a second one and press Enter. ⌘Z twice deletes them.
8. **⇧C**, type a comment, ⌘↵: it shows first under Comments, and the box empties. ⌘Z deletes it and puts the text back in the box.
9. **A re-render while typing:** focus the comment box and type a few words. Start a model run from the UI that ends in a re-render (Re-plan or the note's redo; the mock finishes it after 6 seconds), and keep the cursor in the box. When the run ends, the text, the cursor position and the focus are all still there.
10. **A save that fails:** stop the mock (kill its background job), edit the description and leave the box: the error toast shows and the box stays open with your text. Start the mock again, focus the box and press ⌘↵: it saves.
11. Check the console (`browser_console_messages`): no errors.

- [ ] **Step 4: Client and Dev**

Press ⌘3 (Client) and select an Initech & Co issue. Set its client to "Dev / internal": the toast says "ENG-… moved to Dev", the issue leaves the list, and the next row is selected. ⌘Z brings it back. Press **e** in the Client pane and check that the title edits in place. Take a screenshot of the pane with the fields row.

- [ ] **Step 5: Narrow and dark**

Resize to 800×800 and switch the theme to dark (**t** until dark). On Today and on Client, check that the fields row wraps without overlapping, that the editors keep the pane's width, and that the description box and comment box are readable (screenshot of each).

- [ ] **Step 6: Detector**

Run the Impeccable detector on the changed UI files:

```bash
"/Users/thibaultdody/.claude/plugins/cache/impeccable/impeccable/4.8.0/skills/impeccable/scripts/impeccable" detect --json app/src/styles.css app/src/main.ts
```

Expected: the five side-tab warnings already known (`.td-row.prio-1`, `.td-row.prio-2`, `.row.prio-2`, `.md blockquote`, `.bal-mark`) and nothing new. Fix anything new, then rebuild.

- [ ] **Step 7: Clean up**

Playwright MCP writes only under the repo's `.playwright-mcp/`. Move the screenshots to `$PREVIEW/screenshots/edit-issues/`, then delete `.playwright-mcp/`. Stop the background Vite and mock jobs. Run `git status --short` and check that no stray files are left.

If anything in Steps 3–6 needed a code fix, commit it with a message naming the fix (run the scan first).

---

### Task 12: README and the final checks

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Today's selected issue**

In the Today bullet that starts `  - **The selected issue** opens beside the list`, replace

```
Below: status, priority and due date to edit, **⋯** (Remove from Today, **Delete…**), sub-issues, the description and the latest three comments, with their Markdown rendered
```

with

```
Below: status, priority, due date, client and project to edit, **⋯** (Remove from Today, **Delete…**), then the description, sub-issues and the latest three comments, with their Markdown rendered
```

and in the same bullet replace `then **More in Linear**)` with `then **Edit in Linear**)`.

- [ ] **Step 2: The Client and Dev pane**

In the bullet that starts `- **Client and Dev: list and reading pane**`, replace

```
the title, then status, priority and due date to edit,
```

with

```
the title, then status, priority, due date, client and project to edit,
```

and replace `below, its sub-issues, description and latest three comments.` with `below, its description, sub-issues and latest three comments.`

- [ ] **Step 3: A bullet for editing**

Add a new bullet right after the Client and Dev bullet:

```
- **Editing in the reading pane** (Today, Client and Dev, the same in each): click the title or press **e** to rename it in place (Enter saves, Esc cancels). Click the description or press **⇧E** to edit its Markdown in place; leaving the box, ⌘↵ or Esc saves (a description longer than the pane's 6,000 characters is edited in Linear). Client and project are pills next to the due date: changing the client swaps only the client label, and "Dev / internal" makes it a Dev issue (in Client or Dev it leaves the list and the next one is selected). Sub-issues come from Linear, done ones included: tick one to mark it done, untick to put it back in Todo (one in another team shows its status without a box). **⇧S** adds a sub-issue with the parent's client, project and priority, assigned to you; the box stays ready for the next. **⇧C** writes a comment, posted as you with ⌘↵. Every save offers **Undo** (⌘Z, 10 minutes): the old value comes back, a new sub-issue or comment is deleted (the comment's text goes back in the box). A re-render never loses what you're typing, and a failed save keeps your text.
```

- [ ] **Step 4: Final checks**

Run: `cd backend && uv run pytest -q`
Expected: 186 passed.

Run: `cd app && npm run build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add README.md
# run the scan from Conventions
git commit -m "README: editing an issue in the reading pane" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Report**

Report to Thibault: what changed, the test count, the screenshots folder, and the three assumptions from the spec (last write wins on the description; moving off a completed project can't be undone; a title over 200 characters can't be restored by undo). Don't push: pushing waits for Thibault.
