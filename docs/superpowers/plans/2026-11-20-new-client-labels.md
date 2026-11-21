# New client labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a sweep or a capture finds a task for a customer with no client label, the candidate proposes a new client label, and Approve creates it in Linear before the issue.

**Architecture:** A new nullable column `new_client_label` holds a proposed name. `add_candidate` decides between an existing label (exact or near-match, through `matching_client_label` in `linear.py`) and a new name. Approve reads the labels again, creates the label in the client label group only if it is still missing, then creates the issue with it. The Inbox shows a box, "Hooli (new)" in the select, and ", add label" on the primary button.

**Tech Stack:** Python 3 (FastAPI, httpx, sqlite3, pytest), TypeScript (Vite, no framework), Linear GraphQL.

**Spec:** `docs/superpowers/specs/2026-11-20-new-client-labels-design.md`

**Rules for every task:**

- The repo is public. Use only fictional names (Globex, Hooli, Initech, Umbrella, Pied Piper, `ENG-123`). Never copy a name from the TodoHub settings folder.
- End every commit message with this line, exactly: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Backend commands run from `backend/`; frontend commands from `app/`.

---

## Task 0: Set up the worktree

- [ ] **Step 1: Install the dependencies**

```bash
cd backend && uv sync --extra dev && cd ../app && npm ci
```

- [ ] **Step 2: Run the tests once, to know the baseline**

Run: `cd backend && uv run pytest -q`
Expected: all tests pass.

Run: `cd app && npx tsc --noEmit`
Expected: no output.

---

## Task 1: `matching_client_label`

**Files:**
- Modify: `backend/src/todohub/linear.py` (after `client_label_of`, around line 431)
- Test: `backend/tests/test_linear.py`

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `backend/tests/test_linear.py`:

```python
from todohub.linear import Linear, LinearError, client_labels_of, matching_client_label, shape_issue
```

(replace the existing `from todohub.linear import ...` line). Add at the end of the file:

```python
LABELS = ["Globex", "PiedPiper", "Initech dba Initrode", "Hooli (fka Nucleus)", "Umbrella (Cypress)",
          "Acme Bolt Company", "Zinc"]


@pytest.mark.parametrize("name,expected", [
    ("globex", "Globex"),
    ("Globex, Inc.", "Globex"),
    ("GLOBEX LLC", "Globex"),
    ("Pied-Piper", "PiedPiper"),
    ("Initrode", "Initech dba Initrode"),
    ("initech", "Initech dba Initrode"),
    ("Nucleus", "Hooli (fka Nucleus)"),
    ("hooli", "Hooli (fka Nucleus)"),
    ("Cypress", "Umbrella (Cypress)"),
    ("Zinc", "Zinc"),
    ("Zinc Inc", "Zinc"),
    ("Globex Mining", None),     # no partial match
    ("ABC", None),               # no initials ("Acme Bolt Company")
    ("Inc.", None),
    ("", None),
])
def test_matching_client_label(name, expected):
    assert matching_client_label(name, LABELS) == expected


def test_matching_client_label_with_two_matches():
    assert matching_client_label("globex", ["Globex, Inc.", "Globex"]) == "Globex"   # the same name wins
    assert matching_client_label("Globex Corp", ["Globex, Inc.", "Globex LLC"]) is None
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `uv run pytest tests/test_linear.py -q`
Expected: FAIL, `ImportError: cannot import name 'matching_client_label'`

- [ ] **Step 3: Write the code**

In `backend/src/todohub/linear.py`, add `import re` after `from __future__ import annotations` and its blank line (with the other standard imports), then add after `client_label_of`:

```python
LEGAL_SUFFIXES = {"inc", "llc", "co", "corp", "corporation", "ltd", "company"}


def _normalized(name: str) -> str:
    """Lowercase letters and digits, without a last word that is a legal suffix ("Globex, Inc." -> "globex")."""
    words = [w for w in (re.sub(r"[^a-z0-9]", "", w) for w in name.lower().split()) if w]
    if len(words) > 1 and words[-1] in LEGAL_SUFFIXES:
        words.pop()
    return "".join(words)


def _names_of(label: str) -> list[str]:
    """A label's name and its other names: "A dba B", "A (fka B)" and "A (B)" also name A and B."""
    names = [label]
    for pattern in (r"(.+?)\s+dba\s+(.+)", r"(.+?)\s*\((?:fka\s+)?(.+?)\)\s*"):
        m = re.fullmatch(pattern, label, re.IGNORECASE)
        if m:
            names += [m.group(1), m.group(2)]
    return names


def matching_client_label(name: str, labels: list[str]) -> str | None:
    """The client label that ``name`` names, or None. Case, punctuation and a legal suffix don't count,
    and a label's other names count. Of two matches, the label with the same name wins."""
    key = _normalized(name)
    if not key:
        return None
    found = [l for l in labels if any(_normalized(n) == key for n in _names_of(l))]
    same = [l for l in found if l.lower() == name.strip().lower()]
    if len(found) == 1:
        return found[0]
    return same[0] if len(same) == 1 else None
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `uv run pytest tests/test_linear.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/linear.py backend/tests/test_linear.py
git commit -m "Linear: matching_client_label finds the label a company name names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: The client label group, and creating a label in it

**Files:**
- Modify: `backend/src/todohub/linear.py` (`TeamMeta` at line 50, `team_meta` at line 129, a new write method after `create_issue`)
- Test: `backend/tests/test_linear.py`

- [ ] **Step 1: Update the team_meta test, and add a test for the new method**

In `test_team_meta_paginates_labels_and_sends_raw_key`, add this branch in `handler`, before the line `after = body["variables"]["after"]`:

```python
        if "isGroup" in body["query"]:
            assert body["variables"] == {"group": "client"}
            return httpx.Response(200, json={"data": {"issueLabels": {"nodes": [
                {"id": "x", "color": "#aaaaaa", "isGroup": False, "team": None},       # a plain label with the same name
                {"id": "g1", "color": "#f7c8c1", "isGroup": True, "team": None}]}}})
```

and change the asserts at the end of the test to:

```python
    assert meta.viewer_id == "me" and len(calls) == 6
    assert meta.projects == [{"id": "p1", "name": "Globex"}]
    assert meta.client_group == {"id": "g1", "color": "#f7c8c1", "team_id": None}
```

Add these tests at the end of the file:

```python
def test_create_client_label_uses_the_groups_color_and_team():
    sent = []

    def handler(request):
        body = json.loads(request.content)
        sent.append(body["variables"]["input"])
        return httpx.Response(200, json={"data": {"issueLabelCreate": {
            "success": True, "issueLabel": {"id": "l9", "name": "Hooli"}}}})

    linear = Linear("k", transport=transport(handler))
    assert linear.create_client_label("Hooli", {"id": "g1", "color": "#f7c8c1", "team_id": None}) \
        == {"id": "l9", "name": "Hooli"}
    linear.create_client_label("Hooli", {"id": "g2", "color": "#000000", "team_id": "t1"})
    assert sent == [{"name": "Hooli", "parentId": "g1", "color": "#f7c8c1"},
                    {"name": "Hooli", "parentId": "g2", "color": "#000000", "teamId": "t1"}]


def test_create_client_label_refused():
    def handler(request):
        return httpx.Response(200, json={"errors": [{"message": "Only admins can create labels"}]})

    with pytest.raises(LinearError, match="Only admins"):
        Linear("k", transport=transport(handler)).create_client_label("Hooli", {"id": "g1", "color": "#fff", "team_id": None})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `uv run pytest tests/test_linear.py -q`
Expected: FAIL: `len(calls) == 6` is 5, and `AttributeError: 'Linear' object has no attribute 'create_client_label'`

- [ ] **Step 3: Write the code**

In `TeamMeta`, add the last field:

```python
    projects: list[dict] = field(default_factory=list)   # [{id, name}], not completed or canceled
    client_group: dict | None = None   # {id, color, team_id} of the client label group; None if Linear has none
```

In `team_meta`, after the `labels = self._paginate(...)` call, add:

```python
        groups = self.gql(
            """
            query($group: String!) {
              issueLabels(filter: { name: { eq: $group } }) { nodes { id color isGroup team { id } } }
            }
            """,
            {"group": client_group},
        )["issueLabels"]["nodes"]
        group = next((g for g in groups if g["isGroup"]), None)
```

and pass it to `TeamMeta(...)`:

```python
            projects=sorted(projects, key=lambda p: p["name"].lower()),
            client_group={"id": group["id"], "color": group["color"], "team_id": (group.get("team") or {}).get("id")}
            if group else None,
        )
```

After `create_issue`, add:

```python
    def create_client_label(self, name: str, group: dict) -> dict:
        """Add a label to the client label group, with the group's color and team (none for a workspace group)."""
        fields = {"name": name, "parentId": group["id"], "color": group["color"]}
        if group.get("team_id"):
            fields["teamId"] = group["team_id"]
        data = self.gql(
            """
            mutation($input: IssueLabelCreateInput!) {
              issueLabelCreate(input: $input) { success issueLabel { id name } }
            }
            """,
            {"input": fields},
        )
        result = data["issueLabelCreate"]
        if not result["success"]:
            raise LinearError("Linear did not create the label.")
        return result["issueLabel"]
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `uv run pytest tests/test_linear.py -q`
Expected: PASS

Run: `uv run pytest -q`
Expected: PASS (other tests build `TeamMeta` without `client_group`, which defaults to `None`)

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/linear.py backend/tests/test_linear.py
git commit -m "Linear: read the client label group, and create a label in it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: The `new_client_label` column

**Files:**
- Modify: `backend/src/todohub/db.py` (`CANDIDATE_FIELDS` line 111, `MIGRATIONS` line 119, `add_candidate` line 335, `update_candidate` line 396)
- Test: `backend/tests/test_db.py`

- [ ] **Step 1: Write the failing test**

Add at the end of `backend/tests/test_db.py`:

```python
def test_new_client_label_and_setting_the_client(tmp_path):
    db = DB(tmp_path / "t.db")
    _, cid = db.add_candidate(None, source="slack", source_id="C1:1", title="Send Sam the deck", signal="ask",
                              new_client_label="Hooli")
    assert db.get_candidate(cid)["new_client_label"] == "Hooli"
    db.update_candidate(cid, priority=2)                     # another field leaves it
    assert db.get_candidate(cid)["new_client_label"] == "Hooli"
    c = db.update_candidate(cid, client_label="Globex")      # a client, or None, replaces it
    assert c["client_label"] == "Globex" and c["new_client_label"] is None
    db.update_candidate(cid, new_client_label="Pied Piper")  # not an editable field
    assert db.get_candidate(cid)["new_client_label"] is None
```

- [ ] **Step 2: Run the test to see it fail**

Run: `uv run pytest tests/test_db.py -q`
Expected: FAIL, `KeyError: 'new_client_label'`

- [ ] **Step 3: Write the code**

In `CANDIDATE_FIELDS`, add `"new_client_label"` after `"client_label"`:

```python
    "client_label", "new_client_label", "due_date", "priority", "possible_duplicate", "links", "subtasks", "status", "drop_reason", "kind", "target_issue", "comment", "project", "snooze_until", "category",
```

At the end of `MIGRATIONS`, add:

```python
    # A client label to create on approve, for a customer that has none yet; see tools.add_candidate.
    "new_client_label": "ALTER TABLE candidates ADD COLUMN new_client_label TEXT",
```

In `add_candidate`, add the column to the INSERT. Replace the statement's column list, placeholders and values with:

```python
            cur = c.execute(
                "INSERT OR IGNORE INTO candidates (run_id, source, source_id, source_url, title, title_key, signal, "
                "why, excerpt, who, client_label, new_client_label, due_date, priority, possible_duplicate, links, "
                "subtasks, kind, target_issue, comment, project, category, duplicate_advice, duplicate_reason, "
                "reply_draft, sender, channel, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    run_id, f["source"], f["source_id"], f.get("source_url"), f["title"], key, f["signal"],
                    f.get("why"), f.get("excerpt"), f.get("who"), f.get("client_label"), f.get("new_client_label"),
                    f.get("due_date"), int(f.get("priority") or 0), f.get("possible_duplicate"),
                    json.dumps(f.get("links") or []), json.dumps(f.get("subtasks") or []),
                    f.get("kind") or "task", f.get("target_issue"), f.get("comment"), f.get("project"),
                    f.get("category"), f.get("duplicate_advice"), f.get("duplicate_reason"),
                    f.get("reply_draft"), f.get("sender"), f.get("channel"), now_iso(),
                ),
            )
```

In `update_candidate`, after the line `changes = {k: v for k, v in changes.items() if k in EDITABLE_FIELDS}`, add:

```python
        if "client_label" in changes:
            changes["new_client_label"] = None      # a candidate has a client label or a new one, never both
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `uv run pytest tests/test_db.py tests/test_tools.py -q`
Expected: PASS (`test_old_database_is_upgraded` covers the migration)

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/db.py backend/tests/test_db.py
git commit -m "DB: a candidate can hold a new client label

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: `add_candidate` proposes a new client label

**Files:**
- Modify: `backend/src/todohub/tools.py` (the `client_label` block, lines 201-207, and the `db.add_candidate` call, line 268)
- Modify: `backend/src/todohub/mcp_server.py:118`
- Test: `backend/tests/test_tools.py`

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_tools.py`, replace `test_unknown_label_dropped_known_duplicate_kept` with:

```python
def test_unknown_label_proposed_known_duplicate_kept(db):
    r = add(db, client_label="Acme", possible_duplicate="ENG-123")
    c = db.get_candidate(r["id"])
    assert c["client_label"] is None and c["new_client_label"] == "Acme" and c["possible_duplicate"] == "ENG-123"


def test_client_label_near_match_and_new_label(db):
    r = add(db, client_label="Globex, Inc.")
    c = db.get_candidate(r["id"])
    assert c["client_label"] == "Globex" and c["new_client_label"] is None
    assert r["notes"] == ["client_label 'Globex, Inc.' matched the label 'Globex'"]
    r = add(db, source_id="C1:2.0", client_label="Hooli")
    c = db.get_candidate(r["id"])
    assert c["client_label"] is None and c["new_client_label"] == "Hooli"
    assert r["notes"] == ["client_label 'Hooli' is not a label yet; proposed as a new client label"]


def test_no_new_client_label_without_the_label_list(db):
    db.set_meta("client_labels", [])
    r = add(db, client_label="Hooli")
    c = db.get_candidate(r["id"])
    assert c["client_label"] is None and c["new_client_label"] is None
    assert r["notes"] == ["client_label 'Hooli' left empty: no client labels are loaded"]
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `uv run pytest tests/test_tools.py -q`
Expected: FAIL, `new_client_label` is `None` where `"Acme"` and `"Hooli"` are expected

- [ ] **Step 3: Write the code**

In `backend/src/todohub/tools.py`, after the line `from .db import DB, SOURCES, title_key`, add:

```python
from .linear import matching_client_label
```

Replace the `client_label` block:

```python
    label = (client_label or "").strip() or None
    if label:
        known = {l.lower(): l for l in db.get_meta("client_labels", [])}
        if label.lower() in known:
            label = known[label.lower()]
        else:
            notes.append(f"client_label {label!r} is not a known client label; left empty")
            label = None
```

with:

```python
    label = _clip(client_label, 80)
    new_label = None
    if label:
        known = db.get_meta("client_labels", [])
        found = matching_client_label(label, known)
        if found:
            if found.lower() != label.lower():
                notes.append(f"client_label {label!r} matched the label {found!r}")
            label = found
        elif known:
            notes.append(f"client_label {label!r} is not a label yet; proposed as a new client label")
            label, new_label = None, label
        else:            # labels never read from Linear (a new install, or no client label group)
            notes.append(f"client_label {label!r} left empty: no client labels are loaded")
            label = None
```

In the `db.add_candidate(...)` call, add `new_client_label=new_label` after `client_label=label`:

```python
        client_label=label, new_client_label=new_label, due_date=due, priority=prio, possible_duplicate=dup,
```

In `backend/src/todohub/mcp_server.py`, replace the docstring line:

```python
    client_label: exactly one of the client label names given in the prompt, or omit.
```

with:

```python
    client_label: one of the client label names given in the prompt; for a customer with no label, the
        company's name (the prompt says how to find it); omit for development or internal work.
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `uv run pytest tests/test_tools.py tests/test_mcp_server.py -q`
Expected: PASS. `test_normalizes_and_rejects_bad_fields` still counts 3 notes: "globex" is the label "Globex" by case only, which adds no note.

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/tools.py backend/src/todohub/mcp_server.py backend/tests/test_tools.py
git commit -m "add_candidate: a company with no client label becomes a new client label

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: The prompts name the customer

**Files:**
- Modify: `backend/src/todohub/sweep.py` (`build_prompt` line 259, `build_capture_prompt` line 682, a new `client_rule`)
- Modify: `backend/src/todohub/sweep_prompt.md:44-45`
- Modify: `backend/src/todohub/capture_prompt.md:17`
- Test: `backend/tests/test_sweep.py`

- [ ] **Step 1: Write the failing test**

Add at the end of `backend/tests/test_sweep.py`:

```python
def test_client_rule_looks_up_hubspot_only_when_it_can(settings):
    now = datetime.now(timezone.utc)
    settings.hubspot_tools = list(DEFAULT_HUBSPOT_TOOLS)
    for text in (sweep.build_prompt(settings, now, ["Globex"], [], []),
                 sweep.build_capture_prompt(settings, "a note", ["Globex"], [])):
        assert "`lifecyclestage` is `customer`" in text and "A prospect or a partner gets no client" in text
    settings.hubspot_tools = []
    for text in (sweep.build_prompt(settings, now, ["Globex"], [], []),
                 sweep.build_capture_prompt(settings, "a note", ["Globex"], [])):
        assert "lifecyclestage" not in text and "full name from the message, never its initials" in text
```

- [ ] **Step 2: Run the test to see it fail**

Run: `uv run pytest tests/test_sweep.py -q -k client_rule`
Expected: FAIL on the first `assert`

- [ ] **Step 3: Write the code**

In `backend/src/todohub/sweep.py`, add before `build_prompt`:

```python
def client_rule(settings: Settings) -> str:
    """How a sweep or a capture names a customer that has no client label: from HubSpot when it can read it."""
    if settings.hubspot_tools:
        return ("If the task is for a customer that has no name in this list, look the company up in HubSpot "
                "(`search_crm_objects`, objectType `COMPANY`, the company name as the query, properties `name` and "
                "`lifecyclestage`) and give its `name`, but only when its `lifecyclestage` is `customer`. "
                "A prospect or a partner gets no client.")
    return ("If the task is for a customer that has no name in this list, give the company's full name from the "
            "message, never its initials.")
```

In `build_prompt`'s `template.substitute(...)`, and in `build_capture_prompt`'s, add after the `client_labels=...` line:

```python
        client_rule=client_rule(settings),
```

In `backend/src/todohub/sweep_prompt.md`, replace:

```
- `client_label`: if the task is for a client, use exactly one name from this list, matching the company or its people. Otherwise leave it empty (development or internal work):
  $client_labels
```

with:

```
- `client_label`: if the task is for a client, use the name from this list that matches the company or its people:
  $client_labels
  $client_rule Otherwise leave it empty (development or internal work).
```

In `backend/src/todohub/capture_prompt.md`, replace:

```
   - `client_label`: one of: $client_labels (or empty for dev/internal work).
```

with:

```
   - `client_label`: one of: $client_labels. $client_rule Otherwise leave it empty (development or internal work).
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `uv run pytest tests/test_sweep.py -q`
Expected: PASS (`test_capture_run` still finds no `$` in the capture prompt)

- [ ] **Step 5: Commit**

```bash
git add backend/src/todohub/sweep.py backend/src/todohub/sweep_prompt.md backend/src/todohub/capture_prompt.md backend/tests/test_sweep.py
git commit -m "Sweep and capture: name a customer with no client label, from HubSpot when connected

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Approve creates the label; undo keeps it

**Files:**
- Modify: `backend/tests/conftest.py` (`FakeLinear`)
- Modify: `backend/src/todohub/api.py` (`approve_claimed` line 560, `undo` line 828)
- Test: `backend/tests/test_api.py`

- [ ] **Step 1: Give FakeLinear client labels and a client label group**

In `backend/tests/conftest.py`, in `FakeLinear.__init__`, add:

```python
        self.client_labels = [{"id": "l-Initech & Co", "name": "Initech & Co"}, {"id": "l-Globex", "name": "Globex"}]
        self.created_labels = []   # (name, group id)
        self.fail_label = False    # create_client_label raises
```

In `FakeLinear.team_meta`, replace the `client_labels=[...]` argument with:

```python
            client_labels=list(self.client_labels),
            client_group={"id": "g-client", "color": "#f7c8c1", "team_id": None},
```

and add the method:

```python
    def create_client_label(self, name, group):
        from todohub.linear import LinearError
        if self.fail_label:
            raise LinearError("Only admins can create labels.")
        label = {"id": f"l-{name}", "name": name}
        self.created_labels.append((name, group["id"]))
        self.client_labels.append(label)
        return label
```

- [ ] **Step 2: Write the failing tests**

In `test_undo_approve_trashes_issues_and_returns_to_inbox`, after `assert r.status_code == 200, r.text`, add:

```python
    assert r.json()["kept_label"] is None
```

Add at the end of `backend/tests/test_api.py`:

```python
def test_approve_creates_the_new_client_label_first(env):
    client, db, fake, _ = env
    cid = seed(db, client_label="Hooli", subtasks=[{"title": "Pull the list"}])
    assert db.get_candidate(cid)["new_client_label"] == "Hooli"
    r = client.post(f"/api/candidates/{cid}/approve")
    assert r.status_code == 200, r.text
    assert fake.created_labels == [("Hooli", "g-client")]
    assert [c["label_ids"] for c in fake.created] == [["l-Hooli"], ["l-Hooli"]]     # the issue and its subtask
    body = r.json()
    assert body["created_label"] == "Hooli"
    assert body["candidate"]["client_label"] == "Hooli" and body["candidate"]["new_client_label"] is None
    assert "Hooli" in db.get_meta("client_labels")


def test_approve_uses_a_client_label_made_in_the_meantime(env):
    client, db, fake, _ = env
    cid = seed(db, client_label="Hooli")
    fake.client_labels.append({"id": "l-hooli-inc", "name": "Hooli, Inc."})
    r = client.post(f"/api/candidates/{cid}/approve")
    assert r.status_code == 200, r.text
    assert fake.created_labels == [] and fake.created[0]["label_ids"] == ["l-hooli-inc"]
    assert r.json()["created_label"] is None and r.json()["candidate"]["client_label"] == "Hooli, Inc."


def test_a_refused_client_label_creates_no_issue(env):
    client, db, fake, _ = env
    cid = seed(db, client_label="Hooli")
    fake.fail_label = True
    r = client.post(f"/api/candidates/{cid}/approve")
    assert r.status_code == 502
    assert r.json()["error"] == "Couldn't create the client label Hooli: Only admins can create labels."
    assert fake.created == []
    c = db.get_candidate(cid)
    assert c["status"] == "pending" and c["new_client_label"] == "Hooli"


def test_a_label_made_before_a_refused_issue_is_used_on_the_next_try(env):
    client, db, fake, _ = env
    cid = seed(db, title="Book the Hooli kickoff", client_label="Hooli")
    fake.fail_titles = {"Book the Hooli kickoff"}
    assert client.post(f"/api/candidates/{cid}/approve").status_code == 502
    assert fake.created_labels == [("Hooli", "g-client")]
    assert db.get_candidate(cid)["client_label"] == "Hooli"           # the label exists now
    fake.fail_titles = set()
    r = client.post(f"/api/candidates/{cid}/approve")
    assert r.status_code == 200, r.text
    assert fake.created_labels == [("Hooli", "g-client")] and fake.created[0]["label_ids"] == ["l-Hooli"]


def test_two_candidates_for_one_new_client_make_one_label(env):
    client, db, fake, _ = env
    first = seed(db, client_label="Hooli")
    second = seed(db, source_id="C1:2.0", title="Book the Hooli kickoff", client_label="Hooli")
    assert client.post(f"/api/candidates/{first}/approve").status_code == 200
    assert client.post(f"/api/candidates/{second}/approve").status_code == 200
    assert fake.created_labels == [("Hooli", "g-client")]
    assert [c["label_ids"] for c in fake.created] == [["l-Hooli"], ["l-Hooli"]]


def test_setting_the_client_clears_the_new_client_label(env):
    client, db, *_ = env
    cid = seed(db, client_label="Hooli")
    r = client.patch(f"/api/candidates/{cid}", json={"client_label": "Globex"})
    assert r.json()["client_label"] == "Globex" and r.json()["new_client_label"] is None
    cid = seed(db, source_id="C1:2.0", client_label="Hooli")
    r = client.patch(f"/api/candidates/{cid}", json={"client_label": None})
    assert r.json()["client_label"] is None and r.json()["new_client_label"] is None


def test_undo_keeps_a_created_client_label(env):
    client, db, fake, _ = env
    cid = seed(db, client_label="Hooli")
    assert client.post(f"/api/candidates/{cid}/approve").status_code == 200
    r = client.post(f"/api/candidates/{cid}/undo")
    assert r.status_code == 200, r.text
    assert r.json()["kept_label"] == "Hooli" and fake.deleted_issues == ["id-ENG-99"]
    c = r.json()["candidate"]
    assert c["status"] == "pending" and c["client_label"] == "Hooli" and c["new_client_label"] is None
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `uv run pytest tests/test_api.py -q`
Expected: FAIL: `KeyError: 'kept_label'`, `fake.created_labels == []`, and `KeyError: 'created_label'`. `test_setting_the_client_clears_the_new_client_label` already passes (Task 3).

- [ ] **Step 4: Write the code**

In `backend/src/todohub/api.py`, add `matching_client_label` to the `from .linear import ...` line:

```python
from .linear import Linear, LinearError, TeamMeta, client_labels_of, is_linear_upload, matching_client_label, shape_issue
```

Add this function inside `create_app`, after `team_meta`:

```python
    def ensure_client_label(name: str) -> tuple[dict, bool]:
        """The client label ``name`` names, from Linear's labels as they are now, created in the client
        label group if there is none. Returns the label and whether it was created."""
        m = team_meta(refresh=True)
        found = matching_client_label(name, [l["name"] for l in m.client_labels])
        if found:
            return next(l for l in m.client_labels if l["name"] == found), False
        if not m.client_group:
            raise HTTPException(502, f"Couldn't create the client label {name}: Linear has no label group "
                                     f"named {settings.client_label_group!r}.")
        client = linear_factory()
        try:
            label = client.create_client_label(name, m.client_group)
        except LinearError as exc:
            raise HTTPException(502, f"Couldn't create the client label {name}: {exc}")
        finally:
            client.close()
        team_meta(refresh=True)      # the lists, the edit check and the next sweep know the label now
        return label, True
```

In `approve_claimed`, replace:

```python
        label_ids = [l["id"] for l in m.client_labels if l["name"] == c["client_label"]]
```

with:

```python
        label_ids = [l["id"] for l in m.client_labels if l["name"] == c["client_label"]]
        created_label = None
        if c.get("new_client_label"):
            label, created = ensure_client_label(c["new_client_label"])
            label_ids = [label["id"]]
            created_label = label["name"] if created else None
            c = db.update_candidate(cid, client_label=label["name"])     # also clears new_client_label
```

Replace:

```python
        undo = {"issues": [issue["id"]]}     # newest last; undo deletes them in reverse
```

with:

```python
        undo = {"issues": [issue["id"]]}     # newest last; undo deletes them in reverse
        if created_label:
            undo["created_label"] = created_label     # undo keeps the label and says so
```

and add `"created_label": created_label,` to the returned dict:

```python
        return {
            "candidate": updated,
            "issue": shape_issue(issue, settings),
            "subtasks": created,
            "warnings": warnings,
            "created_label": created_label,
        }
```

In `undo`, add `kept_label = None` after `warnings: list[str] = []`, set it from the record after `record = db.get_undo(cid)` and its 409 check:

```python
            kept_label = record.get("created_label")
```

and change the last line to:

```python
        return {"candidate": db.decide(cid, "pending"), "warnings": warnings, "kept_label": kept_label}
```

Change the `undo` docstring's first sentence to: "Put an approved or dropped candidate back in the Inbox, reversing what it did in Linear, except a client label it created:".

- [ ] **Step 5: Run the tests to see them pass**

Run: `uv run pytest -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/todohub/api.py backend/tests/conftest.py backend/tests/test_api.py
git commit -m "Approve creates a new client label before the issue; undo keeps it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: The Inbox

**Files:**
- Modify: `app/src/api.ts` (`Candidate` line 52, `ApproveResult` line 395, `undo` line 582)
- Modify: `app/src/main.ts` (`approve`, `bulk`, `undoDecisions`, `clientSelect`, `candidateCardBody`, `inboxItem`)
- Modify: `app/src/styles.css`

No frontend test suite exists; `npx tsc --noEmit` and the browser check in Step 6 verify this task.

- [ ] **Step 1: Types**

In `app/src/api.ts`, in `Candidate`, after `client_label: string | null;`:

```ts
  /** A client label to create on approve: a customer with no label yet. Never set with client_label. */
  new_client_label: string | null;
```

In `ApproveResult`, after `warnings: string[];`:

```ts
  /** The client label that approve created first, if any. */
  created_label?: string | null;
```

Replace the `undo` line with:

```ts
  undo: (id: number) =>
    call<{ candidate: Candidate; warnings: string[]; kept_label: string | null }>("POST", `/api/candidates/${id}/undo`),
```

- [ ] **Step 2: Approve, bulk and undo messages**

In `app/src/main.ts`, change `approve` to return the created label. Replace its first lines and the result line:

```ts
async function approve(c: Candidate, opts: { quiet?: boolean } = {}): Promise<string | null> {
  const key = `c${c.id}`;
  if (state.busy.has(key)) return null;
```

```ts
    const { candidate, issue, subtasks, warnings, created_label } = await api.approve(c.id, edit);
```

Replace the `extra` line with:

```ts
    const extra = (subtasks.length ? ` with ${subtasks.length} subtask${subtasks.length === 1 ? "" : "s"}` : "")
      + (created_label ? ` and the client label ${created_label}` : "");
```

After `for (const w of warnings) toast(w, undefined, true);`, add:

```ts
    return created_label ?? null;
```

and after the `finally { ... }` block's closing brace, before the function's closing brace, add:

```ts
  return null;
```

In `bulk`, replace:

```ts
  const done: number[] = [];
  for (const c of picked) {
    try {
      if (action === "approve") await approve(c, { quiet: true });
```

with:

```ts
  const done: number[] = [];
  const labels: string[] = [];
  for (const c of picked) {
    try {
      if (action === "approve") {
        const label = await approve(c, { quiet: true });
        if (label) labels.push(label);
      }
```

and replace:

```ts
  const message = `${action === "approve" ? "Approved" : "Dropped"} ${done.length} of ${picked.length}`;
```

with:

```ts
  const message = `${action === "approve" ? "Approved" : "Dropped"} ${done.length} of ${picked.length}`
    + (labels.length ? `. Created the client label${labels.length === 1 ? "" : "s"} ${labels.join(", ")}` : "");
```

In `undoDecisions`, replace:

```ts
  const problems: string[] = [];
  for (const id of ids) {
    try {
      const { warnings } = await api.undo(id);
      problems.push(...warnings);
```

with:

```ts
  const problems: string[] = [];
  const kept: string[] = [];
  for (const id of ids) {
    try {
      const { warnings, kept_label } = await api.undo(id);
      problems.push(...warnings);
      if (kept_label) kept.push(kept_label);
```

and after `for (const w of problems) toast(w, undefined, true);`, add:

```ts
  if (kept.length) toast(`The client label${kept.length === 1 ? "" : "s"} ${kept.join(", ")} stay${kept.length === 1 ? "s" : ""} in Linear.`);
```

- [ ] **Step 3: The select, the box, the button and the chip**

Replace `clientSelect` with:

```ts
/** The select's value for a candidate's proposed new client label (no label name has this character). */
const NEW_CLIENT = "\u0001new";

function clientSelect(value: string | null, onChange: (v: string | null) => void, newName: string | null = null) {
  // A label newer than the loaded list (or none loaded) still shows as the issue's client.
  const known = state.meta?.client_labels ?? [];
  const labels = value && value !== NEW_CLIENT && !known.includes(value) ? [value, ...known] : known;
  return quietSelect(h(
    "select",
    { class: "client", title: "Client label", onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value || null) },
    newName ? h("option", { value: NEW_CLIENT, selected: value === NEW_CLIENT }, `${newName} (new)`) : "",
    h("option", { value: "", selected: !value }, "Dev / internal"),
    ...labels.map((l) => h("option", { value: l, selected: l === value }, l)),
  ));
}

/** A candidate for a customer with no client label: approving creates the label first. */
function newClientBox(name: string): HTMLElement {
  return h("div", { class: "link-box new-client" },
    h("div", { class: "link-head" }, "New client label"),
    h("div", { class: "link-issue" }, h("strong", {}, name), " has no client label in Linear yet."),
    h("div", { class: "link-facts" }, "Approve creates it in the client group, where everyone in the workspace sees it."));
}
```

In `candidateCardBody`, after the `const label = ...` statement, add:

```ts
  // A customer with no client label yet, unless the card picked a label or Dev / internal instead.
  const newClient = showFields && !("client_label" in d) ? c.new_client_label : null;
  const action = newClient ? `${label}, add label` : label;
```

Replace `showFields && subtaskEditor(c, d),` with:

```ts
    showFields && subtaskEditor(c, d),
    newClient && newClientBox(newClient),
```

Replace the client select line:

```ts
      showFields && clientSelect(val("client_label") ?? null, (v) => { d.client_label = v; }),
```

with:

```ts
      showFields && clientSelect(newClient ? NEW_CLIENT : val("client_label") ?? null, (v) => {
        if (v === NEW_CLIENT) delete d.client_label; else d.client_label = v;
        render();          // the box, the button and the list chip follow the pick
      }, c.new_client_label),
```

Replace the primary button:

```ts
      h("button", { class: "primary", disabled: busy, title: "⌘↩", onclick: () => decide(c) },
        busy ? "Working…" : label),
```

with:

```ts
      h("button", {
        class: "primary", disabled: busy, onclick: () => decide(c),
        title: newClient ? `Creates the client label ${newClient} in Linear, then the issue. ⌘↩` : "⌘↩",
      }, busy ? "Working…" : action),
```

In `inboxItem`, after `const client = "client_label" in d ? d.client_label : c.client_label;`, add:

```ts
  const newClient = "client_label" in d ? null : c.new_client_label;
```

and replace:

```ts
  if (client) chips.push(h("span", { class: "ib-chip client" }, client));
```

with:

```ts
  if (newClient) chips.push(h("span", { class: "ib-chip client new" }, `${newClient} (new)`));
  else if (client) chips.push(h("span", { class: "ib-chip client" }, client));
```

- [ ] **Step 4: Styles**

In `app/src/styles.css`, after `.card-actions { ... }` (line 340), add:

```css
.card-actions > button.primary { margin-left: auto; }     /* a wrapped button stays at the right edge */
```

After the `.link-box { ... }` rule (line 641), add:

```css
.link-box.new-client { margin: 10px 0 8px; }
```

After `.ib-chip.client { ... }` (line 1410), add:

```css
.ib-chip.client.new { background: transparent; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, var(--border)); }
```

- [ ] **Step 5: Type check**

Run: `cd app && npx tsc --noEmit`
Expected: no output

- [ ] **Step 6: Check it in a browser (the controller does this step)**

Run the UI with fictional data only: `npx vite --port 1430 --strictPort`, a fake backend that answers `/api/candidates` with one candidate whose `new_client_label` is "Hooli" (and refuses every write), and a `window.__TAURI_INTERNALS__` shim whose `invoke("backend_info")` returns that backend. Check, at a 1120px and a 760px window, in Light and Dark:

- The box shows above the fields, the select shows "Hooli (new)", the list chip shows "Hooli (new)" with an outline.
- At 1120px, "Approve, add label" is on the line of Snooze and Drop.
- Pick "Globex" in the select: the box, the suffix and the outline chip go, and the chip shows "Globex". Pick "Hooli (new)": they come back.
- A candidate with a client label looks as before.

Delete `.playwright-mcp/` after the check.

- [ ] **Step 7: Commit**

```bash
git add app/src/api.ts app/src/main.ts app/src/styles.css
git commit -m "Inbox: show a new client label, and name it on the Approve button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Docs

**Files:**
- Modify: `DESIGN.md` (after "### Linked issue box (Inbox)", and "### Chips")
- Modify: `README.md:27`
- Modify: `PRODUCT.md:41`

- [ ] **Step 1: DESIGN.md**

Before the line `### List items and the reading pane`, add:

```markdown
### New client label box (Inbox)

A card for a customer that has no client label yet. Approving it creates the label first.

- **Box:** the linked issue box's style, above the fields: the heading "New client label", the name at 600 and "has no client label in Linear yet.", then a 12px Pencil line that says everyone in the workspace sees the new label.
- **Select:** the first option is "Hooli (new)". Picking a label or "Dev / internal" removes the box and the suffix.
- **Button:** the primary button's name ends with ", add label" ("Approve, add label"). A primary button that wraps in an Inbox card stays at the right edge.

```

In "### Chips", after the "- **Issue chips:** ..." bullet, add:

```markdown
- **New client chip:** in an Inbox list item, "Hooli (new)": the client chip's accent text, with a 1px accent outline in place of its fill.
```

- [ ] **Step 2: README.md and PRODUCT.md**

In `README.md`, replace:

```markdown
  - a suggested client label, project, priority and due date;
```

with:

```markdown
  - a suggested client label (or, for a customer with no label yet, a new one that Approve creates), project, priority and due date;
```

In `PRODUCT.md`, replace:

```markdown
Block time is the one write that isn't.
```

with:

```markdown
Block time is the one write that isn't, and undoing an approval keeps a client label it created.
```

- [ ] **Step 3: Commit**

```bash
git add DESIGN.md README.md PRODUCT.md
git commit -m "Docs: the new client label box, chip and undo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Final checks

- [ ] **Step 1: All tests and the type check**

Run: `cd backend && uv run pytest -q`
Expected: PASS

Run: `cd app && npx tsc --noEmit`
Expected: no output

- [ ] **Step 2: Scan the branch for work data**

The controller scans every file the branch changed for the employer's name, every client label in the TodoHub settings folder (the `client_labels` list in `todohub.db`, not only `client_domains.json`) and colleagues' names. It fixes any hit before a push.

- [ ] **Step 3: Check the commit trailers**

Run: `git log origin/main..HEAD --format='%h %(trailers:key=Co-Authored-By,valueonly)'`
Expected: every commit shows `Claude Opus 5.5 <noreply@anthropic.com>`

## Assumptions to list in the PR

- HubSpot's `customer` lifecycle stage marks a client.
- The user's Linear API key can create labels in the client label group.
- Linear's `issueLabels` filter by `name` returns the group, and `IssueLabel.isGroup` tells the group from a plain label with the same name.
- With no client label list loaded (a new install, or a workspace without the group), the sweep proposes no new label.
- Label names use `dba`, `(fka …)` and `(…)` for other names.
- The model follows the customers-only rule; Approve is the check.
