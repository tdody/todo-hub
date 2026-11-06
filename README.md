# TodoHub

One place for Thibault's to-dos. Claude Code reads Slack, Gmail, Grain, Google Calendar, HubSpot, Linear mentions and GitHub review requests on a schedule and puts candidate tasks in a review queue. You approve, edit, snooze or drop each one in a small Mac app. Approved tasks become Linear issues in your team. The same app shows your open Client and Dev issues, a Today plan, and Insights.

```
launchd (weekdays 8, 10, 12, 14, 16)        TodoHub.app (Tauri) + menu-bar item, ⌥⌘T capture
  or "Run now" / capture box                  Inbox · Today · Client · Dev · Insights
        │                                            │
        ▼                                            ▼
  sweep ── claude -p (restricted, read-only) ──►  local API (127.0.0.1, token, Host check)
     │        Slack · Gmail · Grain · Calendar · HubSpot │              │
     │        + todo-db MCP (writes the queue)           │              │
     ├── gh search prs (review requests)                 ▼              ▼
     └── Linear API (open issues, projects, mentions)  SQLite queue   Linear API (lists, edits, create, close, comment)
```

## What it does

**Capture**
- Scheduled sweeps on weekdays, plus **Run now**.
- A capture box (and **⌥⌘T** from any app). Paste a Slack, Gmail or Grain link and Claude reads it; type a note and it goes straight in.
- **Signals:** asks of you, your commitments, Grain action items, deadlines, "waiting on" (you asked someone), Google Docs comments assigned to you (via Gmail), HubSpot tickets assigned to you, notes teammates write in HubSpot that mention you, Linear @-mentions, GitHub review requests, and prep for tomorrow's client meetings.
- **Each candidate carries:**
  - a required link back to its source, plus the links mentioned in it;
  - subtasks when the source spells out steps;
  - a suggested client label, project, priority and due date;
  - a "possible duplicate of ENG-…" panel when one of your open issues may already cover it (see below).

**Possible duplicates**
- The sweep recommends one of three choices, with a one-line reason:
  - **Drop as duplicate:** the issue already covers this exact task.
  - **Merge into ENG-…:** same work, but this adds something. Merging posts a comment on the issue with what's new (title, why, quote, due date, source link), attaches the new links, and creates the subtasks as sub-issues. No new issue is made.
  - **Create new:** related, but a separate deliverable.
- The recommended choice is highlighted, and all three are always available. **m** merges from the keyboard.
- **Show ENG-…** expands a preview of the existing issue: status, priority, due date, assignee, description, and its latest three comments.
- Merges can be undone like approvals: the comment, links and sub-issues are removed.

**Task icons**
- Every card and row shows the client's logo with a small badge for the task type. Work with no client shows the type icon on its own.
- **8 types:** code, analysis, model work, review, meeting, email, writing, admin. The sweep picks one for each candidate; click a card's icon to change it (with Undo). For Linear issues it's worked out from labels (your team's labels go in `linear.label_types`) and the title.
- **Logos** come from each client's website icon. The client-label-to-website mapping is `client_domains.json` in the settings folder, for example `{"Globex": "globex.example", "Hooli": null}`; it stays on your Mac and out of the repo. Fetched icons are cached in `logos/` in the settings folder. A client with no known logo (not in the mapping, `null`, or no usable icon) gets one generic company logo.

**Follow-up**
- Each sweep re-reads the threads behind issues TodoHub created, for the sources that sweep reads. It proposes **Close ENG-…** when a thread shows the work is done or the reply arrived, and **Update ENG-…** (a comment) when there's new information.
- **Waiting on** items go to Linear's *Pending* status, due **3 working days** after you asked.
- GitHub review issues are proposed for closing once the review request disappears.
- Issues from a HubSpot ticket are proposed for closing once the ticket is closed.

**Review**
- Approve (⌘↩ or **a**), drop with a reason (**d**, 1–5), snooze (**s**, 1–3), bulk approve or drop, and full keyboard navigation (**?** lists the shortcuts).
- Dropped reasons and recent decisions are fed back into the next sweep.
- **Mute rules:** after you drop several items from the same sender, Slack channel or GitHub repo (3 in 30 days, none approved, not counting "already done" or "duplicate"), TodoHub offers to stop proposing them. "Not now" is remembered. The Drop menu also has **Drop and mute …**.
  - Muting also drops cards already waiting from that source, and Undo brings them back.
  - Muted sources are listed under **Muted** at the bottom of the Inbox, with how many items each has blocked and an **Unmute** button.
  - The sweep is told to skip muted sources, and `add_candidate` refuses anything from them that still gets through.
- **Draft replies:** for a Slack or email ask, the sweep drafts the reply you could send, in your voice. Open **Draft reply** on the card to edit it, then:
  - **Copy**, or **Copy and open in Slack**;
  - for email, **Save as Gmail draft**. This saves a reply in the original thread, to the sender only, with your signature. Nothing is sent. It's a one-off Claude Code run allowed only Gmail's `get_message` and `create_draft`, set by `gmail_draft_tool` in `config.toml`.
- **Undo:** approve, drop, snooze, bulk actions, and status, priority or due-date edits each show a banner with **Undo**. **⌘Z** undoes your recent actions one at a time, for up to 10 minutes; in a text field it undoes typing as usual. Undoing an approval puts the card back in the Inbox and reverses what it did in Linear:
  - created issues and subtasks go to Linear's trash, where they can be restored for 30 days;
  - a closed issue gets its old status back;
  - a posted update is deleted.

  Approvals made before undo existed can't be undone this way. **Block time** isn't covered either; delete the calendar event instead.

**Plan and look back**
- **Today:** star (☆) issues in Client or Dev to add them. In the Brief view the list sits on the left, one task per row with its full title and one line of details (due, "pushed N×", in progress, blocked time). Tick a box to mark it done in Linear (with undo). Drag a row, or press ⌥↑/⌥↓, to reorder; ↑/↓ or j/k select. The selected task opens in a reading pane on the right: status, priority and due date to edit, **Block time** (creates one "Focus: …" calendar event), **Open in Linear**, **Remove from Today**, its sub-issues, its description, and its latest three comments. Done and moved-off items stay at the bottom of the list.
- **Today: brief or checklist.** The switch at the top (or **v**) picks the view; the app remembers it.
  - **Brief:** the morning brief or wrap-up below, then your Today list with reordering and **Block time**. The header counts today's meetings, what's due or overdue, and follow-ups due.
  - **Checklist:** one column. A sentence sums up the day (open Today items, meetings still ahead, follow-ups due), names the most overdue item to do first, and says when client or dev work is behind this week (same rule as the balance nudge). A bar shows done ÷ (done + open) for Today. Ticking a box moves the issue to Done in Linear, with undo. Items with a time block and meetings still ahead are placed by time, after the items without a time. Below: follow-ups due, **+ Add N suggested**, **Wrap up the day** (opens the wrap-up), and what's due later this week.
- **Morning brief** (top of Today, before 2pm), one tile:
  - a sentence with today's meetings, what's due or overdue, and how many waiting-ons are past their follow-up date;
  - **Do first:** the top of the suggested plan, with **Block 1 h** at the next half hour (adds it to Today if needed), **Open in Linear** and **Add to Today**;
  - **Next meeting** (with how long until it, and the rest of the day's meetings) and **Chase** (the oldest follow-up due, with **Copy nudge**: a one-line follow-up message copied for you to paste; nothing is sent);
  - the suggested plan in one line (overdue and due-soon work first, then urgent and high priority) with **Add N to Today**;
  - a "Client (or Dev) work behind this week" pill when the balance nudge applies. Clicking it opens a small popover (Esc or a click outside closes it): how many issues from the side that's behind get you to the target by Sunday, a bar against the target, the math behind the count (assuming no more work from the other side; each extra issue there raises it), about how many a day that is through Friday, and up to three open issues from that side (late and due first) with **+ Today** and **Add N to Today**. **All client work →** opens the tab; **Hide this week** keeps the pill away until Monday.
  - **See the full brief** for the four full sections and the nudge's picks.
  Meetings come from the first sweep of the day.
- **Balance nudge** (in the full brief and the wrap-up): when you've completed at least 3 issues this week and the client share is 15 or more points away from the target, it says so and lists up to three open issues from the side that's behind. It prefers ones due this week, each with **Add to Today**. Client share is the client-labeled issues you completed this week (Monday to Sunday, ET), divided by all the issues you completed this week, as in Insights.
- **Wrap-up** (after 2pm), one tile in dusk colors:
  - a sentence: how many issues you completed in Linear today, and how many Today items are still open;
  - **Tomorrow starts with:** the open Today item ranked highest by the suggested plan for the next working day (how late it will be by then), with **Move N to <day>** (moves what's still open to that day's Today list) and **Open in Linear**;
  - **Done today** (first three, with the client/dev split) and **Tomorrow** (first meeting, what's due that day, who you're still waiting on);
  - **Copy as Slack update** (done and still open, as text), **See the full wrap-up** for the full lists and the balance picks.
  The next working day's calendar is read by the first sweep of the day, along with today's, so the first meeting shows from the morning on.
- On weekdays, a Mac notification at 8am and at 5pm points you to each.
- **Insights:** two views, **Overview** and **Weekly digest**; the app remembers which you used.
  - **Tiles** (top of Overview): closed this week (and last week), client share against the target, approval rate this week, open issues pushed 2+ times, and sweep cost over the last 7 days. Hover a tile for how it's counted; click it to jump to the chart behind it.
  - **Weekly digest:** one week written out, with **← Previous week** to look back up to 8 weeks: a headline, what you closed, what's slipping or overdue, the inbox and sweep numbers, up to three suggestions for next week, and **Copy as Slack update**. It's all counted, not written by a model, so it costs nothing. Closed = your issues completed that week (Monday to Sunday, ET), canceled ones excluded; client share = closed client-labeled ÷ all closed; inbox = suggestions approved or dropped that week, captured notes excluded; slipping = open issues pushed two or more times (whole history) plus open issues past due. The balance line only appears once you've closed 3 or more, and only when you're 15+ points off the target. A source is called noisy when you decided 5+ of its suggestions and dropped half or more.
  - **Client vs dev:** the client share of completed issues per week, against the 50% target.
  - **Approval rate:** approved ÷ (approved + dropped), per source and per week.
  - **Why you dropped:** a breakdown of drop reasons.
  - **Slipped due dates:** how many of your open issues with a due date have been pushed, which ones were pushed two or more times, and totals by client. A slip is a change that moved the due date later; setting a first date, clearing it, or moving it earlier doesn't count. In Client and Dev, a "pushed 2×" tag marks those issues, with the dates in its tooltip. Read from Linear's issue history and cached for 15 minutes.
  - **Sweep history:** cost and turns for each run, with its log, plus the average cost per sweep this week against last week.
- **Sidebar:** Inbox, Today, Client, Dev and Insights on the left with their counts, then your clients, the ones that need you first: overdue issues ("2 late"), then a meeting still ahead today ("2:30"), then the most open issues. Click a client to see its issues in the Client tab. The **+** captures a task. At the bottom, **Sources** lists Slack, Gmail, Grain, Calendar, HubSpot, Linear and GitHub with when each last worked (red with the reason, such as "sign-in", if its last check failed). Hover a source and click **↻** to check only that one: it reads what's new since that source last worked, with a smaller Claude run (GitHub needs none; Calendar re-reads today's and tomorrow's agenda). **Run all** sweeps everything; the theme and shortcuts sit next to it. In a narrow window the sidebar shrinks to icons.
- **Changes you make in Linear:** Client, Dev and Today read Linear every minute and when the window comes back to the front. **Refresh** also re-reads labels, projects and statuses (a new client label shows up without a restart) and re-checks the Inbox. Before each sweep, and on Refresh, every pending suggestion is compared with your issues, and one that looks handled already gets a green "Looks handled in Linear" note: the issue it's about or its possible duplicate was closed or canceled; a closed or canceled issue from the last 14 days has a close title (similarity 0.78, or 0.66 with the same client label); or an open issue you created after the suggestion arrived has a close title. Each note has **Drop as already done** (or **Drop as duplicate** for a ticket you opened) and **Keep**, which clears it and never matches that issue again. A banner above the cards drops them all in one click, with undo. It's a title comparison, not a model, so it costs nothing.
- **Daylight theme:** the theme button opens a menu of System (follows the Mac), Light, Dark and **Daylight** (with the current phase and when the next starts); **t** still cycles them. Daylight changes the colors through the day: Morning (cream and amber, from 6:00 or 30 minutes before sunrise, whichever is earlier) → Day (the Light theme, 10:30–2:00) → Afternoon (warm sand, until an hour before sunset) → Dusk (lavender, an hour each side of sunset) → Night (indigo dark, from an hour after sunset). Light phases blend over 30 minutes; Dusk to Night switches at once. Sunset is worked out on the Mac for the city your time zone is named after (America/New_York → New York), or for `daylight_latitude` / `daylight_longitude` under `[app]` in config.toml (with `daylight_place` as its name). The button's tooltip says the phase, when the next one starts, and today's sunset and where it was worked out for. Status colors and pills keep their meaning in every phase.
- **Status and priority pills:** status and priority show as colored pills everywhere you can change them (Client, Dev, the Today pane, and priority on Inbox cards). Status: Backlog (dashed), Todo (grey), In Progress (blue), Pending (purple), Done (green). Priority: Urgent (solid red), High (orange), Medium (sand), Low (outline), none (plain text). Click a pill for a menu; number keys pick. Urgent rows get a red left edge and a light tint, High rows an orange edge; in the Today list, Urgent and High also show as a pill in the row's details.
- **Client and Dev: by client/project or by status:** the switch next to Refresh (or **v**) groups the tab's issues by client (Client) or project (Dev), or by Linear status: In Progress first, then the other open statuses in Linear's order. Change a row's status and it moves to that group. Backlog stays hidden until you click **Show backlog**. Each tab keeps its own choice.
- **Weekly summary:** a button on each client group in the Client tab opens a draft to edit, copy and send yourself.
- Mac notifications for new urgent items (priority urgent or high, or due within 2 days), and the Inbox count in the menu bar.

## Safety model

- **Read-only sweeps.** Sweeps and captures run Claude Code with `--restricted --permission-mode dontAsk`. That ignores `~/.claude` settings, so no "allow" rule or bypass mode applies, and it denies anything not explicitly allowed.
  - The allowlist has only read tools for Slack, Gmail, Grain, Calendar and HubSpot, plus the `todo-db` tools.
  - Every known write tool of those connectors, and every other MCP server (Linear, Drive, browser…), is also denied by name. Block time and Save as Gmail draft deny all of HubSpot as well. Add your own servers to `sweep.extra_denied_servers`.
- **Untrusted input.** Messages are treated as data. The `todo-db` tools validate every field: unknown labels and projects, bad dates, non-https links and issues that aren't yours are rejected or dropped.
- **Writes need a click.** Nothing reaches Linear until you click Approve, and a candidate can't be approved twice. The only other write is **Block time**: it runs only on your click, can call only the calendar's create-event tool, and gets a cleaned title with no addresses or links in it.
- **Local API.** It listens on 127.0.0.1 only, needs a random per-launch token, and rejects non-loopback `Host` headers. It also exits by itself if the app goes away.
- **No HTML from data.** The UI never inserts HTML built from data.

If `--restricted` turns out to hide your claude.ai connectors in your Claude Code version, the first sweep will show Slack, Gmail and the others as failing. In that case set `restricted = false` and rely on the deny lists; `todohub check` then warns about risky Claude Code settings.

## Setup (macOS)

You need Python 3.11+ with [uv](https://docs.astral.sh/uv/), Node 20+, Rust (`rustup`), the Xcode command-line tools, and `gh` (signed in) for GitHub reviews.

### 1. Backend

```bash
cd backend
uv sync --extra dev
uv run pytest -q                 # optional: run the test suite
uv run todohub init              # creates ~/Library/Application Support/TodoHub
uv run todohub set-linear-key    # Linear personal API key (hidden input, saved in Keychain)
uv run todohub check             # Linear, Claude Code, gh, schedule, settings
```

Create the Linear key in your team's workspace, under Settings → Security & access → Personal API keys.

### 2. First sweep, by hand

```bash
uv run todohub-sweep
```

It prints one line per source. The full prompt and Claude's output are in `logs/sweep-*.log`, and in the app under Insights → Sweep history → Log. The first run looks back 72 hours. If a source shows "Tools denied", add the read-only tool names it lists to `config.toml`.

### 3. Schedule

```bash
uv run todohub install-schedule     # weekdays 8, 10, 12, 14, 16 (Mac local time); missed runs happen on wake
uv run todohub uninstall-schedule
```

### 4. The app

```bash
cd app
npm install
npm run tauri dev
```

**After a code change, press ⇧⌘R** (View → Reload). It restarts the backend from the current code and reloads the window. Screen-only changes also reload by themselves. Only changes to the Rust shell (`app/src-tauri`) need a full quit and a new `npm run tauri dev`.

**TodoHub.app** (runs on its own, no terminal):

```bash
./install-app.sh
```

This builds the one-file backend and the app, replaces `/Applications/TodoHub.app`, and opens it. The first build takes several minutes.

- **Open at login:** the first time it runs, the app adds itself to your login items. At login it starts quietly in the menu bar. Switch it off with **TodoHub → Open at Login**.
- **Finding it:** opening TodoHub from Finder or Spotlight while it's in the menu bar brings the window back.
- **Keychain:** the first time, macOS may ask whether `todohub-backend` can use the Linear key in your Keychain. Choose **Always Allow**.
- **After changing the code:** run `./install-app.sh` again. The installed app doesn't follow the checkout; ⇧⌘R only reloads what it was built with.
- **Dev copy:** use `npm run tauri dev` only while working on TodoHub, and quit the installed app first. Two copies would both put an icon in the menu bar and claim ⌥⌘T. The script refuses to run while the dev copy is open.
- **Scheduled sweeps** keep running from this checkout, as set up by `uv run todohub install-schedule`, so they pick up prompt changes without a rebuild.

The bundled backend also has the CLI built in, for example:

```bash
/Applications/TodoHub.app/Contents/MacOS/todohub-backend cli check
```

### 5. Dead Man's Snitch (optional)

Create a snitch with a **daily** interval and put its URL in `snitch_url`. Each successful sweep pings it.

## Settings (`~/Library/Application Support/TodoHub/config.toml`)

| Key | Default | What it does |
| --- | --- | --- |
| `linear.team_key` | empty (required) | Key of the team new issues go to, e.g. `ENG` |
| `linear.todo_state` / `waiting_state` / `done_state` | `Todo` / `Pending` / `Done` | Statuses for approved tasks, waiting items, closes |
| `linear.followup_days` | `3` | Working days before a "waiting on" item is due |
| `linear.default_priority` | `4` (low) | When a candidate has none and you didn't pick one |
| `linear.label_types` | Bug, Feature, Improvement | Table of your team's labels → task type, e.g. `"Data quality" = "analysis"` |
| `sweep.claude_path` | `claude` | Full path if launchd can't find Claude Code |
| `sweep.model` / `max_turns` / `timeout_minutes` | `sonnet` / `60` / `20` | Per sweep |
| `sweep.restricted` | `true` | Run Claude Code in restricted mode (see Safety) |
| `sweep.slack_tools` / `gmail_tools` / `grain_tools` / `calendar_tools` / `hubspot_tools` | read-only lists | `[]` turns that source off |
| `sweep.linear_mentions` / `github_reviews` | `true` | The two sources read without Claude's connectors |
| `sweep.gmail_account` | empty | Your Gmail address, used in "Open in Gmail" links |
| `sweep.extra_denied_servers` | `[]` | Your own MCP servers the sweep and Block time must never use |
| `sweep.gh_path` | `gh` | GitHub CLI |
| `sweep.snitch_url` | empty | Dead Man's Snitch URL |

## How the sweep decides

- **Window:** each source restarts from the last sweep where *it* worked, minus a 2-hour overlap, so a source that failed (for example, an expired sign-in) gets its missed window back. Meetings get a 24-hour lookback, because Grain notes take time. `is_seen` and `mark_seen` stop anything from being proposed twice.
- **HubSpot:** tickets count from when they were assigned to you, notes from when they were created. Only notes with an owner are read: Grain copies its meeting notes into HubSpot without one, and the Grain source already reads those meetings. HubSpot tasks aren't read, because they're Grain's action items too.
- **Meeting prep:** for the next working day (Friday looks at Monday), every event with people outside your own email domain gets a "Prep for the <client> call" task. Its subtasks check that client's open issues and review the last call's notes. To save cost, this runs once a day, in the first sweep that completes it (normally 8am), and that sweep also saves today's agenda for the morning brief.
- **Your open issues** are shown to the sweep for duplicate checks and meeting prep. Backlog issues untouched for 30 days, with no client and no due date, are left out to keep the prompt short.
- **Learning:** your last 15 kept and 15 dropped candidates, with drop reasons, are part of every sweep prompt.

## Files

```
backend/src/todohub/
  sweep.py            sweep and capture runs: window, prompt, claude -p, results
  sweep_prompt.md     sweep instructions (edit to tune what counts as a task)
  capture_prompt.md   instructions for a pasted link
  mcp_server.py       todo-db MCP server: is_seen, mark_seen, add_candidate, propose_close, propose_update, report_source_status
  tools.py            validation behind those tools
  sources.py          GitHub review requests and Linear mentions
  capture.py          typed notes and link routing
  calendar_block.py   Block time (the one calendar write)
  api.py              local API for the app
  linear.py           Linear GraphQL client
  db.py               SQLite schema, migrations and queries
  stats.py            approval rate and client/dev balance (definitions at the top)
  summary.py          weekly client summary
  cli.py              init, set-linear-key, check, list-tools, install-schedule
  __main__.py         single entry point: api | sweep | mcp | cli
backend/packaging/    PyInstaller build for the bundled backend
app/src/              UI: main.ts (Inbox, Today, lists), insights.ts, desktop.ts (menu bar, notifications), dom.ts
app/src-tauri/        Rust shell: starts the backend, menu bar, ⌥⌘T, close-to-menu-bar
```
