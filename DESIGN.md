---
name: TodoHub
description: A quiet, well-lit desk where the day's to-dos are laid out before you start.
colors:
  accent: "#1f3a5f"
  accent-ink: "#ffffff"
  bg: "#f6f7f9"
  surface: "#ffffff"
  surface-2: "#f0f2f5"
  border: "#dfe3e8"
  ink: "#1b2330"
  muted: "#5d6878"
  warn-bg: "#fff4dc"
  warn-ink: "#7a4b00"
  good: "#2f7d57"
  bad: "#b3261e"
  bad-bg: "#fde8e7"
  s-todo-bg: "#eef1f5"
  s-todo-ink: "#3d4756"
  s-prog-bg: "#e5edf8"
  s-prog-ink: "#1f4f8f"
  s-pend-bg: "#efe9f7"
  s-pend-ink: "#5b3a8a"
  s-done-bg: "#e6f2ea"
  s-done-ink: "#2b7451"
  p-urgent-bg: "#d1462f"
  p-urgent-ink: "#ffffff"
  p-high-bg: "#fde6d8"
  p-high-ink: "#a8420f"
  p-med-bg: "#f1ecdc"
  p-med-ink: "#6b5a1d"
  edge-urgent: "#d1462f"
  edge-high: "#f0a37a"
  urgent-tint: "#fff8f6"
  slack: "#5b3a73"
  gmail: "#a8321f"
  grain: "#23645a"
  linear: "#4b55c4"
  hubspot: "#9b2c6f"
  cat-code: "#2f5fb3"
  cat-analysis: "#2f7d57"
  cat-model: "#7a4fb5"
  cat-review: "#9a5600"
  cat-meeting: "#1d6f80"
  cat-email: "#b0413e"
  cat-writing: "#535b66"
  cat-admin: "#6b5a3a"
  sky-morning: "#ffdca6"
  sky-dusk: "#3d3470"
  sky-night: "#14122b"
  sun-core: "#ffe199"
  sun-rim: "#f6a65c"
  sky-amber: "#f4c08a"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  page-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.3
  title-sm:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.35
  figure:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.25
    fontFeature: "'tnum' 1"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  body-sm:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "'tnum' 1"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.05em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  kbd: "4px"
  control: "6px"
  row: "7px"
  card: "8px"
  dialog: "10px"
  panel: "12px"
  pill: "999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  2xl: "16px"
  3xl: "22px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 14px"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 14px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 14px"
  button-danger:
    backgroundColor: "{colors.bad}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 14px"
  input-filter:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    padding: "5px 10px"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  pill-status-todo:
    backgroundColor: "{colors.s-todo-bg}"
    textColor: "{colors.s-todo-ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  pill-status-in-progress:
    backgroundColor: "{colors.s-prog-bg}"
    textColor: "{colors.s-prog-ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  pill-status-pending:
    backgroundColor: "{colors.s-pend-bg}"
    textColor: "{colors.s-pend-ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  pill-status-done:
    backgroundColor: "{colors.s-done-bg}"
    textColor: "{colors.s-done-ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  pill-priority-urgent:
    backgroundColor: "{colors.p-urgent-bg}"
    textColor: "{colors.p-urgent-ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  pill-priority-high:
    backgroundColor: "{colors.p-high-bg}"
    textColor: "{colors.p-high-ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  pill-priority-medium:
    backgroundColor: "{colors.p-med-bg}"
    textColor: "{colors.p-med-ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  pill-stage-draft:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  pill-stage-changes-requested:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn-ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "12px 14px"
  list-item-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "9px"
    padding: "10px 12px"
  reading-pane:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "16px 18px"
  stat-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.figure}"
    rounded: "{rounded.card}"
    padding: "12px 14px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "7px 10px"
  nav-item-active:
    backgroundColor: "#e4e7ec"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "7px 10px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.card}"
    padding: "8px 10px 8px 14px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    padding: "14px 16px"
  chip-ref:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    padding: "0 6px"
  today-pane:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "16px 18px 14px"
  today-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  today-button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
---

# Design System: TodoHub

## Overview

**Creative North Star: "The Morning Desk"**

TodoHub is a quiet, well-lit desk with the day laid out before you start. The desk is a pale cool grey; on it sit white sheets of paper with hairline edges, and one deep navy pen marks what you act on. Nothing on the desk is there for show. The warmth comes from the window: the light changes through the day, and the top of Today paints the sky outside: night in the morning, a thin band of daylight through the day, dusk at the wrap-up.

Everything is soft and friendly but never loose. Text is the Mac's own system font at a compact 14px, with 12–13px detail lines. Corners are gently rounded, status and priority are rounded pills in gentle tints, and fields that hold nothing stay out of sight until you hover or tab to them. Attention is spent only on what is late, urgent, waiting on someone, or failing; everything else stays calm.

The light is the system's one personality. The Daylight theme moves the desk through cream (morning), clear white (day), warm sand (afternoon), lavender (dusk) and indigo (night), and Today carries a painted sky with a sun that follows the real one. The interface itself does not decorate. It is not an enterprise dashboard, it is not playful or gamified, and the colors of Slack, Gmail and the other sources never spread past their small chips.

**Key Characteristics:**

- Flat paper on a pale desk: hairline borders and tonal steps. Things in the page flow get a whisper of shadow at most; only things that float get real shadows.
- One accent, Early-Light Navy, used for what you act on and where you are.
- Morning Amber is both the warning color and the morning glow.
- System font only; hierarchy from size and weight; tabular figures for every count, date and ID.
- Lists on the left, a reading pane on the right, on every working page.
- Quiet until needed: empty fields take no room, controls appear on hover or focus.
- Every color has a Light, Dark and five Daylight values; status colors keep their meaning in all of them.

## Colors

A cool, low-contrast paper palette with one navy accent and one amber, plus small, fixed signal colors whose meaning never changes.

### Primary

- **Early-Light Navy** (`accent`): the blue of the sky just before sunrise. The primary button, the active sidebar item's icon, the active page tab's underline, focus rings, the selected card's ring, progress fills, the "hot" Inbox count, and links. In Dark it lifts to a pale sky blue, and each Daylight phase gives it a warmer or cooler cast (rust in the morning, violet at dusk). Text on it uses `accent-ink`.

### Secondary

- **Morning Amber** (`warn-bg` wash, `warn-ink` text): warm light across the desk. It marks things that are due today or slipping (due-today dates, warning chips and banners, the "Behind the target" line under a Today list section, the row the weekly digest points to) and it is also the morning glow in Today's sky. Its double role is intentional: amber means "look at this today", never "something broke".

### Neutral

- **Desk** (`bg`): the window background behind everything.
- **Paper** (`surface`): cards, rows, the reading pane, the sidebar, menus and dialogs.
- **Shaded Paper** (`surface-2`): hover backgrounds, secondary buttons, chips, code blocks, quoted excerpts, sub-issue rows.
- **Hairline** (`border`): every 1px border and rule.
- **Ink** (`ink`): body text and titles.
- **Pencil** (`muted`): secondary text, meta lines, counts, inactive tabs and nav, uppercase labels.

### Signal

- **Done Green** (`good`): success, a ticked item, the healthy-source dot, an approved card's ring.
- **Alarm Red** (`bad`, `bad-bg`): late dates, errors, failing sources, a dropped card's ring, destructive menu items and buttons.
- **Status pills** (`s-todo`, `s-prog`, `s-pend`, `s-done`, each a background and ink pair): Todo is grey, In Progress blue, Pending purple, Done green. Each ink reaches 4.5:1 on its own background; the Done ink is a step darker than Done Green for this reason. Backlog is a dashed outline; Canceled and Duplicate are struck through.
- **Priority pills** (`p-urgent`, `p-high`, `p-med`): Urgent is the one solid, saturated fill in the system; High is an orange wash, Medium a sand wash, Low an outline, none plain text. Urgent rows add `urgent-tint` behind the row and an `edge-urgent` stripe; High rows an `edge-high` stripe.

### Source and task-type colors

- **Sources** (`slack`, `gmail`, `grain`, `linear`, `hubspot`): text color in a source chip only. Calendar uses the accent and GitHub uses ink.
- **Task types** (`cat-code`, `cat-analysis`, `cat-model`, `cat-review`, `cat-meeting`, `cat-email`, `cat-writing`, `cat-admin`): the icon in a task avatar and its badge, on a 15–18% tint of the same color.

### Sky

- **Morning Sky** (`sky-morning`), **Dusk Violet** (`sky-dusk`), **Night Indigo** (`sky-night`), and the sun (`sun-core` to `sun-rim`): fixed colors painted only in Today's sky (the morning cover, the band through the day, the wrap-up's dusk) and the Daylight swatch on the theme button. They do not change with the theme, because the sky is a picture, not paper. Through the day the band dims to 82% brightness on a dark page so it doesn't glare.
- **Sky Amber** (`sky-amber`): the warm text on a night or dusk sky: "Yesterday" and "Today" in the morning brief, Claude's name, due-soon dates on the cover, and tomorrow's weekday at the wrap-up. Everything else on a dark sky is white, at 76–92% for secondary text.

### Themes

The frontmatter holds the Light values. Every token is a CSS custom property on `:root`, so Dark and Daylight redefine the same names:

| Token | Light | Dark | Morning | Afternoon | Dusk | Night |
|---|---|---|---|---|---|---|
| `bg` | #f6f7f9 | #14181f | #fbf6ec | #f7f2ea | #efebf5 | #16152a |
| `surface` | #ffffff | #1c222b | #fffdf8 | #fffcf7 | #fbf9fd | #201e38 |
| `surface-2` | #f0f2f5 | #242b36 | #f5eddc | #f1e9dc | #e7e1f0 | #2a2746 |
| `border` | #dfe3e8 | #323b48 | #ecdfc6 | #e6dccb | #ddd5ea | #39355a |
| `ink` | #1b2330 | #e7ebf0 | #2a2418 | #262019 | #231e38 | #e9e6f5 |
| `muted` | #5d6878 | #9aa5b4 | #7a6a52 | #73675a | #6b6688 | #a29dc0 |
| `accent` | #1f3a5f | #8fb3e3 | #a4551a | #7b4a2a | #5b4596 | #b9a7f0 |
| `accent-ink` | #ffffff | #10161f | #ffffff | #ffffff | #ffffff | #16152a |
| `warn-bg` | #fff4dc | #3a2f17 | #fff1d6 | #f6e6d3 | #fbe7cf | #3a2f17 |

Daylight's Day phase is the Light theme. Night sits on the Dark base, so its status, priority and signal colors are Dark's. Light phases blend over 30 minutes; Dusk to Night and Night to Morning switch at once.

### Named Rules

**The One Navy Rule.** The accent marks what you act on and where you are: one primary button per decision, the active nav item and tab, focus and selection rings, progress. As a background it is a tint of 12% or less (active nav 12%, a selected card 6%). It is never a panel, a header band, or a large fill.

**The Meaning Survives the Light Rule.** Daylight only changes the nine paper colors in the table above. Status, priority, good, bad and the source and task-type colors keep their meaning in every theme and phase; a new color that carries meaning needs a Light and a Dark value from the start.

**The Small-Chip Rule.** Source and task-type colors appear only as chip text, icon strokes and avatar tints of 18% or less. Never as backgrounds, borders, headings or rows.

## Typography

**Display Font:** the Mac system font (`-apple-system`, SF Pro), with `BlinkMacSystemFont`, Segoe UI, sans-serif fallbacks
**Body Font:** the same
**Label/Mono Font:** `ui-monospace` (SF Mono), with Menlo, for keyboard shortcuts, logs and code

**Character:** one family, native to the Mac, so TodoHub reads like a well-made Mac app rather than a website. Hierarchy comes from size and weight alone, in small steps.

### Hierarchy

- **Display** (700, 28px, 1.25, −0.01em): the weekly digest's headline and "Good morning." on Today's morning cover. One per page at most.
- **Headline** (700, 22px, 1.3, −0.01em): the score heading on the wrap-up's dusk sky.
- **Page title** (700, 20px): every page's title, followed by its count in Pencil ("12 to review").
- **Title** (700, 18px, 1.3): the selected issue's title in the reading pane.
- **Title small** (600, 15px): Inbox card titles (an inline-editable field), dialog headings, list headings. Group names in Client and Dev use 16px at 700.
- **Figure** (700, 24px, tabular): the number on an Insights tile.
- **Body** (400, 14px, 1.45): list titles, nav, buttons, digest prose (1.6 there, at a 680px column).
- **Body small** (400, 13px, 1.55): rendered Markdown descriptions and comments, banners, toasts, menus, the filter.
- **Meta** (400 or 600, 12px, tabular): the one-line details under a row, chips, pills, counts, IDs.
- **Label** (600, 11px, 0.05em, uppercase): section kickers only: sidebar groups, pane section heads, tile labels, digest section heads.

### Named Rules

**The One Family Rule.** No webfonts and no second family. Weights are 400, 600 and 700 (650 only on the brand name); hierarchy is size and weight, never color alone.

**The Counted Rule.** Every count, date, ID and estimate uses tabular figures so columns of numbers line up.

## Layout

The window is the sidebar beside the page. The sidebar is 224px wide by default: a drag on its right edge sets 200–400px, and the hide button shrinks it to the 60px icon column. It always leaves the page 600px of the window. The page is centered with a 1020px maximum and 16px/20px padding (80px at the bottom so toasts never cover the last row). The wide pages (Inbox, Today, Client, Dev and Pull requests) widen to 1560px with 28px sides, because a wide window should show more, not more empty margin.

**List and reading pane.** The list takes the left column and the selected item opens on the right (columns 1fr and 1.05fr, 16px gap). The pane is sticky 12px from the top and scrolls on its own. Rows in the list sit 2px apart; groups are 22px apart, each led by a heading with a logo or initial, a bold name, a short summary and a hairline rule running to its action.

**Today fits the window.** Today alone does not scroll as a page: the sky, Claude's note and the two columns fill the window height (480px minimum), and the list and the pane each scroll on their own. The list and the pane take the same columns as Client and Dev (1fr and 1.05fr, 16px apart).

**Page header.** Title and count on one line (32px minimum height), then underline tabs 22px apart on a hairline, with the filter (220px) at the right end of the tab line. There is no refresh button, except **Refresh all** on Pull requests, which sits before the filter, after the Group control.

**Rhythm.** 2px between list rows, 6–10px between controls and inside rows, 12px around groups of controls, 16px between page sections, 22px between groups. The spacing tokens in the frontmatter are these steps.

**Responsive behavior.** The window can shrink to 760×520. The width rules are container queries on the page, so they hold at every sidebar width. The numbers below are page widths: the window, less the sidebar, less the side padding. With the 224px sidebar, a 1120px window gives an 840px page on Inbox, Today, Client, Dev and Pull requests.

- At a 1000px page and wider, Inbox rows add a clipped line of "why".
- At a 720px page and narrower, the reading pane moves under the list. On Today the list is capped at 236px tall above the pane, the band drops its later meeting, and the morning cover's side margins narrow from 44px to 24px.
- In a window 820px or narrower, the sidebar is always the 60px column of icons, keeping only the urgent counts as small badges. The hide button gives the same column in a wider window.
- At a 496px page and narrower, two-column panels stack.

## Elevation & Depth

Flat by default. Depth comes from three tonal steps (Desk, Paper, Shaded Paper) and 1px Hairline borders. Cards carry a whisper of shadow in Light and none in Dark. Real shadows appear only on layers that float above the page: menus, popovers, toasts and dialogs. Selection and focus are rings, not lifts.

### Shadow Vocabulary

- **Whisper** (`box-shadow: 0 1px 2px rgba(20, 30, 45, 0.06)`; `none` in Dark): resting cards and the bulk bar.
- **Selected row** (`box-shadow: 0 1px 3px rgba(27, 35, 48, 0.06)`): the selected item in a list, with a border tinted 35% toward the accent.
- **Menu** (`box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14)`): drop, snooze, pill and type menus.
- **Toast** (`box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18)`): Undo toasts at the bottom center.
- **Popover** (`box-shadow: 0 14px 34px rgba(0, 0, 0, 0.18)`): the balance popover, the sources popover and the Start in periscope popover.
- **Dialog** (`box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3)`): dialogs, over a 45% dark scrim.
- **Ring** (`box-shadow: 0 0 0 1px var(--accent)`): the focused Inbox card; green or red for approved and dropped cards.

### Named Rules

**The Float-Only Shadow Rule.** A shadow means "this is above the page and will go away". Nothing that lives in the page flow gets more than the Whisper or the Selected row shadow.

## Shapes

Soft, friendly corners scaled to the size of the thing: 4px for keyboard keys and inline code, 6px for buttons, inputs and menu items, 7px for sidebar client rows, 8px for cards, list groups, nav items and tiles, 9px for list items and task avatars, 10px for dialogs, and 12px for the reading pane, Today's sky and checklist panel, and popovers. Status, priority, chips, counts and the "Start my day" button are full pills; source dots, the help and theme buttons are circles.

Borders are 1px Hairline everywhere. A dashed border means Backlog. A 3px inset stripe on the left edge means Urgent (red, with a light red tint) or High (orange), or marks the row the weekly digest just sent you to (amber, with a brief pulse); there are no other stripes.

Task avatars are rounded squares: a client's logo on white, or a task-type icon on a tint of its color, with a small round type badge at the bottom-right corner, ringed in the page color so it reads as a cut-out.

## Components

### Buttons

Soft and friendly, small and calm.

- **Shape:** gently rounded (6px), 6px × 14px padding, 1px border.
- **Primary:** Early-Light Navy fill, white text, 600 weight. One per decision (Approve, Block, Save).
- **Secondary:** Shaded Paper fill with a Hairline border.
- **Ghost:** transparent with a Hairline border and Pencil text; the default for everything that isn't the decision.
- **Danger:** Alarm Red fill, white text, only inside a confirm dialog (Delete…).
- **Link button:** accent text, no border, 12px, for inline actions ("Show backlog", "+ N more").
- **Hover / Focus:** hover brightens by 6%; focus shows a 2px accent outline offset by 1px. Disabled is 55% opacity.

### Pills (status and priority)

- **Style:** full-pill, 12px at 600, 2px × 10px; status pills start with a 7px dot in their own ink color, and both show a faint caret when clickable.
- **State:** clicking opens a menu listing every option with its number key; hover adds a 1px ring in the pill's own color at 25%. In a row's meta line they shrink to 11px.
- **Pull request stages:** the stage pill starts a row's meta line, before the repo name. It is not clickable and shows no caret. The Linear issue later in the line is an issue chip with the ID only, and a click opens the issue in Linear.
- **Draft:** Shaded Paper fill, Pencil text and a hollow dot (a 1.5px ring). It never uses a dashed outline, because a dashed outline means Backlog.
- **Changes requested:** Morning Amber (`warn-bg` fill, `warn-ink` text). In review reuses `s-prog`, and Approved reuses `s-done`.

### Chips

- **Style:** full-pill, Shaded Paper, 12px at 500. Source chips color only their text. Warning chips use Morning Amber; the kind chip (Close, Update) uses the accent fill.
- **Issue chips:** every issue Claude names in its text is a chip, not a link: a 6px rounded box in Shaded Paper with a Hairline border, the ID at 12px tabular in a softened Pencil, then a short label at 13px. Hover tints the border 45% toward the accent; an issue already done is struck through in Pencil and not clickable. On a sky the chip turns light-on-dark: 12% white fill, 30% white border, white text.

### Cards (Inbox)

- **Corner Style:** 8px.
- **Background:** Paper, Hairline border, the Whisper shadow, 12px × 14px padding, a 36px avatar beside the body.
- **Focused:** accent border plus a 1px accent ring. **Selected (bulk):** a 6% accent tint.
- **Decided:** approved turns green-ringed with a 9% green tint, then swipes off to the right with a slight tilt (420ms); dropped turns red and swipes off to the left. With Reduce motion it fades out (160ms).

### Linked issue box (Inbox)

A card linked to one of your open issues shows the issue, a switch, and the plan for the pick.

- **Box:** Shaded Paper, Hairline border, 8px corners, 10px × 12px padding. An 11px uppercase Pencil heading at 700 ("Adds to an open issue"), the identifier (a link at 600) and the title, then the status and priority pills and "due Nov 28" in 12px Pencil.
- **Switch:** the segmented control of the Group control, across the box; the 3 parts share its width. Claude's recommendation has a 6px dot in the text color. Under it, a 12px Pencil line: "Claude recommends Merge" in Ink at 600, then the reason.
- **Plan:** an 11px uppercase heading ("Merge will change ENG-412"), then one 13px line for each change, with a Pencil icon (✎, +) or a checkbox. An old value is Pencil and struck through; the new one is the Done pill ink (`s-done-ink`) at 600. The comment shows as Markdown in a Paper box with a Hairline border, at 12px.
- **Drop:** the reasons as radio rows, each with its number key at the right.
- **Footer:** Snooze ▾ and one primary button that names the pick ("Merge into ENG-412", "Create issue", "Drop"). No Drop ▾ menu.

### List items and the reading pane

- **List item:** no border or fill at rest; hover shows a 60% Paper wash; selected becomes Paper with an accent-tinted border, the Selected row shadow and a 600 title. One line of 12px meta under the title.
- **Reading pane:** Paper, Hairline border, 12px corners, 16px × 18px padding. The ID (a link), client or project, the 18px title, then one row of pills and fields, then actions above a hairline, then sections under uppercase labels.

### The view strip (Pull requests)

One row of plain segments. Each segment is a count over a label, and one segment is pressed.

- **Shape:** Paper, Hairline border, 8px corners, the Whisper shadow. Hairlines divide the segments, and the segments share the width equally.
- **Segment:** a 20px tabular count at 700 over a 12px Pencil label, 8px × 14px padding. The number keys 1 to N press the segments.
- **Pressed:** a 7% accent tint and a 2px accent line along the bottom edge. The label turns Ink at 600.
- **Hover:** a segment that is not pressed shows Shaded Paper.
- **Filter note:** an optional 12px tabular note under the count, in its tone: Alarm Red at 600, Morning Amber ink, or the Done pill ink (`s-done-ink`) for a green note ("2 CI failing"). Done Green is too light for small text on the pressed and hover fills.
- **Note states:** a click presses the segment and filters the table to that part. Hover on a note that is not pressed underlines it. A pressed note gets a full-pill wash in its tone (`bad-bg`, `warn-bg`, `s-done-bg`) and a 10px × that clears it.
- **Focus:** segments and notes use the 2px accent focus outline of all buttons. On a segment, the outline is inside the button, because the strip clips what is outside it.
- **Narrow pages:** at a 720px page and narrower, the notes go away. A segment with no note keeps an empty line, so the counts stay aligned.

### The stack rail (Pull requests)

A stack of pull requests sorts, shows, lights up and folds as one unit.

- **Summary row:** heads each stack. A chevron in the open column, "Stack of 3" at 13px and 600, then a meta line with the repo and the merge order ("initech #71 → #72 → #73"). Each cell holds the one value that the table sorts the stack by.
- **Rail:** a narrow first column. The summary row has a square knot (8px, 2px corners), and each pull request has a round 8px knot. 2px lines join the knots. The rail color is Pencil mixed 78% with the Desk.
- **Rows:** no hairline divides the rows of a stack; only the last row has one. In an opened row the line runs through. A pull request on its own has no rail.
- **Highlight:** pointing at any row of a stack turns the knots and lines of the whole stack Ink. Another stack or leaving the tab clears it.
- **Fold:** a click on the rail or on the summary row folds the stack to its summary row, and another click unfolds it. The chevron points down when the stack is open and right when it is folded.
- **Folded:** the line stops at the square knot, and a hairline closes the summary row. The knot grows to 16px (4px corners) in Pencil and holds the count in the Desk color, 10px at 700. The rail color is too light for text: Desk on it gives 3.4:1 in light mode, and Desk on Pencil gives 5.3:1.
- **Context rows:** a pull request that the view or the filter leaves out stays in its place, in Pencil at 400, with no status colors. A stack never splits.

### Groups (Pull requests)

Mine shows the client or project of each pull request: in a column when the groups are off, and in sections when they are on.

- **Number column:** the first sortable column, 64px wide. A Pencil "#", then the number in Ink, 13px tabular. A stack's summary row shows its lowest number, all in Pencil.
- **Client / project column:** 168px, after the title. It shows only in Mine with the groups off, on pages wider than 1120px (a 1400px window with the default sidebar). An 18px client logo or project initial with 5px corners, then the name at 13px with an ellipsis. "No client or project" has a "–" initial and a Pencil name.
- **Group starts:** sorted by Client / project, a darker line (Pencil 40% into Hairline) starts each group, and a name shows on a group's first row and where the row above is in another group.
- **Group control:** a 12px Pencil "Group" label and the segmented control (None · Client or project), before Refresh all. Paper, a Hairline border, 7px corners, 12px Pencil text, as tall as Refresh all and the filter. The pressed one has the accent fill and 600 text.
- **Section heading:** a row across the table. A chevron (down when open, right when folded), the 26px logo or initial, the name at 16px and 700, the 12px Pencil summary ("5 open · 2 need you · 1 CI failing", the CI part in Alarm Red), then a Hairline rule to the edge. 22px above it (10px for the first), 6px below it, a Hairline under it. A click folds the section to its heading.
- **Narrow pages:** Client / project folds at a 1120px page and narrower, and Size at 920px, so the titles keep about 235px at the default 1120px window (an 840px page). Comments folds at 620px. At 720px the "Group" label hides, Refresh all shows only its icon, and the filter can shrink to 120px, so the header line fits on the narrowest page (about 530px).

### Inputs / Fields

- **Style:** Paper with a Hairline border, 6px corners, 13px text.
- **Focus:** the border turns accent (the capture box turns accent on focus-within; the inline title field shows its border only on hover, accent on focus).
- **Quiet empty fields:** an unset date, priority, client or project shows nothing at rest. Its control fades in (0.12s) on hover of the row or card, on keyboard focus, and always in the reading pane. A set date shows as plain text ("Nov 9", "Today"); red and 600 when late, amber when due today.

### Navigation

- **Sidebar:** Paper with a hairline right edge. Items are 14px Pencil with an icon; hover shows Shaded Paper; active gets a 12% accent tint, Ink text at 600 and an accent icon. Counts sit at the right in Pencil; the Inbox count becomes an accent pill when there's work. Uppercase labels head the client and project lists. The sources line sits at the bottom with a green or red dot. The hide button (a sidebar glyph in Pencil, Shaded Paper on hover) sits after **+**, and under it in the icon column. The right edge is a 6px drag edge: on hover and while dragging, a 2px accent line covers the hairline. In the icon column, the Sources popover and the theme menu open beside the column.
- **Page tabs:** plain 14px text in Pencil; the active tab is Ink at 600 with a 2px accent underline sitting on the header's hairline.

### Menus and popovers

Built on disclosure elements: Paper, Hairline border, 8px corners, 4px padding, the Menu shadow. Items are 6px × 10px with Shaded Paper on hover and their key shortcut right-aligned in a `kbd`. Destructive items sit last, in Alarm Red, under a hairline.

### Toasts

Inverted: Ink background with the desk color as text, 8px corners, 13px, bottom center. After an action, the toast carries an **Undo** ghost button with its shortcut (⌘Z). Errors use Alarm Red.

### Dialogs

Paper, 10px corners, up to 760px wide and 85% of the window tall, over a 45% dark scrim. A 15px heading, the body, then right-aligned actions.

### Insights tiles

One row that wraps (each at least 150px wide): an 11px uppercase label, a 24px tabular figure, a 12px note. Hover tints the border toward the accent; a tile in trouble gets a Morning Amber wash and amber figure.

### The Today Sky (signature)

The top of Today, and the one place the desk looks out of the window. It changes with the moment of the day, always at 12px corners, with the sun placed where the real one is and hills along the bottom (darkened at night).

- **Morning cover:** until you start the day (6 AM to noon, on workdays), the sky is the whole page: a night sky with stars over a dawn-colored horizon, white text at 28px/44px margins. "Good morning." in Display, then a short brief with "Yesterday" and "Today" run-in in Sky Amber and the issues as chips, then the checklist on a translucent dark panel (42% night, 14% white border): uppercase section labels, Claude's picks unchecked, work already on Today checked with amber boxes, each row with its why and its due date on the right. Below it the one bright control: the amber "Start my day with N" pill (15px at 700, dark violet text, a gradient from pale to deep amber) with its ↵ key.
- **Sunrise:** pressing it plays a 2.35 s keyframed sequence: the stars and night fade, a rose-and-amber dawn passes, the sun rises from below the hills (the first 68%, `cubic-bezier(.2, .7, .2, 1)`), the hills brighten, the cover's text fades out early, and the sky folds into the band in the last 30% as the band's text fades in. If the page re-renders mid-way, it resumes where it was (a negative delay from `--elapsed`). Reduce motion skips all of it.
- **Band:** through the day, a 46px strip: the time, the next meeting (a link, with "in 30 min" and "external"), and the one after it. The sun, 16px, drifts across it with the real sun every minute; around noon the sky turns pale, and after sunset it darkens with stars and white text. On a dark page it is dimmed to 82% brightness.
- **Dusk:** at the wrap-up (once the 4 PM sweep writes it, or from 5 PM), a violet-to-rose sky with a few stars and a warm glow low on the right: the time and the score in Headline, Claude's summary (14px, 1.6), then a tomorrow line under a 20% white rule led by tomorrow's weekday in Sky Amber.
- On any sky, keys are light-on-dark and focus is a 2px white outline offset 2px.

### The Today list and pane

Under the band, Claude's note (a 15px 600 lead sentence, then 14px prose with issue chips, signed in an uppercase "Claude" label), then the list beside the selected issue.

- **List:** Client's groups and rows straight on the desk, no panel, in two groups: Client and Dev. Each opens with Client's group heading (the name in bold, "N open · N late", a hairline rule) ending in "N% of done" with a 56px balance meter: an accent fill on Shaded Paper and a 2px Ink tick at the target. When a side is behind its target (50% by default), a "Behind the 50% target this week" line in Morning Amber sits under its heading and opens the balance popover. The list scrolls on its own, and rows fade out under its top and bottom edges instead of meeting a border.
- **Rows:** Client's list items (see List items and the reading pane), with a small avatar and no star. A decided row goes Pencil and drops its priority edge.
- **Folds:** under a hairline, "N not on Today" (Claude's picks and late issues left out) and "N done today", each a plain 13px Pencil summary with a chevron that turns when open.
- **Pane:** Paper, 12px corners, 20px × 26px padding. The ID, client and why it's here in 12px Pencil, the title at 20px and 600, why now at 15px, then a Shaded Paper box with the nudge or message to send, then a fit line: 12px Pencil text and an 88px, 4px bar in accent, Morning Amber when it doesn't fit. Then the actions, Linear's fields under a hairline, and the description. "Up next" stays pinned to the pane's bottom edge on a hairline, with its j key.
- **Pane buttons:** Paper with a Hairline border, 6px corners, 6px × 12px, 14px, each with its key in a `kbd`. One is filled (Mark done): accent fill, accent-ink text at 600, 10% darker on hover, its `kbd` tinted from the accent.
- **Empty:** when nothing is on Today, the pane holds a centered 20px heading, a line of Pencil text and buttons to open Client or Dev.

## Do's and Don'ts

### Do:

- **Do** read every color from the CSS custom properties (`var(--accent)`, `var(--surface)`), so all four themes and all five Daylight phases follow. Literal colors belong only in the sky.
- **Do** keep one primary button per decision; everything else is ghost, secondary or a link button.
- **Do** keep accent backgrounds at a 12% tint or less (`color-mix(in srgb, var(--accent) 12%, var(--surface))`).
- **Do** hide an empty field's control until hover or focus, and show a set value as plain text.
- **Do** use tabular figures for counts, dates, IDs and estimates.
- **Do** keep gradients, glows, stars and choreographed motion in the sky: Today's morning cover, sunrise, band and dusk, and the Daylight swatch. Elsewhere, light or motion appears only when it carries meaning (a decided card swiping off, the pulse on a row you were sent to), stays under half a second for state changes (0.12s transitions), and has a Reduce-motion fallback.
- **Do** give any new meaningful color a Light and a Dark value before it ships.

### Don't:

- **Don't** build an enterprise dashboard: no walls of KPI cards, no heavy chrome or admin-panel density. Insights has one row of tiles, then charts that each answer one question.
- **Don't** make it playful or gamified: no confetti, streaks, mascots or celebratory emoji. A done item gets a check and a strikethrough; that is the celebration.
- **Don't** let source or task-type colors spread beyond chip text, icons and avatar tints. No Slack-purple headers, no Gmail-red rows.
- **Don't** add colored left stripes beyond Urgent, High and the digest's landing highlight.
- **Don't** give things in the page flow more than the Whisper or the Selected row shadow; only menus, popovers, toasts and dialogs get real shadows.
- **Don't** add a webfont or a second typeface.
- **Don't** add a refresh button or chrome that is only decoration.
