# TodoHub

One place for Thibault's to-dos. Claude Code reads Slack, Gmail, Grain, Google Calendar, HubSpot, Linear mentions and GitHub review requests on a schedule and puts candidate tasks in a review queue. You approve, edit, snooze or drop each one in a small Mac app. Approved tasks become Linear issues in your team. The same app shows your open Client and Dev issues, your pull requests, a Today plan, and Insights.

```
launchd (weekdays 8, 10, 12, 14, 16)        TodoHub.app (Tauri) + menu-bar item, ⌥⌘T capture
  or "Run now" / capture box                  Inbox · Today · Client · Dev · Pull requests · Insights
        │                                            │
        ▼                                            ▼
  sweep ── claude -p (restricted, read-only) ──►  local API (127.0.0.1, token, Host check)
     │        Slack · Gmail · Grain · Calendar · HubSpot │              │
     │        + todo-db MCP (writes the queue)           │              │
     ├── gh search prs (review requests)                 ▼              ▼
     └── Linear API (open issues, projects, mentions)  SQLite queue   Linear API (lists, edits, create, close, comment)
                                                                       gh api graphql (the Pull requests tab)
```

## What it does

**Capture**
- Scheduled sweeps (weekdays every 2 hours by default; change it on the Settings page), plus **Run now**.
- A capture box (and **⌥⌘T** from any app). Paste a Slack, Gmail or Grain link and Claude reads it; type a note and it goes straight in.
- **Signals:** asks of you, your commitments, Grain action items, deadlines, "waiting on" (you asked someone), Google Docs comments assigned to you (via Gmail), HubSpot tickets assigned to you, notes teammates write in HubSpot that mention you, Linear @-mentions, GitHub review requests, and prep for tomorrow's client meetings.
- **Each candidate carries:**
  - a required link back to its source, plus the links mentioned in it;
  - subtasks when the source spells out steps;
  - a suggested client label, project, priority and due date;
  - a link to one of your open issues when that issue may already cover it (see below).

**Linked issues**
- When one of your open issues may already cover a card, the sweep links them and recommends one of three picks, with a one-line reason:
  - **Merge:** same work, but this adds something (a new ask, a date, a step, a link).
  - **Create new:** related, but a separate deliverable.
  - **Drop:** the issue already covers this exact task.
- The card shows the linked issue (status, priority, due date; **Show description and comments** for the rest) and a switch with the three picks. Claude's recommendation is selected at first and has a dot. The card below the switch changes with the pick, and one button does it (**a** or ⌘↩):
  - **Merge into ENG-…** shows what it will change on the issue. No new issue is made.
    - The comment it posts. **Edit** changes it. The source link goes under it.
    - **Move the due date**: shown when the card has a due date and the issue has a later one or none.
    - **Raise the priority**: shown when the card has a priority and the issue has a lower one or none.
    - Both boxes start ticked. Untick a box to skip that change.
    - The subtasks it adds as sub-issues, and the links it attaches.
  - **Create issue** (or **Track**) shows the usual fields.
  - **Drop** shows the drop reasons, with Duplicate selected. 1–5 select another reason.
- Keys on a linked card: **a** or ⌘↩ press the button, **m** selects Merge (with Merge selected, it merges), and **d** selects Drop.
- Undo removes the comment, links and sub-issues, and puts the issue's old due date and priority back.
- Bulk **Approve** leaves linked cards out; decide them one at a time.

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
- **List and pane:** the Inbox lists the candidates on the left, two lines each: the title, then the source, who, and chips for what's set (client, High/Urgent, due date, red when late; "Same as ENG-123", "Adds to ENG-123" or "Related to ENG-123" for a linked issue, "Looks handled" when Linear already covers it). The selected one opens in full on the right: why, the excerpt, the linked issue and its plan, the draft reply, links, subtasks, the fields to edit, and its decision. ↑↓ or **j**/**k** move through the list; after a decision the next one is selected. Hover a row for its checkbox (bulk select).
- Approve (⌘↩ or **a**), drop with a reason (**d**, 1–5), snooze (**s**, 1–3), bulk approve (linked cards left out) or drop, and full keyboard navigation (**?** lists the shortcuts).
- Dropped reasons and recent decisions are fed back into the next sweep.
- **Mute rules:** after you drop several items from the same sender, Slack channel or GitHub repo (3 in 30 days, none approved, not counting "already done" or "duplicate"), TodoHub offers to stop proposing them. "Not now" is remembered. The Drop menu also has **Drop and mute …** (linked cards have no Drop menu).
  - Muting also drops cards already waiting from that source, and Undo brings them back.
  - Muted sources are listed under **Muted** at the bottom of the Inbox, with how many items each has blocked and an **Unmute** button.
  - The sweep is told to skip muted sources, and `add_candidate` refuses anything from them that still gets through.
- **Draft replies:** for a Slack or email ask, the sweep drafts the reply you could send, in your voice. Open **Draft reply** on the card to edit it, then:
  - **Copy**, or **Copy and open in Slack**;
  - for email, **Save as Gmail draft**. This saves a reply in the original thread, to the sender only, with your signature. Nothing is sent. It's a one-off Claude Code run allowed only Gmail's `get_message` and `create_draft`, set by `gmail_draft_tool` in `config.toml`.
- **Undo:** approve, drop, snooze, bulk actions, and status, priority or due-date edits each show a banner with **Undo**. **⌘Z** undoes your recent actions one at a time, for up to 10 minutes; in a text field it undoes typing as usual. Undoing an approval puts the card back in the Inbox and reverses what it did in Linear:
  - created issues and subtasks go to Linear's trash, where they can be restored for 30 days;
  - a closed issue gets its old status back, and an issue you merged into gets its old due date and priority back;
  - a posted update is deleted.

  Approvals made before undo existed can't be undone this way. **Block time** isn't covered either; delete the calendar event instead.

**Plan and look back**
- **Today:** one list for the day, read in three moments: the morning cover, the day, and the wrap-up. Star (☆) issues in Client or Dev to add them; the keys are in the shortcuts sheet (**?**).
  - **The morning cover** (working days from 6am until noon, until you press **Start my day**): a night sky with Claude's brief. **Yesterday** is a sentence or two on the last working day (what you closed, what carried over, what slipped); **Today** is the shape of the day (the meeting that matters, what to do before it). Each issue Claude names is a chip that goes to its row. Below, a checklist: Claude's picks, each with why today, how late or due and its estimate, all **unchecked**; then what's already on Today, checked. Check what you'll take on (**x** or a click; **j**/**k** move); the line under it adds up the estimates against your free time between meetings (8:30am–6pm, lunch excluded). **Start my day with N** (or ↵) puts only what's checked on Today and plays a short sunrise (about 2½ seconds; skipped if macOS's Reduce motion is on): dawn, the sun comes up, and the sky folds into the band. Until Claude's plan is in, the checklist shows suggestions counted from due dates and priority, with **Ask Claude to plan**.
  - **Through the day:** a band with the time, the next meeting (how long until it, and whether it's external) and the one after. Its sun follows the real one, worked out for the Daylight theme's location, and moves every minute. Under it, Claude's note: the morning plan's headline and summary, until the first sweep from noon writes a fresh note for the rest of the day (**↻ Redo** asks again: about a minute, a few cents). Then the list, split **Client** and **Dev**, each in attention order (late, due today, follow-ups due, later, no date), the side with the most urgent work first. Each section shows its share of what you've closed this week against the target; when a side is behind, a line says so and opens the balance popover. A row is the title and one line: due, waiting, Claude's estimate, blocked time; Urgent and High rows have a colored edge. **Not on Today** folds Claude's picks you didn't take and the late issues it left out, each with its next step (**Set due Fri**, **Clear the date** or **Copy message**) and **Add to Today** (**a**); **N done today** folds what you closed.
  - **The selected issue** opens beside the list (under it on a narrow page): its identifier (a link to Linear), client or project, "Claude's pick" and "pushed N×"; the title and Claude's reason; for a follow-up, the nudge to copy; whether Claude's estimate fits before the next meeting ("~45 min · too long for now; fits 4:00–5:00, before 1:1 with Sam"). Then the actions, each with its key: **Mark done** (⌘↵, with undo), **Block 30 min at 3:00** (**b**: one "Focus: …" calendar event in the first free stretch long enough), **Move to Thu** (**m**: onto the next working day's Today list and off today's, with undo) and **Copy nudge** (**n**). Below: status, priority, due date, client and project to edit, **⋯** (**Start in periscope** when periscope is set up, Remove from Today, **Delete…**), then the description, sub-issues and the latest three comments, with their Markdown rendered (headings, bold and italic, lists and checklists, tables, quotes, code and links; up to 6,000 characters of the description, then **Edit in Linear**). The pane builds the text itself and never inserts HTML from Linear, and only web and email links are clickable. Images pasted into Linear show in the pane at its width (click one to open it full size): the backend fetches them from Linear's upload server with your Linear key, which never goes anywhere else, and keeps the last 40 in memory. Images hosted on other sites stay links, so opening a ticket never tells another site you read it. **j**/**k** (or ↑/↓) move through the list; **o** opens the issue in Linear.
  - **The wrap-up** (once the 4pm sweep writes it, or from 5pm on a working day): a dusk sky with the score ("2 of 5 planned done, plus 11 more."), Claude's summary with chips, **↻ Redo**, **Weekly check-in**, and the next working day: what to start with, its first meeting and what's due. Each item on Today gets Claude's next step as its main button: **Close?** (⌘↵, marks it done in Linear), **Move to Thu** (**m**), **Set due Nov 20** (**d**, in Linear) or **Copy message** (**n**: a short note to whoever is blocking it, copied for you to paste; nothing is sent); the others stay a key away. Decided items stay in the list, checked ("Moved to Thu", "Message copied"), so the evening reads as a list filling up. Without a wrap-up yet, every open item's step is Move to Thu.
  The plan is made by the first sweep of a working morning (6–11am), using what it just read in Slack, email, Grain and the calendar, plus your Linear issues (due dates, priority, state, pushed due dates), yesterday's wrap-up and what you closed then, and this week's client/dev balance. The midday note is written by the first sweep from noon (before 3pm), the wrap-up by the first sweep from 3pm (normally the 4pm one). Claude only suggests: it saves each with a tool (`report_plan`, `report_note`, `report_wrapup`) and never stars, re-dates, closes or sends anything, and it marks each issue it names as `[label](ENG-123)` so the app can show a chip (only for open issues; anything else stays plain text). `todohub sweep --plan`, `--note` and `--wrapup` run one by hand; **↻ Re-plan** and **↻ Redo** do the same from the app (a run of its own, about a minute, a few cents). Meetings come from the first sweep of the day, which also reads the next working day's calendar.
- **Balance popover** (from the "Behind the 50% target this week" line under Client or Dev): shows when you've completed at least 3 issues this week and the client share is 15 or more points away from the target. It says how many issues from the side that's behind get you to the target by Sunday, with a bar against the target, the math behind the count (assuming no more work from the other side; each extra issue there raises it), about how many a day that is through Friday, and up to three open issues from that side (late and due first) with **+ Today** and **Add N to Today**. **All client work →** opens the tab; **Hide this week** hides the line until Monday. Esc or a click outside closes it. Client share is the client-labeled issues you completed this week (Monday to Sunday, ET), divided by all the issues you completed this week, as in Insights.
- **Weekly check-in** (from the wrap-up): your mission check-in for the week, drafted by Claude and rebuilt by each wrap-up, ready to paste into the /mission-checkin skill. It lists your accomplishments by mission (from the `missions_initiative` in config.toml, "Q4 Missions" by default; ones in no mission go under "Other"): releases (code that shipped, described by what it does) and client results (what a client received or got), not meetings, emails, prep or reviews. It's written for a non-technical reader (the COO): plain language, no pull request links or technical names, with the Linear issue ID at the end of each line so the check-in files it under the right mission. Then the results you expect next week, documents or decks to look at, and the health of the missions you lead. The daily notes it builds on keep only accomplishments too. Edit it in the box; **How was your week?**, **Help needed**, **Highlights** and **Shoutouts** are yours to write, and empty ones are left out. **Copy** puts it all on the clipboard in the order the check-in asks. Your edits stay in the app for the week, until Claude writes a newer draft (your four answers are kept); **Back to Claude's draft** drops your edits to the text.
- On weekdays, a Mac notification at 8am and at 5pm points you to each.
- **Pull requests** (⌘5): your open pull requests (**Mine**) and the ones that ask for your review (**To review**), read from GitHub with `gh api graphql`. No Claude run is involved.
  - **Next step:** each of yours gets one, from GitHub data only: Fix CI, Resolve conflicts, Resolve N threads, Re-request review, Find a reviewer, Waiting on Ana · 2 days (amber from 2 days) or Merge. Steps that only wait are grey: Waiting for CI, Waiting on Raj, Merge after #2374, and a draft's Mark ready for review.
  - **Views:** the strip counts **Needs you** (the default), **In review**, **Changes requested**, **Approved** and **All open**; **To review** has **Waiting on you**, **Waiting 3+ days** and **Asked again**. The note under a count ("4 CI failing", "3 ready to merge") filters the table to that part. Number keys pick a view.
  - **Table:** click a header to sort; Next step puts the most urgent first, then the oldest. Rows with the same value sort by Next step. **#** is the pull request number: the first click puts the newest first, and a stack sorts by its lowest number. Comment counts leave out bots, and "3 open" counts the unresolved threads that people started (of the 30 newest). Drafts in no stack fold under **N drafts**. Click the Linear issue under a title (ENG-123) to open it in Linear. Size folds away when the page is 920 px or narrower (a window under 1200 px with the default sidebar).
  - **Client / project** (Mine only): the client label of the Linear issue that a pull request names, else the issue's project, else "No client or project" (no issue, or one that is not one of your open issues). A stack takes the group of its base pull request.
    - When the page is wider than 1120 px (a window wider than 1400 px with the default sidebar), a **Client / project** column shows it on each row. Sorted by it, a name shows on the first row of each group and where the row above is in another group, and a darker line starts each group.
    - **Group** (next to Refresh all, or **g**) splits Mine into one section for each client or project, with the heading of Client and Dev: "5 open · 2 need you · 1 CI failing". The rows sort inside each section. Sorted by Next step, the section with the most urgent first row comes first; "No client or project" always comes last. Click a heading to fold its section until the app restarts. In a section, a stack member in another client or project names it under its title. The app remembers whether the groups are on.
  - **Stacks:** a pull request whose base branch is another of yours is built on it. A stack shows as one unit: a summary row with the merge order and the values it sorts by, then its pull requests on a rail. The ones the view leaves out stay in grey, so a stack never splits. Point at one to light up the whole stack. Click the rail or the summary row to fold the stack to its summary row, with its count on the rail; click again to unfold it. A folded stack stays folded until the app restarts.
  - **A row, opened in place** (click, or Space; j/k move): failing checks with their run time, the open threads, the Linear issue the branch or title names (its status and due date when it's one of your open issues), and the reviews. **Open in GitHub** (**o**), **Open ENG-123** (**l**), **Copy branch name**, and **Refresh**, which reads that one pull request from GitHub again (1 point). A merged or closed one leaves the list.
  - **Reading GitHub:** when the app starts, and while the tab shows, about every 5 minutes after the last read (a read costs about 20 of the 5,000 points an hour GitHub allows). **Refresh all** (or **⌘R**) reads now and starts the 5 minutes again. When `gh` fails, a banner says why and the page keeps the last read. The sidebar count is Needs you plus To review.
- **Insights:** two views, **Overview** and **Weekly digest**; the app remembers which you used.
  - **Tiles** (top of Overview): closed this week (and last week), lines merged this week (added and removed, in how many pull requests, and last week's figures), open issues pushed 2+ times, and sweep cost over the last 7 days. Hover a tile for how it's counted; click it to jump to the chart behind it (the sweep-cost tile opens the sweep history).
  - **Weekly digest:** one week written out, with **← Previous week** to look back up to 8 weeks: a headline, what you closed, what's slipping or overdue, the inbox and sweep numbers, up to three suggestions for next week, and **Copy as Slack update**. It's all counted, not written by a model, so it costs nothing. Closed = your issues completed that week (Monday to Sunday, ET), canceled ones excluded; client share = closed client-labeled ÷ all closed; inbox = suggestions approved or dropped that week, captured notes excluded; slipping = open issues pushed two or more times (whole history) plus open issues past due. The balance line only appears once you've closed 3 or more, and only when you're 15+ points off the target. A source is called noisy when you decided 5+ of its suggestions and dropped half or more.
  - **Client vs dev:** the client share of completed issues per week, against the 50% target.
  - **Pull requests:** your pull requests that GitHub merged each week, and under each week the pull requests of others you reviewed (each counts once a week). Merged counts any branch, so a pull request merged into the one below it in a stack counts too. Read from GitHub with one `gh api graphql` call (about 1 point; lines only for this week and last week) and cached for 15 minutes; when `gh` fails, the tile and the panel say so and the rest of Insights still works.
  - **Slipped due dates:** how many of your open issues with a due date have been pushed, which ones were pushed two or more times, and totals by client (folded under **By client**). A slip is a change that moved the due date later; setting a first date, clearing it, or moving it earlier doesn't count. In Client and Dev, a "pushed 2×" tag marks those issues, with the dates in its tooltip. Read from Linear's issue history and cached for 15 minutes.
  - **Approval rate:** approved ÷ (approved + dropped) per week; **By source and why you dropped** unfolds the per-source table and the breakdown of drop reasons.
- **Sweep history** (a dialog from **Sweep history →** in the sources popover, or the sweep-cost tile): cost and turns for each run (scheduled, run now, capture, re-plan or wrap-up), with its log, plus the average cost per sweep this week against last week (re-plans and wrap-up redos aren't counted as sweeps).
- **Sidebar:** Inbox, Today, Client, Dev, Pull requests and Insights on the left with their counts, then your clients, the ones that need you first: overdue issues ("2 late"), then a meeting still ahead today ("2:30"), then the most open issues. Click a client to see its issues in the Client tab. Below, **Projects**: the projects of your open issues, Client and Dev (a client issue can belong to a project too), late ones first and then the busiest, with "N late" or the open count. Click one for its own view: every open issue in the project grouped by status, as in By status (In Progress first, backlog behind **Show backlog**), each row naming its client, with the same reading pane and a header like "3 open · 1 client, 2 dev"; the filter searches within it, and any tab in the sidebar leaves it. Issues without a project stay under "No project" in Dev. Each list shows six, with **+ N more**. The **+** captures a task. At the bottom, one line sums up the sources: a green dot and the next sweep ("next 12pm"), a red dot and "1 error" (or "2 errors") when a source's last check failed, or "Sweeping…". Click it (or press **r**) for the Sources popover: Slack, Gmail, Grain, Calendar, HubSpot, Linear and GitHub with when each last worked, and the reason under any that failed. Hover a source and click **↻** to check only that one: it reads what's new since that source last worked, with a smaller Claude run (GitHub needs none; Calendar re-reads today's and tomorrow's agenda). **Run all** sweeps everything; **Sweep history →** opens the run list in Insights. The theme and shortcuts sit next to the line. Drag the sidebar's right edge to make it wider or narrower (200 to 400 px; double-click it for 224 px). The hide button after **+** (or **⌃⌘S**) shrinks the sidebar to icons, and shows it again. The app remembers both on this Mac. The sidebar always leaves the page 600 px of the window, and in a window 820 px or narrower it is always icons.
- **Changes you make in Linear:** Client, Dev and Today read Linear every minute and when the window comes back to the front. **⌘R** reloads now and also re-reads labels, projects and statuses (a new client label shows up without a restart) and re-checks the Inbox. Before each sweep, and on ⌘R, every pending suggestion is compared with your issues, and one that looks handled already gets a green "Looks handled in Linear" note: the issue it's about or its linked issue was closed or canceled; a closed or canceled issue from the last 14 days has a close title (similarity 0.78, or 0.66 with the same client label); or an open issue you created after the suggestion arrived has a close title. Each note has **Drop as already done** (or **Drop as duplicate** for a ticket you opened) and **Keep**, which clears it and never matches that issue again. A banner above the cards drops them all in one click, with undo. It's a title comparison, not a model, so it costs nothing.
- **Daylight theme:** the theme button opens a menu of System (follows the Mac), Light, Dark and **Daylight** (with the current phase and when the next starts); **t** still cycles them. Daylight changes the colors through the day: Morning (cream and amber, from 6:00 or 30 minutes before sunrise, whichever is earlier) → Day (the Light theme, 10:30–2:00) → Afternoon (warm sand, until an hour before sunset) → Dusk (lavender, an hour each side of sunset) → Night (indigo dark, from an hour after sunset). Light phases blend over 30 minutes; Dusk to Night switches at once. Sunset is worked out on the Mac for the city your time zone is named after (America/New_York → New York), or for `daylight_latitude` / `daylight_longitude` under `[app]` in config.toml (with `daylight_place` as its name). The button's tooltip says the phase, when the next one starts, and today's sunset and where it was worked out for. Status colors and pills keep their meaning in every phase.
- **Settings** (bottom of the sidebar, ⌘7 or ⌘,): one page with four sections, or five when periscope is set up; a list on the left jumps to each. Changes save as you make them, to `settings.json` in the TodoHub folder, which wins over `config.toml` for these keys (config.toml stays as you wrote it). Nothing on the page can send anything. The last section, **Updates**, shows your version and checks for a new release.
  - **Appearance:** the four styles as small pictures (the theme button and **t** change the same setting), and where Daylight follows the sun: a place name with latitude and longitude, or **Use my time zone**. It shows today's sunrise and sunset there.
  - **Sources:** the sources the sweep reads, each with its status ("OK · read 10:02", or the problem in red, with **Open claude.ai ↗** for a connector), **Check now**, and a tick box: untick to pause it (it stays in the list, and sweeps skip it). **Remove** (on hover) takes it off the list; **+ Add a source** lists the supported sources you don't use and adds one back with its read-only tools. A source TodoHub doesn't support yet (Zoom, another mail service) can't be added from here. **Check all now** sweeps every source that's on.
  - **Schedule:** every 1, 2, 3 or 4 hours, between a first and last hour, on weekdays or every day, with a week grid that marks the sweep that writes the morning plan (the first between 6am and 11am) and the one that writes the wrap-up (the first at 3pm or later); if none qualifies, it says so. Saving rewrites the Mac's launchd schedule and reloads it, so the new hours apply at once; if the schedule isn't installed, **Set it up** installs it. The sidebar's "next 12pm" follows these hours.
  - **Periscope:** the prompt that Start in periscope sends. **Save** keeps it. **Reset to default** brings back the default prompt.
- **Status and priority pills:** status and priority show as colored pills everywhere you can change them (Client, Dev, the Today pane, and priority on Inbox cards). The status menu lists every status your Linear team has, in Linear's order (backlog, not started, started, done, canceled, duplicate): Backlog (dashed), Todo and other not-started ones (grey), Pending (purple), In Progress and other started ones (blue), Done (green), Canceled and Duplicate (struck through). Done, Canceled and Duplicate take the issue off the open lists, with **Undo**. Priority: Urgent (solid red), High (orange), Medium (sand), Low (outline), none (plain text). Click a pill for a menu; number keys pick. Urgent rows get a red left edge and a light tint, High rows an orange edge; in the Today list, Urgent and High also show as a pill in the row's details.
- **Quiet empty fields:** an unset due date, priority, client or project shows nothing, and a set date shows as text ("Nov 9", "Today", red when late). The field appears when you hover the row or card, or tab to it; on an Inbox card the empty ones take no room until then. The reading panes always show an empty priority, client and project; Client and Dev's pane shows an empty due date too.
- **Zoom:** ⌘+ (or ⌘=) and ⌘− make the window's text and layout bigger or smaller, in steps of 20%. ⌘0 goes back to 100%.
- **Page headers:** every page has its title (with a count: "12 to review", "8 open") and, when it has views, underline tabs under it; the filter (**/**) sits on the right of that line. There's no Refresh button: Linear reloads every minute and when the window comes back, and **⌘R** reloads now.
- **Client and Dev: by client/project or by status:** the **By client** (or **By project**) and **By status** tabs under the title (or **v**) group the tab's issues by client (Client) or project (Dev), or by Linear status: In Progress first, then the other open statuses in Linear's order. Change a row's status and it moves to that group. Backlog stays hidden until you click **Show backlog**. Each tab keeps its own choice.
- **Client and Dev: list and reading pane** (like Today and the Inbox): the grouped list on the left. Each group starts with a heading: the client's logo (a project's initial, or the status's colored dot), the name in bold, a short summary ("8 open · 2 late · 1 due today") and a rule running to **Weekly summary** on client groups. Below it, one issue per row with its full title (wrapping when it's long) and one quiet line: status, ID, the project (Client) or client (Dev), priority, due date, "pushed N×", and the parent for a sub-issue shown on its own. ☆ stars it for Today. Click a row, or use ↑/↓ or j/k, to read it in the pane on the right: its ID (a link to Linear), client or project, the title, then status, priority, due date, client and project to edit, **Block time ▾** when it's on Today (else **☆ Add to Today**) and **⋯** (Open in Linear, **Start in periscope** when periscope is set up, Remove from Today, **Delete…**); below, its description, sub-issues and latest three comments. Each tab remembers its selection. **Delete…** asks first, then moves the issue to Linear's trash (restorable there for 30 days) and takes it off Today; **Undo** or ⌘Z brings it back, onto Today where it was. Deleting doesn't touch its sub-issues; the dialog says how many are still open so you can check them in Linear. On a narrow page the pane sits under the list.
- **Editing in the reading pane** (Today, Client and Dev, the same in each): click the title or press **e** to rename it in place (Enter or leaving the box saves, Esc cancels). Click the description or press **⇧E** to edit its Markdown in place; leaving the box, ⌘↵ or Esc saves (a description longer than the pane's 6,000 characters is edited in Linear). Client and project are selects next to the due date: changing the client swaps only the client label, and "Dev / internal" makes it a Dev issue (in Client or Dev it leaves the list and the next one is selected). Sub-issues come from Linear, done ones included: tick one to mark it done, untick to put it back in Todo (a canceled or duplicate one, or one in another team, shows its status without a box). **⇧S** adds a sub-issue in the parent's team, with its client, project and priority, assigned to you; the box stays ready for the next. **⇧C** writes a comment, posted as you with ⌘↵. Every save offers **Undo** (⌘Z, 10 minutes): the old value comes back, a new sub-issue or comment is deleted (its text goes back in the box). Right after a post, ⌘Z in the box it emptied undoes the post; once you type there, ⌘Z undoes typing again. A re-render never loses what you're typing, switching to another app doesn't save a half-typed field, and a failed save keeps your text.
- **Weekly summary:** a link on each client group in the Client tab opens a draft to edit, copy and send yourself.
- **Recently decided** (bottom of the Inbox, after Snoozed and Muted): the cards you approved or dropped in the last 30 days, latest first, 50 at a time. Each shows what happened (Approved, Closed, Commented, or Dropped with its reason), where it came from and when. A dropped card has **Restore**, which puts it back in the Inbox (with Undo); an approved one links to the Linear issue it became. The filter (/) applies to it too.
- **New tasks:** one Mac notification per sweep that adds tasks, once it finishes: "TodoHub: 4 new tasks to review (1 urgent)" with the first three titles, urgent ones first (urgent: priority urgent or high, or due within 2 days); a single task shows its title and why. A sweep that finished more than 3 hours ago (the app was closed) doesn't notify, nor do typed captures. The menu bar shows the Inbox count.
- **A source that keeps failing:** a sweep can finish fine while one source fails (an expired Gmail or Slack sign-in, a connector that won't connect). When the same source fails in two sweeps in a row (scheduled or Check now), a Mac notification names it, with its error and since when; at most once a day per source. Settings → Sources shows "failed N sweeps in a row" on that row. Nothing is lost meanwhile: the source reads back to its last good sweep once it works again.

**Start in periscope**
- This feature is off until you set `app.periscope_url` in config.toml. While it is off, the app shows no menu item, no **p** shortcut and no Periscope settings.
- In Today, Client and Dev, an issue's **⋯** menu has **Start in periscope** (**p**). It opens a popover with three fields. Each field is filled in, except Repo when no repo is remembered. Then Repo shows "Pick a repo".
  - **Repo** lists periscope's repos. It selects the repo you last used for the issue's Linear project (or its client, when it has no project), else the last repo you used.
  - **Branch** is Linear's branch name for the issue.
  - **Prompt** comes from the template on the Settings page. `{identifier}`, `{title}` and `{url}` become the issue's.
- **Start** (↵, or ⌘↵ in the prompt) asks periscope to make the worktree (or use the one on that branch). Periscope starts Claude Code in it and sends the prompt, and the new card shows the issue.
  If a Claude is already on that branch, periscope starts nothing.
- Before the start, Haiku names the new Claude on periscope's rail: the issue's ID and up to three words, for example `eng-123-grade-rebin`. This adds 2 to 5 seconds. Periscope pins the name, so it does not rename the Claude. If the title has no words, for example only a link, or Claude Code fails, the name is the ID alone.
- The toast's **Show** selects that Claude in periscope. When `app.periscope_app_id` is set, **Show** also brings the app to the front.
- When periscope starts a new Claude, todo-hub adds a comment to the issue: the start time, the email of the Claude account and the Claude session ID. To open that conversation again, run `claude --resume <id>` in the issue's worktree, or use `resume_session` in periscope. With a Claude already on the branch, or a periscope that sends no session ID, todo-hub adds no comment. If Linear refuses the comment, the start still counts, and an error toast says so.
- Periscope must be running. It must answer `POST /api/linear/start` and `POST /api/select`. A periscope that does not know the `name` field starts Claude without it.

## Safety model

- **Read-only sweeps.** Sweeps and captures run Claude Code with `--restricted --permission-mode dontAsk`. That ignores `~/.claude` settings, so no "allow" rule or bypass mode applies, and it denies anything not explicitly allowed.
  - The allowlist has only read tools for Slack, Gmail, Grain, Calendar and HubSpot, plus the `todo-db` tools.
  - Every known write tool of those connectors, and every other MCP server (Linear, Drive, browser…), is also denied by name. Block time and Save as Gmail draft deny all of HubSpot as well. Add your own servers to `sweep.extra_denied_servers`.
- **Untrusted input.** Messages are treated as data. The `todo-db` tools validate every field: unknown labels and projects, bad dates, non-https links and issues that aren't yours are rejected or dropped.
- **Writes need a click.** Nothing reaches Linear until you click Approve, and a candidate can't be approved twice. The only other write is **Block time**: it runs only on your click, can call only the calendar's create-event tool, and gets a cleaned title with no addresses or links in it.
- **Local API.** It listens on 127.0.0.1 only, needs a random per-launch token, and rejects non-loopback `Host` headers. It also exits by itself if the app goes away.
- **No HTML from data.** The UI never inserts HTML built from data.

If `--restricted` turns out to hide your claude.ai connectors in your Claude Code version, the first sweep will show Slack, Gmail and the others as failing. In that case set `restricted = false` and rely on the deny lists; `todohub check` then warns about risky Claude Code settings.

When Anthropic's connector service is down, the connector sources a sweep couldn't read (Slack, Gmail, Grain, HubSpot, and Calendar when it was due for meeting prep) each say "Anthropic's connector service didn't respond (HTTP 503), so it wasn't read", followed by Anthropic's incident title when status.claude.com has one. Nothing is lost: the next sweep reads each of them from its last success. The end of each sweep log (`logs/sweep-*.log`, section `--- claude.ai connectors ---`) shows how the connector fetch went.

## Install (Apple Silicon Mac)

1. Download the `.dmg` from the [newest release](https://github.com/tdody/todo-hub/releases/latest).
2. Open it and drag **TodoHub** to **Applications**.
3. Apple did not sign TodoHub. Before you open it the first time, run this one time in Terminal:

   ```bash
   xattr -dr com.apple.quarantine /Applications/TodoHub.app
   ```

   Without it, macOS says that Apple "could not verify that TodoHub is free of malware", or that the app "is damaged". If you already saw that message, run the command, then open TodoHub again.

4. Set up with the command line inside the app:

   ```bash
   todohub=/Applications/TodoHub.app/Contents/MacOS/todohub-backend
   $todohub cli init              # creates ~/Library/Application Support/TodoHub
   ```

   In `config.toml` there, set `team_key` (for example `"ENG"`) under `[linear]`. Then:

   ```bash
   $todohub cli set-linear-key    # Linear personal API key (hidden input, saved in Keychain)
   $todohub cli check             # Linear, Claude Code, gh, schedule, settings
   ```

5. Open TodoHub. In **Settings → Schedule**, click **Set it up**.

You also need Claude Code (`claude`), signed in, and `gh`, signed in, for GitHub reviews and the Pull requests tab.

### Updates

TodoHub checks for a new release when it starts and every hour. When one exists, **↑ Update to v0.3.0** shows at the bottom of the sidebar. Click it to read what changed, then click **Update and restart**. **Settings → Updates** shows your version and has **Check for updates**.

After an update, macOS may ask again whether `todohub-backend` can use the Linear key in your Keychain. Choose **Always Allow**.

## Build from source

To work on TodoHub, build it from a checkout. You need Python 3.11+ with [uv](https://docs.astral.sh/uv/), Node 20+, Rust (`rustup`), the Xcode command-line tools, and `gh` (signed in) for GitHub reviews and the Pull requests tab.

### 1. Backend

```bash
cd backend
uv sync --extra dev
uv run pytest -q                 # optional: run the test suite
uv run todohub init              # creates ~/Library/Application Support/TodoHub
```

In `config.toml` there, set `team_key` (for example `"ENG"`) under `[linear]`. Then:

```bash
uv run todohub set-linear-key    # Linear personal API key (hidden input, saved in Keychain)
uv run todohub check             # Linear, Claude Code, gh, schedule, settings
```

Create the Linear key in your team's workspace, under Settings → Security & access → Personal API keys.

### 2. First sweep, by hand

```bash
uv run todohub-sweep
```

It prints one line per source. The full prompt and Claude's output are in `logs/sweep-*.log`, and in the app under the sources popover → Sweep history → Log. The first run looks back 72 hours. If a source shows "Tools denied", add the read-only tool names it lists to `config.toml`.

### 3. Schedule

```bash
uv run todohub install-schedule     # weekdays 8, 10, 12, 14, 16 by default (Mac local time); missed runs happen on wake
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
| `linear.todo_state` / `waiting_state` / `done_state` | `Todo` / `Pending` / `Done` | Statuses for approved tasks; waiting items; Mark done, ticked sub-issues and approved closes (a completed status) |
| `linear.followup_days` | `3` | Working days before a "waiting on" item is due |
| `linear.default_priority` | `4` (low) | When a candidate has none and you didn't pick one |
| `linear.missions_initiative` | `Q4 Missions` | The Linear initiative your missions live in, by name or id; the weekly check-in groups your work by its projects |
| `linear.label_types` | Bug, Feature, Improvement | Table of your team's labels → task type, e.g. `"Data quality" = "analysis"` |
| `sweep.claude_path` | `claude` | Full path if launchd can't find Claude Code |
| `sweep.model` / `max_turns` / `timeout_minutes` | `sonnet` / `60` / `20` | Per sweep |
| `sweep.restricted` | `true` | Run Claude Code in restricted mode (see Safety) |
| `sweep.slack_tools` / `gmail_tools` / `grain_tools` / `calendar_tools` / `hubspot_tools` | read-only lists | `[]` turns that source off |
| `sweep.linear_mentions` / `github_reviews` | `true` | The two sources read without Claude's connectors |
| `settings.json` (same folder) | none | Written by the Settings page: sources added, paused or removed; the schedule; the Daylight place; the periscope prompt. Wins over config.toml for those. Delete it to go back to config.toml |
| `sweep.gmail_account` | empty | Your Gmail address, used in "Open in Gmail" links |
| `sweep.extra_denied_servers` | `[]` | Your own MCP servers the sweep and Block time must never use |
| `sweep.gh_path` | `gh` | GitHub CLI |
| `sweep.snitch_url` | empty | Dead Man's Snitch URL |
| `app.periscope_url` | empty (off) | Where periscope listens, for example `http://127.0.0.1:17374`. Setting it turns on Start in periscope |
| `app.periscope_app_id` | empty | The macOS app ID that **Show** opens, for example `com.tom.periscope.app`. Empty: **Show** only selects the Claude |

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
  schedule.py         the launchd schedule: hours from Settings, install, and which run plans and wraps up
  __main__.py         single entry point: api | sweep | mcp | cli
backend/packaging/    PyInstaller build for the bundled backend
bin/release           cut a release: check, set the version, tag and push (see docs/releasing.md)
bin/release-notes     print one version's CHANGELOG.md section
app/src/              UI: main.ts (Inbox, Today, lists), insights.ts, settings.ts, desktop.ts (menu bar, notifications), update.ts (updates), dom.ts
app/src-tauri/        Rust shell: starts the backend, menu bar, ⌥⌘T, close-to-menu-bar
```
