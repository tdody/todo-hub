---
version: 1
slug: "app-src-pulls-ts"
primary_target: "app/src/pulls.ts"
related_targets: ["app/src/styles.css","app/src/main.ts"]
---

# Pull requests

Mode: Operate. A tab after Dev with Thibault's open pull requests (Mine) and the ones that wait on his review (To review), read from GitHub with gh. Job: see which pull request needs him next, read why, and open it. Constraints: GitHub data only (no Claude text), keyboard-first, every column sortable, stacks easy to see, inside the TodoHub world of DESIGN.md.

## Direction contract

THESIS: One next step per pull request, so the page answers "what needs me" before "what is open". It refuses a raw GitHub list by date and a kanban of review states.

OWN-WORLD: TodoHub's quiet Operate UI: rows on the app background, Paper for the selected row, navy accent, amber for "look at this today", red for broken, the Client and Dev status pills. A grey rail with a square head joins a stack; one filled button, on the selected row only.

STORY: Thibault opens the tab, reads five counts, sees Needs you sorted by next step (Fix CI, Resolve conflicts, Resolve threads), opens a row in place to read the failing checks and open threads, and presses o to act in GitHub.

FIRST VIEWPORT: "Pull requests" with "Read from GitHub N min ago"; Mine and To review tabs with counts, then on the right the Group control (Mine), Refresh all and the filter; a five-segment strip with Needs you on, a filter note under each count; the table: #, Pull request (title over a meta line that starts with the stage pill), Next step, CI, Comments, Size (pages wider than 920px), Updated, with Client / project after the title on pages wider than 1120px; loose drafts folded below.

FORM: review-pipeline table with in-place rows and stack summary rows, first on my list (the hybrid of review pipeline, full table open in place and stacks), seed:866a9e0ba9d556ec. The composition to match is .impeccable/mocks/pull-requests.html.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment

Point at one pull request of a stack and the whole stack lights up; the stack's summary row holds the value the table sorts by, so a stack never splits.

## Decided with Thibault

- Mine plus To review as two tabs; Needs you is the default view.
- Next steps are plain labels from GitHub data; no Claude drafts.
- Stage is a pill at the start of the meta line, not a column.
- An open thread is every unresolved review thread that a person started; its step is "Resolve N threads". On 2026-11-15, 8 of his 21 open pull requests that are not drafts had one.
- Comment counts and open threads leave out bots: 54 of 74 conversation comments came from bots.
- A failing check's name opens its run log: GitHub gives no reason text for his runs (on 2026-11-14, 0 of 23 failed check runs had a title or summary), so the mock's "ruff, 3 errors" cannot be shown.
- The tab reads GitHub about every 5 minutes after the last read; it need not be exact. Refresh all (beside the filter, or ⌘R) reads now and starts the 5 minutes again.
- Refresh in an opened row reads that one pull request again; it does not change the 5 minutes of the list.
- The pull request number has its own sortable column, **#**, in Mine and To review (2026-11-16). The meta line keeps only the repo name.
- Mine groups by client or project: the client label of the Linear issue, else its project, else "No client or project". It combines prototype A (sections, from the Group control or g) and prototype B (a sortable Client / project column when the groups are off). The column hides in the sections.
- Pull requests with no client or project share one group, not one group for each repo.
- To review has a Reviewed view, third, between Waiting 3+ days and Asked again (2026-11-24): open pull requests of others that he reviewed and that do not ask for his review now. They do not wait on him, so the To review count and the sidebar count leave them out.
- To review has no column and no groups: on 2026-11-16, none of its 7 pull requests named one of his open issues.
- The Client / project column shows only on pages wider than 1120px (a 1400px window with the default sidebar). At the default 1120px window (an 840px page), the titles would get no room. The groups work at every width.
- Size folds at a 920px page and narrower: with **#** and Size, the titles had about 135px at the default 1120px window.

## Decided in the build (from real GitHub data, to confirm)

- The Linear issue comes from the branch name or title, when its team key is one his issues use; its status and due date show when it is one of his open issues.
- The stack summary row keeps two lines ("Stack of N" over "repo · merge order"), as in the approved mock's final version: one line broke "Stack of 2" in two.
- A read of the list costs about 25 of 5,000 points an hour, and a read of one pull request costs 1; the newest 30 threads per pull request are read.
- A pull request read again alone leaves the list only when it is merged or closed. A review request that GitHub drops stays in To review until the next read of the list.
- The error banner has no button of its own: Refresh all sits just above it.
- The Done pill ink (`s-done-ink`) is #2b7451 in light mode: 4.9:1 on its pill, where Done Green gave 4.35:1. Every Done pill and the Approved pill use it, and so does a green filter note, because Done Green falls under 4.5:1 on the pressed and hover fills.
