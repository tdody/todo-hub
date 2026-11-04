# TodoHub

One place for Thibault's to-dos. Claude Code reads Slack, Gmail, Grain, Google Calendar, Linear mentions and GitHub review requests on a schedule and puts candidate tasks in a review queue. You approve, edit, snooze or drop each one in a small Mac app. Approved tasks become Linear issues in your team. The same app shows your open Client and Dev issues, a Today plan, and Insights.

```
launchd (weekdays 8, 10, 12, 14, 16)        TodoHub.app (Tauri) + menu-bar item, ⌥⌘T capture
  or "Run now" / capture box                  Inbox · Today · Client · Dev · Insights
        │                                            │
        ▼                                            ▼
  sweep ── claude -p (restricted, read-only) ──►  local API (127.0.0.1, token, Host check)
     │        Slack · Gmail · Grain · Calendar           │              │
     │        + todo-db MCP (writes the queue)           │              │
     ├── gh search prs (review requests)                 ▼              ▼
     └── Linear API (open issues, projects, mentions)  SQLite queue   Linear API (lists, edits, create, close, comment)
```

## What it does

**Capture**
- Scheduled sweeps on weekdays, plus **Run now**.
- A capture box (and **⌥⌘T** from any app). Paste a Slack, Gmail or Grain link and Claude reads it; type a note and it goes straight in.
- **Signals:** asks of you, your commitments, Grain action items, deadlines, "waiting on" (you asked someone), Google Docs comments assigned to you (via Gmail), Linear @-mentions, GitHub review requests, and prep for tomorrow's client meetings.
- **Each candidate carries:**
  - a required link back to its source, plus the links mentioned in it;
  - subtasks when the source spells out steps;
  - a suggested client label, project, priority and due date;
  - a "maybe duplicate of ENG-…" flag.

**Task icons**
- Every card and row shows the client's logo with a small badge for the task type. Work with no client shows the type icon on its own.
- **8 types:** code, analysis, model work, review, meeting, email, writing, admin. The sweep picks one for each candidate. For Linear issues it's worked out from labels (your team's labels go in `linear.label_types`) and the title.
- **Logos** come from each client's website icon. The client-label-to-website mapping is `client_domains.json` in the settings folder, for example `{"Globex": "globex.example", "Hooli": null}`; it stays on your Mac and out of the repo. Fetched icons are cached in `logos/` in the settings folder. A client with no known logo (not in the mapping, `null`, or no usable icon) gets one generic company logo.

**Follow-up**
- Each sweep re-reads the threads behind issues TodoHub created. It proposes **Close ENG-…** when a thread shows the work is done or the reply arrived, and **Update ENG-…** (a comment) when there's new information.
- **Waiting on** items go to Linear's *Pending* status, due **3 working days** after you asked.
- GitHub review issues are proposed for closing once the review request disappears.

**Review**
- Approve (⌘↩ or **a**), drop with a reason (**d**, 1–5), snooze (**s**, 1–3), bulk approve or drop, and full keyboard navigation (**?** lists the shortcuts).
- Dropped reasons and recent decisions are fed back into the next sweep.
- **Undo:** approve, drop, snooze, bulk actions, and status, priority or due-date edits each show a banner with **Undo**. **⌘Z** undoes your recent actions one at a time, for up to 10 minutes; in a text field it undoes typing as usual. Undoing an approval puts the card back in the Inbox and reverses what it did in Linear:
  - created issues and subtasks go to Linear's trash, where they can be restored for 30 days;
  - a closed issue gets its old status back;
  - a posted update is deleted.

  Approvals made before undo existed can't be undone this way. **Block time** isn't covered either; delete the calendar event instead.

**Plan and look back**
- **Today:** star (☆) issues in Client or Dev, order them, and **Block time**, which creates one "Focus: …" calendar event.
- **Insights:**
  - **Client vs dev:** the client share of completed issues per week, against the 50% target.
  - **Approval rate:** approved ÷ (approved + dropped), per source and per week.
  - **Why you dropped:** a breakdown of drop reasons.
  - **Sweep history:** cost and turns for each run, with its log.
- **Weekly summary:** a button on each client group in the Client tab opens a draft to edit, copy and send yourself.
- Mac notifications for new urgent items (priority urgent or high, or due within 2 days), and the Inbox count in the menu bar.

## Safety model

- **Read-only sweeps.** Sweeps and captures run Claude Code with `--restricted --permission-mode dontAsk`. That ignores `~/.claude` settings, so no "allow" rule or bypass mode applies, and it denies anything not explicitly allowed.
  - The allowlist has only read tools for Slack, Gmail, Grain and Calendar, plus the four `todo-db` tools.
  - Every known write tool of those connectors, and every other MCP server (Linear, Drive, HubSpot, browser…), is also denied by name. Add your own servers to `sweep.extra_denied_servers`.
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

**Standalone app** (no uv or terminal needed to run it):

```bash
backend/packaging/build-backend.sh                                   # one-file backend → app/src-tauri/binaries/
cd app && npm run tauri build -- --config src-tauri/tauri.bundle.conf.json
```

The bundled backend also has the CLI built in:

```bash
/Applications/TodoHub.app/Contents/MacOS/todohub-backend cli install-schedule
```

Run `todohub-backend cli set-linear-key` and `cli check` the same way.

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
| `sweep.slack_tools` / `gmail_tools` / `grain_tools` / `calendar_tools` | read-only lists | `[]` turns that source off |
| `sweep.linear_mentions` / `github_reviews` | `true` | The two sources read without Claude's connectors |
| `sweep.gmail_account` | empty | Your Gmail address, used in "Open in Gmail" links |
| `sweep.extra_denied_servers` | `[]` | Your own MCP servers the sweep and Block time must never use |
| `sweep.gh_path` | `gh` | GitHub CLI |
| `sweep.snitch_url` | empty | Dead Man's Snitch URL |

## How the sweep decides

- **Window:** each source restarts from the last sweep where *it* worked, minus a 2-hour overlap, so a source that failed (for example, an expired sign-in) gets its missed window back. Meetings get a 24-hour lookback, because Grain notes take time. `is_seen` and `mark_seen` stop anything from being proposed twice.
- **Meeting prep:** for the next working day (Friday looks at Monday), every event with people outside your own email domain gets a "Prep for the <client> call" task. Its subtasks check that client's open issues and review the last call's notes.
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
