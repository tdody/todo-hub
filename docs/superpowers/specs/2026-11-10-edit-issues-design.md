# Edit issues from TodoHub

## Goal

Thibault can change an existing issue without opening Linear: rename it, rewrite its description, move it to another client or project, add or tick off sub-issues, and post a comment. Status, priority and due date are already editable; this adds the rest of what he changes day to day.

## Scope

In:

1. **Title** and **description**.
2. **Client** (the label in the client label group) and **project**.
3. **Sub-issues:** list all of them, add one, tick one off.
4. **Comments:** post one.

Out:

- Assignee, estimate, and labels other than the client label.
- Editing or deleting existing comments (only the comment just posted can be deleted, by undo).
- Attachments and links.
- Detecting that someone else edited the issue while it was open here.
- Inbox candidates: they already have their own editing.

## Where

Today's focus pane and the Client/Dev reading pane share one pane body, so editing works the same in both. Today's pane gains the sub-issues section it doesn't have now.

```
ENG-123 ↗ · Globex · pushed 2×
Fix the lead export                          ← e, or click: rename
[In Progress] [High] [Due Thu] [Globex ▾] [Q4 data ▾]   [Block time] ⋯

Description                                  ← ⇧E, or click: edit
The export drops rows when…

Sub-issues · 2
 ☐ ENG-124 Check the CSV          Todo
 ☑ ENG-125 Rerun the job          Done
 + Add sub-issue                             ← ⇧S

Comments · 3
 [ Comment…                          ] ⌘↵    ← ⇧C
 Sam · 2h   Looks like the date filter…
```

## Behavior

Editing is inline: fields edit in place and save when you leave them, like the status and priority pills.

**Title.** Click it or press **e** (the same key as in Inbox). It becomes a text box in the same type, capped at 200 characters. Enter or leaving the field saves; Esc cancels. An empty title reverts.

**Client and project.** Two pills in the fields row, after the due date, using Inbox's client and project selects. "No client" makes it a Dev issue. The row wraps in a narrow window.

- In Client or Dev, an issue that changes list leaves the list, the next row is selected, and the toast says so ("ENG-123 moved to Dev").
- On Today, it moves between the Client and Dev sections and stays selected.

**Description.** Click it (anywhere but a link or image) or press **⇧E**. It becomes an auto-growing text box with the raw Markdown, which is what Linear stores. Leaving the field, ⌘↵ or Esc all save, so a long edit is never thrown away. An empty description shows "Add a description". A description over 6,000 characters (the pane only loads that much) isn't editable here and shows "Edit in Linear ↗".

**Sub-issues.** All of the issue's sub-issues, done ones and other people's included, read from Linear with the preview. Each has a checkbox: ticking marks it done (the `done_state` setting), unticking puts it back in Todo (`todo_state`). A sub-issue in another team shows its status without a checkbox, since the app only knows its own team's statuses. "Add sub-issue" (or **⇧S**) opens a text box; Enter creates it and leaves the box open for the next.

**Comments.** A comment box above the latest comments. **⇧C** focuses it, **⌘↵** posts it as you. It counts down near 2,000 characters and won't post past that.

**Keys.** e, ⇧E, ⇧S and ⇧C act only when no field has focus, and they're listed on the **?** sheet.

**Undo.** Every save shows the usual toast; ⌘Z undoes it for 10 minutes:

| Save | Undo |
| --- | --- |
| Title, description, client, project | Puts the old value back |
| Comment | Deletes it |
| New sub-issue | Deletes it (to Linear's trash) |
| Tick or untick | Puts the sub-issue's old status back |

While typing in a field, ⌘Z undoes the typing, as it does now.

## Backend

The UI sends names and text. Linear's ids and label groups stay in `api.py` and `linear.py`, so another ticket app can take Linear's place later.

| Endpoint | Change |
| --- | --- |
| `PATCH /api/issues/{id}` | Adds `title` (1–200 characters), `description` (empty clears it), `client` (a client label name, or null for Dev), `project` (a project name, or null). |
| `GET /api/issues/{ident}/preview` | Adds `sub_issues`: the issue's children (up to 50), each shaped like an issue plus its assignee and team id. |
| `POST /api/issues/{id}/comments` | New. `{body}`, 1–2,000 characters. Returns `{id}`. |
| `DELETE /api/comments/{id}` | New. Deletes a comment (for undo). |
| `POST /api/issues/{id}/sub-issues` | New. `{title}`. Returns the new issue. |

**Client change.** Reads the issue's labels, then updates it with `removedLabelIds` (its labels in the client label group) and `addedLabelIds` (the new client's label). Other labels are untouched. Client and project names are looked up in the cached team metadata; an unknown name is a 400 that names it.

**New sub-issue.** Created the way Inbox creates sub-tasks: your team, assigned to you, in Todo, with the parent's client label, project and priority, and the description "Part of ENG-123: Fix the lead export". The app adds it to its open issues, so the lists show it at once.

**Ticks** use the existing `PATCH` with a status id from the team metadata.

## Data flow in the app

- Title, client and project saves replace the issue in memory with the `PATCH` response; the lists re-sort from its `client` and `list`.
- Description, comment and sub-issue saves reload the issue's preview in the background. The pane keeps showing what it has while it reloads.
- The undo for a description edit uses the preview text loaded before the edit.
- A background reload never replaces a block holding the focused field; it's applied when you leave the field. (The minute refresh already waits like this.)

## Errors and edge cases

- **A save fails** (Linear refuses it, offline, issue deleted in Linear). The toast names the problem. Nothing typed is lost: a failed description reopens its edit box with your text, and the comment and sub-issue boxes keep theirs. A title or pill goes back to its old value.
- **Clicking another row while editing** saves the field, then moves.
- **One request per save.** A field is disabled while its save is in flight.
- **Safety.** Editors are plain text fields; saved text is still shown through the Markdown renderer, so no HTML is built from data. Every write to Linear follows an action of yours: Enter, ⌘↵, a pick, a tick, or leaving a field you changed.

## Assumptions

- **Last write wins.** If someone edits the description in Linear while it's open here, saving overwrites their edit, and undo only restores the text the pane had loaded. Thibault's issues are mostly his own.
- **Moving an issue off a completed or canceled project can't be undone:** the team metadata only lists open projects, so the old name isn't found.
- **A title over 200 characters already in Linear** can't be put back by undo after a rename (the limit is the one Inbox uses).

## Testing

- **Backend (pytest, with the existing Linear mock):** title and description saves; a client change keeps other labels; moving to Dev; unknown client; set, clear and unknown project; posting and deleting a comment; a new sub-issue gets the parent's client, project and priority; the preview's `sub_issues`.
- **Frontend:** tsc and the Vite build pass. In the preview harness, against the mock backend with the new endpoints added: each edit and its ⌘Z on Today and on Client/Dev, at 1120 and 800 wide, in a light and a dark theme, with no console errors. The Impeccable detector runs on the changed UI files; the work follows DESIGN.md and Today's surface brief.

## Docs

- README: the reading pane and Today bullets.
- The **?** sheet: e, ⇧E, ⇧S, ⇧C.
- DESIGN.md: only if the inline editor needs its own component entry.
