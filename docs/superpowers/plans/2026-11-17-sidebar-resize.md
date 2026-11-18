# Sidebar resize and hide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag the sidebar's right edge to set its width (200 to 400px), and hide it to the 60px icon column with a button or ⌃⌘S. The page's width rules measure the page, so they stay correct at every sidebar width.

**Architecture:** A new module, `app/src/sidebar.ts`, owns the sidebar's frame: the saved width (`--side-w` on `#app`), the saved choice, the `side-icons` class on `#app`, the drag edge and the hide button. `main.ts` adds the edge and the button and handles ⌃⌘S. In `styles.css`, the two 820px media queries for the icon column become `#app.side-icons` rules, and the page's width media queries become container queries on `main`.

**Tech Stack:** TypeScript with the app's `h()` and `svg()` DOM helpers, CSS container queries, Vite, Tauri (WKWebView). The app has no unit tests: `npx tsc --noEmit`, `npm run build` and a Playwright check are its tests.

**Spec:** `docs/superpowers/specs/2026-11-17-sidebar-resize-design.md`.

**Worktree:** `/Users/thibaultdody/dev/worktrees/todo-hub/main`, branch `sidebar-resize`. Run every command from there (Task 0 sets it up).

---

## Conventions

**No private data.** Nothing about work clients goes in this repo. Before every commit, run the privacy scan on the staged files:

```bash
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
```

Expected: `clean`. Its docstring lists the known false positives. Fix any other hit before the commit.

**Commit messages** name the area first, as the log does: `App: …`, `README, PRODUCT, DESIGN: …`. End each with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Edits** below are "Find … Replace with …" pairs. Each "Find" block is unique in its file. Copy them exactly, with their indentation.

**Words.** "Icon column" is the 60px sidebar (class `side-icons`). Do not call it `rail`: the Pull requests table already has a `rail` class for its stack line. "Page width" is the content box of `main`: the window, less the sidebar, less the page's side padding (2 × 28px on Inbox, Today, Client, Dev and Pull requests; 2 × 20px on Insights and Settings).

---

## File map

| File | Change |
|---|---|
| `app/src/sidebar.ts` | New. Width, choice, `side-icons` class, drag edge, hide button. |
| `app/src/main.ts` | Import; the edge in `start()`; the button in `renderHeader()`; ⌃⌘S; a row in `SHORTCUTS`. |
| `app/src/styles.css` | `--side` and `#app.side-icons`; the button and edge styles; the icon-column rules; container queries. |
| `README.md`, `DESIGN.md`, `PRODUCT.md` | The sidebar and the width rules. |
| `.impeccable/design.json`, `.impeccable/surfaces/app-src-pulls-ts.md` | Breakpoints as page widths. |

---

### Task 0: Worktree and baseline

- [ ] **Step 1: Move the branch to the worktree**

The branch `sidebar-resize` (with the spec and this plan) is checked out in `/Users/thibaultdody/github/tdody/todo-hub`. A branch can be checked out in one place only.

```bash
git -C /Users/thibaultdody/github/tdody/todo-hub status --short
git -C /Users/thibaultdody/github/tdody/todo-hub switch main
git -C /Users/thibaultdody/dev/worktrees/todo-hub/main status --short
git -C /Users/thibaultdody/dev/worktrees/todo-hub/main switch sidebar-resize
```

Expected: both `status --short` print nothing (stop and ask if not). The last command prints `Switched to branch 'sidebar-resize'`.

- [ ] **Step 2: Type-check and build the app**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npm ci --silent && npm run build 2>&1 | tail -3
```

Expected: the build ends with `✓ built in …`. If it fails before any change, stop and report it.

---

### Task 1: App: `sidebar.ts`, the drag edge, the hide button and ⌃⌘S

**Files:**
- Create: `app/src/sidebar.ts`
- Modify: `app/src/main.ts` (imports at the top; `renderHeader()` near line 3303; the `keydown` handler near line 3605; `SHORTCUTS` near line 3507; `start()` near line 3733)

- [ ] **Step 1: Create `app/src/sidebar.ts`**

```ts
// The sidebar's frame, remembered on this Mac: its width (drag its right edge) and the icon column
// (the hide button or ⌃⌘S; a window 820px or narrower always has it). main.ts renders what is inside.
import { h, loadPref, savePref, svg } from "./dom";

const WIDTH_KEY = "todohub.sidebarWidth";
const COLLAPSED_KEY = "todohub.sidebarCollapsed";
const DEFAULT_WIDTH = 224;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const narrow = matchMedia("(max-width: 820px)");     // styles.css hides the hide button at the same width
const SIDEBAR_ICON = "M4.5 3.5h11A1.5 1.5 0 0 1 17 5v10a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15V5a1.5 1.5 0 0 1 1.5-1.5zM8 3.5v13";

let width = DEFAULT_WIDTH;
let collapsed = loadPref(COLLAPSED_KEY) === "1";
let rerender = () => {};

function app(): HTMLElement {
  return document.querySelector<HTMLElement>("#app")!;
}

/** Kept between 200 and 400px. styles.css also caps it, so the page keeps 600px of the window. */
function setWidth(px: number) {
  width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px)));
  app().style.setProperty("--side-w", `${width}px`);
}

function showIcons() {
  app().classList.toggle("side-icons", collapsed || narrow.matches);
}

/** Before the first render. ``onToggle`` re-renders the sidebar, so the hide button's label follows. */
export function setupSidebar(onToggle: () => void) {
  rerender = onToggle;
  setWidth(Number(loadPref(WIDTH_KEY)) || DEFAULT_WIDTH);
  showIcons();
  narrow.addEventListener("change", showIcons);
}

/** The hide button and ⌃⌘S: the icon column, or the full sidebar again. A narrow window keeps the icons. */
export function toggleSidebar() {
  if (narrow.matches) return;
  collapsed = !collapsed;
  savePref(COLLAPSED_KEY, collapsed ? "1" : "0");
  showIcons();
  rerender();
}

/** The hide button: in the brand row after +, and under + in the icon column. */
export function sidebarToggle(): HTMLElement {
  const label = collapsed ? "Show sidebar" : "Hide sidebar";
  return h("button", { class: "icon side-toggle", title: `${label} (⌃⌘S)`, "aria-label": label, onclick: toggleSidebar },
    svg("svg", { viewBox: "0 0 20 20", width: 18, height: 18, fill: "none", stroke: "currentColor",
      "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
      svg("path", { d: SIDEBAR_ICON })));
}

/** The sidebar follows the pointer; the width is saved when the pointer is released. */
function startDrag(e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();                        // no text selection while dragging
  const edge = e.currentTarget as HTMLElement;
  edge.setPointerCapture(e.pointerId);
  document.body.classList.add("side-drag");
  const follow = (m: PointerEvent) => setWidth(m.clientX);
  edge.addEventListener("pointermove", follow);
  edge.addEventListener("lostpointercapture", () => {
    edge.removeEventListener("pointermove", follow);
    document.body.classList.remove("side-drag");
    savePref(WIDTH_KEY, String(width));
  }, { once: true });
}

/** The drag edge on the sidebar's right side. It is beside the sidebar, not in it: renderHeader()
 *  replaces the sidebar's children, and that would stop a drag. A double-click sets 224px again. */
export function sidebarEdge(): HTMLElement {
  return h("div", {
    class: "side-edge", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize the sidebar",
    onpointerdown: startDrag,
    ondblclick: () => { setWidth(DEFAULT_WIDTH); savePref(WIDTH_KEY, String(width)); },
  });
}
```

- [ ] **Step 2: Import it in `main.ts`**

Find:

```ts
import { applyTheme, currentTheme, nextTheme, onDaylightPhase, setTheme, themeIcon, themeLabel, themeOptions } from "./theme";
```

Replace with:

```ts
import { applyTheme, currentTheme, nextTheme, onDaylightPhase, setTheme, themeIcon, themeLabel, themeOptions } from "./theme";
import { setupSidebar, sidebarEdge, sidebarToggle, toggleSidebar } from "./sidebar";
```

- [ ] **Step 3: The edge and the setup in `start()`**

Find:

```ts
  document.querySelector("#app")!.replaceChildren(h("aside", { class: "sidebar" }), h("main", {}), h("div", { class: "toasts", role: "status" }));
  render();
```

Replace with:

```ts
  document.querySelector("#app")!.replaceChildren(h("aside", { class: "sidebar" }), sidebarEdge(), h("main", {}),
    h("div", { class: "toasts", role: "status" }));
  setupSidebar(renderHeader);
  render();
```

The edge is `position: fixed`, so it takes no grid cell: `main` stays in the second column.

- [ ] **Step 4: The hide button in the brand row (`renderHeader()`)**

Find:

```ts
      h("button", {
        class: "icon add", title: "Capture a task (c)", "aria-label": "Capture a task",
        onclick: () => { goTab("inbox"); captureInput.focus(); },
      }, "+")),
```

Replace with:

```ts
      h("button", {
        class: "icon add", title: "Capture a task (c)", "aria-label": "Capture a task",
        onclick: () => { goTab("inbox"); captureInput.focus(); },
      }, "+"),
      sidebarToggle()),
```

- [ ] **Step 5: ⌃⌘S in the `keydown` handler**

It goes with the other ⌘ keys, before the `typing` check, so it also works from a text field.

Find:

```ts
  if ((e.metaKey || e.ctrlKey) && e.key === ",") {          // the Mac's usual Settings shortcut
    e.preventDefault();
    goTab("settings");
    return;
  }
```

Replace with:

```ts
  if ((e.metaKey || e.ctrlKey) && e.key === ",") {          // the Mac's usual Settings shortcut
    e.preventDefault();
    goTab("settings");
    return;
  }
  if (e.metaKey && e.ctrlKey && e.key.toLowerCase() === "s") {   // the Mac's usual Show/Hide Sidebar
    e.preventDefault();
    toggleSidebar();
    return;
  }
```

- [ ] **Step 6: The row in the shortcuts sheet**

Find:

```ts
  ["⌘1 – ⌘7", "Inbox, Today, Client, Dev, Pull requests, Insights, Settings (also ⌘,)"],
```

Replace with:

```ts
  ["⌘1 – ⌘7", "Inbox, Today, Client, Dev, Pull requests, Insights, Settings (also ⌘,)"],
  ["⌃⌘S", "Hide the sidebar to icons, or show it again (drag its edge to resize it)"],
```

- [ ] **Step 7: Type-check**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npx tsc --noEmit && echo TSC OK
```

Expected: `TSC OK`.

No commit yet: without Task 2's styles, the edge has no size and the icon column has no rules.

---

### Task 2: App: the styles for the frame, the button, the edge and the icon column

**Files:**
- Modify: `app/src/styles.css` (lines 110–175 and 1276–1281)

- [ ] **Step 1: The frame**

Find:

```css
/* App frame: sidebar on the left, the page on the right. */
#app { display: grid; grid-template-columns: 224px minmax(0, 1fr); min-height: 100vh; }
```

Replace with:

```css
/* App frame: sidebar on the left, the page on the right. sidebar.ts sets --side-w (the dragged width) and
   .side-icons (the icon column). --side caps the sidebar, so the page keeps 600px of the window. */
#app { --side: min(var(--side-w, 224px), 100vw - 600px); display: grid; grid-template-columns: var(--side) minmax(0, 1fr); min-height: 100vh; }
#app.side-icons { grid-template-columns: 60px minmax(0, 1fr); }
```

- [ ] **Step 2: The hide button and the drag edge**

Find:

```css
.side-brand .add:hover { color: var(--accent); background: var(--surface-2); }
```

Replace with:

```css
.side-brand .add:hover { color: var(--accent); background: var(--surface-2); }
/* The hide button: a quiet icon right after +. */
.side-brand .side-toggle { width: 26px; height: 26px; padding: 0; margin-left: -4px; display: inline-flex; align-items: center;
  justify-content: center; border-radius: 7px; }
.side-brand .side-toggle:hover { color: var(--ink); background: var(--surface-2); }
/* The drag edge: 6px over the sidebar's hairline, with a 2px accent line on hover and while dragging. */
.side-edge { position: fixed; top: 0; bottom: 0; left: calc(var(--side) - 3px); width: 6px; z-index: 6; cursor: col-resize; touch-action: none; }
.side-edge::after { content: ""; position: absolute; top: 0; bottom: 0; left: 2px; width: 2px; background: var(--accent);
  opacity: 0; transition: opacity .12s; }
.side-edge:hover::after, body.side-drag .side-edge::after { opacity: 1; }
body.side-drag { cursor: col-resize; }
```

`.side-brand .side-toggle:hover` (3 classes) wins over `button.icon:hover`, which turns icons Alarm Red for the × buttons.

- [ ] **Step 3: The icon column, first block**

Find:

```css
/* Narrow window: the sidebar shrinks to icons. */
@media (max-width: 820px) {
  #app { grid-template-columns: 60px minmax(0, 1fr); }
  .sidebar { padding: 12px 8px; align-items: center; }
  .sidebar .nav-label, .side-group, .side-clients, .sweep-line, .sweep-sources, .sweep-actions .secondary, .src-head, .src-list, .sweep-next { display: none; }
  .side-brand { flex-direction: column; padding: 2px 0 10px; }
  .side-brand .add { margin: 6px 0 0; }
  .nav { position: relative; justify-content: center; padding: 8px; }
  .nav .count { position: absolute; top: 0; right: -2px; margin: 0; font-size: 10px; }
  .nav .count:not(.hot) { display: none; }
  .sweep { padding: 10px 0 0; border-top: 0; }
  .sweep-actions { flex-direction: column; }
}
```

Replace with:

```css
/* The icon column: the sidebar hidden, or a window 820px or narrower (sidebar.ts sets .side-icons). */
#app.side-icons .sidebar { padding: 12px 8px; align-items: center; }
#app.side-icons :is(.nav-label, .side-group, .side-clients, .side-edge) { display: none; }
#app.side-icons .side-brand { flex-direction: column; padding: 2px 0 10px; }
#app.side-icons .side-brand .add { margin: 6px 0 0; }
#app.side-icons .side-brand .side-toggle { margin: 0; }
#app.side-icons .nav { position: relative; justify-content: center; padding: 8px; }
#app.side-icons .nav .count { position: absolute; top: 0; right: -2px; margin: 0; font-size: 10px; }
#app.side-icons .nav .count:not(.hot) { display: none; }
#app.side-icons .sweep { padding: 10px 0 0; border-top: 0; }
#app.side-icons .sweep-actions { flex-direction: column; }
/* A narrow window always shows the icon column, so it has no hide button. */
@media (max-width: 820px) { .side-brand .side-toggle { display: none; } }
```

The dropped selectors: `.sweep-line`, `.sweep-sources`, `.sweep-actions .secondary`, `.src-head` and `.sweep-next` name classes that no code makes. `.src-list` is only in the Sources popover, where the second block showed it again.

- [ ] **Step 4: The icon column, second block (the Sources popover)**

Find:

```css
@media (max-width: 820px) {
  .src-line-text { display: none; }
  .src-line { flex: none; justify-content: center; }
  .src-menu .menu.src-pop { position: fixed; left: 68px; right: auto; bottom: 16px; width: 260px; }
  .src-pop .src-list { display: flex; }
}
```

Replace with:

```css
#app.side-icons .src-line-text { display: none; }
#app.side-icons .src-line { flex: none; justify-content: center; }
#app.side-icons .src-menu .menu.src-pop { position: fixed; left: 68px; right: auto; bottom: 16px; width: 260px; }
```

- [ ] **Step 5: Check that no 820px rule is left**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && grep -n "820px" src/styles.css src/sidebar.ts
```

Expected: 4 lines. In `styles.css`: the icon-column comment and the hide button's `@media (max-width: 820px)`. In `sidebar.ts`: the header comment and `narrow`.

- [ ] **Step 6: Build**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npm run build 2>&1 | tail -3
```

Expected: `✓ built in …`.

- [ ] **Step 7: Commit**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main
git add app/src/sidebar.ts app/src/main.ts app/src/styles.css
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
App: drag the sidebar's edge to resize it, and hide it to icons

A drag edge sets the width (200 to 400px, double-click for 224px), and
the button after + or ⌃⌘S shrinks the sidebar to the icon column. Both
are remembered on this Mac. The icon column is one class, side-icons,
for a hidden sidebar and for a window 820px or narrower.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Expected: `clean`, then the new commit.

---

### Task 3: App: the page's width rules become container queries

Each threshold is the page width that the old window threshold gave with the 224px sidebar: window − 280px on wide pages (Inbox, Today, Client, Dev, Pull requests), window − 264px on Insights and Settings.

**Files:**
- Modify: `app/src/styles.css`

- [ ] **Step 1: `main` is the query container**

Find:

```css
main { width: 100%; box-sizing: border-box; max-width: 1020px; margin: 0 auto; padding: 16px 20px 80px; }
```

Replace with:

```css
/* Width rules use container queries on main, so they measure the page and hold at any sidebar width.
   Page width = window − sidebar − side padding (2 × 28px on wide pages, 2 × 20px on Insights and Settings). */
main { width: 100%; box-sizing: border-box; max-width: 1020px; margin: 0 auto; padding: 16px 20px 80px; container-type: inline-size; }
```

- [ ] **Step 2: Delete the dead `.row` width rule**

No code makes a `.row` element. Find:

```css
@media (max-width: 900px) {
  .row { grid-template-columns: 26px 26px 72px 1fr 120px; }
  .row select.prio, .row input.date { grid-column: span 1; }
}

```

Replace with nothing (an empty string).

- [ ] **Step 3: Insights, two-column panels (760 → 496)**

Find:

```css
@media (max-width: 760px) { .two-col { grid-template-columns: 1fr; } }
```

Replace with:

```css
@container (max-width: 496px) { .two-col { grid-template-columns: 1fr; } }
```

- [ ] **Step 4: Client and Dev, the pane under the list (1000 → 720)**

Find:

```css
@media (max-width: 1000px) { .tl-grid { grid-template-columns: 1fr; } .tl-pane { position: static; max-height: none; } }
```

Replace with:

```css
@container (max-width: 720px) { .tl-grid { grid-template-columns: 1fr; } .tl-pane { position: static; max-height: none; } }
```

- [ ] **Step 5: Today, the pane under the list (1000 → 720)**

Find:

```css
/* A narrow window: the list, then the selected issue under it. */
@media (max-width: 1000px) {
  .td-cols {
```

Replace with:

```css
/* A narrow page: the list, then the selected issue under it. */
@container (max-width: 720px) {
  .td-cols {
```

- [ ] **Step 6: Inbox, the "why" line (1280 → 1000) and the pane under the list (1000 → 720)**

Find:

```css
@media (min-width: 1280px) { .ib-why { display: block; } }
```

Replace with:

```css
@container (min-width: 1000px) { .ib-why { display: block; } }
```

Find:

```css
@media (max-width: 1000px) { .ib { grid-template-columns: 1fr; } .ib-pane { position: static; max-height: none; } }
```

Replace with:

```css
@container (max-width: 720px) { .ib { grid-template-columns: 1fr; } .ib-pane { position: static; max-height: none; } }
```

- [ ] **Step 7: Settings (860 → 596) and the Inbox's recently decided rows (860 → 580)**

Find:

```css
@media (max-width: 860px) {
  .set-wrap { grid-template-columns: 1fr; }
```

Replace with:

```css
@container (max-width: 596px) {
  .set-wrap { grid-template-columns: 1fr; }
```

Find:

```css
@media (max-width: 860px) {
  .decided-row { grid-template-columns: 1fr auto; }
```

Replace with:

```css
@container (max-width: 580px) {
  .decided-row { grid-template-columns: 1fr auto; }
```

- [ ] **Step 8: Pull requests, the darker group line (> 1400 → > 1120)**

Find:

```css
/* sorted by Client / project: a darker line where the group changes. With collapsed borders the row
   above owns that line; the column must show (it folds below 1400px). */
@media (width > 1400px) {
```

Replace with:

```css
/* sorted by Client / project: a darker line where the group changes. With collapsed borders the row
   above owns that line; the column must show (it folds at a 1120px page and narrower). */
@container (width > 1120px) {
```

- [ ] **Step 9: Pull requests, the header line and the detail boxes (1000 → 720)**

Find:

```css
@media (max-width: 1000px) {
  .seg-n { display: none; }
```

Replace with:

```css
@container (max-width: 720px) {
  .seg-n { display: none; }
```

- [ ] **Step 10: Pull requests, the columns that fold (1400 → 1120, 1200 → 920, 900 → 620, 860 → 580)**

Find:

```css
/* A narrow window collapses a column to zero width; its cells stay, so the open row's colspan still fits.
   Client / project folds first, below 1400px: at the default 1120px window the titles would get no room. */
@media (max-width: 1400px) {
```

Replace with:

```css
/* A narrow page collapses a column to zero width; its cells stay, so the open row's colspan still fits.
   Client / project folds first, at a 1120px page: at the default window (an 840px page) the titles would get no room. */
@container (max-width: 1120px) {
```

Find:

```css
@media (max-width: 1200px) {
  .pr-table th.c-size {
```

Replace with:

```css
@container (max-width: 920px) {
  .pr-table th.c-size {
```

Find:

```css
@media (max-width: 900px) {
  .pr-table th.c-cm {
```

Replace with:

```css
@container (max-width: 620px) {
  .pr-table th.c-cm {
```

Find:

```css
@media (max-width: 860px) { .prs .dgrid { grid-template-columns: 1fr; } }
```

Replace with:

```css
@container (max-width: 580px) { .prs .dgrid { grid-template-columns: 1fr; } }
```

- [ ] **Step 11: Check that no width media query is left**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && grep -n "@media" src/styles.css | grep -v "prefers-"
```

Expected: one line, the hide button's `@media (max-width: 820px)`.

```bash
grep -c "@container" src/styles.css
```

Expected: `13`.

- [ ] **Step 12: Build and commit**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npm run build 2>&1 | tail -3
cd /Users/thibaultdody/dev/worktrees/todo-hub/main
git add app/src/styles.css
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
App: the width rules measure the page, not the window

Each media query that assumed the 224px sidebar becomes a container
query on main, at the page width that the window gave with that sidebar.
A hidden, narrower or wider sidebar now folds the Pull requests columns
and moves the reading panes at the right point. The dead .row width
rule goes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Expected: `✓ built in …`, `clean`, then the new commit.

---

### Task 4: Browser check

Check the app on a copy of the settings folder, with every write blocked. Do not start the real app: the user may run a dev copy (vite on :1420).

- [ ] **Step 1: A scratch settings folder**

```bash
S=$(mktemp -d /private/tmp/claude-501/-Users-thibaultdody-github-tdody-todo-hub/cff14c58-23b8-4645-a80e-7deb4356e5d9/scratchpad/home.XXXX)
cp "$HOME/Library/Application Support/TodoHub/"{config.toml,settings.json,todohub.db,client_domains.json} "$S"/
sqlite3 "$S/todohub.db" "SELECT count(*) FROM candidates WHERE status = 'pending';"
echo "$S"
```

Expected: a count of 2 or more (the Inbox needs cards for the pane check). If it is less, run:

```bash
sqlite3 "$S/todohub.db" "UPDATE candidates SET status = 'pending', snooze_until = NULL WHERE id IN (SELECT id FROM candidates ORDER BY id DESC LIMIT 4);"
```

Keep the folder path for Step 2.

- [ ] **Step 2: Start the backend and two UIs: the branch on :1430, `main` on :1431**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/backend && TODOHUB_HOME="$S" TODOHUB_TOKEN=x uv run python -m todohub.api --port 8791
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npx vite --port 1430 --strictPort
cd /Users/thibaultdody/github/tdody/todo-hub/app && npx vite --port 1431 --strictPort
```

Run each with `run_in_background: true`. The third serves `main` from the main checkout (Task 0 switched it to `main`), for the icon-column comparison. Expected: the backend logs `Uvicorn running on http://127.0.0.1:8791`; each vite prints its `Local:` URL.

- [ ] **Step 3: Open the branch in Playwright with writes blocked**

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
      await page.evaluate((x) => { (window.__writes ??= []).push(x); }, { method: req.method(), url: req.url() });
      return route.fulfill({ status: 500, headers: cors, contentType: "application/json", body: '{"error":"blocked in the browser check"}' });
    }
    const res = await route.fetch();
    return route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
  await page.setViewportSize({ width: 1120, height: 800 });
  await page.goto("http://localhost:1430/");
  await page.evaluate(() => { localStorage.removeItem("todohub.sidebarWidth"); localStorage.removeItem("todohub.sidebarCollapsed"); });
  await page.reload();
  await page.waitForSelector("aside.sidebar .nav");
  return await page.evaluate(() => document.querySelector("aside.sidebar").getBoundingClientRect().width);
}
```

Expected: `224`.

- [ ] **Step 4: The drag edge, the double-click and the brand row at 200px**

```js
async (page) => {
  const w = () => page.evaluate(() => document.querySelector("aside.sidebar").getBoundingClientRect().width);
  const r = { start: await w() };
  await page.mouse.move(224, 400); await page.mouse.down();
  await page.mouse.move(150, 400, { steps: 5 }); r.min = await w();
  r.brandFits = await page.evaluate(() => {
    const side = document.querySelector("aside.sidebar").getBoundingClientRect();
    const t = document.querySelector(".side-toggle").getBoundingClientRect();
    return t.right <= side.right - 8;
  });
  await page.mouse.move(600, 400, { steps: 5 }); r.max = await w();
  await page.mouse.move(300, 400, { steps: 5 }); await page.mouse.up(); r.dragged = await w();
  r.saved = await page.evaluate(() => localStorage.getItem("todohub.sidebarWidth"));
  await page.reload(); await page.waitForSelector("aside.sidebar .nav"); r.afterReload = await w();
  await page.mouse.dblclick(300, 400); r.dblclick = await w();
  r.savedAfterDbl = await page.evaluate(() => localStorage.getItem("todohub.sidebarWidth"));
  return r;
}
```

Expected: `{ start: 224, min: 200, brandFits: true, max: 400, dragged: 300, saved: "300", afterReload: 300, dblclick: 224, savedAfterDbl: "224" }`. Take a screenshot while you hover the edge (`page.mouse.move(224, 300)`): the 2px accent line shows over the hairline.

- [ ] **Step 5: The hide button, ⌃⌘S and a reload**

```js
async (page) => {
  const w = () => page.evaluate(() => document.querySelector("aside.sidebar").getBoundingClientRect().width);
  const label = () => page.getAttribute(".side-toggle", "aria-label");
  const r = {};
  await page.click(".side-toggle"); r.hidden = await w(); r.hiddenLabel = await label();
  r.edgeHidden = await page.evaluate(() => getComputedStyle(document.querySelector(".side-edge")).display === "none");
  await page.keyboard.press("Control+Meta+KeyS"); r.shown = await w(); r.shownLabel = await label();
  await page.keyboard.press("Control+Meta+KeyS"); r.hiddenByKey = await w();
  await page.reload(); await page.waitForSelector("aside.sidebar .nav"); r.afterReload = await w();
  await page.click(".side-toggle"); r.back = await w();
  return r;
}
```

Expected: `{ hidden: 60, hiddenLabel: "Show sidebar", edgeHidden: true, shown: 224, shownLabel: "Hide sidebar", hiddenByKey: 60, afterReload: 60, back: 224 }`. Take a screenshot of the icon column at 1120: the hide button sits under **+**.

If `shown` is 60, check that the key reached the page: `page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, metaKey: true })))`. If that works, Playwright's key press did not reach the page, and the code is fine; check the key once by hand in the real app before the PR.

- [ ] **Step 6: A narrow window, and the 600px cap**

```js
async (page) => {
  const w = () => page.evaluate(() => document.querySelector("aside.sidebar").getBoundingClientRect().width);
  const r = {};
  await page.setViewportSize({ width: 760, height: 600 });
  r.narrow = await w();
  r.noButton = await page.evaluate(() => getComputedStyle(document.querySelector(".side-toggle")).display === "none");
  r.noEdge = await page.evaluate(() => getComputedStyle(document.querySelector(".side-edge")).display === "none");
  await page.keyboard.press("Control+Meta+KeyS");
  r.prefAfterKey = await page.evaluate(() => localStorage.getItem("todohub.sidebarCollapsed"));
  await page.setViewportSize({ width: 1120, height: 800 }); r.wideAgain = await w();
  await page.evaluate(() => localStorage.setItem("todohub.sidebarWidth", "400"));
  await page.reload(); await page.waitForSelector("aside.sidebar .nav");
  await page.setViewportSize({ width: 821, height: 700 }); r.capped = await w();
  await page.setViewportSize({ width: 1120, height: 800 }); r.uncapped = await w();
  return r;
}
```

Expected: `{ narrow: 60, noButton: true, noEdge: true, prefAfterKey: "0", wideAgain: 224, capped: 221, uncapped: 400 }`.

- [ ] **Step 7: The width rules at each window and sidebar width**

This sets the width and the class directly, to measure the CSS only (Steps 4 to 6 checked the controls). At 820px and narrower only the icon column is real, so the other widths are skipped there.

```js
async (page) => {
  const measure = () => {
    const m = document.querySelector("main"), cs = getComputedStyle(m);
    const shown = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none" : null; };
    const cols = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).gridTemplateColumns.split(" ").length : null; };
    const right = document.querySelector(".page-right");
    return {
      page: m.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      side: document.querySelector("aside.sidebar").getBoundingClientRect().width,
      grp: shown(".pr-table th.c-grp"), size: shown(".pr-table th.c-size"), cm: shown(".pr-table th.c-cm"),
      why: shown(".ib-why"), ib: cols(".ib"), tl: cols(".tl-grid"), td: cols(".td-cols"),
      headFits: right ? right.getBoundingClientRect().right <= m.getBoundingClientRect().right - parseFloat(cs.paddingRight) + 1 : null,
    };
  };
  const tabs = { inbox: "Meta+1", today: "Meta+2", client: "Meta+3", pulls: "Meta+5" };
  const out = [];
  for (const W of [760, 821, 1120, 1400, 1700]) {
    for (const side of [200, 224, 400, "icons"]) {
      if (W <= 820 && side !== "icons") continue;
      await page.setViewportSize({ width: W, height: 800 });
      await page.evaluate((side) => {
        const app = document.querySelector("#app");
        if (side !== "icons") app.style.setProperty("--side-w", `${side}px`);
        app.classList.toggle("side-icons", side === "icons" || innerWidth <= 820);
      }, side);
      for (const [tab, key] of Object.entries(tabs)) {
        await page.keyboard.press(key);
        await page.waitForTimeout(700);
        out.push({ W, sideSet: side, tab, ...(await page.evaluate(measure)) });
      }
    }
  }
  const wrong = out.filter((r) =>
    (r.grp !== null && r.grp !== r.page > 1120) || (r.size !== null && r.size !== r.page > 920)
    || (r.cm !== null && r.cm !== r.page > 620) || (r.why !== null && r.tab === "inbox" && r.why !== r.page >= 1000)
    || [r.ib, r.tl, r.td].some((c) => c !== null && (c === 1) !== (r.page <= 720))
    || r.headFits === false);
  const missing = Object.keys(tabs).filter((t) => !out.some((r) => r.tab === t && (r.ib ?? r.tl ?? r.td ?? r.grp) !== null));
  return { rows: out.length, wrong, missing, sample: out.filter((r) => r.W === 1120) };
}
```

Expected: `wrong` is empty. `missing` may list `today` when Today shows its morning cover (no `.td-cols`): then press ↵ is not possible (it writes), so note it and check Today's fold by eye at 1120 with a 400px sidebar on a day view, if one shows. `missing` must not list `inbox`, `client` or `pulls`. If it lists `pulls`, the Client / project column may be off because the groups are on: on Pull requests (Mine), press **g** to turn them off (a local choice, no write), and run this step again. In `sample`, the 224px rows have `page` = 840 (wide pages). If a row is wrong, check its `page` against the thresholds in Task 3, fix the CSS, and run this step again.

Then press **Meta+1** and set the window to 1120 again before Step 8.

- [ ] **Step 8: The icon column looks the same as on `main`**

```js
async (page) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("http://localhost:1430/"); await page.waitForSelector("aside.sidebar .nav");
  await page.screenshot({ path: "/private/tmp/claude-501/-Users-thibaultdody-github-tdody-todo-hub/cff14c58-23b8-4645-a80e-7deb4356e5d9/scratchpad/icons-branch.png", clip: { x: 0, y: 0, width: 80, height: 600 } });
  await page.goto("http://localhost:1431/"); await page.waitForSelector("aside.sidebar .nav");
  await page.screenshot({ path: "/private/tmp/claude-501/-Users-thibaultdody-github-tdody-todo-hub/cff14c58-23b8-4645-a80e-7deb4356e5d9/scratchpad/icons-main.png", clip: { x: 0, y: 0, width: 80, height: 600 } });
}
```

Read both PNGs. Expected: the same icons, counts and bottom buttons in the same places. The branch has no hide button at 800px.

- [ ] **Step 9: The popovers**

Go back to the branch: `page.setViewportSize({ width: 1120, height: 800 })`, then `page.goto("http://localhost:1430/")`. Click `.side-toggle` to hide the sidebar. Then:

- Press **r**: the Sources popover opens to the right of the icon column (its left edge at 68px). Press **r** again to close it.
- On the Inbox, click a card, then press **s**: the Snooze menu opens under the card's Snooze button. Press Escape.
- Click `.side-toggle` again, then press **t** until the theme is Dark, hover the edge, and take a screenshot: the accent line shows clearly.

Read `window.__writes` with `browser_evaluate`. Expected: `undefined` or an empty list. It holds the blocked writes since the last page load; nothing in this check writes.

- [ ] **Step 10: Clean up**

Stop the 3 background commands. Then:

```bash
rm -rf /Users/thibaultdody/dev/worktrees/todo-hub/main/.playwright-mcp /Users/thibaultdody/github/tdody/todo-hub/.playwright-mcp "$S"
git -C /Users/thibaultdody/dev/worktrees/todo-hub/main status --short
git -C /Users/thibaultdody/github/tdody/todo-hub status --short
```

Expected: both `status` commands print nothing. Fix what the check found in a new commit (`App: fixes from the browser check`), with `npm run build` and the scan first.

---

### Task 5: Docs

**Files:**
- Modify: `README.md`, `DESIGN.md`, `PRODUCT.md`, `.impeccable/design.json`, `.impeccable/surfaces/app-src-pulls-ts.md`

- [ ] **Step 1: README, the sidebar paragraph**

Find:

```markdown
The theme and shortcuts sit next to the line. In a narrow window the sidebar shrinks to icons.
```

Replace with:

```markdown
The theme and shortcuts sit next to the line. Drag the sidebar's right edge to make it wider or narrower (200 to 400 px; double-click it for 224 px). The sidebar button after **+** (or **⌃⌘S**) shrinks the sidebar to icons, and shows it again. The app remembers both on this Mac. The sidebar always leaves the page 600 px of the window, and in a window 820 px or narrower it is always icons.
```

- [ ] **Step 2: README, the Client / project column**

Find:

```markdown
    - In a window wider than 1400 px, a **Client / project** column shows it on each row.
```

Replace with:

```markdown
    - When the page is wider than 1120 px (a window wider than 1400 px with the default sidebar), a **Client / project** column shows it on each row.
```

- [ ] **Step 3: PRODUCT.md**

Find:

```markdown
In a narrow window the sidebar shrinks to icons and the reading pane moves under the list.
```

Replace with:

```markdown
You can drag the sidebar wider or narrower, or hide it to icons; in a narrow window it is always icons. On a narrow page the reading pane moves under the list.
```

- [ ] **Step 4: DESIGN.md, Layout**

Find:

```markdown
The window is a fixed 224px sidebar beside the page.
```

Replace with:

```markdown
The window is the sidebar beside the page. The sidebar is 224px wide by default: a drag on its right edge sets 200–400px, and the hide button shrinks it to the 60px icon column. It always leaves the page 600px of the window.
```

- [ ] **Step 5: DESIGN.md, Responsive behavior**

Find:

```markdown
**Responsive behavior.** The window can shrink to 760×520.

- At 1280px and wider, Inbox rows add a clipped line of "why".
- Below 1000px the reading pane moves under the list.
```

Replace with:

```markdown
**Responsive behavior.** The window can shrink to 760×520. The width rules are container queries on the page, so they hold at every sidebar width. The numbers below are page widths: the window, less the sidebar, less the side padding. With the 224px sidebar, a 1120px window gives an 840px page on Inbox, Today, Client, Dev and Pull requests.

- At a 1000px page and wider, Inbox rows add a clipped line of "why".
- At a 720px page and narrower, the reading pane moves under the list.
```

Find:

```markdown
- Below 900px list rows drop their least important columns (the plan's avatar and due date).
- Below 820px the sidebar becomes a 60px column of icons, keeping only the urgent counts as small badges.
- Below 760px two-column panels stack.
```

Replace with:

```markdown
- In a window 820px or narrower, the sidebar is always the 60px column of icons, keeping only the urgent counts as small badges. The hide button gives the same column in a wider window.
- At a 496px page and narrower, two-column panels stack.
```

- [ ] **Step 6: DESIGN.md, the view strip and the Pull requests table**

Find:

```markdown
- **Narrow windows:** below 1000px the notes go away.
```

Replace with:

```markdown
- **Narrow pages:** at a 720px page and narrower, the notes go away.
```

Find:

```markdown
It shows only in Mine with the groups off, in windows wider than 1400px.
```

Replace with:

```markdown
It shows only in Mine with the groups off, on pages wider than 1120px (a 1400px window with the default sidebar).
```

Find:

```markdown
- **Narrow windows:** Client / project folds below 1400px and Size below 1200px, so the titles keep about 235px at the default 1120px window. Below 1000px the "Group" label hides
```

Replace with:

```markdown
- **Narrow pages:** Client / project folds at a 1120px page and narrower, and Size at 920px, so the titles keep about 235px at the default 1120px window (an 840px page). Comments folds at 620px. At 720px the "Group" label hides
```

- [ ] **Step 7: DESIGN.md, the Sidebar component**

Find:

```markdown
The sources line sits at the bottom with a green or red dot.
```

Replace with:

```markdown
The sources line sits at the bottom with a green or red dot. The hide button (a sidebar glyph in Pencil, Shaded Paper on hover) sits after **+**, and under it in the icon column. The right edge is a 6px drag edge: on hover and while dragging, a 2px accent line covers the hairline.
```

- [ ] **Step 8: `.impeccable/design.json`, the breakpoints**

Find:

```json
    "breakpoints": [
      {
        "name": "stack-panels",
        "value": "760px"
      },
      {
        "name": "sidebar-icons",
        "value": "820px"
      },
      {
        "name": "settings-narrow",
        "value": "860px"
      },
      {
        "name": "row-columns",
        "value": "900px"
      },
      {
        "name": "pane-under-list",
        "value": "1000px"
      },
      {
        "name": "inbox-why-line",
        "value": "1280px"
      }
    ],
```

Replace with:

```json
    "breakpoints": [
      {
        "name": "stack-panels",
        "value": "496px",
        "purpose": "Page width (a container query on main)."
      },
      {
        "name": "sidebar-icons",
        "value": "820px",
        "purpose": "Window width: the sidebar is always the icon column."
      },
      {
        "name": "settings-narrow",
        "value": "596px",
        "purpose": "Page width (a container query on main)."
      },
      {
        "name": "pane-under-list",
        "value": "720px",
        "purpose": "Page width (a container query on main)."
      },
      {
        "name": "inbox-why-line",
        "value": "1000px",
        "purpose": "Page width (a container query on main)."
      }
    ],
```

Check that the file is still valid JSON:

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main && python3 -c "import json; json.load(open('.impeccable/design.json')); print('JSON OK')"
```

Expected: `JSON OK`.

- [ ] **Step 9: `.impeccable/surfaces/app-src-pulls-ts.md`**

Find:

```markdown
- The Client / project column shows only in windows wider than 1400px. At the default 1120px, the titles would get no room. The groups work at every width.
- Size folds below 1200px: with **#** and Size, the titles had about 135px at the default 1120px window.
```

Replace with:

```markdown
- The Client / project column shows only on pages wider than 1120px (a 1400px window with the default sidebar). At the default 1120px window (an 840px page), the titles would get no room. The groups work at every width.
- Size folds at a 920px page and narrower: with **#** and Size, the titles had about 135px at the default 1120px window.
```

- [ ] **Step 10: Check that no old window number is left in the docs**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main && grep -n "1400\|1280px\|Below 1000\|below 1000\|1200px\|fixed 224" README.md DESIGN.md PRODUCT.md .impeccable/surfaces/app-src-pulls-ts.md
```

Expected: only lines that name the window next to its page width ("a 1400px window with the default sidebar", "a window wider than 1400 px with the default sidebar").

- [ ] **Step 11: Commit**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main
git add README.md DESIGN.md PRODUCT.md .impeccable/design.json .impeccable/surfaces/app-src-pulls-ts.md
python3 "$HOME/Library/Application Support/TodoHub/scan_staged.py"
git commit -q -F - <<'EOF'
README, PRODUCT, DESIGN: the sidebar's drag edge and hide button; width rules as page widths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Expected: `clean`, then the new commit.

---

### Task 6: Final check

- [ ] **Step 1: Build from clean**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main/app && npm run build 2>&1 | tail -3
```

Expected: `✓ built in …`.

- [ ] **Step 2: Read the whole diff against `main`**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main && git diff main --stat && git diff main -- app/src
```

Check the diff against the spec and `~/.claude/coding-principles.md`: names use the codebase's words, comments describe current behavior, no guard without a cause, nothing left that the change made dead.

- [ ] **Step 3: Check that every commit on the branch was scanned**

```bash
cd /Users/thibaultdody/dev/worktrees/todo-hub/main && git log --oneline main..
```

Expected: the spec, the plan, Task 2, Task 3 and Task 5 (and a fix commit from Task 4, if any). Each one ran the scan before its commit. If another commit is in the list, stop and ask the user.

- [ ] **Step 4: Ask the user before the push and the PR**

The push and the PR are outward-facing, and the repo is public. Ask the user. When they say yes, push the branch and open the PR with `gh pr create`. List the assumptions from the spec in the PR description, and end it with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
