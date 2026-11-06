# HubSpot as a sweep source

Linear: [ENG-9425](https://linear.app/example/issue/ENG-9425)

## Goal

Tickets assigned to Thibault and notes teammates write that mention him reach the Inbox like any other source. When a ticket behind an approved issue closes, TodoHub proposes closing the issue. Nothing is ever written to HubSpot.

## What HubSpot holds today (checked read-only, 2026-11-04)

| Object | Owned by / mentioning Thibault | Notes |
| --- | --- | --- |
| Tickets | 43 owned, 0 open | Newest Aug 26. About one a month. `hubspot_owner_assigneddate` and `closed_date` are set; `hs_is_closed` is empty. |
| Tasks | 97 owned | 96 created by the Grain integration (`hs_object_source_detail_1` = "Grain"), the last on Jan 20, 2026. The one other task is from Jan 2024 and completed. |
| Notes mentioning "Thibault" since Aug 1 | 121 | 111 are Grain meeting notes copied in ("Added by Grain"); none of them has an owner. The 10 written by teammates all have one; a few are real asks. |
| Emails logged under him since Aug 1 | 17 | Copies of his own Gmail threads. |
| Meetings logged under him since Aug 1 | 1 | |
| Deals owned | 0 | |

His HubSpot user can read companies, deals, tickets, tasks, notes, emails and meetings, and can't write any of them.

## Scope

In:

1. **Tickets** assigned to him in the window that aren't in a closed stage.
2. **Notes** created in the window that mention him and have an owner (Grain's copies have none).
3. **Ticket follow-up:** propose closing an issue when its ticket is in a closed stage.

Out:

- Any write to HubSpot.
- HubSpot tasks: they are Grain action items, which the Grain source already reads.
- Logged emails and meetings (copies of Gmail and Grain).
- Deals and company context (meeting prep, weekly summary, logos).
- Draft replies for HubSpot cards.
- Pasting a HubSpot link in the capture box.

## Behavior

HubSpot is a sweep source named `hubspot`, shown as "HubSpot". It is on when `sweep.hubspot_tools` is non-empty (the default) and off with `hubspot_tools = []`, like `slack_tools`. Its window works like every other source's: from the start of the last sweep where it reported success, minus the 2-hour overlap. A source that has never reported starts from the last successful sweep. One that has reported but never succeeded falls back to `first_run_lookback_hours` (72), so a failed first HubSpot sweep is followed by a 72-hour lookback.

Each sweep:

1. Gets his owner id with `get_user_details`.
2. **Tickets:** `search_crm_objects` on `TICKET` with `hubspot_owner_id = <owner id>` and `hubspot_owner_assigneddate >= <window start>`, requesting `subject`, `content`, `hs_pipeline_stage`. Only if this returns tickets, or a HubSpot ticket is listed for follow-up, it gets the ticket pipelines with `discover_hubspot_schema` (`GET_PIPELINES`, `TICKET`); a stage whose `state` is `CLOSED` is closed. It skips tickets in a closed stage. Each remaining ticket is an `add_candidate` with:
   - `signal` "ask", `source_id` `ticket:<id>`, `source_url` from the result's `urlTemplate`;
   - title from the subject, written as the usual short imperative;
   - `excerpt` from the start of `content`;
   - `client_label` from the client named in the subject or content, when it matches a label.
3. **Notes:** `search_crm_objects` on `NOTE` with `hs_note_body CONTAINS_TOKEN "Thibault"`, `hubspot_owner_id HAS_PROPERTY` and `hs_createdate >= <window start>`, requesting `hs_body_preview` and `hubspot_owner_id` (never `hs_note_body`: 8 full notes came to 127K characters). The author's name comes from `search_owners` and goes in `sender`. Each note is judged like a Linear mention:
   - an ask of Thibault: `add_candidate` with `signal` "mention", `source_id` `note:<id>`;
   - new information on one of his open issues: `propose_update`;
   - an FYI or status note: `mark_seen`.
4. Calls `is_seen` before each item and `report_source_status` once for `hubspot`, as for the other sources.
5. **Follow-up:** for each open issue TodoHub created from a `ticket:` source, fetch the ticket's stage with `get_crm_objects`. If it's closed, `propose_close` with `source_id` `ticket:<id>#closed` and why "Ticket closed in HubSpot on <closed_date>". Nothing else is read for these issues.

Like Slack and Gmail threads, HubSpot tickets are re-checked only by sweeps that read HubSpot: a full sweep with HubSpot on, or a HubSpot "Check now". A ticket merged into an existing issue isn't re-checked, since closing the ticket doesn't finish that issue.

## Changes

No new module. HubSpot follows the Slack, Gmail and Grain pattern.

`config.py`
- `DEFAULT_HUBSPOT_TOOLS`: `mcp__claude_ai_HubSpot__get_user_details`, `mcp__claude_ai_HubSpot__search_crm_objects`, `mcp__claude_ai_HubSpot__get_crm_objects`, `mcp__claude_ai_HubSpot__discover_hubspot_schema`, `mcp__claude_ai_HubSpot__search_owners`.
- `Settings.hubspot_tools`, read in `load_settings()`; `enabled_sources()` includes `"hubspot"`.
- `Settings.only()` (one-source "Check now") keeps `hubspot_tools` for a HubSpot check and clears it for any other.
- The `DEFAULT_CONFIG` comment on read-only tool lists names `hubspot_tools`.

`sweep.py`
- `source_sections()`: a `### HubSpot` section with steps 1–4 above and the window start.
- `allowed_tools()`: adds `settings.hubspot_tools`.
- `DISALLOWED_TOOLS`: HubSpot's tools that write or act, by name: `manage_crm_objects`, `manage_blog_post`, `manage_campaign_objects`, `manage_landing_page`, `manage_website_page`, `manage_segment`, `manage_saved_reports`, `manage_aeo_prompts`, `manage_aeo_recommendations`, `manage_onboarding`, `import-claude-design-from-url`, `show_feedback_form`.
- `"mcp__claude_ai_HubSpot"` stays in `DENIED_SERVERS`, so Block time and Save as Gmail draft keep denying the whole server. `claude_command()`, used by sweeps and captures, leaves it out of `--disallowedTools` when `hubspot_tools` is non-empty (a deny on the server would override the allowed read tools).
- `watched_section()`: besides Slack and Gmail threads, re-checks issues whose `source` is `hubspot` and `source_id` starts with `ticket:`, unless the ticket was merged into an existing issue (`linear_identifier == possible_duplicate`; `db.watched_issues()` selects `possible_duplicate`).
- `todohub-sweep --source` accepts `hubspot`, which the app's "Check now" runs.

`sweep_prompt.md`
- Safety paragraph: names HubSpot tickets and notes as data.
- Follow-ups: one rule for HubSpot tickets (step 5).

`db.py`, `tools.py`, `mcp_server.py`
- `"hubspot"` in `SOURCES`, and in the `source` choices of `is_seen`, `mark_seen`, `add_candidate`, `propose_close`, `propose_update` and `report_source_status`.
- `MISSING_URL_HELP["hubspot"]`: "Use the record link built from the search result's urlTemplate."
- No new signals.

`api.py`, `mutes.py`, `digest.py`
- `SOURCE_NAMES["hubspot"] = "HubSpot"` (the issue description's source line and the Linear link title).
- `"hubspot"` in `MuteIn.source`. Muting a note's author works through `sender`, since `mutes.keys()` is the same for every source.
- `mutes.prompt_section()`: names HubSpot, so a muted author shows as "sender Ana Tapsieva (HubSpot)".
- `digest.SOURCE_NAME`: the weekly digest names HubSpot.

App
- `api.ts`: `"hubspot"` in `Source`.
- `main.ts` and `insights.ts`: `hubspot: "HubSpot"` in the source name maps.
- `styles.css`: a `--hubspot` colour in each theme and `.chip.src-hubspot`.

`cli.py`
- `CONNECTORS["hubspot"] = "claude.ai HubSpot"`; `hubspot_tools` joins the read-only set `check` compares allow rules against.

README
- Signals: HubSpot tickets and notes.
- Follow-up: issues from a ticket are proposed for closing when it closes.
- Safety model: HubSpot is read-only; its write tools are denied by name; Block time and Gmail drafts deny the whole server.
- Settings table: `sweep.hubspot_tools`.
- How the sweep decides: HubSpot's window uses assignment and creation dates; only notes with an owner are read; tasks aren't read.

## Errors

- **Sign-in expired or connector unavailable:** the sweep reports `hubspot` with `ok=false` and the error; the header dot turns red, and the next sweep where it works re-reads the missed window. If Claude never reports HubSpot, the existing "Not reported by the sweep." fallback records it.
- **Missing record link:** `add_candidate` rejects the call with the HubSpot help text, and the sweep retries with the link.
- **Large results:** each search requests only the fields above, with `limit` 50.
- **Turn limit:** HubSpot adds at least three calls per sweep (owner id, two searches), plus one per note author and per ticket re-checked. Today's sweeps reported 42–79 turns with `max_turns = 60` and still ended ok, so the reported count isn't the limit's unit and the headroom is unknown. The first day of sweeps is checked for `error_max_turns` before deciding anything about the limit.

## Testing

pytest, with no live HubSpot calls, like the existing suite.

- `test_sweep.py`
  - The HubSpot section, with its window start, is in the prompt when `hubspot_tools` is set, and absent when it's `[]`.
  - `claude_command()` puts the HubSpot read tools in `--allowedTools`, and leaves `mcp__claude_ai_HubSpot` out of `--disallowedTools` only when HubSpot is on.
  - HubSpot write tools are always in `--disallowedTools`.
  - The Block time and Gmail draft commands deny `mcp__claude_ai_HubSpot` with HubSpot on.
  - `watched_section()` lists a `ticket:` issue, not a `note:` one, and nothing from a source that's off.
- `test_tools.py`, `test_mcp_server.py`: `add_candidate` accepts `source` "hubspot"; a missing link returns the HubSpot help text; `propose_close` accepts a HubSpot source.
- `test_api.py`: an approved HubSpot candidate's issue description says "HubSpot"; a HubSpot candidate can be muted by sender, and the sweep prompt names the muted author with "(HubSpot)". The existing assertion on `/api/meta`'s source list includes `"hubspot"`.
- `test_cli.py`: `hubspot_tools` is on by default and `[]` turns it off; `check` treats `hubspot_tools` as read-only.

Manual: run `uv run todohub-sweep`, read the log for the HubSpot calls and their output size, and compare cost per sweep in Insights. With no open tickets and a short first window, the first run will most likely report 0 items; the first real card comes with the next ticket or note. Over the first day, check the runs for `error_max_turns`.

## Assumptions

1. Notes Grain copies in have no owner, and notes teammates write have one. Checked since Aug 1: 0 of the Grain copies that mention Thibault have an owner; all 10 hand-written ones do.
2. Notes that matter contain the token "Thibault". "@Thibault Dody" mentions do.
3. A note's `hubspot_owner_id` is its author. The 10 hand-written notes resolved to teammates through `search_owners`.
4. The claude.ai HubSpot connector works under `--restricted`, like Slack and Gmail. Unverified until the first run.
5. An ask that appears both in a HubSpot note and a Slack thread has two source ids, so `is_seen` won't catch the repeat; only the sweep's duplicate check against the queue and open issues will, and that isn't guaranteed.
6. With `restricted = false` and a broad HubSpot allow rule in `~/.claude/settings.json`, a write tool HubSpot adds later (not in the deny list) would be usable, since the server-wide deny is lifted for the sweep. The default `restricted = true` isn't affected, and `todohub check` flags broad rules.
