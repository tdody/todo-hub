# Insights: issues opened and closed, and pull requests reviewed and merged

## Goal

- A new **Issues** panel on the Overview shows two series for each of the last 8 weeks. The second series is Closed. A toggle sets the first series: Opened or Still open.
- The **Pull requests** panel shows Reviewed and Merged as two series. Today Reviewed is text under each week.

## Scope

In:

- One read of Linear, the weekly counts, a route and the two charts.
- The README, `DESIGN.md` and the definitions in `stats.py`.

Out:

- The Client vs dev chart, the tiles' figures and the weekly digest.
- A net figure, a backlog target and a tooltip of our own. The charts keep the browser's tooltip.
- Small numbers on a narrow page. Each chart scales with its panel, as today.

## Definitions

A week is Monday to Sunday (ET), as in the rest of `stats.py`. An issue counts for its current assignee.

- **Opened:** my issues that were created that week, except the ones that are canceled or duplicates now. So a recent week can go down later.
- **Still open:** my issues that were open when the week ended. For this week, that is now. An issue that was canceled later counts in each week that ended before that.
- **Closed:** my issues completed that week: client + dev of the balance count, as in the "Closed this week" tile.

Linear clears `completedAt` and `canceledAt` when an issue is reopened, so a reopened issue counts as open in all its past weeks. A duplicate has a `canceledAt`.

## Behavior

### The Issues panel

It sits between Client vs dev and Pull requests.

> **Issues** `[Opened | Still open]`
>
> 40 of your issues were opened in the last 8 weeks, and you closed 35. This week so far: 6 opened, 4 closed.
>
> ▒ Opened █ Closed
>
> *(two bars a week)*
>
> Opened = …

- The toggle is the segmented control, at the right end of the title line. It starts on Opened, and the app remembers the choice on this Mac (`todohub.insightsIssues`).
- The toggle changes the first series, the legend, the sentence and the definition. With Still open, the sentence is "You have 30 open issues, against 28 at the end of last week. You closed 35 in the last 8 weeks, 4 of them this week."
- A click redraws only what is under the title line, so the page keeps its scroll and the button keeps the focus.
- The "Closed this week" tile scrolls to this panel.
- When Linear's read fails, the panel says so, and the rest of Insights still works.

### The chart

Both panels use one chart function, which replaces `pullsChart`.

- Two bars a week, 22px each with a 2px gap: as wide as a Client vs dev bar, in the same frame, so the weeks line up.
- Each bar has its number above it. A 0 has no bar.
- The right bar (Closed, Merged) is the work that you finished, in the accent. The left bar is `--pale-fill`, a 50% mix of the accent and the surface, so it follows each theme. The mix has a contrast of 2.1 or more against the surface in Light, Dark and each Daylight phase; each bar has its number, and a legend names the two.
- The tooltip covers the whole week: "Nov 2: 6 opened, 4 closed".

## Backend

- `Linear.my_issue_dates(since)`: `createdAt`, `completedAt`, `canceledAt` and the status type of my issues that are open or were closed since `since`. The filter selects open issues by status type: `completedAt: { null: true }` inside `or` also returned issues that were closed earlier.
- `stats.issue_counts(issues, weeks, today)` → `{"weeks": [{"week", "opened", "still_open"}]}`.
- `GET /api/stats/issues?weeks=8` (1 to 26), read again on each load, as `/api/stats/balance`.

## Checks

- Tests: an issue on each side of a week's edge (ET), canceled and duplicate issues in both counts, the Linear filter, and the route.
- The app in Chrome and WebKit with fake data: both views, the remembered choice, focus, scroll, all palettes, 1120px and 760px windows.
