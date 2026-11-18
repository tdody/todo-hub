# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: Thibault.** Splits the week between client work (client-labeled issues in Linear) and dev work, against a 50% client target. Leads missions and reports on them each week to a non-technical reader (the COO) through a mission check-in. Works across Slack, Gmail, Grain, Google Calendar, HubSpot, Linear and GitHub all day, between meetings.
- **Later: teammates.** TodoHub is personal today, but teammates may install it. Their ticket app, connectors, team key, labels and missions may differ from Thibault's.

## Product Purpose

TodoHub collects the to-dos scattered across a working day into one review queue and one daily plan, so nothing gets lost and the weekly reporting writes itself.

Success means:

- **Nothing slips.** No ask, commitment, follow-up, review request or meeting prep from any source goes unnoticed, and work that is late, pushed again and again, or waiting on someone shows up before it hurts.
- **Reporting writes itself.** The weekly check-in, the weekly digest and client summaries are drafted from work already recorded. Thibault edits them instead of starting from a blank page.
- **Providers can change.** Connectors and the ticket app are not fixed to today's set. Other ticket apps and sources should be able to take Linear's or a connector's place.

## Positioning

A read-only Claude sweep reads every channel on a schedule and turns asks and commitments into candidates, each linked to its source and checked against open issues for duplicates. The user approves, edits, snoozes or drops each one. Approved work goes into the ticket app the team already uses. TodoHub is a review queue and a lens on that ticket app, not another place for tasks to live.

## Operating Context

- **macOS desktop app** (Tauri shell, web UI). It lives in the menu bar, opens at login, and captures from any app with ⌥⌘T. The window defaults to 1120×800 with a 760×520 minimum. You can drag the sidebar wider or narrower, or hide it to icons; in a narrow window it is always icons. On a narrow page the reading pane moves under the list.
- **Rhythm of the day:** sweeps on weekdays every 2 hours (set on the Settings page), plus Run now and per-source checks. The first morning sweep writes the day's plan and the first sweep from 3pm writes the wrap-up. Mac notifications arrive at 8am and 5pm, and after a sweep adds tasks. Linear is re-read every minute and when the window comes back to the front.
- **Rituals it feeds:** the weekly mission check-in (pasted into the /mission-checkin skill), a Slack update copied from the weekly digest, weekly client summaries, follow-up nudges and reply drafts copied for pasting.
- **Model runs cost time and money:** a re-plan or wrap-up redo takes about a minute and a few cents, and the UI says so. Insights tracks sweep cost.

## Capabilities and Constraints

- **Areas:** Inbox (review queue), Today (Brief and Checklist views; morning plan and wrap-up), Client, Dev, Insights (Overview and Weekly digest), Settings (Appearance, Sources, Schedule).
- **Sources today:** Slack, Gmail, Grain, Google Calendar and HubSpot via Claude connectors; Linear mentions and GitHub review requests read directly. **Ticket app today:** Linear only.
- **Terminology** (use these words, don't coin synonyms): sweep, candidate, capture, Inbox, Today, Client, Dev, Insights, sources, linked issue (Same as / Adds to / Related to; Merge, Create new, Drop), Looks handled, mute, snooze, Block time, morning plan, wrap-up, weekly check-in, weekly digest, balance pill, pushed N×, waiting on.
- **Safety constraints:** sweeps run Claude Code restricted, read-only, with write tools denied by name. Source content is untrusted data. The UI never inserts HTML built from data; only web and email links are clickable; images hosted outside Linear stay links. The local API listens on loopback only and needs a per-launch token.
- **Undo:** approvals, drops, snoozes, edits, merges and deletes can be undone (⌘Z, up to 10 minutes). Block time is the one write that isn't.
- **Undecided:** which other ticket apps and connectors to support, and how a teammate would set TodoHub up.

## Brand Commitments

- **Name:** TodoHub. **Logo:** `app/public/logo.svg` (a sun rising over a horizon above a ticked box); app icon `app/app-icon.png`.
- **Voice:** plain, short sentences. Says what happened and what didn't ("Saved as a Gmail draft. Nothing was sent."), tells you what to do next ("Paste it where you talk to them."), and gives the time and cost of a model run up front. No jargon or hype.

## Evidence on Hand

- Real client names, domains, logos, issues and messages exist only in `~/Library/Application Support/TodoHub/`. They never go in the repo, screenshots, fixtures or docs.
- The repo has no demo dataset, screenshots or marketing material. Examples use fictional names (Globex, Hooli, `ENG-123`, `example.slack.com`, `me@example.com`).

## Product Principles

1. **Claude proposes; the user decides.** Nothing reaches the ticket app, Slack, email or the calendar without a click. Claude drafts and suggests; messages are copied or saved as drafts, never sent.
2. **The ticket app is the record.** TodoHub keeps no competing task list. Linear is the ticket app today, and new work shouldn't make swapping it, or a connector, harder.
3. **Keyboard-first and quiet.** Every action has a key. Unset fields take no room, there are no refresh buttons, and nothing is on screen just for decoration. Attention goes to what's late, waiting or failing.
4. **Reporting from recorded work.** Check-ins, digests and summaries are drafted from what Linear and the sweeps already know, ready to edit and paste.
5. **Client data stays local.** Client and company specifics live in the settings folder, never in code defaults, the repo or anywhere beyond the connectors the user already uses. Personal specifics belong in settings, so teammates can use TodoHub later.

## Accessibility & Inclusion

- Honors macOS Reduce motion (the sunrise and plan animations are skipped).
- Status and priority colors keep their meaning in every theme, including each Daylight phase.
- Full keyboard navigation, with a shortcuts sheet on **?**.
- No formal standard (such as a WCAG level) has been set.
