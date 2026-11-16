# Pull requests: a # column and groups by client or project

## Goal

- Find a pull request by its number. The number gets its own column, and you can sort by it.
- See your pull requests by client or project. A Client / project column shows the group of each row. The **Group** control splits the table into sections, one for each client or project.

The design came from three prototypes: A (sections in the table), B (a Client / project column) and C (chips that filter). This spec combines A and B.

## Scope

In:

- The **#** column, in Mine and To review.
- The Client / project column, the **Group** control, the **g** key and the sections, in Mine only.
- The README, `DESIGN.md` and `.impeccable/surfaces/app-src-pulls-ts.md`.

Out:

- Groups in To review. On 2026-11-16, none of the 7 pull requests in To review named one of your open Linear issues, so all of them would be in one group.
- A group for each repo. All pull requests with no client or project go in one group.
- Linear issues that are not yours. The group comes from your open issues only, the same list that `linearOf` uses today.
- A filter by client or project name.
- The backend. This change is in the app only.

## Behavior

### The # column

- **#** is the first sortable column, after the chevron column. It is in Mine and in To review.
- A cell shows `#2374`. The `#` is in Pencil and the number is in Ink, at 13 px with tabular figures.
- The first click on the header sorts the newest first (descending). A second click reverses the sort.
- A stack sorts by the lowest number of its pull requests. Its summary row shows that number, in Pencil, because a summary row holds the value that the table sorts the stack by.
- The meta line under a title no longer shows the number. It keeps the repo name, which still shortens when the column is narrow.
- The filter still finds `#2374`.
- The column shows at every window width.

### The group of a pull request

- The Linear issue of a pull request is the one `linearOf` finds today: an ID in the branch name or the title, with a team key that your issues use.
- If that issue is one of your open issues, the group is its client label. If it has no client label, the group is its project.
- Otherwise, the group is **No client or project**. This group also holds the pull requests that name no issue, and those that name a closed issue or another person's issue.
- A stack has the group of its base pull request. A stack never splits.

### The Client / project column (Mine, groups off)

- The column comes after **Pull request**. It is 168 px wide.
- A cell shows the client's logo (`clientLogo`, as in Client and Dev) or the project's initial (`ll-initial`), then the name. The name gets an ellipsis when it is too long. **No client or project** shows "–" as its initial, and its name is in Pencil.
- Each pull request row shows its own group. A stack's summary row shows the stack's group.
- Sorted by this column, the groups are in name order, and **No client or project** comes last. Inside a group, the rows sort by Next step: in every column, rows with the same value sort by Next step. A stack sorts by the group of its base pull request.
- Sorted by this column, a cell shows the name only when it is different from the row above. The first row of each group gets a darker line above it (Pencil 40% into Hairline).
- The first click sorts A to Z.
- Below 1400 px, the column folds to zero width, as Size does below 1000 px. Its cells stay, so the colspans still fit. At the default window (1120 px) the table is 840 px wide, and the fixed columns with **#** take 690 px, so there is no room for this column. The groups work at every width.

### Groups (Mine only)

- The **Group** control is in the header line, before **Refresh all**. It shows only in Mine. It is the `.segmented` control: **None** and **Client or project**, each a button with `aria-pressed`.
- **g** turns the groups on and off in Mine. In To review, **g** does nothing.
- Below 1000 px, the "Group" label hides, **Refresh all** shows only its icon, and the filter can shrink to 120 px, so the header line fits from 760 px.
- The app remembers the choice on this Mac, in `todohub.pullsGroups`. The default is off.
- When the groups are on:
  - The Client / project column hides, because each section heading names the group. The title gets the width back.
  - Each group with a pull request in the view gets a section: a `tbody` whose first row is the heading.
  - The heading is the heading of Client and Dev: the client logo or the project initial, the name in bold, a summary and a rule. The summary counts the pull requests that the section shows, not the grey ones that are there only for their stack: "5 open · 2 need you · 1 CI failing". A part with 0 does not show, and 1 gives "1 needs you".
  - The rows in each section sort by the column you pick. The sections come in the order of their first row, so the section with the most urgent pull request comes first when you sort by Next step. **No client or project** always comes last.
  - A click on a heading folds its section to the heading, and another click unfolds it. A folded section stays folded until the app restarts, as a folded stack does. The heading button has `aria-expanded`.
  - If the selected row is in the section that you fold, the selection moves to the next row after the section, else to the row before it, as when you fold a stack.
  - In a stack, a pull request whose own group is not the stack's group names its group in its meta line, after the Linear issue chip. On 2026-11-16, 2 of your 3 stacks had one such pull request.
  - The drafts that are not in a stack stay in the **N drafts** fold at the bottom, outside the sections.
- If you turn on the groups while the table sorts by Client / project, the sort changes to Next step.
- **j** and **k** move through the rows as they show: section by section, and they skip folded sections. When the selection is not on the page, the first row shown is selected.

### Keys and the hint line

- The shortcuts sheet (**?**) gets a row: **g**, "Pull requests (Mine): group by client or project".
- The hint line under the Mine table adds "**g** groups".

## Changes

**`app/src/dom.ts`**

- `loadPref` and `savePref` move here from `main.ts` and `insights.ts`, which each have a copy. `main.ts`, `insights.ts` and `pulls.ts` import them.

**`app/src/pulls.ts`**

- `COLS` gets `number` (first) and `group` (after `title`). The `group` column shows only in Mine when the groups are off. The table draws the visible columns, and the colspans of the detail row and the drafts fold count them. Today these are the fixed numbers 7 and 8.
- `units()`: rows with the same value sort by Next step.
- `groupOf(p)`: the client label, else the project, of the issue from `linearOf`, else `null` for **No client or project**. It is the one way to ask for the group of a pull request. The stack's group is `groupOf(u.all[0])`.
- `metaLine` drops the number. It names the group of a stack member whose group is not the stack's, when the groups are on.
- `stackRow` gets the **#** cell, and the Client / project cell when the column shows.
- `st` gets `grouped` (from `loadPref`) and `foldedSections` (a `Set`, like `foldedStacks`).
- `table()` draws one `tbody` for each section when the groups are on. `panel()` builds the selection order from the sections as they show.
- `head()` adds the **Group** control in Mine. `pullsKey` handles **g**.
- `onClick` handles the **Group** buttons and the section headings.

**`app/src/styles.css`**

- Widths for `th.c-num` (64 px) and `th.c-grp` (168 px). The Client / project column folds below 1400 px.
- The section heading row reuses `.ll-name`, `.ll-sum`, `.ll-rule` and `.ll-initial`.
- The darker line at the start of each group when the table sorts by Client / project.
- The meta line's repo name: the `row-reverse` layout for "repo #n" goes away. The name only gets an ellipsis.
- Remove the `.toolbar` rules. Nothing in the app uses them since Client and Dev moved their views to page tabs.

**`app/src/main.ts`**

- The **g** row in the shortcuts sheet.
- Import `loadPref` and `savePref` from `dom.ts`.

**Docs**

- `README.md`, under **Pull requests**: the **#** column, the Client / project column, **Group** and **g**.
- `DESIGN.md`: a "Groups (Pull requests)" section, and the **#** cell of the stack summary row.
- `.impeccable/surfaces/app-src-pulls-ts.md`: the decisions in this spec, under "Decided with Thibault".

## Checks

- `npx tsc --noEmit` in `app/`.
- `uv run pytest -q` in `backend/`. Nothing there changes, so it must still pass.
- A browser check with a scratch copy of the settings folder and the real GitHub and Linear data, with every write blocked (see the "UI check without the real app" notes). Check:
  - Sort by **#** in Mine and To review, both directions, with a stack in the list.
  - Sort by Client / project: the names show only where they change, and the darker lines.
  - Groups on and off with the control and with **g**, and after a restart of the page (the choice is remembered).
  - Fold and unfold a section with the selected row in it. **j** and **k** skip the folded section.
  - A stack with a member in another group: the member names its group in the meta line.
  - Open a row in every mode: the detail row spans the whole table.
  - A window under 1400 px: the Client / project column folds away. At 1120 px and at 760 px, the header line fits.
  - Light and dark themes.

## Assumptions

- A stack's members are mostly in the group of its base. On 2026-11-16, 2 of 3 stacks had one member in another project. The meta line names that project, so the pull request is still easy to find.
- Most of your pull requests that name a Linear issue have a project, and few have a client label: on 2026-11-16, 20 and 2 of 22. So most groups will be projects.
- About 4 in 10 of your pull requests name no Linear issue (15 of 37 on 2026-11-16), so **No client or project** will often be the biggest section. It is last, and you can fold it.
