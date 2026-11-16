# Pull requests: # column and groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Pull requests tab gets a sortable **#** column (Mine and To review), and Mine gets a Client / project column and a **Group** control (or **g**) that splits the table into one section for each client or project.

**Architecture:** All changes are in the app. `pulls.ts` gets two columns in `COLS`, one function that gives the group of a pull request (`groupOf`), a row builder that draws the Client / project cells, and a sections mode for the table body. The saved-preference helpers move to `dom.ts`, so `pulls.ts` can remember the Group choice. The backend does not change.

**Tech Stack:** TypeScript with the app's `h()` DOM helper, Vite, Tauri. The app has no frontend unit tests: `npx tsc --noEmit` and a browser check with real data are the tests.

**Spec:** `docs/superpowers/specs/2026-11-16-pulls-number-and-groups-design.md`.

Review fixes changed the code of Tasks 3 and 4 after this plan was written. Task 3: the darker line, the names under a stack member, the sort key, one sort value per unit. Task 4: the header line below 1000 px, the section class names (`sec-h`, `sec-b`), `foldedSections`, one sections list per paint. After the browser check, Size folds below 1200 px. The code is the source of truth.

**Worktree:** `/Users/thibaultdody/dev/worktrees/todo-hub/main`, branch `pulls-number-and-groups`. Run every command from there.

---

## Conventions

**No private data.** Nothing about work clients goes in this repo. Examples use Globex, Initech & Co, `ENG-123`, `acme/api`. Before every commit, run the privacy scan on the staged files:

```bash
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
```

Expected: `clean`. Its docstring lists the known false positives. Fix any other hit before the commit.

**Commit messages** name the area first, as the log does: `App: …`, `README, DESIGN: …`. End each with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Edits** below are "Find … Replace with …" pairs. Each "Find" block is unique in its file.

---

## File map

| File | Change |
|---|---|
| `app/src/dom.ts` | `loadPref`, `savePref` (moved here). |
| `app/src/main.ts` | Imports the two helpers; the **g** row in the shortcuts sheet. |
| `app/src/insights.ts` | Imports the two helpers. |
| `app/src/pulls.ts` | The **#** and Client / project columns, `groupOf`, the row builder, the sections, the Group control, **g**. |
| `app/src/styles.css` | Column widths, the group cell, the sections, the Group control; the `.toolbar` rules go. |
| `README.md`, `DESIGN.md`, `.impeccable/surfaces/app-src-pulls-ts.md` | Docs. |

---

### Task 0: Check the baseline

- [ ] **Step 1: Type-check the app and run the backend tests**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npx tsc --noEmit && echo TSC OK
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/backend && uv run pytest -q 2>&1 | tail -2
```

Expected: `TSC OK`, and pytest ends with `N passed`. If either fails before any change, stop and report it.

---

### Task 1: One copy of `loadPref` and `savePref`, in `dom.ts`

`main.ts` and `insights.ts` each have a copy. `pulls.ts` needs them too.

**Files:**
- Modify: `app/src/dom.ts` (end of file)
- Modify: `app/src/main.ts:3`, `app/src/main.ts:93-104`
- Modify: `app/src/insights.ts:5-14`

- [ ] **Step 1: Add the helpers at the end of `app/src/dom.ts`**

Append:

```ts

/** Per-machine UI choices. Storage can be unavailable; the app then uses the defaults. */
export function loadPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* not remembered */ }
}
```

- [ ] **Step 2: Use them in `app/src/main.ts`**

Find:

```ts
import { h, link, modal, pageHead, svg } from "./dom";
```

Replace with:

```ts
import { h, link, loadPref, modal, pageHead, savePref, svg } from "./dom";
```

Find:

```ts
/** Per-machine UI choices. Storage can be unavailable; the app then just uses the defaults. */
function loadPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
/** "board" is the old name for the by-status layout. */
function layoutPref(key: string): "group" | "status" {
  const v = loadPref(key);
  return v === "status" || v === "board" ? "status" : "group";
}
function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* not remembered */ }
}
```

Replace with:

```ts
/** "board" is the old name for the by-status layout. */
function layoutPref(key: string): "group" | "status" {
  const v = loadPref(key);
  return v === "status" || v === "board" ? "status" : "group";
}
```

- [ ] **Step 3: Use them in `app/src/insights.ts`**

Find:

```ts
import { h, link, modal, pageHead, svg } from "./dom";

type GoTab = (tab: "inbox" | "client" | "dev", highlight?: string[]) => void;

function loadPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* not remembered */ }
}
```

Replace with:

```ts
import { h, link, loadPref, modal, pageHead, savePref, svg } from "./dom";

type GoTab = (tab: "inbox" | "client" | "dev", highlight?: string[]) => void;
```

- [ ] **Step 4: Type-check, and check that no other copy is left**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npx tsc --noEmit && echo TSC OK
cd /Users/thibaultdody/dev/worktrees/todo-hub/main && git grep -n 'function loadPref\|function savePref' -- app/src
```

Expected: `TSC OK`, then exactly two lines, both in `app/src/dom.ts`.

- [ ] **Step 5: Commit**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main
git add app/src/dom.ts app/src/main.ts app/src/insights.ts
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
App: one copy of loadPref and savePref, in dom.ts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The # column

**Files:**
- Modify: `app/src/pulls.ts` (columns, `units`, cells and rows, `table`)
- Modify: `app/src/styles.css` (Pull requests section)

- [ ] **Step 1: Add the column, and name the Next step column**

Today `COLS[1]` means "Next step" in three places. With **#** first, that index is wrong, so the column gets a name.

In `app/src/pulls.ts`, find:

```ts
// A header's first click sorts the way you most often want.
const COLS: Col[] = [
  { id: "title", label: "Pull request", key: (p) => p.title.toLowerCase(), first: 1, unit: "base" },
  { id: "step", label: "Next step", first: 1, cls: "c-st", unit: "min",
    key: (p) => (st.side === "mine" ? stepOf(p).rank * 1e13 + Date.parse(p.updated_at) : Date.parse(p.asked_at)) },
  { id: "ci", label: "CI", key: (p) => CI_RANK[p.ci.state], first: 1, cls: "c-ci", unit: "min" },
```

Replace with:

```ts
// A header's first click sorts the way you most often want.
const STEP_COL: Col = { id: "step", label: "Next step", first: 1, cls: "c-st", unit: "min",
  key: (p) => (st.side === "mine" ? stepOf(p).rank * 1e13 + Date.parse(p.updated_at) : Date.parse(p.asked_at)) };
const COLS: Col[] = [
  { id: "number", label: "#", key: (p) => p.number, first: -1, cls: "c-num", unit: "min", tip: "Pull request number" },
  { id: "title", label: "Pull request", key: (p) => p.title.toLowerCase(), first: 1, unit: "base" },
  STEP_COL,
  { id: "ci", label: "CI", key: (p) => CI_RANK[p.ci.state], first: 1, cls: "c-ci", unit: "min" },
```

Then find:

```ts
function units(shown: PullRequest[]): Unit[] {
  const sort = st.sorts[st.side];
  const col = COLS.find((c) => c.id === sort.id) ?? COLS[1];
```

Replace with:

```ts
/** The column the table sorts by. */
const sortCol = () => COLS.find((c) => c.id === st.sorts[st.side].id) ?? STEP_COL;

function units(shown: PullRequest[]): Unit[] {
  const sort = st.sorts[st.side], col = sortCol();
```

- [ ] **Step 2: The # cell on each row and on a stack's summary row**

Find:

```ts
function stagePill(stage: PullRequest["stage"]): HTMLElement {
```

Replace with:

```ts
/** "#2374": a Pencil "#", then the number. */
const numCell = (n: number, cls = "num") => h("td", { class: cls }, h("span", { class: "hash" }, "#"), String(n));

function stagePill(stage: PullRequest["stage"]): HTMLElement {
```

Find:

```ts
  const ms = u.all, step = COLS[1], folded = isFolded(u);
```

Replace with:

```ts
  const ms = u.all, step = STEP_COL, folded = isFolded(u);
```

In `stackRow`, find:

```ts
    h("td", { class: "x" }, icon("rt")),
    h("td", { class: "t" }, h("button", { class: "sk", "aria-expanded": String(!folded) }, `Stack of ${ms.length}`),
```

Replace with:

```ts
    h("td", { class: "x" }, icon("rt")),
    numCell(Math.min(...ms.map((p) => p.number)), "num mute"),
    h("td", { class: "t" }, h("button", { class: "sk", "aria-expanded": String(!folded) }, `Stack of ${ms.length}`),
```

In `prRow`, find:

```ts
    rail(u, p),
    h("td", { class: "x" }, icon("rt")),
    h("td", { class: "t" },
```

Replace with:

```ts
    rail(u, p),
    h("td", { class: "x" }, icon("rt")),
    numCell(p.number),
    h("td", { class: "t" },
```

- [ ] **Step 3: The meta line keeps the repo name only**

Find:

```ts
/** The line under a title. The stage, "Conflicts" and the repo and number always show (the repo name
 *  shortens); when the line is full, the rest drops out whole, from the end: "N of M" first, as the rail
 *  shows the place in the stack. */
function metaLine(p: PullRequest, u: Unit): HTMLElement {
  const keep = h("span", { class: "keep" }, st.side === "mine" && stagePill(p.stage),
    p.conflicts && h("span", { class: "b red" }, "Conflicts"),
    // the number first: drawn right to left, so a repo name that does not fit drops out whole
    h("span", { class: "b id", title: p.repo }, h("span", {}, `#${p.number}`), h("span", {}, p.repo.split("/")[1])));
```

Replace with:

```ts
/** The line under a title. The stage, "Conflicts" and the repo name always show (the repo name ends in
 *  an ellipsis when it does not fit); when the line is full, the rest drops out whole, from the end:
 *  "N of M" first, as the rail shows the place in the stack. */
function metaLine(p: PullRequest, u: Unit): HTMLElement {
  const keep = h("span", { class: "keep" }, st.side === "mine" && stagePill(p.stage),
    p.conflicts && h("span", { class: "b red" }, "Conflicts"),
    h("span", { class: "b id", title: p.repo }, p.repo.split("/")[1]));
```

- [ ] **Step 4: Colspans count the columns, and the table uses `sortCol`**

In `detailRow`, find:

```ts
    h("td", { colspan: "7", id: `${domId(key)}-d` },
```

Replace with:

```ts
    h("td", { colspan: String(COLS.length + 1), id: `${domId(key)}-d` },
```

In `table`, find:

```ts
  const sort = st.sorts[st.side], v = viewOf();
  const col = COLS.find((c) => c.id === sort.id) ?? COLS[1];
```

Replace with:

```ts
  const sort = st.sorts[st.side], v = viewOf(), col = sortCol();
```

Find:

```ts
      h("tr", { class: "fold-h" }, h("td", { colspan: "8" },
```

Replace with:

```ts
      h("tr", { class: "fold-h" }, h("td", { colspan: String(COLS.length + 2) },
```

- [ ] **Step 5: Styles**

In `app/src/styles.css`, find:

```css
.pr-table th:nth-child(2) { width: 20px; }
```

Replace with:

```css
.pr-table th:nth-child(2) { width: 20px; }
.pr-table th.c-num { width: 64px; }
```

Find:

```css
.pr-table td.st, .pr-table td.ci, .pr-table td.cm, .pr-table td.up { padding-top: 8px; font-size: 13px; }
```

Replace with:

```css
.pr-table td.st, .pr-table td.ci, .pr-table td.cm, .pr-table td.up, .pr-table td.num { padding-top: 8px; font-size: 13px; }
.pr-table td.num .hash { color: var(--muted); }
```

Find:

```css
.pr-table tr.ctx .tt, .pr-table tr.ctx td.st, .pr-table tr.ctx td.ci, .pr-table tr.ctx td.cm, .pr-table tr.ctx td.up { color: var(--muted); }
```

Replace with:

```css
.pr-table tr.ctx .tt, .pr-table tr.ctx td.st, .pr-table tr.ctx td.ci, .pr-table tr.ctx td.cm, .pr-table tr.ctx td.up,
.pr-table tr.ctx td.num { color: var(--muted); }
```

Find:

```css
/* "repo #n", laid out from the right: when the repo name does not fit, it wraps onto the hidden second line */
.prs .m .keep > .id { flex: 0 1 auto; min-width: 0; display: flex; flex-direction: row-reverse; flex-wrap: wrap;
  justify-content: flex-end; column-gap: 4px; height: 17px; overflow: hidden; }
```

Replace with:

```css
/* the repo name: when it does not fit, it ends in an ellipsis */
.prs .m .keep > .id { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
```

- [ ] **Step 6: Type-check**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npx tsc --noEmit && echo TSC OK
cd /Users/thibaultdody/dev/worktrees/todo-hub/main && git grep -n 'COLS\[' -- app/src/pulls.ts
```

Expected: `TSC OK`, and the `git grep` prints nothing.

- [ ] **Step 7: Commit**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main
git add app/src/pulls.ts app/src/styles.css
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
App: Pull requests: the number has its own column, sortable, newest first

A stack sorts by its lowest number and its summary row shows it, so a
stack never splits. The line under the title keeps the repo name only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: The group of a pull request, and the Client / project column

**Files:**
- Modify: `app/src/pulls.ts`
- Modify: `app/src/styles.css`

- [ ] **Step 1: Import the client logo**

In `app/src/pulls.ts`, find:

```ts
import { h, pageHead, svg } from "./dom";
```

Replace with:

```ts
import { clientLogo } from "./avatars";
import { h, pageHead, svg } from "./dom";
```

- [ ] **Step 2: `groupOf` and its helpers, after `linearRef`**

Find:

```ts
const linearRef = (ident: string) =>
  h("button", { class: "ref", "data-act": "lin", tabindex: "-1", title: `Open ${ident} in Linear` }, h("span", { class: "k" }, ident));
```

Replace with:

```ts
const linearRef = (ident: string) =>
  h("button", { class: "ref", "data-act": "lin", tabindex: "-1", title: `Open ${ident} in Linear` }, h("span", { class: "k" }, ident));

// ---- groups: the client label, else the project, of the pull request's Linear issue ------------
/** null is "No client or project": no Linear issue, or one that is not one of your open issues. */
type Group = { kind: "client" | "project"; name: string } | null;
/** The one way to ask which client or project a pull request belongs to. A stack's is its base's. */
function groupOf(p: PullRequest): Group {
  const issue = linearOf(p)?.issue;
  if (issue?.client) return { kind: "client", name: issue.client };
  return issue?.project ? { kind: "project", name: issue.project } : null;
}
const groupKey = (g: Group) => (g ? `${g.kind}:${g.name}` : "none");
const groupName = (g: Group) => g?.name ?? "No client or project";
/** The client's logo, the project's initial, or "–", as in Client and Dev. */
const groupMark = (g: Group) => (g?.kind === "client" ? clientLogo(g.name)
  : h("span", { class: "ll-initial", "aria-hidden": "true" }, g ? g.name.slice(0, 1).toUpperCase() : "–"));
/** The Client / project cell. ``named`` false leaves it empty, under a row that names the same group. */
const groupCell = (g: Group, named = true) => h("td", { class: "grp" },
  named && h("span", { class: `gi${g ? "" : " none"}`, title: groupName(g) }, groupMark(g), h("span", {}, groupName(g))));
```

- [ ] **Step 3: The column, and the columns the table shows**

Find:

```ts
  { id: "title", label: "Pull request", key: (p) => p.title.toLowerCase(), first: 1, unit: "base" },
  STEP_COL,
```

Replace with:

```ts
  { id: "title", label: "Pull request", key: (p) => p.title.toLowerCase(), first: 1, unit: "base" },
  // name order, No client or project last; a stack sorts by its base's group
  { id: "group", label: "Client / project", first: 1, cls: "c-grp", unit: "base",
    key: (p) => { const g = groupOf(p); return `${g ? 0 : 1}${groupName(g).toLowerCase()}`; } },
  STEP_COL,
```

Find:

```ts
/** The column the table sorts by. */
const sortCol = () => COLS.find((c) => c.id === st.sorts[st.side].id) ?? STEP_COL;
```

Replace with:

```ts
/** The table's columns: Client / project only in Mine. */
const shownCols = () => COLS.filter((c) => c.id !== "group" || st.side === "mine");
/** The column the table sorts by. */
const sortCol = () => shownCols().find((c) => c.id === st.sorts[st.side].id) ?? STEP_COL;
```

- [ ] **Step 4: Rows with the same value sort by Next step**

In `units`, find:

```ts
  const value = (u: Unit) => {
    const ks = u.all.map(col.key);
    if (col.unit === "base" || typeof ks[0] === "string") return ks[0];
    const ns = ks as number[];
    return col.unit === "min" ? Math.min(...ns) : col.unit === "max" ? Math.max(...ns) : ns.reduce((a, b) => a + b, 0);
  };
  return [...seen.values()].sort((a, b) => { const x = value(a), y = value(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
```

Replace with:

```ts
  const value = (u: Unit, c: Col) => {
    const ks = u.all.map(c.key);
    if (c.unit === "base" || typeof ks[0] === "string") return ks[0];
    const ns = ks as number[];
    return c.unit === "min" ? Math.min(...ns) : c.unit === "max" ? Math.max(...ns) : ns.reduce((a, b) => a + b, 0);
  };
  const cmp = (x: number | string, y: number | string) => (x < y ? -1 : x > y ? 1 : 0);
  // rows with the same value sort by Next step
  return [...seen.values()].sort((a, b) =>
    cmp(value(a, col), value(b, col)) * sort.dir || cmp(value(a, STEP_COL), value(b, STEP_COL)));
```

- [ ] **Step 5: `prRow` and `stackRow` take the cell**

Find:

```ts
function stackRow(u: Unit): HTMLElement {
```

Replace with:

```ts
function stackRow(u: Unit, grp?: HTMLElement): HTMLElement {
```

In `stackRow`, find:

```ts
        h("span", { class: "b" }, `merge order ${ms.map((p) => `#${p.number}`).join(" → ")}`))),
```

Replace with:

```ts
        h("span", { class: "b" }, `merge order ${ms.map((p) => `#${p.number}`).join(" → ")}`))),
    grp,
```

Find:

```ts
function prRow(p: PullRequest, u: Unit): HTMLElement[] {
```

Replace with:

```ts
function prRow(p: PullRequest, u: Unit, grp?: HTMLElement): HTMLElement[] {
```

In `prRow`, find:

```ts
      metaLine(p, u)),
    h("td", { class: "st" }, stepCell(p)),
```

Replace with:

```ts
      metaLine(p, u)),
    grp,
    h("td", { class: "st" }, stepCell(p)),
```

In `detailRow`, find:

```ts
    h("td", { colspan: String(COLS.length + 1), id: `${domId(key)}-d` },
```

Replace with:

```ts
    h("td", { colspan: String(shownCols().length + 1), id: `${domId(key)}-d` },
```

- [ ] **Step 6: The row builder, before `table`**

Find:

```ts
function table(us: Unit[], folded: PullRequest[]): HTMLElement {
```

Replace with:

```ts
/** The rows of the units. With the Client / project column, each pull request names its own group and
 *  a stack's summary row names the stack's. Sorted by that column, a name shows only where the group
 *  changes, and that row gets a darker line above it; a stack member then names its group only when it
 *  is not the stack's. */
function bodyRows(us: Unit[]): HTMLElement[] {
  const withGroup = shownCols().some((c) => c.id === "group");
  const runs = withGroup && st.sorts[st.side].id === "group";
  const out: HTMLElement[] = [];
  let above: string | null = null;
  for (const u of us) {
    const g = groupOf(u.all[0]), k = groupKey(g), starts = k !== above;
    const cell = withGroup ? groupCell(g, !runs || starts) : undefined;
    const first = u.all.length > 1 ? [stackRow(u, cell)] : prRow(u.all[0], u, cell);
    if (runs && starts && above !== null) first[0].classList.add("run");
    above = k;
    out.push(...first);
    if (u.all.length < 2 || isFolded(u)) continue;
    for (const p of u.all) {
      const own = groupOf(p);
      out.push(...prRow(p, u, withGroup ? groupCell(own, !runs || groupKey(own) !== k) : undefined));
    }
  }
  return out;
}

function table(us: Unit[], folded: PullRequest[]): HTMLElement {
```

- [ ] **Step 7: `table` draws the shown columns with the row builder**

Find:

```ts
  const sort = st.sorts[st.side], v = viewOf(), col = sortCol();
  const label = (c: Col) => (st.side === "review" && c.id === "step" ? "Waiting" : c.label);
```

Replace with:

```ts
  const sort = st.sorts[st.side], v = viewOf(), col = sortCol(), cols = shownCols();
  const label = (c: Col) => (st.side === "review" && c.id === "step" ? "Waiting" : c.label);
  const withGroup = cols.some((c) => c.id === "group");
```

Find:

```ts
      ...COLS.map((c) => {
```

Replace with:

```ts
      ...cols.map((c) => {
```

Find:

```ts
    h("tbody", {}, ...us.flatMap((u) => [...(u.all.length > 1 ? [stackRow(u)] : []),
      ...(isFolded(u) ? [] : u.all.flatMap((p) => prRow(p, u)))])),
    h("tbody", {}, ...(folded.length ? [
      h("tr", { class: "fold-h" }, h("td", { colspan: String(COLS.length + 2) },
```

Replace with:

```ts
    h("tbody", {}, ...bodyRows(us)),
    h("tbody", {}, ...(folded.length ? [
      h("tr", { class: "fold-h" }, h("td", { colspan: String(cols.length + 2) },
```

Find:

```ts
      ...(st.fold ? folded.flatMap((p) => prRow(p, { id: keyOf(p), all: [p], shown: new Set([p]) })) : []),
```

Replace with:

```ts
      ...(st.fold ? folded.flatMap((p) => prRow(p, { id: keyOf(p), all: [p], shown: new Set([p]) },
        withGroup ? groupCell(groupOf(p)) : undefined)) : []),
```

- [ ] **Step 8: Styles**

In `app/src/styles.css`, find:

```css
.pr-table th.c-num { width: 64px; }
```

Replace with:

```css
.pr-table th.c-num { width: 64px; }
.pr-table th.c-grp { width: 168px; }
```

Find:

```css
.pr-table td.num .hash { color: var(--muted); }
```

Replace with:

```css
.pr-table td.num .hash { color: var(--muted); }
/* the Client / project cell: a logo or initial, then the name, which ends in an ellipsis */
.pr-table td.grp { padding-top: 7px; font-size: 13px; overflow: hidden; }
.pr-table td.grp .gi { display: flex; align-items: center; gap: 7px; min-width: 0; }
.pr-table td.grp .gi > span:last-child { overflow: hidden; text-overflow: ellipsis; }
.pr-table td.grp .gi.none > span:last-child { color: var(--muted); }
.pr-table td.grp .avatar.sm, .pr-table td.grp .ll-initial { width: 18px; height: 18px; border-radius: 5px; font-size: 10px; }
.pr-table td.grp .avatar.sm .mark { border-radius: 5px; }
/* sorted by Client / project: a darker line where the group changes */
.pr-table tr.run > td:not(.rail) { border-top: 1px solid color-mix(in srgb, var(--muted) 40%, var(--border)); }
```

Find:

```css
.pr-table tr.ctx .tt, .pr-table tr.ctx td.st, .pr-table tr.ctx td.ci, .pr-table tr.ctx td.cm, .pr-table tr.ctx td.up,
.pr-table tr.ctx td.num { color: var(--muted); }
```

Replace with:

```css
.pr-table tr.ctx .tt, .pr-table tr.ctx td.st, .pr-table tr.ctx td.ci, .pr-table tr.ctx td.cm, .pr-table tr.ctx td.up,
.pr-table tr.ctx td.num, .pr-table tr.ctx td.grp { color: var(--muted); }
```

Find:

```css
/* A narrow window collapses a column to zero width; its cells stay, so the open row's colspan still fits. */
@media (max-width: 1000px) {
```

Replace with:

```css
/* A narrow window collapses a column to zero width; its cells stay, so the open row's colspan still fits.
   Client / project needs the most room: at the default 1120px window the titles would get none. */
@media (max-width: 1400px) {
  .pr-table th.c-grp { width: 0; visibility: hidden; overflow: hidden; }
  .pr-table td.grp { padding: 0; visibility: hidden; overflow: hidden; }
}
@media (max-width: 1000px) {
```

- [ ] **Step 9: Type-check**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npx tsc --noEmit && echo TSC OK
```

Expected: `TSC OK`.

- [ ] **Step 10: Commit**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main
git add app/src/pulls.ts app/src/styles.css
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
App: Pull requests: a Client / project column in Mine, in windows 1400 px wide or more

The group is the client label of the Linear issue, else its project, else
"No client or project". Sorted by it, a name shows only where it changes.
In every column, rows with the same value now sort by Next step.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Groups: the Group control, g, and the sections

**Files:**
- Modify: `app/src/pulls.ts`
- Modify: `app/src/main.ts` (shortcuts sheet)
- Modify: `app/src/styles.css`

- [ ] **Step 1: State, and the remembered choice**

In `app/src/pulls.ts`, find:

```ts
import { h, pageHead, svg } from "./dom";
```

Replace with:

```ts
import { h, loadPref, pageHead, savePref, svg } from "./dom";
```

Find:

```ts
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
```

Replace with:

```ts
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const GROUPS_PREF = "todohub.pullsGroups";   // "on": Mine shows one section for each client or project
```

Find:

```ts
  foldedStacks: new Set<string>(),      // stacks that show only their summary row
```

Replace with:

```ts
  foldedStacks: new Set<string>(),      // stacks that show only their summary row
  grouped: loadPref(GROUPS_PREF) === "on",  // Mine: one section for each client or project
  foldedGroups: new Set<string>(),      // sections that show only their heading, by groupKey
```

- [ ] **Step 2: The column hides in the sections**

Find:

```ts
/** The table's columns: Client / project only in Mine. */
const shownCols = () => COLS.filter((c) => c.id !== "group" || st.side === "mine");
```

Replace with:

```ts
/** The table's columns: Client / project only in Mine with the groups off (each heading names it). */
const shownCols = () => COLS.filter((c) => c.id !== "group" || (st.side === "mine" && !st.grouped));
const isGrouped = () => st.side === "mine" && st.grouped;
```

- [ ] **Step 3: A stack member in another group names it, in the sections**

In `metaLine`, find:

```ts
  if (lin) rest.push(linearRef(lin.ident));
```

Replace with:

```ts
  if (lin) rest.push(linearRef(lin.ident));
  // a stack sits in its base's section, so a member in another client or project names it
  if (isGrouped() && u.all.length > 1 && groupKey(groupOf(p)) !== groupKey(groupOf(u.all[0]))) rest.push(groupName(groupOf(p)));
```

- [ ] **Step 4: Sections and their headings, before `table`**

Find:

```ts
function table(us: Unit[], folded: PullRequest[]): HTMLElement {
```

Replace with:

```ts
interface Section { key: string; group: Group; units: Unit[] }
/** The units by group, in the order of each group's first unit; No client or project comes last. */
function sections(us: Unit[]): Section[] {
  const byKey = new Map<string, Section>();
  for (const u of us) {
    const group = groupOf(u.all[0]), key = groupKey(group);
    if (!byKey.has(key)) byKey.set(key, { key, group, units: [] });
    byKey.get(key)!.units.push(u);
  }
  return [...byKey.values()].sort((a, b) => Number(!a.group) - Number(!b.group));
}

/** A section's heading, as in Client and Dev: the logo or initial, the name, what the section shows
 *  (not the grey rows that are there only for their stack), and a rule. A click folds the section. */
function sectionHead(s: Section, span: number): HTMLElement {
  const ps = s.units.flatMap((u) => u.all.filter((p) => u.shown.has(p)));
  const needs = ps.filter(needsYou).length, fail = ps.filter((p) => p.ci.state === "failing").length;
  const folded = st.foldedGroups.has(s.key);
  return h("tr", { class: `gh${folded ? " folded" : ""}` },
    h("th", { colspan: String(span), scope: "rowgroup" },
      h("button", { class: "gh-b", "aria-expanded": String(!folded) }, icon("rt"), groupMark(s.group),
        h("span", { class: "ll-name" }, groupName(s.group)),
        h("span", { class: "ll-sum" }, `${ps.length} open`, needs > 0 && ` · ${needs} ${needs === 1 ? "needs" : "need"} you`,
          fail > 0 && " · ", fail > 0 && h("span", { class: "red" }, `${fail} CI failing`)),
        h("span", { class: "ll-rule" }))));
}

function table(us: Unit[], folded: PullRequest[]): HTMLElement {
```

- [ ] **Step 5: `table` draws one `tbody` for each section**

Find:

```ts
    h("tbody", {}, ...bodyRows(us)),
    h("tbody", {}, ...(folded.length ? [
```

Replace with:

```ts
    ...(isGrouped()
      ? sections(us).map((s) => h("tbody", { "data-section": s.key }, sectionHead(s, cols.length + 2),
          ...(st.foldedGroups.has(s.key) ? [] : bodyRows(s.units))))
      : [h("tbody", {}, ...bodyRows(us))]),
    h("tbody", {}, ...(folded.length ? [
```

- [ ] **Step 6: The selection follows the sections, and the hint names g**

In `panel`, find:

```ts
  const order = [...us.flatMap((u) => (isFolded(u) ? [] : u.all)), ...(st.fold ? folded : [])].map(keyOf);
```

Replace with:

```ts
  const listed = isGrouped() ? sections(us).filter((s) => !st.foldedGroups.has(s.key)).flatMap((s) => s.units) : us;
  const order = [...listed.flatMap((u) => (isFolded(u) ? [] : u.all)), ...(st.fold ? folded : [])].map(keyOf);
```

Find:

```ts
      kbd("l"), " Linear · ", kbd("1"), "–", kbd(String(VIEWS[side].length)), " pick a view · ", kbd("?"), " all keys"));
```

Replace with:

```ts
      kbd("l"), " Linear · ", side === "mine" && kbd("g"), side === "mine" && " groups · ",
      kbd("1"), "–", kbd(String(VIEWS[side].length)), " pick a view · ", kbd("?"), " all keys"));
```

- [ ] **Step 7: The Group control in the header line**

Find:

```ts
function head(): HTMLElement {
```

Replace with:

```ts
/** "Group: None | Client or project", before Refresh all in Mine; g does the same. */
function groupControl(): HTMLElement {
  const seg = (on: boolean, label: string) => h("button", { class: `seg${st.grouped === on ? " on" : ""}`,
    "data-act": on ? "group-on" : "group-off", "aria-pressed": String(st.grouped === on), "aria-keyshortcuts": "g" }, label);
  return h("span", { class: "pr-group" }, h("span", { class: "pr-group-l", "aria-hidden": "true" }, "Group"),
    h("span", { class: "segmented", role: "group", "aria-label": "Group by" }, seg(false, "None"), seg(true, "Client or project")));
}

function head(): HTMLElement {
```

In `head`, find:

```ts
  const right = document.createDocumentFragment();
  right.append(h("button", { class: "ghost pr-refresh", "data-act": "reread", "aria-disabled": String(st.loading),
```

Replace with:

```ts
  const right = document.createDocumentFragment();
  if (st.side === "mine") right.append(groupControl());
  right.append(h("button", { class: "ghost pr-refresh", "data-act": "reread", "aria-disabled": String(st.loading),
```

- [ ] **Step 8: Keep the focus on a section heading across a redraw**

Find:

```ts
type Focus = { on: "filter"; from: number | null; to: number | null } | { on: "act"; act: string; key: string | null }
  | { on: "stack"; id: string } | { on: "table" } | { on: "tab" } | null;
```

Replace with:

```ts
type Focus = { on: "filter"; from: number | null; to: number | null } | { on: "act"; act: string; key: string | null }
  | { on: "stack"; id: string } | { on: "section"; key: string } | { on: "table" } | { on: "tab" } | null;
```

Find:

```ts
  if (stack) return { on: "stack", id: stack };
  if (a?.closest(".pr-table")) return { on: "table" };
```

Replace with:

```ts
  if (stack) return { on: "stack", id: stack };
  const section = a?.matches(".gh-b") && a.closest<HTMLElement>("tbody")?.dataset.section;
  if (section) return { on: "section", key: section };
  if (a?.closest(".pr-table")) return { on: "table" };
```

Find:

```ts
  } else if (f?.on === "stack") root?.querySelector<HTMLElement>(`tr.sum[data-stack="${CSS.escape(f.id)}"] .sk`)?.focus();
```

Replace with:

```ts
  } else if (f?.on === "stack") root?.querySelector<HTMLElement>(`tr.sum[data-stack="${CSS.escape(f.id)}"] .sk`)?.focus();
  else if (f?.on === "section") root?.querySelector<HTMLElement>(`tbody[data-section="${CSS.escape(f.key)}"] .gh-b`)?.focus();
```

- [ ] **Step 9: Turn the groups on and off; fold a section**

Find:

```ts
/** Fold a stack to its summary row, or unfold it. A selection in the stack moves to the next row, else the one before. */
function foldStack(id: string) {
  if (!st.foldedStacks.delete(id)) {
    st.foldedStacks.add(id);
    const rows = [...(root?.querySelectorAll<HTMLElement>("tr.pr-row") ?? [])];
    const at = rows.findIndex((r) => r.dataset.key === st.sel);
    if (at >= 0 && rows[at].dataset.stack === id) {
      const outside = (r: HTMLElement) => r.dataset.stack !== id;
      st.sel = (rows.slice(at).find(outside) ?? rows.slice(0, at).reverse().find(outside))?.dataset.key ?? null;
    }
  }
  paint();
}
```

Replace with:

```ts
/** When the selected row is one that ``inside`` picks, select the next row after them, else the one before. */
function moveSelOut(inside: (row: HTMLElement) => boolean) {
  const rows = [...(root?.querySelectorAll<HTMLElement>("tr.pr-row") ?? [])];
  const at = rows.findIndex((r) => r.dataset.key === st.sel);
  if (at < 0 || !inside(rows[at])) return;
  const outside = (r: HTMLElement) => !inside(r);
  st.sel = (rows.slice(at).find(outside) ?? rows.slice(0, at).reverse().find(outside))?.dataset.key ?? null;
}
/** Fold a stack to its summary row, or unfold it. */
function foldStack(id: string) {
  if (!st.foldedStacks.delete(id)) {
    st.foldedStacks.add(id);
    moveSelOut((r) => r.dataset.stack === id);
  }
  paint();
}
/** Fold a section to its heading, or unfold it. It stays folded until the app restarts. */
function foldSection(key: string) {
  if (!st.foldedGroups.delete(key)) {
    st.foldedGroups.add(key);
    moveSelOut((r) => r.closest<HTMLElement>("tbody")?.dataset.section === key);
  }
  paint();
}
/** Turn the groups on or off (Mine only). The column hides in the sections, so a sort by it becomes
 *  a sort by Next step. */
function setGrouped(on: boolean) {
  if (st.side !== "mine" || st.grouped === on) return;
  st.grouped = on;
  savePref(GROUPS_PREF, on ? "on" : "off");
  if (on && st.sorts.mine.id === "group") st.sorts.mine = { id: STEP_COL.id, dir: STEP_COL.first };
  paint();
}
```

- [ ] **Step 10: Clicks on the control and on a heading**

In `onClick`, find:

```ts
  const t = (e.target as Element).closest<HTMLElement>("[data-view],[data-note],[data-sort],[data-fold],[data-act],[data-clear],tr.pr-row");
```

Replace with:

```ts
  const t = (e.target as Element).closest<HTMLElement>("[data-view],[data-note],[data-sort],[data-fold],[data-act],[data-clear],tr.gh,tr.pr-row");
```

Find:

```ts
  if (d.act === "reread") return void loadPulls(true);
```

Replace with:

```ts
  if (t.matches("tr.gh")) return foldSection(t.closest<HTMLElement>("tbody")!.dataset.section!);
  if (d.act === "group-on" || d.act === "group-off") return setGrouped(d.act === "group-on");
  if (d.act === "reread") return void loadPulls(true);
```

- [ ] **Step 11: The g key**

In `pullsKey`, find:

```ts
  if (/^[1-9]$/.test(e.key)) {
    const v = VIEWS[st.side][Number(e.key) - 1];
    if (v) pickView(v.id);
    return true;
  }
```

Replace with:

```ts
  if (/^[1-9]$/.test(e.key)) {
    const v = VIEWS[st.side][Number(e.key) - 1];
    if (v) pickView(v.id);
    return true;
  }
  if (e.key === "g" && st.side === "mine") { setGrouped(!st.grouped); return true; }
```

- [ ] **Step 12: The shortcuts sheet**

In `app/src/main.ts`, find:

```ts
  ["1 – 5 · Space · o · l", "Pull requests: pick a view · open or close the row · open it in GitHub · open its Linear issue. ⌘R refreshes all"],
```

Replace with:

```ts
  ["1 – 5 · Space · o · l", "Pull requests: pick a view · open or close the row · open it in GitHub · open its Linear issue. ⌘R refreshes all"],
  ["g", "Pull requests (Mine): group by client or project"],
```

- [ ] **Step 13: Styles, and remove the unused `.toolbar` rules**

In `app/src/styles.css`, find:

```css
.page-right .pr-refresh { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; font-size: 13px; white-space: nowrap; }
```

Replace with:

```css
.page-right .pr-refresh { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; font-size: 13px; white-space: nowrap; }
/* the Group control, before Refresh all in Mine */
.pr-group { display: inline-flex; align-items: center; gap: 6px; flex: none; }
.pr-group-l { font-size: 12px; color: var(--muted); }
.pr-group .segmented { background: var(--surface); }
```

Find:

```css
/* sorted by Client / project: a darker line where the group changes */
```

Replace with:

```css
/* the sections: one for each client or project, headed as in Client and Dev */
.pr-table tr.gh > th { padding: 22px 0 6px; border-bottom: 1px solid var(--border); font-weight: 400; color: var(--ink); }
.pr-table tbody:first-of-type tr.gh > th { padding-top: 10px; }
.pr-table tr.gh .gh-b { display: flex; width: 100%; align-items: center; gap: 10px; padding: 0 10px 0 2px; font-weight: 400; text-align: left; }
.pr-table tr.gh .gh-b > .i { width: 14px; height: 14px; color: var(--muted); transform: rotate(90deg); transition: transform .12s; }
.pr-table tr.gh.folded .gh-b > .i { transform: none; }
.pr-table tr.gh .avatar.sm { width: 26px; height: 26px; }
.pr-table tr.gh .avatar.sm .mark { border-radius: 7px; font-size: 11px; }
.pr-table tr.gh .gh-b:hover .ll-name { text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 3px; }
/* sorted by Client / project: a darker line where the group changes */
```

Find:

```css
@media (prefers-reduced-motion: reduce) { .pr-table td.x .i, .fold-b .i { transition: none; } }
```

Replace with:

```css
@media (max-width: 1000px) { .pr-group-l { display: none; } }
@media (prefers-reduced-motion: reduce) { .pr-table td.x .i, .fold-b .i, .pr-table tr.gh .gh-b > .i { transition: none; } }
```

Find and delete this line (and the blank line after it):

```css
.toolbar { display: flex; gap: 8px; margin: 4px 0 14px; }
```

Find:

```css
.toolbar .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; flex: none; }
.toolbar .seg button { border: 0; border-radius: 0; background: var(--surface); color: var(--muted); padding: 6px 12px; white-space: nowrap; }
.toolbar .seg button + button { border-left: 1px solid var(--border); }
.toolbar .seg button.on { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
```

Delete these four lines. Keep the comment line above them: it heads the `.st-group` rules that follow.

- [ ] **Step 14: Type-check, and check that `.toolbar` is gone**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npx tsc --noEmit && echo TSC OK
cd /Users/thibaultdody/dev/worktrees/todo-hub/main && git grep -n 'toolbar' -- app
```

Expected: `TSC OK`, and the `git grep` prints nothing.

- [ ] **Step 15: Commit**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main
git add app/src/pulls.ts app/src/main.ts app/src/styles.css
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
App: Pull requests: Group (or g) splits Mine into one section for each client or project

Each section has the heading of Client and Dev, sorts by the column you
pick, and folds. The section with the most urgent first row comes first,
"No client or project" last. The app remembers the choice. The .toolbar
rules go: nothing used them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Browser check with real data, writes blocked

The user's app may be running, so do not use `npm run tauri dev`. Use a scratch settings folder, a scratch backend and Vite, and Playwright. Every non-GET call is answered with 500, so nothing can change in Linear or GitHub.

- [ ] **Step 1: A scratch settings folder and backend**

```bash
S=/private/tmp/claude-501/-Users-thibaultdody-dev-worktrees-todo-hub-main/aeb9a614-d664-4f06-abe9-79c51fbf0cd1/scratchpad/home
mkdir -p "$S" && cp "$HOME/Library/Application Support/TodoHub/"{config.toml,settings.json,todohub.db,client_domains.json} "$S"/
mkdir -p "$S/logos" && cp "$HOME/Library/Application Support/TodoHub/logos/"* "$S/logos/" 2>/dev/null
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/backend && TODOHUB_HOME="$S" TODOHUB_TOKEN=x uv run python -m todohub.api --port 8791
```

Run the last command in the background. Wait until `curl -s http://127.0.0.1:8791/api/health` answers.

- [ ] **Step 2: Vite on port 1430**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npx vite --port 1430 --strictPort
```

Run it in the background.

- [ ] **Step 3: Open the app in Playwright with the Tauri shim and the write block**

With `mcp__playwright__browser_run_code_unsafe`:

```js
async (page) => {
  const ctx = page.context();
  const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  await ctx.addInitScript(() => {
    window.__writes = [];
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => (cmd === "backend_info" ? { url: "http://127.0.0.1:8791", token: "x", error: null } : null),
      transformCallback: () => 0, unregisterCallback: () => {}, convertFileSrc: (p) => p,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    };
  });
  await ctx.route("http://127.0.0.1:8791/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (req.method() !== "GET") return route.fulfill({ status: 500, headers: CORS, body: "writes are blocked in this check" });
    const resp = await route.fetch();
    return route.fulfill({ response: resp, headers: { ...resp.headers(), ...CORS } });
  });
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("http://localhost:1430/");
  await page.keyboard.press("Meta+5");
}
```

If the app does not start, read the console with `mcp__playwright__browser_console_messages` and add the missing `invoke` command to the shim. Do not answer any write.

- [ ] **Step 4: Check the # column (window 1500 px)**

In Mine, then in To review:
- Click **#**: the newest number is first. Click again: the oldest is first.
- A stack stays together. Its summary row shows its lowest number in grey.
- The line under each title shows the stage pill and the repo name, but no number.
- Type a number in the filter, for example `#` and a number from the list: only that pull request shows.

Take a screenshot of each.

- [ ] **Step 5: Check the Client / project column (Mine, groups off, 1500 px)**

- Every row shows a client logo or a project initial and a name. Rows with no group show "–" and "No client or project" in grey.
- Click **Client / project**: the rows of one group come together, in name order, with **No client or project** last. A name shows only on the first row of each group, and a darker line is above it.
- In the stack with a member in another project, that member shows its own project in this column.
- Resize to 1300 px: the column folds away and the titles get the width.

- [ ] **Step 6: Check the groups (1500 px, then 1120 px)**

- Click **Client or project** in the Group control: the sections show, the Client / project column goes away, and the sort changes to Next step if it was Client / project.
- Each heading shows the logo or initial, the name, "N open · N need you · N CI failing" and a rule. **No client or project** is last.
- Sort by **#**, then by **Updated**: the rows sort inside each section, and the sections change order.
- The stack member in another project names its project in the line under its title.
- Select a row, then click its section heading: the section folds, and the next row after it is selected. Press **j** and **k**: they skip the folded section. Click the heading again: it unfolds.
- Press **g**: the groups go off. Press **g** again: they come back. Reload the page: the groups are still on.
- Open a row (Space): its detail spans the whole table, with the groups on and off.
- Switch to To review: no Group control, no column, and **g** does nothing.
- Resize to 1120 px, then to 760 px: the header line fits on one line, and below 1000 px the "Group" label hides.

- [ ] **Step 7: Check both themes**

With `mcp__playwright__browser_emulate_media` set to `dark`, then to `light`, take a screenshot of Mine with the groups on and with the groups off. The headings, the darker lines, the grey "No client or project" and the Group control must be readable in both.

- [ ] **Step 8: Check that no write was tried, and clean up**

- `mcp__playwright__browser_network_requests`: no request other than GET and OPTIONS reached port 8791 (blocked ones show status 500).
- Close the browser. Stop Vite and the scratch backend.
- Delete `.playwright-mcp/` in the worktree if it exists. It can hold real client names:

```bash
rm -rf /Users/thibaultdody/dev/worktrees/todo-hub/main/.playwright-mcp
cd /Users/thibaultdody/dev/worktrees/todo-hub/main && git status --short
```

Expected: `git status` shows no changes.

- [ ] **Step 9: Fix what the check found**

For each problem: fix it in `pulls.ts` or `styles.css`, run `npx tsc --noEmit`, check it again in the browser, and commit with an `App:` message.

---

### Task 6: Docs

**Files:**
- Modify: `README.md` (the **Pull requests** bullets)
- Modify: `DESIGN.md` (after "### The stack rail (Pull requests)")
- Modify: `.impeccable/surfaces/app-src-pulls-ts.md` ("## Decided with Thibault")

- [ ] **Step 1: README**

Find:

```markdown
  - **Table:** click a header to sort; Next step puts the most urgent first, then the oldest. Comment counts leave out bots, and "3 open" counts the unresolved threads that people started (of the 30 newest). Drafts in no stack fold under **N drafts**. Click the Linear issue under a title (ENG-123) to open it in Linear.
```

Replace with:

```markdown
  - **Table:** click a header to sort; Next step puts the most urgent first, then the oldest. Rows with the same value sort by Next step. **#** is the pull request number: the first click puts the newest first, and a stack sorts by its lowest number. Comment counts leave out bots, and "3 open" counts the unresolved threads that people started (of the 30 newest). Drafts in no stack fold under **N drafts**. Click the Linear issue under a title (ENG-123) to open it in Linear.
  - **Client / project** (Mine only): the client label of the Linear issue that a pull request names, else the issue's project, else "No client or project" (no issue, or one that is not one of your open issues). A stack takes the group of its base pull request.
    - In a window 1400 px wide or more, a **Client / project** column shows it on each row. Sorted by it, a name shows only where it changes.
    - **Group** (next to Refresh all, or **g**) splits Mine into one section for each client or project, with the heading of Client and Dev: "5 open · 2 need you · 1 CI failing". The rows sort inside each section. The section with the most urgent first row comes first, and "No client or project" comes last. Click a heading to fold its section until the app restarts. In a section, a stack member in another client or project names it under its title. The app remembers whether the groups are on.
```

- [ ] **Step 2: DESIGN.md**

Find:

```markdown
- **Context rows:** a pull request that the view or the filter leaves out stays in its place, in Pencil at 400, with no status colors. A stack never splits.
```

Replace with:

```markdown
- **Context rows:** a pull request that the view or the filter leaves out stays in its place, in Pencil at 400, with no status colors. A stack never splits.

### Groups (Pull requests)

Mine shows the client or project of each pull request: in a column when the groups are off, and in sections when they are on.

- **Number column:** the first sortable column, 64px wide. A Pencil "#", then the number in Ink, 13px tabular. A stack's summary row shows its lowest number, all in Pencil.
- **Client / project column:** 168px, after the title. It shows only in Mine with the groups off, in windows 1400px wide or more. An 18px client logo or project initial with 5px corners, then the name at 13px with an ellipsis. "No client or project" has a "–" initial and a Pencil name.
- **Runs:** sorted by Client / project, a name shows only where the group changes, and that row gets a darker top line (Pencil 40% into Hairline).
- **Group control:** a 12px Pencil "Group" label and the segmented control (None · Client or project), before Refresh all. Paper, a Hairline border, 7px corners, 12px Pencil text. The pressed one has the accent fill and 600 text. Below 1000px the label hides.
- **Section heading:** a row across the table. A chevron (down when open, right when folded), the 26px logo or initial, the name at 16px and 700, the 12px Pencil summary ("5 open · 2 need you · 1 CI failing", the CI part in Alarm Red), then a Hairline rule to the edge. 22px above it (10px for the first), 6px below it, a Hairline under it. A click folds the section to its heading.
```

- [ ] **Step 3: The surface notes**

In `.impeccable/surfaces/app-src-pulls-ts.md`, find:

```markdown
## Decided in the build (from real GitHub data, to confirm)
```

Replace with:

```markdown
- The pull request number has its own sortable column, **#**, in Mine and To review (2026-11-16). The meta line keeps only the repo name.
- Mine groups by client or project: the client label of the Linear issue, else its project, else "No client or project". It combines prototype A (sections, from the Group control or g) and prototype B (a sortable Client / project column when the groups are off). The column hides in the sections.
- Pull requests with no client or project share one group, not one group for each repo.
- To review has no column and no groups: on 2026-11-16, none of its 7 pull requests named one of his open issues.
- The Client / project column shows only in windows 1400px wide or more. At the default 1120px, the titles would get no room. The groups work at every width.

## Decided in the build (from real GitHub data, to confirm)
```

- [ ] **Step 4: Commit**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main
git add README.md DESIGN.md .impeccable/surfaces/app-src-pulls-ts.md
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
README, DESIGN: the # column and the groups by client or project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Final checks and the branch

- [ ] **Step 1: Run all checks**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npx tsc --noEmit && npm run build 2>&1 | tail -3
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/backend && uv run pytest -q 2>&1 | tail -2
```

Expected: no type errors, `vite build` ends with `built in`, and pytest ends with `N passed`.

- [ ] **Step 2: Scan the whole branch for private data**

The scanner reads the files that `git diff --cached` names. A scratch index that holds `main` makes it name every file that the branch changed:

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main && git diff main --stat
GIT_INDEX_FILE="$(mktemp -u)" sh -c 'git read-tree main && python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"'
```

Expected: `clean`, or only the known false positives from the scanner's docstring.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch. Ask the user before any push or pull request.
