---
version: 1
slug: "app-src-main-ts"
primary_target: "app/src/main.ts"
related_targets: ["app/src/styles.css"]
---

# Today

Mode: Operate. The screen that drives Thibault's day, opened at 8 AM, between meetings, and at the end of the day. Job: decide what to take on, do the next thing, settle what's left. Constraints: keyboard-first, Claude only suggests (nothing reaches Today, Linear or the calendar without a click), client data stays local.

## Direction contract

THESIS: Today is one list read in three moments: the morning is a decision, the day is a focus, the evening is a settlement. It refuses tiles stacked over a second list and Brief/Checklist tabs.

OWN-WORLD: Daylight. The painted sky is the only ornament: a full night sky on the morning cover, a 46px band (time, next meeting) through the day, a tall dusk for the wrap-up. Under it, quiet Operate UI: one surface list split Client and Dev with a 50% balance meter, a reading pane at panel radius, one filled button, kbd hints.

STORY: Thibault reads yesterday's recap and Claude's suggestion, checks what to take on, starts the day; between meetings, sees what's next and whether it fits before the next meeting; at dusk each open item gets Claude's next step, one key away.

FIRST VIEWPORT: Cover: "Good morning.", Yesterday and Today with issue chips, the checklist (Claude's picks unchecked, carried work checked), "Start my day with N". Day: band, Claude's note, a 304px list (Client, Dev, not on Today, done) beside the stage with Mark done primary. Wrap-up: dusk score, summary, tomorrow line over the same list and stage.

FORM: list plus reading-pane focus layout with sky states, first on my list (the hybrid of Claude's note, Focus pane and Client/Dev split), seed:5531f7f0574a94db. The composition to match is .impeccable/mocks/today-hybrid.html.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment

Start my day: the night sky turns to dawn, the sun rises, and the sky folds into the band as the checked list slides up.

## Decided with Thibault

- Claude only suggests: picks start unchecked on the cover; skipped picks and late issues Claude left out wait under "not on Today" with Add to Today.
- The wrap-up shows once the 4 PM sweep writes it (or from 5 PM, with "Ask Claude to wrap up"), not from 2 PM.
- Wrap-up decisions stay in the list, checked. "Move to Thu" puts an item on tomorrow's Today list; "Set due" changes the date in Linear.
- A midday sweep refreshes Claude's note; the morning recap is not shown again after the sunrise.
- Keys: j/k, ⌘↵ done, m move to tomorrow, b block, n nudge or copy message, d set Claude's due date, a add to Today, o open; x checks on the cover.

## Unresolved

- In a narrow window the cover's checklist scrolls inside its panel.
