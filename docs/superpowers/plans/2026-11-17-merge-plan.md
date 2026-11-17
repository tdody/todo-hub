# Merge plan for linked Inbox cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Inbox card linked to an open issue gets one switch (Merge, Create new, Drop) with Claude's advice picked first, a visible plan for the pick, and one main button. Merge can also move the issue's due date and raise its priority, with Undo.

**Architecture:** The backend's merge endpoint takes the comment text from the app, plus 2 flags for the due date and priority, and records the old values under one `restore` key in the undo record (Close uses the same key). The app replaces the duplicate panel with a box (the issue, the switch, the reason) and a plan below it; one function (`decide`) does the pick for the main button, **a** and ⌘↩. Bulk Approve leaves linked cards out.

**Tech Stack:** Python 3 / FastAPI / pydantic v2 / pytest (backend); TypeScript with the app's `h()` DOM helper, Vite, Tauri (app). The app has no unit tests: `npx tsc --noEmit` and a browser check are its tests.

**Spec:** `docs/superpowers/specs/2026-11-17-merge-plan-design.md`.

Review fixes changed the code after this plan was written. Task 2: the backend checks again that the card's date is sooner and its priority higher. Task 3: the preview's `toggle` guard, no empty comment draft, the comment ignores the stored copy, a guarded Drop, clearer names. Task 4: holding ⌘↩ decides one card; a click on a drop reason or a merge box re-renders. Task 5: `selectedCandidates()`. Task 6: `.segmented.link-switch` selectors, wrapping, the comment box's indent. The code is the source of truth.

**Worktree:** `/Users/thibaultdody/dev/worktrees/todo-hub/main`, branch `merge-plan`. Run every command from there (Task 0 sets it up).

---

## Conventions

**No private data.** Nothing about work clients goes in this repo. Examples use Globex, Initech & Co, Sam, `ENG-123`. Before every commit, run the privacy scan on the staged files:

```bash
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
```

Expected: `clean`. Its docstring lists the known false positives. Fix any other hit before the commit.

**Commit messages** name the area first, as the log does: `Backend: …`, `App: …`, `README, PRODUCT, DESIGN: …`. End each with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Edits** below are "Find … Replace with …" pairs. Each "Find" block is unique in its file. Copy them exactly, with their indentation.

**Words.** The code calls the link `possible_duplicate`. The UI and docs say "linked issue". The 3 picks are `merge`, `new`, `drop`, the same values as `duplicate_advice`.

---

## File map

| File | Change |
|---|---|
| `backend/src/todohub/api.py` | `restore` undo key (Close and Merge); `MergeIn`; comment limit 4000; `merge_text` goes; the merge posts the app's comment and changes the due date and priority. |
| `backend/tests/test_api.py` | Merge tests send a comment; new tests for the 2 flags, the failure warning, the missing comment, and Close's `restore`. |
| `app/src/api.ts` | `merge(id, edit, fields)`. |
| `app/src/main.ts` | The box, the plans, `decide`, `merge`, keys, the shortcuts sheet, bulk Approve. |
| `app/src/styles.css` | The box and plan styles; the old `.dup` panel rules go. |
| `README.md`, `PRODUCT.md`, `DESIGN.md` | Docs. |

---

### Task 0: Worktree and baseline

- [ ] **Step 1: Move the branch to the worktree**

The branch `merge-plan` (with the spec and this plan) is checked out in `/Users/thibaultdody/github/tdody/todo-hub`. A branch can be checked out in one place only.

```bash
git -C /Users/thibaultdody/github/tdody/todo-hub status --short
git -C /Users/thibaultdody/github/tdody/todo-hub switch main
git -C /Users/thibaultdody/dev/worktrees/todo-hub/main status --short
git -C /Users/thibaultdody/dev/worktrees/todo-hub/main switch merge-plan
```

Expected: both `status --short` print nothing (stop and ask if not); the last command prints `Switched to branch 'merge-plan'`.

- [ ] **Step 2: Type-check the app and run the backend tests**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npm ci --silent && npx tsc --noEmit && echo TSC OK
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/backend && uv run pytest -q 2>&1 | tail -2
```

Expected: `TSC OK`, and pytest ends with `N passed`. If either fails before any change, stop and report it.

---

### Task 1: Backend: one `restore` key for Undo (Close first)

**Files:**
- Modify: `backend/src/todohub/api.py` (`act_on_issue`, `undo`)
- Test: `backend/tests/test_api.py` (`test_undo_close_reopens_and_deletes_comment`)

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_api.py`, find:

```python
    client.post(f"/api/candidates/{close}/approve")
    r = client.post(f"/api/candidates/{close}/undo")
```

Replace with:

```python
    client.post(f"/api/candidates/{close}/approve")
    assert db.get_undo(close)["restore"] == {"stateId": "s-Todo"}
    r = client.post(f"/api/candidates/{close}/undo")
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd backend && uv run pytest -q tests/test_api.py::test_undo_close_reopens_and_deletes_comment
```

Expected: FAIL with `KeyError: 'restore'`.

- [ ] **Step 3: Write `restore` in Close**

In `backend/src/todohub/api.py`, find:

```python
                undo["state_id"] = target["state"]["id"]
```

Replace with:

```python
                undo["restore"] = {"stateId": target["state"]["id"]}
```

- [ ] **Step 4: Read `restore` in Undo**

In `backend/src/todohub/api.py`, find:

```python
                if record.get("state_id"):
                    client.update_issue(record["issue"], {"stateId": record["state_id"]})
                    record.pop("state_id")
                    db.set_undo(cid, record)
```

Replace with:

```python
                if record.get("restore"):            # the issue's fields as they were
                    client.update_issue(record["issue"], record["restore"])
                    record.pop("restore")
                    db.set_undo(cid, record)
```

In the same function's docstring, find:

```python
        created issues go to Linear's trash, a closed issue gets its old status back, and posted
```

Replace with:

```python
        created issues go to Linear's trash, a closed or merged-into issue gets its old fields back, and posted
```

- [ ] **Step 5: Run the tests**

```bash
cd backend && uv run pytest -q 2>&1 | tail -2
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/todohub/api.py backend/tests/test_api.py
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
Backend: Undo puts an issue's fields back from one restore key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Backend: the merge posts the app's comment and can change the due date and priority

**Files:**
- Modify: `backend/src/todohub/api.py` (`CandidateEdit`, new `MergeIn`, `merge_text`, `merge`, `merge_claimed`)
- Test: `backend/tests/test_api.py` (merge tests)

- [ ] **Step 1: Update the 2 merge tests that post without a comment**

In `backend/tests/test_api.py`, find:

```python
    r = client.post(f"/api/candidates/{cid}/merge")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["candidate"]["status"] == "approved" and body["candidate"]["linear_identifier"] == "ENG-1"
    issue_id, text = fake.comments[0]
    assert issue_id == "id-ENG-1" and "Send Jordan the rebinned grade table" in text and "**Due:** 2026-11-09" in text
    assert "**More from Slack message · Sam:** Send Jordan the rebinned grade table" in text
```

Replace with:

```python
    r = client.post(f"/api/candidates/{cid}/merge", json={"comment": "**More from Slack · Sam:** Send Jordan the table"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["candidate"]["status"] == "approved" and body["candidate"]["linear_identifier"] == "ENG-1"
    assert fake.comments[0] == ("id-ENG-1", "**More from Slack · Sam:** Send Jordan the table\n\n"
                                "**Source:** [Slack message](https://example.slack.com/archives/C1/p1)\n\n"
                                "_Merged from TodoHub._")
    assert db.get_candidate(cid)["comment"] == "**More from Slack · Sam:** Send Jordan the table"
    assert fake.updated == []                       # no flag: the issue's fields stay
```

Find:

```python
    assert client.post(f"/api/candidates/{cid}/merge").status_code == 409
```

Replace with:

```python
    assert client.post(f"/api/candidates/{cid}/merge", json={"comment": "Again."}).status_code == 409
```

In `test_merge_sub_issues_follow_the_target`, find:

```python
    cid = seed(db, title="Send Jordan the table", possible_duplicate="ENG-1", priority=2,
               subtasks=[{"title": "Export the table", "due_date": "2026-11-12"}, {"title": "Send it"}])
    r = client.post(f"/api/candidates/{cid}/merge")
```

Replace with:

```python
    cid = seed(db, title="Send Jordan the table", possible_duplicate="ENG-1", priority=2,
               subtasks=[{"title": "Export the table", "due_date": "2026-11-12"}, {"title": "Send it"}])
    r = client.post(f"/api/candidates/{cid}/merge", json={"comment": "More."})
```

Find:

```python
    cid = seed(db, source_id="C1:z", title="Another", possible_duplicate="ENG-1",
               subtasks=[{"title": "Export the table"}, {"title": "Send it"}])
    r = client.post(f"/api/candidates/{cid}/merge")
```

Replace with:

```python
    cid = seed(db, source_id="C1:z", title="Another", possible_duplicate="ENG-1",
               subtasks=[{"title": "Export the table"}, {"title": "Send it"}])
    r = client.post(f"/api/candidates/{cid}/merge", json={"comment": "More."})
```

- [ ] **Step 2: Add the new tests**

In `backend/tests/test_api.py`, find:

```python
def test_merge_needs_a_flagged_duplicate(env):
    client, db, fake, _ = env
    cid = seed(db)
    assert client.post(f"/api/candidates/{cid}/merge").status_code == 400
```

Replace with:

```python
def test_merge_needs_a_flagged_duplicate(env):
    client, db, fake, _ = env
    cid = seed(db)
    assert client.post(f"/api/candidates/{cid}/merge").status_code == 400


def test_merge_needs_a_comment(env):
    client, db, fake, _ = env
    dup_env(db)
    cid = seed(db, possible_duplicate="ENG-1")
    r = client.post(f"/api/candidates/{cid}/merge")
    assert r.status_code == 400 and "comment" in r.json()["error"]
    assert fake.comments == [] and db.get_candidate(cid)["status"] == "pending"
    long = "x" * 2300                    # a 1,000-character why and quote, the title and the labels
    assert client.post(f"/api/candidates/{cid}/merge", json={"comment": long}).status_code == 200
    assert fake.comments[0][1].startswith(long + "\n\n**Source:**")


def test_merge_moves_the_due_date_and_raises_the_priority_then_undoes(env):
    client, db, fake, _ = env
    dup_env(db)
    fake.issues[0].update(dueDate="2026-11-28", priority=3)
    cid = seed(db, possible_duplicate="ENG-1", due_date="2026-11-20", priority=2)
    r = client.post(f"/api/candidates/{cid}/merge",
                    json={"comment": "More.", "move_due_date": True, "raise_priority": True})
    assert r.status_code == 200, r.text
    assert fake.updated == [("id-ENG-1", {"dueDate": "2026-11-20", "priority": 2})]
    assert (r.json()["issue"]["due_date"], r.json()["issue"]["priority"]) == ("2026-11-20", 2)
    assert db.get_undo(cid)["restore"] == {"dueDate": "2026-11-28", "priority": 3}
    assert client.post(f"/api/candidates/{cid}/undo").status_code == 200
    assert fake.updated[-1] == ("id-ENG-1", {"dueDate": "2026-11-28", "priority": 3})
    assert fake.deleted_comments == ["comment-1"]


def test_merge_moves_only_the_due_date(env):
    client, db, fake, _ = env
    dup_env(db)
    cid = seed(db, possible_duplicate="ENG-1", due_date="2026-11-20", priority=2)
    r = client.post(f"/api/candidates/{cid}/merge", json={"comment": "More.", "move_due_date": True})
    assert r.status_code == 200, r.text
    assert fake.updated == [("id-ENG-1", {"dueDate": "2026-11-20"})]
    assert db.get_undo(cid)["restore"] == {"dueDate": None}


def test_merge_stays_when_the_field_update_fails(env):
    client, db, fake, _ = env
    dup_env(db)

    def refuse(issue_id, changes):
        raise LinearError("Can't reach Linear")
    fake.update_issue = refuse
    cid = seed(db, possible_duplicate="ENG-1", due_date="2026-11-20", priority=2)
    r = client.post(f"/api/candidates/{cid}/merge",
                    json={"comment": "More.", "move_due_date": True, "raise_priority": True})
    assert r.status_code == 200, r.text
    assert r.json()["candidate"]["status"] == "approved"
    assert r.json()["warnings"] == ["ENG-1's due date and priority were not changed: Can't reach Linear"]
    assert "restore" not in db.get_undo(cid)
```

- [ ] **Step 3: Run them to see them fail**

```bash
cd backend && uv run pytest -q tests/test_api.py -k merge 2>&1 | tail -8
```

Expected: `test_merge_adds_comment_links_and_subtasks_then_undoes`, `test_merge_needs_a_comment`, `test_merge_moves_the_due_date_and_raises_the_priority_then_undoes`, `test_merge_moves_only_the_due_date` and `test_merge_stays_when_the_field_update_fails` FAIL (the comment text differs, there is no 400, `fake.updated` is empty, a 2,300-character comment gets 422).

- [ ] **Step 4: Raise the comment limit and add `MergeIn`**

In `backend/src/todohub/api.py`, find:

```python
    comment: str | None = Field(default=None, min_length=1, max_length=2000)
```

Replace with:

```python
    comment: str | None = Field(default=None, min_length=1, max_length=4000)
```

Find:

```python
    reply_draft: str | None = Field(default=None, max_length=4000)


class MuteIn(BaseModel):
```

Replace with:

```python
    reply_draft: str | None = Field(default=None, max_length=4000)


class MergeIn(CandidateEdit):
    """A merge: the card's edits (``comment`` is the text to post) and the issue fields to change."""
    move_due_date: bool = False      # set the issue's due date to the card's
    raise_priority: bool = False     # set the issue's priority to the card's


class MuteIn(BaseModel):
```

`db.update_candidate` keeps only its editable fields, so `edit_candidate` saves a `MergeIn` without the 2 flags.

- [ ] **Step 5: Replace `merge_text`, `merge` and the start of `merge_claimed`**

In `backend/src/todohub/api.py`, find:

```python
    def merge_text(c: dict) -> str:
        source = SOURCE_NAMES.get(c["source"], c["source"])
        parts = [f"**More from {source}{' · ' + c['who'] if c.get('who') else ''}:** {c['title']}"]
        if c.get("why"):
            parts.append(c["why"])
        if c.get("excerpt"):
            parts.append("\n".join("> " + line for line in c["excerpt"].splitlines()))
        if c.get("due_date"):
            parts.append(f"**Due:** {c['due_date']}")
        parts.append(source_line(c))
        return "\n\n".join(parts) + "\n\n_Merged from TodoHub._"

    @app.post("/api/candidates/{cid}/merge", dependencies=auth)
    def merge(cid: int, edit: CandidateEdit | None = None) -> dict:
        """Add a candidate to the open issue it duplicates, instead of making a new issue:
        a comment with what's new, its links, and its subtasks as sub-issues."""
        c = candidate_or_404(cid)
        if c["status"] != "pending":
            raise HTTPException(409, f"Already {c['status']}")
        if c["kind"] not in ("task", "waiting") or not c.get("possible_duplicate"):
            raise HTTPException(400, "Only a task flagged as a possible duplicate can be merged")
        if edit and edit.model_fields_set:
            c = edit_candidate(cid, edit)
        if not db.claim(cid):
            raise HTTPException(409, "Already being approved")
        try:
            return merge_claimed(c)
        finally:
            db.release(cid)

    def merge_claimed(c: dict) -> dict:
```

Replace with:

```python
    @app.post("/api/candidates/{cid}/merge", dependencies=auth)
    def merge(cid: int, body: MergeIn | None = None) -> dict:
        """Add a candidate to the open issue it is linked to, instead of making a new issue: the
        comment, its links, its subtasks as sub-issues and, when asked, its due date and priority."""
        c = candidate_or_404(cid)
        if c["status"] != "pending":
            raise HTTPException(409, f"Already {c['status']}")
        if c["kind"] not in ("task", "waiting") or not c.get("possible_duplicate"):
            raise HTTPException(400, "Only a task flagged as a possible duplicate can be merged")
        body = body or MergeIn()
        if body.model_fields_set:
            c = edit_candidate(cid, body)
        if not c.get("comment"):
            raise HTTPException(400, "A merge needs a comment")
        if not db.claim(cid):
            raise HTTPException(409, "Already being approved")
        try:
            return merge_claimed(c, body)
        finally:
            db.release(cid)

    def merge_claimed(c: dict, body: MergeIn) -> dict:
```

- [ ] **Step 6: Post the comment and change the fields**

In `backend/src/todohub/api.py`, find:

```python
                target = client.get_issue(c["possible_duplicate"])
                comment_id = client.create_comment(target["id"], merge_text(c))
            except LinearError as exc:
                raise HTTPException(502, str(exc))
            # The comment is in, so the candidate counts as handled; the rest is best effort.
            updated = db.decide(cid, "approved", target["identifier"], target["url"])
            undo: dict = {"issue": target["id"], "comments": [comment_id] if comment_id else [],
                          "attachments": [], "issues": []}
            db.set_undo(cid, undo)
```

Replace with:

```python
                target = client.get_issue(c["possible_duplicate"])
                comment_id = client.create_comment(
                    target["id"], f"{c['comment']}\n\n{source_line(c)}\n\n_Merged from TodoHub._")
            except LinearError as exc:
                raise HTTPException(502, str(exc))
            # The comment is in, so the candidate counts as handled; the rest is best effort.
            updated = db.decide(cid, "approved", target["identifier"], target["url"])
            undo: dict = {"issue": target["id"], "comments": [comment_id] if comment_id else [],
                          "attachments": [], "issues": []}
            db.set_undo(cid, undo)

            changes = {}
            if body.move_due_date:
                changes["dueDate"] = c["due_date"]
            if body.raise_priority:
                changes["priority"] = c["priority"]
            if changes:
                undo["restore"] = {field: target.get(field) for field in changes}
                db.set_undo(cid, undo)
                try:
                    target = client.update_issue(target["id"], changes)
                except LinearError as exc:
                    undo.pop("restore")
                    db.set_undo(cid, undo)
                    what = " and ".join(name for field, name in (("dueDate", "due date"), ("priority", "priority"))
                                        if field in changes)
                    warnings.append(f"{target['identifier']}'s {what} {'were' if len(changes) > 1 else 'was'} "
                                    f"not changed: {exc}")
```

`update_issue` returns the same fields as `get_issue` (`ISSUE_FIELDS`, with `team` and `project`), so the links and sub-issues below can keep using `target`.

- [ ] **Step 7: Run the tests**

```bash
cd backend && uv run pytest -q 2>&1 | tail -2
grep -n "merge_text" src/todohub/*.py tests/*.py
```

Expected: all pass; `grep` prints nothing.

- [ ] **Step 8: Commit**

```bash
git add backend/src/todohub/api.py backend/tests/test_api.py
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
Backend: a merge posts the app's comment and can move the due date and raise the priority, with Undo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: App: the box, the plans, `decide` and `merge`

The app compiles with `noUnusedLocals`, so every new function is used in this task.

**Files:**
- Modify: `app/src/api.ts` (`merge`)
- Modify: `app/src/main.ts` (imports, `merge`, `loadPreview`, `ADVICE_LABEL`, `duplicatePanel`, `candidateCardBody`)

- [ ] **Step 1: The API call**

In `app/src/api.ts`, find:

```ts
  merge: (id: number, edit: CandidateEdit) => call<ApproveResult>("POST", `/api/candidates/${id}/merge`, edit),
```

Replace with:

```ts
  /** Merge a linked card into its open issue. ``edit.comment`` is the text to post; the flags set
   *  the issue's due date and priority to the card's. */
  merge: (id: number, edit: CandidateEdit, fields: { move_due_date: boolean; raise_priority: boolean }) =>
    call<ApproveResult>("POST", `/api/candidates/${id}/merge`, { ...edit, ...fields }),
```

- [ ] **Step 2: Import the Markdown renderer**

In `app/src/main.ts`, find:

```ts
import { closePeriscope, dismissPeriscope, forgetPeriscope, isPeriscopeOpen, periscopeItem, periscopePopover, setupPeriscope } from "./periscope";
```

Replace with:

```ts
import { closePeriscope, dismissPeriscope, forgetPeriscope, isPeriscopeOpen, periscopeItem, periscopePopover, setupPeriscope } from "./periscope";
import { renderMarkdown } from "./markdown";
```

- [ ] **Step 3: Replace `merge`**

In `app/src/main.ts`, find:

```ts
/** Add a possible duplicate to the issue it duplicates: a comment, its links and its subtasks. */
async function merge(c: Candidate) {
  const key = `c${c.id}`;
  if (state.busy.has(key) || !c.possible_duplicate) return;
  state.busy.add(key);
  render();
  try {
    const edit = { ...(state.drafts.get(c.id) ?? {}) };
    if (edit.subtasks) edit.subtasks = edit.subtasks.filter((s) => s.title.trim());
    const { issue, subtasks, warnings } = await api.merge(c.id, edit);
    state.drafts.delete(c.id);
    state.candidates = state.candidates.filter((x) => x.id !== c.id);
    await swipeAway(c.id);
    const added = new Set(subtasks.map((s) => s.id));
    state.issues = [...subtasks, ...state.issues.filter((i) => !added.has(i.id))];
    previews.delete(issue.identifier);     // it has a new comment now
    const extra = subtasks.length ? ` with ${subtasks.length} subtask${subtasks.length === 1 ? "" : "s"}` : "";
    offerUndo(`Merged into ${issue.identifier}${extra}`,
```

Replace with:

```ts
/** Merge a linked card into its open issue: the comment, the links, the subtasks as sub-issues,
 *  and the due date and priority when their boxes are ticked. */
async function merge(c: Candidate) {
  const key = `c${c.id}`;
  if (state.busy.has(key) || !isLinked(c)) return;
  state.busy.add(key);
  render();
  try {
    const d = state.drafts.get(c.id) ?? {};
    const edit = { ...d, comment: commentToPost(c, d) };
    if (edit.subtasks) edit.subtasks = edit.subtasks.filter((s) => s.title.trim());
    const ch = linkChoice(c);
    const before = linkedIssue(c.possible_duplicate!);
    const change = before ? mergeChanges(c, before) : { due: null, priority: null };
    const fields = { move_due_date: !!change.due && ch.moveDue, raise_priority: !!change.priority && ch.raisePriority };
    const { issue, subtasks, warnings } = await api.merge(c.id, edit, fields);
    state.drafts.delete(c.id);
    state.candidates = state.candidates.filter((x) => x.id !== c.id);
    await swipeAway(c.id);
    const added = new Set(subtasks.map((s) => s.id));
    state.issues = [...subtasks, ...state.issues.filter((i) => !added.has(i.id)).map((i) => (i.id === issue.id ? issue : i))];
    previews.delete(issue.identifier);     // it has a new comment now
    const did = [
      "comment",
      subtasks.length ? `${subtasks.length} sub-issue${subtasks.length === 1 ? "" : "s"}` : "",
      fields.move_due_date && issue.due_date === change.due ? `due ${dateText(issue.due_date)}` : "",
      fields.raise_priority && issue.priority === change.priority ? `${priorityName(issue.priority)} priority` : "",
    ].filter(Boolean).join(", ");
    offerUndo(`Merged into ${issue.identifier}: ${did}`,
```

(The lines after it, from `` `merge into ${issue.identifier} removed, task back in the Inbox` `` to the end of the function, stay.)

- [ ] **Step 4: Re-draw when a linked issue's preview arrives**

In `app/src/main.ts`, find:

```ts
    .finally(() => {
      // Swap the body in place, so typing elsewhere on the page isn't interrupted.
      document.querySelectorAll(`.dup-preview[data-ident="${ident}"] > .dup-body`)
        .forEach((el) => el.replaceWith(previewBody(ident)));
    });
```

Replace with:

```ts
    .finally(() => {
      // Re-draw, for the linked issue's facts and the merge plan. While typing, swap only the
      // preview bodies in place, so the typing isn't interrupted.
      if (!editing()) { render(); return; }
      document.querySelectorAll(`.dup-preview[data-ident="${ident}"] > .dup-body`)
        .forEach((el) => el.replaceWith(previewBody(ident)));
    });
```

- [ ] **Step 5: Remove `ADVICE_LABEL` and its stray comment**

In `app/src/main.ts`, find:

```ts
const ADVICE_LABEL = { drop: "Drop it", merge: "Merge", new: "Create a new issue" } as const;

/** What to do about a possible duplicate: a recommendation, the three choices, and a look at the issue. */
// ---- suggestions handled in Linear by hand ----------------------------------------------------
```

Replace with:

```ts
// ---- suggestions handled in Linear by hand ----------------------------------------------------
```

- [ ] **Step 6: Replace `duplicatePanel` with the linked-issue functions**

In `app/src/main.ts`, find the whole function:

```ts
function duplicatePanel(c: Candidate, busy: boolean): HTMLElement {
  const ident = c.possible_duplicate!;
  const known = state.issues.find((i) => i.identifier === ident);
  const cached = previews.get(ident);
  const fetched = cached && "issue" in cached ? cached.issue : undefined;
  const title = known?.title ?? fetched?.title;
  const url = known?.url ?? fetched?.url ?? null;
  const advice = c.duplicate_advice ?? "merge";
  const choices: { key: "drop" | "merge" | "new"; label: string; title: string; run: () => void }[] = [
    { key: "drop", label: "Drop as duplicate", title: `${ident} already covers it`, run: () => void drop(c, "duplicate") },
    { key: "merge", label: `Merge into ${ident}`, title: `Add this to ${ident}: a comment, its links and subtasks (m)`,
      run: () => void merge(c) },
    { key: "new", label: "Create new", title: "Make its own Linear issue", run: () => void approve(c) },
  ];
  const preview = h("details", {
    class: "dup-preview", "data-ident": ident, open: openPreviews.has(c.id),
    ontoggle: (e: Event) => {
      if ((e.target as HTMLDetailsElement).open) { openPreviews.add(c.id); loadPreview(ident); }
      else openPreviews.delete(c.id);
    },
  }, h("summary", {}, `Show ${ident}`), previewBody(ident));
  return h("div", { class: `dup advice-${advice}` },
    h("div", { class: "dup-head" },
      h("span", { class: "dup-label" }, "Possible duplicate"),
      link(ident, url, "link"), title ? h("span", { class: "dup-title" }, title) : ""),
    h("div", { class: "dup-advice" },
      h("strong", {}, `Recommended: ${advice === "merge" ? `merge into ${ident}` : ADVICE_LABEL[advice].toLowerCase()}.`),
      c.duplicate_reason ? ` ${c.duplicate_reason}` : ""),
    h("div", { class: "dup-actions" },
      ...choices.map((ch) => h("button", {
        class: ch.key === advice ? "rec" : "ghost-btn", disabled: busy, title: ch.title,
        onclick: (e: Event) => { e.stopPropagation(); ch.run(); },
      }, ch.label))),
    preview);
}
```

Replace with:

```ts
// ---- linked issues: Merge, Create new or Drop ---------------------------------------------------
type LinkPick = NonNullable<Candidate["duplicate_advice"]>;
const PICKS: { value: LinkPick; label: string }[] = [
  { value: "merge", label: "Merge" }, { value: "new", label: "Create new" }, { value: "drop", label: "Drop" },
];
const LINK_HEAD: Record<LinkPick, string> = {
  merge: "Adds to an open issue", drop: "Same as an open issue", new: "Related to an open issue",
};

/** A linked card's pick, its 2 merge boxes and its drop reason, until the app restarts. */
type LinkChoice = { pick: LinkPick; moveDue: boolean; raisePriority: boolean; reason: DropReason };
const linkChoices = new Map<number, LinkChoice>();
const openComments = new Set<number>();        // linked cards whose merge comment is in a text box

/** A Task or Waiting card the sweep linked to one of your open issues. */
function isLinked(c: Candidate): boolean {
  return !!c.possible_duplicate && (c.kind === "task" || c.kind === "waiting");
}

function linkChoice(c: Candidate): LinkChoice {
  let ch = linkChoices.get(c.id);
  if (!ch) {
    ch = { pick: c.duplicate_advice ?? "merge", moveDue: true, raisePriority: true, reason: "duplicate" };
    linkChoices.set(c.id, ch);
  }
  return ch;
}

/** The linked issue: from the issue list, else from its preview, loaded on first use. A preview
 *  that failed is not loaded again here (opening "Show description and comments" retries). */
function linkedIssue(ident: string): Issue | undefined {
  const known = state.issues.find((i) => i.identifier === ident);
  if (known) return known;
  const p = previews.get(ident);
  if (!p) loadPreview(ident);
  return p && "issue" in p ? p.issue : undefined;
}

/** What a merge can change on the issue: the card's due date when it is sooner, and its priority
 *  when it is higher (a smaller number that is not 0). Null when it can't. */
function mergeChanges(c: Candidate, issue: Issue): { due: string | null; priority: number | null } {
  const d = state.drafts.get(c.id) ?? {};
  const due = "due_date" in d ? d.due_date ?? null : c.due_date;
  const priority = "priority" in d ? d.priority ?? 0 : c.priority;
  return {
    due: due && (!issue.due_date || due < issue.due_date) ? due : null,
    priority: priority > 0 && (issue.priority === 0 || priority < issue.priority) ? priority : null,
  };
}

/** The default merge comment, from what the card shows. The backend adds the source line. */
function mergeComment(c: Candidate, d: CandidateEdit): string {
  const title = ("title" in d ? d.title : c.title) || c.title;
  const due = "due_date" in d ? d.due_date : c.due_date;
  return [
    `**More from ${SOURCE_NAME[c.source]}${c.who ? ` · ${c.who}` : ""}:** ${title}`,
    c.why ?? "",
    c.excerpt ? c.excerpt.split("\n").map((line) => `> ${line}`).join("\n") : "",
    due ? `**Due:** ${due}` : "",
  ].filter(Boolean).join("\n\n");
}

/** The comment a merge posts: the edited text, else the default. */
function commentToPost(c: Candidate, d: CandidateEdit): string {
  return (d.comment ?? c.comment ?? "").trim() || mergeComment(c, d);
}

/** The open issue a card is linked to, and the switch: Merge, Create new or Drop. */
function linkBox(c: Candidate, busy: boolean): HTMLElement {
  const ident = c.possible_duplicate!;
  const advice = c.duplicate_advice ?? "merge";
  const ch = linkChoice(c);
  const issue = linkedIssue(ident);
  const loaded = previews.get(ident);
  const preview = h("details", {
    class: "dup-preview", "data-ident": ident, open: openPreviews.has(c.id),
    ontoggle: (e: Event) => {
      if ((e.target as HTMLDetailsElement).open) { openPreviews.add(c.id); loadPreview(ident); }
      else openPreviews.delete(c.id);
    },
  }, h("summary", {}, "Show description and comments"), previewBody(ident));
  return h("div", { class: "link-box" },
    h("div", { class: "link-head" }, LINK_HEAD[advice]),
    h("div", { class: "link-issue" }, link(ident, issue?.url ?? null, "link"), issue ? ` ${issue.title}` : ""),
    issue
      ? h("div", { class: "link-facts" },
          h("span", { class: `pill ${statusClass(issue.state)}` }, issue.state.name),
          issue.priority ? h("span", { class: `pill ${PRIO_CLASS[issue.priority]}` }, priorityName(issue.priority)) : "",
          issue.due_date ? h("span", {}, `due ${dateText(issue.due_date)}`) : "")
      : h("div", { class: "link-facts" },
          loaded && "error" in loaded ? `Couldn't load ${ident}: ${loaded.error}` : "Loading…"),
    preview,
    h("div", { class: "segmented link-switch", role: "group", "aria-label": `What to do with ${ident}` },
      ...PICKS.map((p) => h("button", {
        class: `seg${ch.pick === p.value ? " on" : ""}`, "aria-pressed": String(ch.pick === p.value), disabled: busy,
        onclick: (e: Event) => { e.stopPropagation(); ch.pick = p.value; render(); },
      }, p.label, p.value === advice ? h("span", { class: "rec-dot", title: "Claude's recommendation" }) : ""))),
    h("div", { class: "link-reason" },
      h("strong", {}, `Claude recommends ${PICKS.find((p) => p.value === advice)!.label}`),
      c.duplicate_reason ? `: ${c.duplicate_reason}` : "."));
}

/** Merge picked: each change the merge will make to the linked issue. */
function mergePlan(c: Candidate, d: CandidateEdit, busy: boolean): HTMLElement {
  const ident = c.possible_duplicate!;
  const ch = linkChoice(c);
  const issue = linkedIssue(ident);
  const change = issue ? mergeChanges(c, issue) : { due: null, priority: null };
  const links = (c.source_url ? 1 : 0) + c.links.length;
  const box = (checked: boolean, set: (v: boolean) => void, ...label: Child[]) => h("label", { class: "plan-step" },
    h("input", { type: "checkbox", checked, disabled: busy,
      onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }),
    h("span", {}, ...label));
  const editComment = () => {
    openComments.add(c.id);
    render();
    document.querySelector<HTMLTextAreaElement>(`.card[data-id="${c.id}"] .merge-plan textarea`)?.focus();
  };
  return h("div", { class: "merge-plan" },
    h("div", { class: "plan-head" }, `Merge will change ${ident}`),
    h("div", { class: "plan-step" }, h("span", { class: "plan-ic" }, "✎"), h("span", {}, "Post this comment"),
      !openComments.has(c.id) && h("button", { class: "link-btn", onclick: editComment }, "Edit")),
    openComments.has(c.id)
      ? h("textarea", { class: "comment-input", rows: 6, value: commentToPost(c, d), "aria-label": `Comment to post on ${ident}`,
          oninput: (e: Event) => { d.comment = (e.target as HTMLTextAreaElement).value; } })
      : h("div", { class: "plan-comment md" }, ...renderMarkdown(commentToPost(c, d))),
    issue && change.due ? box(ch.moveDue, (v) => { ch.moveDue = v; }, "Move the due date ",
      h("s", {}, issue.due_date ? dateText(issue.due_date) : "none"), " → ",
      h("b", { class: "plan-new" }, dateText(change.due))) : "",
    issue && change.priority ? box(ch.raisePriority, (v) => { ch.raisePriority = v; }, "Raise the priority ",
      h("s", {}, priorityName(issue.priority)), " → ",
      h("b", { class: "plan-new" }, priorityName(change.priority))) : "",
    (d.subtasks ?? c.subtasks).length ? subtaskEditor(c, d) : "",
    links ? h("div", { class: "plan-step" }, h("span", { class: "plan-ic" }, "+"),
      h("span", {}, `Attach ${links} link${links === 1 ? "" : "s"}`)) : "",
  );
}

/** Drop picked: the reasons, with Duplicate picked first; 1–5 pick one. */
function dropPlan(c: Candidate): HTMLElement {
  const ch = linkChoice(c);
  return h("div", { class: "drop-plan", role: "radiogroup", "aria-label": "Why drop it" },
    ...DROP_REASONS.map((r, i) => h("label", { class: "plan-step", title: r.hint },
      h("input", { type: "radio", name: `drop-${c.id}`, checked: ch.reason === r.value,
        onchange: () => { ch.reason = r.value; } }),
      h("span", {}, r.label), h("kbd", {}, String(i + 1)))));
}

/** The card's main button, a and ⌘↩: a linked card does its pick; any other card is approved. */
function decide(c: Candidate) {
  if (!isLinked(c)) { void approve(c); return; }
  const ch = linkChoice(c);
  if (ch.pick === "merge") void merge(c);
  else if (ch.pick === "drop") void drop(c, ch.reason);
  else void approve(c);
}
```

- [ ] **Step 7: Use them in the card**

In `app/src/main.ts`, in `candidateCardBody`, find:

```ts
  const label = { task: "Approve", waiting: "Track", close: `Close ${c.target_issue}`, comment: "Post update" }[c.kind];
```

Replace with:

```ts
  const linked = isLinked(c);
  const pick = linked ? linkChoice(c).pick : null;
  const fixed = linked && pick !== "new";           // Merge or Drop: no title box, no fields
  const fields = !acting && !fixed;
  const label = pick === "merge" ? `Merge into ${c.possible_duplicate}` : pick === "drop" ? "Drop"
    : pick === "new" && c.kind === "task" ? "Create issue"
    : { task: "Approve", waiting: "Track", close: `Close ${c.target_issue}`, comment: "Post update" }[c.kind];
```

Find:

```ts
        refIssue ? `: ${refIssue.title}` : c.title.replace(/^(Close|Update) [A-Z]+-\d+/, ""))
    : h("input", {
        class: "title-input",
        value: val("title") ?? "",
        "aria-label": "Task title",
        oninput: (e: Event) => { d.title = (e.target as HTMLInputElement).value; },
        onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void approve(c); },
      });
```

Replace with (⌘↩ moves to the global key handler in Task 4):

```ts
        refIssue ? `: ${refIssue.title}` : c.title.replace(/^(Close|Update) [A-Z]+-\d+/, ""))
    : fixed
      ? h("div", { class: "title-static" }, val("title") || c.title)
      : h("input", {
          class: "title-input",
          value: val("title") ?? "",
          "aria-label": "Task title",
          oninput: (e: Event) => { d.title = (e.target as HTMLInputElement).value; },
        });
```

Find:

```ts
    !acting && c.handled?.identifier ? handledPanel(c, busy) : "",
    !acting && c.possible_duplicate && duplicatePanel(c, busy),
    !acting && c.reply_draft && replyBox(c, d),
```

Replace with:

```ts
    !acting && c.handled?.identifier ? handledPanel(c, busy) : "",
    linked && linkBox(c, busy),
    pick === "merge" && mergePlan(c, d, busy),
    pick === "drop" && dropPlan(c),
    !acting && c.reply_draft && replyBox(c, d),
```

Find:

```ts
    linksRow(c),
    !acting && subtaskEditor(c, d),
    h(
      "div",
      { class: "card-actions" },
      !acting && clientSelect(val("client_label") ?? null, (v) => { d.client_label = v; }),
      !acting && projectSelect(val("project") ?? null, (v) => { d.project = v; }),
      !acting && priorityPill(val("priority") ?? 0, (v) => { d.priority = v; }),
      !acting && c.kind === "waiting" && h("span", { class: "muted small" }, "Follow up"),
      !acting && dateInput(val("due_date") ?? null, (v) => { d.due_date = v; }),
      h("span", { class: "spacer" }),
      snoozeMenu(c, busy),
      dropMenu(c, busy),
      h("button", { class: "primary", disabled: busy, title: "⌘↩", onclick: () => void approve(c) },
        busy ? "Working…" : label),
```

Replace with:

```ts
    linksRow(c),
    fields && subtaskEditor(c, d),
    h(
      "div",
      { class: "card-actions" },
      fields && clientSelect(val("client_label") ?? null, (v) => { d.client_label = v; }),
      fields && projectSelect(val("project") ?? null, (v) => { d.project = v; }),
      fields && priorityPill(val("priority") ?? 0, (v) => { d.priority = v; }),
      fields && c.kind === "waiting" && h("span", { class: "muted small" }, "Follow up"),
      fields && dateInput(val("due_date") ?? null, (v) => { d.due_date = v; }),
      h("span", { class: "spacer" }),
      snoozeMenu(c, busy),
      !linked && dropMenu(c, busy),
      h("button", { class: "primary", disabled: busy, title: "⌘↩", onclick: () => decide(c) },
        busy ? "Working…" : label),
```

- [ ] **Step 8: Type-check**

```bash
cd app && npx tsc --noEmit && echo TSC OK
grep -n "duplicatePanel\|ADVICE_LABEL" src/main.ts
```

Expected: `TSC OK`; `grep` prints nothing. If `tsc` reports `Child` as unknown, it is already imported (`import type { Child } from "./dom";`).

- [ ] **Step 9: Commit**

```bash
git add app/src/api.ts app/src/main.ts
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
App: a linked card shows its issue, a Merge / Create new / Drop switch and the plan for the pick

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: App: keys and the shortcuts sheet

**Files:**
- Modify: `app/src/main.ts` (the `keydown` listener, `SHORTCUTS`)

- [ ] **Step 1: ⌘↩ presses the main button from anywhere in the Inbox**

In `app/src/main.ts`, find:

```ts
  if (e.key === "Escape" && state.balanceOpen) { state.balanceOpen = false; render(); return; }
```

Replace with:

```ts
  // ⌘↩ presses the focused Inbox card's main button: from the page or a field in the card, but
  // not from its draft reply.
  if (state.tab === "inbox" && (e.metaKey || e.ctrlKey) && e.key === "Enter" && !document.querySelector(".overlay")
      && (!typing || target.closest(".ib-pane .card")) && !target.closest(".reply")) {
    const c = focusedCard() ? focusedCandidate() : undefined;
    if (c) { e.preventDefault(); decide(c); }
    return;
  }
  if (e.key === "Escape" && state.balanceOpen) { state.balanceOpen = false; render(); return; }
```

- [ ] **Step 2: Digits pick a drop reason, and a, d, m follow the pick**

In `app/src/main.ts`, find:

```ts
  const c = focusedCard() ? focusedCandidate() : undefined;
  switch (e.key) {
```

Replace with:

```ts
  const c = focusedCard() ? focusedCandidate() : undefined;
  // A linked card with Drop picked takes 1–5 as the reason.
  if (c && isLinked(c) && linkChoice(c).pick === "drop" && /^[1-5]$/.test(e.key)) {
    linkChoice(c).reason = DROP_REASONS[Number(e.key) - 1].value;
    render();
    return;
  }
  switch (e.key) {
```

Find:

```ts
    case "a": if (c) void approve(c); break;
    case "m": if (c?.possible_duplicate && (c.kind === "task" || c.kind === "waiting")) void merge(c); break;
```

Replace with:

```ts
    case "a": if (c) decide(c); break;
    case "m": if (c && isLinked(c)) void merge(c); break;
```

Find:

```ts
    case "d": if (c) { closeMenus(); const m = focusedCard()?.querySelector<HTMLDetailsElement>("details.drop-menu:not(.snooze-menu)"); if (m) m.open = true; } break;
```

Replace with:

```ts
    case "d":
      if (c && isLinked(c)) { linkChoice(c).pick = "drop"; render(); }
      else if (c) { closeMenus(); const m = focusedCard()?.querySelector<HTMLDetailsElement>("details.drop-menu:not(.snooze-menu)"); if (m) m.open = true; }
      break;
```

- [ ] **Step 3: The shortcuts sheet**

In `app/src/main.ts`, find:

```ts
  ["a", "Approve (or close / post / track)"],
  ["d, then 1–5", "Drop, with a reason"],
  ["s, then 1–3", "Snooze: tomorrow / next Monday / in a week"],
  ["m", "Merge a possible duplicate into the existing issue"],
```

Replace with:

```ts
  ["a or ⌘↩", "Approve (or close / post / track); on a linked card, do its pick"],
  ["d, then 1–5", "Drop, with a reason (on a linked card: pick Drop)"],
  ["s, then 1–3", "Snooze: tomorrow / next Monday / in a week"],
  ["m", "Merge into the linked issue"],
```

- [ ] **Step 4: Type-check**

```bash
cd app && npx tsc --noEmit && echo TSC OK
```

Expected: `TSC OK`.

- [ ] **Step 5: Commit**

```bash
git add app/src/main.ts
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
App: ⌘↩ and a do a linked card's pick, d picks Drop and 1–5 its reason, m merges

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: App: bulk Approve leaves linked cards out

**Files:**
- Modify: `app/src/main.ts` (`bulk`, `bulkBar`)

- [ ] **Step 1: `bulk` skips linked cards on Approve**

In `app/src/main.ts`, find:

```ts
  const picked = state.candidates.filter((c) => state.selected.has(c.id));
  const done: number[] = [];
```

Replace with:

```ts
  // A linked card's merge plan needs a look, so bulk Approve leaves it out.
  const picked = state.candidates.filter((c) => state.selected.has(c.id) && !(action === "approve" && isLinked(c)));
  const done: number[] = [];
```

- [ ] **Step 2: The bar counts and names them**

In `app/src/main.ts`, find:

```ts
  return h("div", { class: "bulk" },
    h("span", {}, `${state.selected.size} selected`),
    h("span", { class: "spacer" }),
    h("button", { class: "ghost", onclick: () => { state.selected.clear(); render(); } }, "Clear"),
    drop,
    h("button", { class: "primary", onclick: () => void bulk("approve") }, `Approve ${state.selected.size}`),
  );
```

Replace with:

```ts
  const linked = state.candidates.filter((c) => state.selected.has(c.id) && isLinked(c)).length;
  const approvable = state.selected.size - linked;
  return h("div", { class: "bulk" },
    h("span", {}, `${state.selected.size} selected`),
    linked ? h("span", { class: "muted small" }, approvable
      ? `${linked} linked card${linked === 1 ? "" : "s"} left out`
      : "Decide linked cards one at a time") : "",
    h("span", { class: "spacer" }),
    h("button", { class: "ghost", onclick: () => { state.selected.clear(); render(); } }, "Clear"),
    drop,
    approvable ? h("button", { class: "primary", onclick: () => void bulk("approve") }, `Approve ${approvable}`) : "",
  );
```

- [ ] **Step 3: Type-check**

```bash
cd app && npx tsc --noEmit && echo TSC OK
```

Expected: `TSC OK`.

- [ ] **Step 4: Commit**

```bash
git add app/src/main.ts
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
App: bulk Approve leaves linked cards out and says how many

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: App: styles

**Files:**
- Modify: `app/src/styles.css`

- [ ] **Step 1: Replace the duplicate panel's rules**

In `app/src/styles.css`, find:

```css
/* Possible duplicate: recommendation, choices, and a look at the existing issue */
.dup {
  margin: 8px 0 4px; padding: 10px 12px; border-radius: 8px;
  background: var(--warn-bg); border: 1px solid color-mix(in srgb, var(--warn-ink) 25%, transparent);
  font-size: 13px;
}
.dup-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.dup-label { font-weight: 600; color: var(--warn-ink); }
.dup-title { color: var(--ink); }
.dup-advice { margin-top: 4px; color: var(--ink); }
.dup-advice strong { color: var(--warn-ink); }
.dup-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.dup-actions button { font-size: 12px; padding: 4px 12px; border-radius: 6px; cursor: pointer; }
.dup-actions button.ghost-btn { background: var(--surface); color: var(--ink); }
.dup-actions button.rec { background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent); font-weight: 600; }
.dup-preview { margin-top: 8px; }
.dup-preview > summary { cursor: pointer; color: var(--warn-ink); font-size: 12px; font-weight: 500; width: fit-content; }
```

Replace with:

```css
/* A card linked to an open issue: the issue, the switch (Merge, Create new, Drop), and the plan */
.link-box {
  margin: 8px 0 4px; padding: 10px 12px; border-radius: 8px;
  background: var(--surface-2); border: 1px solid var(--border); font-size: 13px;
}
.link-head, .plan-head {
  font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px;
}
.link-issue { color: var(--ink); }
.link-issue .link { font-weight: 600; }
.link-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; font-size: 12px; color: var(--muted); }
.link-switch { display: flex; margin-top: 10px; }
.link-switch button.seg { flex: 1; min-width: 0; border-left: 1px solid var(--border); }
.link-switch button.seg:first-child { border-left: 0; }
.rec-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: currentColor; margin-left: 6px; vertical-align: middle; }
.link-reason { margin-top: 6px; font-size: 12px; color: var(--muted); }
.link-reason strong { color: var(--ink); font-weight: 600; }
.dup-preview { margin-top: 6px; }
.dup-preview > summary { cursor: pointer; color: var(--accent); font-size: 12px; width: fit-content; }
.merge-plan, .drop-plan { margin: 10px 0 6px; }
.plan-step { display: flex; align-items: flex-start; gap: 8px; padding: 3px 0; font-size: 13px; }
.plan-step input { margin: 3px 0 0; flex: none; }
.plan-step .link-btn, .drop-plan kbd { margin-left: auto; }
.plan-ic { flex: none; width: 13px; text-align: center; color: var(--muted); }
.plan-step s { color: var(--muted); }
.plan-new { color: var(--s-done-ink); font-weight: 600; }
.plan-comment {
  margin: 2px 0 6px 21px; padding: 6px 8px; border-radius: 6px;
  background: var(--surface); border: 1px solid var(--border); font-size: 12px;
}
.merge-plan .comment-input { margin: 2px 0 6px; }
.merge-plan .subtasks { margin: 4px 0 4px 21px; }
```

- [ ] **Step 2: Check no rule names a removed class**

```bash
cd app && grep -n -E "\.dup(-head|-label|-title|-advice|-actions)?\b[^-]" src/styles.css; grep -n -E "\"dup(-head|-label|-title|-advice|-actions)?\"|advice-" src/main.ts
cd app && npx tsc --noEmit && echo TSC OK
```

Expected: both `grep` print nothing; `TSC OK`.

- [ ] **Step 3: Commit**

```bash
git add app/src/styles.css
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
App: styles for the linked issue box and the merge plan; the duplicate panel's rules go

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Browser check

Check the card on a copy of the settings folder, with every write blocked. Do not start the real app: the user may run a dev copy (vite on :1420).

- [ ] **Step 1: A scratch settings folder with 3 linked cards in the Inbox**

```bash
S=$(mktemp -d /private/tmp/claude-501/-Users-thibaultdody-github-tdody-todo-hub/9a9d6ffa-cbec-4967-8528-057bd0b277b9/scratchpad/home.XXXX)
cp "$HOME/Library/Application Support/TodoHub/"{config.toml,settings.json,todohub.db,client_domains.json} "$S"/
sqlite3 "$S/todohub.db" "
UPDATE candidates SET status = 'pending', drop_reason = NULL, linear_identifier = NULL, linear_url = NULL, snooze_until = NULL
 WHERE id IN (SELECT id FROM candidates WHERE possible_duplicate IS NOT NULL ORDER BY id DESC LIMIT 3);
UPDATE candidates SET due_date = date('now', '+1 day'), priority = 1
 WHERE id = (SELECT max(id) FROM candidates WHERE possible_duplicate IS NOT NULL);
SELECT id, kind, possible_duplicate, duplicate_advice, due_date, priority FROM candidates WHERE status = 'pending' AND possible_duplicate IS NOT NULL;"
echo "$S"
```

Expected: 3 rows. Keep the folder path for Step 2.

- [ ] **Step 2: Start the backend and the UI from the worktree**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/backend && TODOHUB_HOME="$S" TODOHUB_TOKEN=x uv run python -m todohub.api --port 8791
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npx vite --port 1430 --strictPort
```

Run each with `run_in_background: true`. Expected: the backend logs `Uvicorn running on http://127.0.0.1:8791`; vite prints `Local: http://localhost:1430/`.

- [ ] **Step 3: Open the Inbox in Playwright with writes blocked**

Load the Playwright tools, then run this with `browser_run_code_unsafe` before the first navigation:

```js
async (page) => {
  const ctx = page.context();
  await ctx.addInitScript(() => {
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => (cmd === "backend_info" ? { url: "http://127.0.0.1:8791", token: "x", error: null } : null),
      transformCallback: () => 0,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    };
  });
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  await ctx.route("http://127.0.0.1:8791/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.method() !== "GET") {
      await page.evaluate((x) => { (window.__writes ??= []).push(x); }, { method: req.method(), url: req.url(), body: req.postData() });
      return route.fulfill({ status: 500, headers: cors, contentType: "application/json", body: '{"error":"blocked in the browser check"}' });
    }
    const res = await route.fetch();
    return route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
  await page.setViewportSize({ width: 1120, height: 800 });
  await page.goto("http://localhost:1430/");
}
```

Expected: the Inbox lists the 3 linked cards.

- [ ] **Step 4: Check each item, with a screenshot at 1120 × 800**

- The box: the heading words match the list chip; the issue's status, priority and due date show (or "Loading…" first, then the facts).
- The switch: Claude's pick is on, with a dot. Click each part: the main button reads **Merge into ENG-…**, **Create issue** (or **Track**), **Drop**; Create new brings back the title box and the fields; Merge and Drop hide them.
- Merge: the comment shows as formatted text; **Edit** turns it into a text box with the focus in it. On the card with tomorrow's date and Urgent, "Move the due date" and "Raise the priority" show, ticked.
- Drop: the 5 reasons, Duplicate picked; press 3, then "Not a task" is picked.
- Keys, with the focus on the page: **d** picks Drop; **m** and then ⌘↩ each send a write. Read `window.__writes` with `browser_evaluate`: a `POST …/merge` whose body has `comment`, `move_due_date` and `raise_priority`; the backend answers 500, and the card stays with an error toast.
- Bulk: hover a linked card, tick it and one other card: the bar says "Approve 1" and "1 linked card left out". Tick only linked cards: no Approve button, and "Decide linked cards one at a time".

- [ ] **Step 5: The same at 760 × 520, and in Dark**

```js
async (page) => { await page.setViewportSize({ width: 760, height: 520 }); }
```

Expected: the switch's 3 parts fit on one line; nothing overflows the card. Then press **t** until the theme is Dark and look again: the dot shows on the picked and the other parts, and the old → new values read clearly.

- [ ] **Step 6: Clean up**

Stop the 2 background commands. Then:

```bash
rm -rf /Users/thibaultdody/dev/worktrees/todo-hub/main/.playwright-mcp "$S"
git -C /Users/thibaultdody/dev/worktrees/todo-hub/main status --short
```

Expected: `status` prints nothing. Fix what the check found in a new commit (`App: fixes from the browser check`), with `tsc` and the scan first.

---

### Task 8: Docs

**Files:**
- Modify: `README.md`, `PRODUCT.md`, `DESIGN.md`

- [ ] **Step 1: README, "Each candidate carries"**

In `README.md`, find:

```markdown
  - a "possible duplicate of ENG-…" panel when one of your open issues may already cover it (see below).
```

Replace with:

```markdown
  - a link to one of your open issues when that issue may already cover it (see below).
```

- [ ] **Step 2: README, the linked issues section**

In `README.md`, find:

```markdown
**Possible duplicates**
- The sweep recommends one of three choices, with a one-line reason:
  - **Drop as duplicate:** the issue already covers this exact task.
  - **Merge into ENG-…:** same work, but this adds something. Merging posts a comment on the issue with what's new (title, why, quote, due date, source link), attaches the new links, and creates the subtasks as sub-issues. No new issue is made.
  - **Create new:** related, but a separate deliverable.
- The recommended choice is highlighted, and all three are always available. **m** merges from the keyboard.
- **Show ENG-…** expands a preview of the existing issue: status, priority, due date, assignee, description, and its latest three comments.
- Merges can be undone like approvals: the comment, links and sub-issues are removed.
```

Replace with:

```markdown
**Linked issues**
- When one of your open issues may already cover a card, the sweep links them and recommends one of three picks, with a one-line reason:
  - **Merge:** same work, but this adds something (a new ask, a date, a step, a link).
  - **Create new:** related, but a separate deliverable.
  - **Drop:** the issue already covers this exact task.
- The card shows the linked issue (status, priority, due date; **Show description and comments** for the rest) and a switch with the three picks. Claude's pick comes first and has a dot. The card below the switch changes with the pick, and one button does it (**a** or ⌘↩):
  - **Merge into ENG-…** lists what it will change on the issue: the comment it posts (**Edit** changes it; the source link is added), **Move the due date** when the card is due sooner, **Raise the priority** when the card is more urgent (both ticked; untick to skip), the subtasks it adds as sub-issues, and the links it attaches. No new issue is made. **m** merges from the keyboard.
  - **Create issue** (or **Track**) shows the usual fields.
  - **Drop** shows the drop reasons, with Duplicate picked; 1–5 pick another.
- Undo removes the comment, links and sub-issues, and puts the issue's old due date and priority back.
- Bulk **Approve** leaves linked cards out; decide them one at a time.
```

- [ ] **Step 3: README, the Review list**

In `README.md`, find:

```markdown
"Same as ENG-123" or "Adds to ENG-123" for a possible duplicate, "Looks handled" when Linear already covers it). The selected one opens in full on the right: why, the excerpt, the duplicate panel, the draft reply,
```

Replace with:

```markdown
"Same as ENG-123", "Adds to ENG-123" or "Related to ENG-123" for a linked issue, "Looks handled" when Linear already covers it). The selected one opens in full on the right: why, the excerpt, the linked issue and its plan, the draft reply,
```

Find:

```markdown
- Approve (⌘↩ or **a**), drop with a reason (**d**, 1–5), snooze (**s**, 1–3), bulk approve or drop, and full keyboard navigation (**?** lists the shortcuts).
```

Replace with:

```markdown
- Approve (⌘↩ or **a**), drop with a reason (**d**, 1–5), snooze (**s**, 1–3), bulk approve (linked cards left out) or drop, and full keyboard navigation (**?** lists the shortcuts).
```

- [ ] **Step 4: PRODUCT.md, the terms**

In `PRODUCT.md`, find:

```markdown
possible duplicate (Drop as duplicate / Merge into / Create new)
```

Replace with:

```markdown
linked issue (Same as / Adds to / Related to; Merge, Create new, Drop)
```

- [ ] **Step 5: DESIGN.md, the box**

In `DESIGN.md`, find:

```markdown
- **Decided:** approved turns green-ringed with a 9% green tint, then swipes off to the right with a slight tilt (420ms); dropped turns red and swipes off to the left. With Reduce motion it fades out (160ms).
```

Replace with:

```markdown
- **Decided:** approved turns green-ringed with a 9% green tint, then swipes off to the right with a slight tilt (420ms); dropped turns red and swipes off to the left. With Reduce motion it fades out (160ms).

### Linked issue box (Inbox)

A card linked to one of your open issues shows the issue, a switch, and the plan for the pick.

- **Box:** Shaded Paper, Hairline border, 8px corners, 10px × 12px padding. An 11px uppercase Pencil heading at 700 ("Adds to an open issue"), the identifier (a link at 600) and the title, then the status and priority pills and "due Nov 28" in 12px Pencil.
- **Switch:** the segmented control of the Group control, across the box; the 3 parts share its width. Claude's pick has a 6px dot in the text color. Under it, a 12px Pencil line: "Claude recommends Merge" in Ink at 600, then the reason.
- **Plan:** an 11px uppercase heading ("Merge will change ENG-412"), then one 13px line for each change, with a Pencil icon (✎, +) or a checkbox. An old value is Pencil and struck through; the new one is the Done pill ink (`s-done-ink`) at 600. The comment shows as Markdown in a Paper box with a Hairline border, at 12px.
- **Drop:** the reasons as radio rows, each with its number key at the right.
- **Footer:** Snooze ▾ and one primary button that names the pick ("Merge into ENG-412", "Create issue", "Drop"). No Drop ▾ menu.
```

- [ ] **Step 6: Commit**

```bash
git add README.md PRODUCT.md DESIGN.md
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
README, PRODUCT, DESIGN: linked issues, the switch, the merge plan and bulk Approve

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Final check

- [ ] **Step 1: Everything passes**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/backend && uv run pytest -q 2>&1 | tail -2
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npx tsc --noEmit && echo TSC OK
git -C /Users/thibaultdody/dev/worktrees/todo-hub/main log --oneline main..
```

Expected: all tests pass; `TSC OK`; the log lists the spec, the plan and the commits of Tasks 1–8.

- [ ] **Step 2: Report**

Tell the user what changed, what the browser check showed (with the screenshots), and the assumptions from the spec. Do not push or open a pull request until the user asks.
