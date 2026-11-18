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
- The sidebar always leaves at least 600px of the window for the page. In a window narrower than the width + 600px, the sidebar gets narrower; at an 821px window it is 221px. So the page is never narrower than today's narrowest page (about 540px). The saved width comes back when the window gets wider.
- A double-click on the edge sets the width back to 224px.
- The app remembers the width on this Mac, in `todohub.sidebarWidth`. The default is 224px.
- The drag edge does not show when the sidebar is the icon column.

### Hide and show

- The hide button is in the brand row, after **+**. It shows the macOS sidebar glyph: a rounded rectangle with a line near its left side.
- A click shrinks the sidebar to the icon column. In the icon column, the button is under **+**, and a click shows the full sidebar again.
- The button's tooltip says "Hide sidebar (⌃⌘S)" or "Show sidebar (⌃⌘S)". Its `aria-label` says "Hide sidebar" or "Show sidebar".
- **⌃⌘S** does the same as the button, also from a text field, as the other ⌘ keys do. It is the Mac's usual key for Show/Hide Sidebar.
- The app remembers the choice on this Mac, in `todohub.sidebarCollapsed`. The default is the full sidebar.

### A narrow window

- At 820px or narrower, the sidebar is the icon column, as today. The hide button and the drag edge do not show, and **⌃⌘S** does nothing.
- When the window gets wider than 820px, the sidebar comes back as you left it: full at your width, or the icon column.

### Keys

- The shortcuts sheet (**?**) gets a row: **⌃⌘S**, "Hide or show the sidebar".

## Changes

### The icon column is one class

Today a media query at 820px sets the icon column (`styles.css`, two blocks). It becomes the class `side-icons` on `#app`, so one set of rules serves both cases.

- A new module, `app/src/sidebar.ts`, owns the sidebar's frame, as `theme.ts` owns the theme: the saved width, the saved choice, the `side-icons` class, the drag edge and the hide button. `main.ts` keeps what is inside the sidebar.
- It sets `side-icons` when the sidebar is hidden or the window is 820px or narrower (`matchMedia("(max-width: 820px)")`). It also sets `--side-w` on `#app` from the saved width. It does this at start, after the hide button or **⌃⌘S**, and when the media query changes.
- `#app` sets `--side: min(var(--side-w, 224px), 100vw - 600px)` and uses `grid-template-columns: var(--side) minmax(0, 1fr)`. `#app.side-icons` uses `60px minmax(0, 1fr)`.
- The rules move from the two `@media (max-width: 820px)` blocks to `#app.side-icons` selectors. The selectors for classes that no code makes any more (`.sweep-line`, `.sweep-sources`, `.sweep-actions .secondary`, `.src-head`, `.sweep-next`) are not carried over. The `.src-list` rules are not carried over either: one hid the list in the sidebar and the other showed it again in the popover, which is the only place it is.
- `renderHeader()` puts the hide button from `sidebar.ts` in the brand row. After the button or **⌃⌘S**, `sidebar.ts` calls `renderHeader()` again, so the label follows.

### The drag edge

- The edge is a `div.side-edge` in `#app`, beside the sidebar, not inside it. `renderHeader()` replaces the sidebar's children often, and that must not stop a drag.
- It is `position: fixed`, full height, at `left: calc(var(--side) - 3px)`.
- `pointerdown` captures the pointer. `pointermove` sets `--side-w` to the pointer's x, kept between 200px and 400px. When the pointer releases, the width is saved. A drag does not call `render()`.
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

The 900px media query for `.row` styles a class that no code makes. It is deleted, not converted. The other `.row` rules are dead too, but they use no width, so they are outside this change.

The comment on the Client / project fold names the page width instead of the window width.

### Docs

- README: the sidebar paragraph says that you can drag its edge and hide it to icons with the button or **⌃⌘S**. The Client / project column's 1400px window becomes a 1120px page.
- `DESIGN.md`: the "fixed 224px sidebar" line, the responsive list, the Sidebar component, and the narrow-window lines of the view strip and the Pull requests table. The dead "below 900px" line goes.
- `PRODUCT.md`: the narrow-window sentence.
- `.impeccable/design.json`: the breakpoints become page widths, and `row-columns` goes. `.impeccable/surfaces/app-src-pulls-ts.md`: the 1400px and 1200px windows become page widths.

## Checks

The app has no frontend tests, and CI runs `tsc` only.

1. `npm run build` passes.
2. A Playwright check in a scratch setup (`TODOHUB_HOME` copy, vite on :1430, the Tauri shim, every write answered with 500):
   - A drag changes the width, stops at 200px and 400px, and a reload keeps it.
   - A double-click sets 224px.
   - The hide button and **⌃⌘S** switch to the icon column and back, and a reload keeps the choice.
   - At 760px the icon column shows, with no hide button and no drag edge, and **⌃⌘S** does nothing. At 1120px your choice comes back.
   - At an 821px window with a 400px sidebar, the sidebar is 221px.
   - At windows of 760, 821, 1120, 1400 and 1700px, with the sidebar at 200, 224 and 400px and as the icon column: the Pull requests header line fits, the columns fold at the page widths above, the Inbox "why" line shows at a 1000px page, and the Inbox, Today and Client panes stack at a 720px page. With the 224px sidebar, page width = window − 280px, so each fold is at the same window width as on `main`.
   - The icon column looks the same as on `main` (a screenshot of each at 800px).
   - The Snooze menu and the Sources popover open in their usual places.

## Assumptions

- WKWebView supports container queries. Safari has supported them since version 16 (2022).
- `container-type: inline-size` does not move anything that is positioned inside `main`. The only `position: fixed` elements (the dialog overlay, the toasts and the narrow Sources popover) are outside `main`. The Playwright check confirms this.
- A container query measures the content box of `main`, so the thresholds subtract its padding. The Playwright check confirms each fold point.
- 200px is wide enough for the brand row. The Playwright check confirms it.
- `100vw` is the window width. macOS shows overlay scrollbars by default, so a scrollbar takes no width. With "Always show scrollbars", the cap and the page widths are off by the scrollbar's 15px at most.
