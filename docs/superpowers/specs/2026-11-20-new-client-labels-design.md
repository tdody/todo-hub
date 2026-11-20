# New client labels from the sweep

## Goal

When a sweep or a capture finds a task for a customer that has no client label in Linear, the candidate proposes a new client label. Approve creates the label in the client label group, then the issue with it. Today the client stays empty and nothing says why, so the issue goes to the Dev list.

## What happened (2026-11-20)

A sweep read a HubSpot note about a task for a customer. The customer had no label in the client label group, so the sweep left `client_label` empty, as the prompt tells it to. The issue went to the Dev list.

- The prompt says: "use exactly one name from this list … Otherwise leave it empty". `add_candidate` also drops an unknown name with the note "left empty".
- The Inbox could not fix it either: `PATCH /api/candidates/{id}` refuses a name that is not in the label list.
- In 2.5 weeks, about 15 approved candidates were for three customers with no label. They became 7 issues, because several candidates were merged. All 7 went to the Dev list. The balance pill, the weekly digest and the client summaries counted them as dev work.
- The client label group is shared by the whole workspace. A label that TodoHub creates shows for everyone, and teammates who install TodoHub create labels too.

## Scope

In: sweeps and captures propose a new client label for a customer. The Inbox shows it. Approve ("Create new") creates it.

Out:

- **New projects.** A Linear project needs a lead, a team and a status, and a new client needs a label first.
- **Older issues.** No backfill. The 7 issues of 2026-11-20 were fixed by hand.
- **Typing a name in the Inbox.** The client field stays a select. To change a new label's name, rename it in Linear.
- **Initials.** The near-match check does not match "ABC" to "Acme Bolt Company".
- **Logos.** A new label gets no entry in `client_domains.json`.
- **Merge.** Merge does not create a label (see Approve).

## Behavior

### The sweep and the capture

The `client_label` rule in `sweep_prompt.md` and `capture_prompt.md` changes:

- Use a name from the label list when one matches the company or its people.
- If the task is for a customer with no label, give the customer's company name:
  - With HubSpot tools: search `COMPANY` by name. Give the company's `name` only when its `lifecyclestage` is `customer`. Otherwise leave the client empty: prospects and partners get no label.
  - Without HubSpot tools: give the company's full name from the message, not initials.
- Otherwise leave it empty (development or internal work).

`sweep.py` writes this rule once, as `$client_rule`, from `settings.hubspot_tools`. Both prompts use it.

### `add_candidate`

For a `client_label` that is given:

1. It is a label, case not important: the candidate gets that label in `client_label`, as today.
2. It is a near-match of a label: the candidate gets that label in `client_label`. The note says "client_label 'Globex Inc.' matched the label 'Globex'".
3. There is no match: the candidate keeps the name in `new_client_label`. The note says "client_label 'Hooli' is not a label yet; proposed as a new client label".

A candidate has a `client_label` or a `new_client_label`, never both.

### The near-match check

`matching_client_label(name, labels) -> str | None` in `linear.py`, next to `client_label_of`. It returns the label that `name` names, or `None`. The tool and approve use it.

- **Normalize** both sides: lowercase, split into words, drop a last word that is a legal suffix (`inc`, `llc`, `co`, `corp`, `corporation`, `ltd`, `company`), then keep only letters and digits. So "Pied-Piper" matches "PiedPiper", "Globex, Inc." matches "Globex", and "Zinc" stays "zinc".
- **Other names.** A label also matches by each of its other names:
  - "Initech dba Initrode": "Initech" and "Initrode" (any case of `dba`).
  - "Hooli (fka Nucleus)": "Hooli" and "Nucleus".
  - "Globex (Cypress)": "Globex" and "Cypress".
- **No partial match.** "Globex" does not match "Globex Mining". If two labels match, the result is `None`, and the name stays new.

### The Inbox

When a candidate has a `new_client_label`, and the card's action creates an issue:

- **Box.** Above the fields, a box with the linked issue box's style (`link-box`): the heading "New client label", then "**Hooli** has no client label in Linear yet.", then, in 12px Pencil, "Approve creates it in the client group, where everyone in the workspace sees it."
- **Select.** The client select's first option is "Hooli (new)", selected. Pick a label, and the new name, the box and the button suffix go. Pick "Dev / internal", and both fields go. Pick "Hooli (new)" again, and the card drops its client change.
- **Button.** The primary button's name gets ", add label": "Approve, add label", "Track, add label", or "Create issue, add label" on a linked card. Its tooltip says "Creates the client label Hooli in Linear, then the issue. ⌘↩". When the row wraps, the button stays at the right edge. In the default 1120px window, Snooze and Drop leave 160px, and "Approve, add label" takes 156px, so it fits on their line.
- **List.** The item shows the chip "Hooli (new)" in place of the client chip: the client chip's accent text, with a 1px accent outline in place of the fill.

While a merge or drop plan is open, the box and the suffix do not show, because merge creates no label.
- **Edit API.** `CandidateEdit` does not change: the Inbox never sends a new name. An edit that sets `client_label`, to a label or to `null`, also clears `new_client_label`. `client_label` keeps its check: it must be a label.

### Approve ("Create new")

When the candidate has a `new_client_label`, `approve_claimed`:

1. Reads the labels from Linear again (`team_meta(refresh=True)`) and runs the near-match check. If a label matches now, for example from an earlier candidate in the same bulk approve, it uses that label.
2. If not, it creates the label in the client label group, with the group's color and team (none for a workspace group).
3. Creates the issue and its subtasks with the label, as today.
4. Saves the name in `client_label`, clears `new_client_label` and reads the labels again, so the lists and the next sweep know the label.

The response gains `created_label` (the name, or `null`). One approve says "Created the client label Hooli." Bulk approve adds the names of the labels it created to its "Approved N of M" message.

**Merge** adds to an issue that already exists, so it creates no label. Subtasks from a merge get a client label only if `client_label` is set, as today.

### Undo

Undo sends the issue to Linear's trash, as today, and keeps the label. The candidate goes back to the Inbox with the label in `client_label`, so another approve uses it. The approve's undo record holds `created_label`. The undo response gains `kept_label`, and the undo message adds: "The client label Hooli stays in Linear."

`PRODUCT.md`: "Block time is the one write that isn't" becomes "Block time and a new client label are the writes that undo leaves".

## Changes

**`backend/src/todohub/linear.py`**

- `TeamMeta` gains `client_group: dict | None`: `{id, color, team_id}` of the label named `client_label_group` that has `isGroup` true. `team_meta` reads it with the labels.
- `create_client_label(name, group) -> dict`: `issueLabelCreate` with `name`, `parentId`, `color` and `teamId` when the group has one. Raises `LinearError` if Linear refuses.
- `matching_client_label(name, labels)`.

**`backend/src/todohub/db.py`**: the column `new_client_label TEXT`, added in the migrations and in the candidate fields. It is not in `EDITABLE_FIELDS`.

**`backend/src/todohub/tools.py`**: `add_candidate` as above. **`mcp_server.py`**: the `client_label` docstring says that a customer with no label gets its company name.

**`backend/src/todohub/sweep.py`**, **`sweep_prompt.md`**, **`capture_prompt.md`**: `$client_rule`.

**`backend/src/todohub/api.py`**: `edit_candidate`, `approve_claimed` and `undo` as above.

**`app/src/api.ts`**, **`app/src/main.ts`** and **`app/src/styles.css`**: the `Candidate` type, `clientSelect` (an optional new name), the box, the button suffix, the list chip, and the approve, bulk and undo messages.

**`DESIGN.md`**: under "Linked issue box (Inbox)", the new client label box and the button suffix; under "Chips", the outlined client chip.

**`README.md`**: the line "a suggested client label, project, priority and due date" adds "or a new client label, created when you approve".

## Errors

- **Linear refuses the label** (no permission, or no group named `client_label_group`): approve stops before it creates the issue. The candidate stays in the Inbox, and the message says "Couldn't create the client label Hooli: <reason>".
- **Linear creates the label, then refuses the issue:** the label stays. The next approve finds it in step 1.
- **Two candidates for the same customer in one bulk approve:** the second one finds the first one's label in step 1.

## Testing

- `matching_client_label`: case and punctuation ("Pied-Piper" and "PiedPiper"); suffixes ("Globex, Inc.", and "Zinc" keeps its "inc"); `dba`, `(fka …)` and `(…)` names; no partial match ("Globex Mining"); no initials; two matches give `None`.
- `add_candidate`: a label, a near-match and a new name, with their notes.
- `PATCH /api/candidates/{id}`: setting `client_label` to a label or to `null` clears `new_client_label`; an unknown `client_label` is still refused.
- Approve, with a fake Linear: the label is created and set on the issue and its subtasks; a label made in the meantime is used and nothing is created; a refused label leaves the candidate pending and creates no issue.
- Two approves in a row for the same new name create one label.
- Undo after an approve that created a label: the issue is deleted, the label is not, and the response names the label.
- `$client_rule`: the HubSpot text with `hubspot_tools`, the message text without.
- The Inbox, in the app at 1120px and 760px, in Light and Dark: the box, "Hooli (new)" in the select, "Approve, add label" on the line of Snooze and Drop at 1120px, and the chip. Pick a label: the box and the suffix go.

## Assumptions

- **HubSpot's `customer` lifecycle stage marks a client.** A customer whose stage is wrong in HubSpot gets no proposal. You can still approve with "Dev / internal" and set the label in Linear.
- **The user's Linear API key can create labels in the client label group.** It can for the first user on 2026-11-20. A workspace that limits labels to admins gets the error above.
- **Linear's `issueLabelCreate` takes a `parentId`, and a child label must have the group's team.** The three labels of 2026-11-20 were created this way in a workspace group.
- **Label names use `dba`, `(fka …)` and `(…)` for other names.** These are the patterns in the current label list. Other patterns get no near-match, and you see the new name before you approve.
- **The model follows the customers-only rule.** It cannot be checked in code. You confirm each new label with Approve.
