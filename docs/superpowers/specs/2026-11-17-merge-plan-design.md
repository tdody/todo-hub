# A clear choice, and a visible plan, when an Inbox card links to an open issue

## Goal

When the sweep links a card to one of your open issues (`possible_duplicate`), the card asks one question: Merge, Create new or Drop. Claude's recommendation is picked first. The card then shows what that choice will do, and one button does it. For Merge, you see each change to the open issue before it happens, and you can move its due date and raise its priority.

## What happens today

- The duplicate panel has 3 buttons (Drop as duplicate, Merge into ENG-412, Create new). The card footer has Snooze ▾, Drop ▾ and Approve. Two buttons have the accent fill.
- Approve, **a** and ⌘↩ create a new issue, also when the panel recommends Merge. Create new and Approve do the same thing.
- The client, project, priority and due date fields stay on screen for a merge, but a merge ignores most of them.
- What Merge does (a comment, the links, the subtasks as sub-issues) is only in a tooltip. ENG-412 is behind "Show ENG-412".
- The panel says "Possible duplicate". In the local history (2026-11-17), 45 of 220 cards had a link: 31 were merged, 9 became new issues and 5 were dropped (3 as duplicates). When Claude recommended Merge, the card was merged 26 times out of 27.
- Bulk Approve creates a new issue for every selected card, linked or not.

## Scope

In: Task and Waiting cards with `possible_duplicate` set, in the Inbox pane; the merge endpoint and its Undo; bulk Approve; the shortcuts sheet; README, PRODUCT.md and DESIGN.md.

Out: how the sweep picks the link and the advice (`duplicate_advice`, `duplicate_reason`); Close and Update cards; the "Looks handled in Linear" panel; the Inbox list chip ("Same as", "Adds to", "Related to ENG-412"), which stays as it is.

## Behavior

### The box

The box replaces the duplicate panel, in the same place (after the why and the quote).

- **Heading:** the chip's words for Claude's advice: "Adds to an open issue" (merge), "Same as an open issue" (drop), "Related to an open issue" (new).
- **The issue:** the identifier (a link) and the title, then the status pill, the priority pill and the due date. These come from the issue list (`state.issues`). When the issue is not in the list, the box loads the issue preview that exists today, and shows "Loading…" until it comes.
- **Show description and comments:** folds the preview that exists today (description and the latest 3 comments).
- **The switch:** the `.segmented` control of the Pull requests **Group** control, with 3 parts: **Merge**, **Create new**, **Drop**. Claude's advice is picked first (Merge when there is no advice) and has a small dot. The pick stays for each card until the app restarts.
- **The reason:** one line under the switch: "Claude recommends Merge: same deck; this adds the churn numbers." (the advice and `duplicate_reason`).

### Below the box, for each pick

**Merge**

- The title shows as plain text. The client, project, priority and due date fields do not show.
- Under the heading "Merge will change ENG-412":
  - **Post this comment:** the comment, drawn by the Markdown renderer. **Edit** turns it into a text box (at most 4,000 characters). The text is kept in the card's draft (`comment`). An empty box, or a cleared draft, gives the default again.
  - **☑ Move the due date Nov 28 → Nov 20:** shows only when the card has a due date and the issue has none or a later one. Ticked at first.
  - **☑ Raise the priority Medium → High:** shows only when the card has a priority (1–4) and the issue has none (0) or a lower one (a larger number). Ticked at first.
  - **Add N sub-issues:** the subtask editor that exists today. It does not show when the card has no subtasks.
  - **Attach N links:** the source link and the card's links. Links already on the issue are not attached again (as today).
- The main button: **Merge into ENG-412**.
- The 2 boxes keep their state for each card, with the pick.

The default comment is the text today's `merge_text` writes, without its last 2 lines, built from what the card shows (so a title edit shows in it):

```
**More from Slack · Sam Lee:** Add the Q4 churn numbers to the Globex deck

Sam asked for churn by segment before Thursday's review.

> Can you drop the Q4 churn by segment into the deck before Thursday?

**Due:** 2026-11-20
```

**Create new:** the card as today: the title box, the fields and the subtask editor. The main button: **Create issue** (**Track** for a Waiting card).

**Drop:** as for Merge, the title shows as plain text and the fields do not show. The 5 drop reasons show as a radio list, with **Duplicate** picked. The number keys 1–5 pick a reason. The main button: **Drop**. "Drop and mute …" is not in the list; the mute offer after a drop shows as today.

### The footer

- **Snooze ▾** and the main button. Linked cards have no **Drop ▾** menu.
- The duplicate panel's accent button goes away, so the main button is the only action button in the box and the footer with the accent fill. (The picked part of the switch also has it, as in the Group control.)

### Keys

- **⌘↩** and **a**: press the main button. Today ⌘↩ works only in the title box; it now works from anywhere in the Inbox, except in the draft reply.
- **m**: selects Merge and shows its plan. With Merge already selected, it merges.
- **d**: pick Drop.
- In the shortcuts sheet: **m** "Merge into the linked issue"; **d** "Drop (on a linked card: pick Drop)".

### After a merge

- The toast names what changed: "Merged into ENG-412: comment, 2 sub-issues, due Nov 20, High priority". It leaves out what did not happen. **Undo** and **Open** stay.
- The app puts the issue the merge returns into `state.issues`, so its new date and priority show at once.

### Bulk Approve

- Bulk Approve leaves out the selected Task and Waiting cards that have `possible_duplicate`.
- The bar counts only the others ("Approve 3"), and a note says "2 linked cards left out". When every selected card is linked, the Approve button does not show and the note says "Decide linked cards one at a time".
- Bulk Drop is the same as today.

## Changes

**`backend/src/todohub/api.py`**

- New request body `MergeIn(CandidateEdit)` with `move_due_date: bool = False` and `raise_priority: bool = False`. `POST /api/candidates/{id}/merge` takes it in place of `CandidateEdit`. The edit fields are saved first, as today.
- The merge needs a comment: when the saved candidate has no `comment`, the endpoint answers 400 "A merge needs a comment". The app always sends one.
- `CandidateEdit.comment` allows 4000 characters in place of 2000 (as `reply_draft`). The default comment can be about 2,300 characters: a 200-character title, a 1,000-character why and a 1,000-character quote (`tools.MAX_TEXT`), with the labels and the `> ` marks.
- `merge_text` goes away. The posted comment is `comment`, then `source_line(c)`, then `_Merged from TodoHub._`, as `act_on_issue` does for Update cards.
- `merge_claimed`, in this order:
  1. Get the issue and post the comment. If this fails: 502, nothing changed (as today).
  2. Mark the card approved and write the undo record (as today).
  3. When `move_due_date` or `raise_priority` is set, and the card's value is still sooner (due date) or higher (priority) than the issue just read: one `update_issue` call with `dueDate` (the card's `due_date`) and/or `priority` (the card's `priority`). Before the call, the undo record gets `restore` with the issue's old values. If the call fails, `restore` is removed and a warning says "ENG-412's due date and priority were not changed: …". The returned issue replaces the one from step 1.
  4. Links and sub-issues, as today.
- `act_on_issue` (Close) writes `restore: {"stateId": …}` in place of `state_id`.
- `undo` reads `restore`: one `update_issue(record["issue"], record["restore"])`, then removes the key. The `state_id` branch goes away.

**`app/src/api.ts`:** `merge(id, edit, opts)` sends `{...edit, move_due_date, raise_priority}`.

**`app/src/main.ts`**

- `duplicatePanel` becomes the box above. The plan, the drop reasons and the footer follow the pick.
- A per-card map of the pick and the 2 boxes (like `openPreviews`), and one function that does the pick (merge, approve, or drop with the picked reason). The main button, **a** and ⌘↩ call it.
- `mergeComment(c, draft)` builds the default comment.
- `merge` sends the comment and the 2 boxes, updates `state.issues` with the returned issue, and writes the new toast.
- `bulkBar` and `bulk("approve")` leave out linked cards.
- The shortcuts sheet text for **m** and **d**.

**`app/src/styles.css`:** styles for the box, the plan list and the old → new values. The switch uses `.segmented`. The `.dup-actions` and `.dup-advice` rules go away.

**Docs**

- README: rewrite "Possible duplicates" for the switch, the plan, the 2 boxes, Undo and bulk Approve.
- PRODUCT.md, Terminology: "possible duplicate (Drop as duplicate / Merge into / Create new)" becomes "linked issue: Same as / Adds to / Related to (Merge, Create new, Drop)".
- DESIGN.md: a "Linked issue box" part under "Cards (Inbox)".

## Errors

- The comment fails: 502 and the card stays in the Inbox, as today.
- The date and priority update fails: the merge stays, with a warning toast. Undo still removes the comment, links and sub-issues.
- The issue preview fails to load (the issue is not in `state.issues`): the box says "Couldn't load ENG-412: …" as today. The 2 boxes do not show, because the old values are not known. Merge still works.
- Undo of the date and priority fails: 502 "Couldn't undo in Linear: … Try again." The `restore` key stays for the retry, as `state_id` does today.

## Testing

**Backend (pytest, `backend/tests/test_api.py`)**

- The 3 merge tests send a `comment`, and check that the posted body is the comment, the source line and the footer.
- A merge with no comment gets 400. A 2,300-character comment is accepted.
- `move_due_date` and `raise_priority` send one `update_issue` with `dueDate` and `priority`; Undo sends the old values back.
- Only `move_due_date`: the update has only `dueDate`.
- The update fails: the merge is approved, a warning comes back, and the undo record has no `restore`.
- Close, then Undo: the old status comes back through `restore`.

**App**

- `npx tsc --noEmit` passes.
- A browser check on a copy of the settings folder, with every write to the backend blocked (see the project's UI-check notes): a card for each advice; switch the pick; edit the comment; untick a box; the main button label for each pick; **a**, **m**, **d**; bulk Approve with linked cards selected. At 1120 px and at 760 px wide, in Light and Dark.

## Assumptions

- **The linked issue is usually in `state.issues`.** The sweep may link only one of your open issues (`tools.py` drops other links). On the Inbox tab the app does not reload the issue list every minute, so its copy can be old: the box can show an old status, due date or priority. The backend checks again before it changes the due date or the priority. When the issue is not in the list, the box falls back to the preview.
- **The 2 boxes are worked out again when you press Merge.** If the issue's preview arrives while you type in the comment, a box can be sent ticked without being shown. The backend's check limits this to a sooner date or a higher priority.
- **A lost answer from Linear on the field update** removes `restore`. If Linear made the change but its answer was lost, Undo does not put the old due date and priority back.
- **Linear priority numbers:** 1 Urgent, 2 High, 3 Medium, 4 Low, 0 none. "Higher" means a smaller number that is not 0.
- **Undo records with `state_id` are not read after this change.** The app offers Undo for 10 minutes, so only a Close made in the 10 minutes before the update is affected.
- **The pick is not saved.** It goes back to Claude's advice when the app restarts.
- **Bulk Approve leaving linked cards out** is the wanted behavior, also when Claude recommends Create new for them.
