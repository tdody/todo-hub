# Sidebar: resize it, and hide it to icons

## Goal

- Make the sidebar wider or narrower with a drag on its right edge.
- Hide the sidebar with a button, to give the page more room. The hidden sidebar is the 60px icon column that the app already shows in a narrow window.

## Scope

In:

- The drag edge, the hide button and the **⌃⌘S** key.
- The width rules of the page. They measure the page instead of the window, so they stay correct at each sidebar width.
- The README, `DESIGN.md` and `PRODUCT.md`.

Out:

- A fully hidden sidebar. The icon column keeps the show button, the Inbox count and one-click navigation.
- A drag that snaps the sidebar to the icon column. The hide button and **⌃⌘S** do that.
- Arrow keys on the drag edge. The hide button and **⌃⌘S** are the keyboard path.
- A View menu item in the Tauri shell. The app's other shortcuts are not in the menu either.
- The backend.

## Behavior

### Resize

- A 6px drag edge sits on the right edge of the sidebar, over the hairline. On hover and while you drag, the cursor is `col-resize` and the edge shows a 2px accent line.
- While you drag, the whole window keeps the `col-resize` cursor and no text gets selected.
- The width stays between 200px and 400px. At 200px the brand row (logo, TodoHub, **+**, the hide button) still fits.
- A double-click on the edge sets the width back to 224px.
- The app remembers the width on this Mac, in `todohub.sidebarWidth`. The default is 224px.
- The drag edge does not show when the sidebar is the icon column.

### Hide and show

- The hide button is in the brand row, after **+**. It shows the macOS sidebar glyph: a rounded rectangle with a line near its left side.
- A click shrinks the sidebar to the icon column. In the icon column, the button is under **+**, and a click shows the full sidebar again.
- The button's tooltip and `aria-label` say "Hide sidebar (⌃⌘S)" or "Show sidebar (⌃⌘S)".
- **⌃⌘S** does the same as the button, also from a text field, as the other ⌘ keys do. It is the Mac's usual key for Show/Hide Sidebar.
- The app remembers the choice on this Mac, in `todohub.sidebarCollapsed`. The default is the full sidebar.

### A narrow window

- At 820px or narrower, the sidebar is the icon column, as today. The hide button and the drag edge do not show, and **⌃⌘S** does nothing.
- When the window gets wider than 820px, the sidebar comes back as you left it: full at your width, or the icon column.

### Keys

- The shortcuts sheet (**?**) gets a row: **⌃⌘S**, "Hide or show the sidebar".

## Changes

### The icon column is one class

Today a media query at 820px sets the icon column (`styles.css`, two blocks). It becomes the class `rail` on `#app`, so one set of rules serves both cases.

- `applySidebar()` in `main.ts` sets `rail` when the sidebar is hidden or the window is 820px or narrower (`matchMedia("(max-width: 820px)")`). It also sets `--side-w` on `#app` from the saved width. It runs at start, after the hide button or **⌃⌘S**, and when the media query changes.
- `#app` uses `grid-template-columns: var(--side-w, 224px) minmax(0, 1fr)`. `#app.rail` uses `60px minmax(0, 1fr)`.
- The rules move from the two `@media (max-width: 820px)` blocks to `#app.rail` selectors. The selectors for classes that no code makes any more (`.sweep-line`, `.sweep-sources`, `.sweep-actions .secondary`, `.src-head`, `.sweep-next`) are not carried over.
- `state.sidebarCollapsed` holds the choice. `renderHeader()` reads it for the button's label.

### The drag edge

- The edge is a `div.side-edge` in `#app`, beside the sidebar, not inside it. `renderHeader()` replaces the sidebar's children often, and that must not stop a drag.
- It is `position: fixed`, full height, at `left: calc(var(--side-w) - 3px)`.
- `pointerdown` captures the pointer. `pointermove` sets `--side-w` to the pointer's x, kept between 200px and 400px. `pointerup` saves the width. A drag does not call `render()`.
- It has `role="separator"`, `aria-orientation="vertical"` and `aria-label="Resize the sidebar"`.

### Width rules on the page

`main` gets `container-type: inline-size`. Each width rule that assumed the 224px sidebar becomes a container query. Its threshold is the page width that the window gave with the 224px sidebar:

page width = window − 224px − the page's side padding (2 × 28px on wide pages, 2 × 20px on Insights and Settings).

At the 224px sidebar, the app looks as it does today. With a hidden, narrower or wider sidebar, each rule follows the real page width.

| Rule | Page | Window today | Page width |
|---|---|---|---|
| `.ib-why` shows | Inbox | ≥ 1280px | ≥ 1000px |
| `.ib` stacks | Inbox | ≤ 1000px | ≤ 720px |
| `.decided-row` compacts | Inbox | ≤ 860px | ≤ 580px |
| `.td-cols` stacks, and the rest of that block | Today | ≤ 1000px | ≤ 720px |
| `.tl-grid` stacks | Client, Dev | ≤ 1000px | ≤ 720px |
| A darker line between groups | Pull requests | > 1400px | > 1120px |
| Client / project folds | Pull requests | ≤ 1400px | ≤ 1120px |
| Size folds | Pull requests | ≤ 1200px | ≤ 920px |
| The header line compacts, and the rest of that block | Pull requests | ≤ 1000px | ≤ 720px |
| Comments folds | Pull requests | ≤ 900px | ≤ 620px |
| The detail boxes stack | Pull requests | ≤ 860px | ≤ 580px |
| `.two-col` stacks | Insights | ≤ 760px | ≤ 496px |
| The Settings blocks stack | Settings | ≤ 860px | ≤ 596px |

The `.row` rules, with their 900px media query, style a class that no code makes. They are deleted, not converted.

The comment on the Client / project fold names the page width instead of the window width.

### Docs

- README: the sidebar paragraph says that you can drag its edge and hide it to icons with the button or **⌃⌘S**.
- `DESIGN.md`: the "fixed 224px sidebar" line, the narrow-window line and the Sidebar component.
- `PRODUCT.md`: the narrow-window sentence.

## Checks

The app has no frontend tests, and CI runs `tsc` only.

1. `npm run build` passes.
2. A Playwright check in a scratch setup (`TODOHUB_HOME` copy, vite on :1430, the Tauri shim, every write answered with 500):
   - A drag changes the width, stops at 200px and 400px, and a reload keeps it.
   - A double-click sets 224px.
   - The hide button and **⌃⌘S** switch to the icon column and back, and a reload keeps the choice.
   - At 760px the icon column shows, with no hide button and no drag edge. At 1120px your choice comes back.
   - At windows of 760, 1120 and 1400px, with the sidebar at 200, 224 and 400px and as the icon column: the Pull requests header line fits, the columns fold at the page widths above, and the Inbox, Today and Client panes stack below a 720px page.
   - At the 224px sidebar, the screens match `main` at each window width.
   - The periscope popover, the Snooze and Drop menus and the Sources popover open in their usual places.

## Assumptions

- WKWebView supports container queries. Safari has supported them since version 16 (2022).
- `container-type: inline-size` does not move anything that is positioned inside `main`. The only `position: fixed` elements (the dialog overlay, the toasts and the narrow Sources popover) are outside `main`. The Playwright check confirms this.
- A container query measures the content box of `main`, so the thresholds subtract its padding. The Playwright check confirms each fold point.
- 200px is wide enough for the brand row. The Playwright check confirms it.
