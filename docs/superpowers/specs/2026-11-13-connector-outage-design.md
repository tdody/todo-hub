# A clearer error when Anthropic's connector service is down

## Goal

When a sweep can't load the claude.ai connectors because Anthropic's connector service is failing, each affected source says so, with the HTTP status and, when Anthropic has posted one, the incident's title. Today the source shows Claude's own sentence ("Slack tools not available in this sweep session"), which reads like a setup problem.

## What happened (2026-11-13)

Every sweep from 08:00 to 08:38 reported Slack, Gmail, Grain, Calendar and HubSpot as failed, with Claude saying their tools weren't available. GitHub and Linear, which don't use claude.ai, worked. Each run finished `ok` with no denied tools.

- Claude Code fetches the connector list from `https://api.anthropic.com/v1/mcp_servers` when a run starts. Its debug log showed `[claudeai-mcp] Transient fetch error (503), retrying …` on every attempt.
- An unauthenticated request to that URL also got 503, where a healthy service answers 401. A run without `--restricted` failed the same way, so the sweep's flags weren't the cause.
- status.claude.com had an open incident, "Elevated errors on claude.ai, the Claude API, and Claude Code", listing the Claude Code component.
- `claude --debug=claudeai-mcp --debug-file <path>` writes only the connector-fetch lines: `Fetching from …`, then `Fetched 14 servers` when it works.

## Scope

In: sweeps (scheduled, manual, and one-source checks), for the five connector sources (`connectors.BUILTIN`: Slack, Gmail, Grain, Calendar, HubSpot).

Out: plan, note, wrap-up and capture runs (they have no per-source status); grouping the Mac notifications when several sources fail at once; retrying the sweep when the service comes back (the next sweep already re-reads each failed source from its last success).

## Behavior

After a sweep, if Claude Code's connector fetch ended in failure, every connector source that reported a failure in that run (or didn't report at all) shows:

> Anthropic's connector service didn't respond (HTTP 503), so it wasn't read. Anthropic reports "Elevated errors on claude.ai, the Claude API, and Claude Code" (status.claude.com).

- The second sentence appears only when status.claude.com has an open incident listing the Claude Code component.
- The message doesn't name the source or say when it catches up: the sidebar row, the Inbox's problems banner and the Mac notification already put the source's name before it, and the sidebar's tooltip already says when it last worked and that the next check catches up from there.
- Sources that worked, Calendar's "Meeting prep already done today", GitHub and Linear are never changed.
- When the fetch worked, or the debug lines can't be read, nothing changes: Claude's own message stays.

## Changes

**New `backend/src/todohub/outage.py`** (pure functions plus one HTTP call):

- `fetch_failure(lines: list[str]) -> str | None`: reads the `[claudeai-mcp]` lines in order. A line with `Fetched ` marks success; a line matching `fetch failed` or `fetch error` (any case) marks failure. The last such line decides. The status is the latest value in parentheses right after those words (`Transient fetch error (503)`, `Fetch failed (503) after 3 attempt(s)`) since the last success, since Claude Code's final line (`Connector-list fetch failed transiently; background retry …`) carries none. Returns `"HTTP 503"` for a three-digit value, the value itself for anything else (`"ECONNRESET"`), `""` for a failure with no value, and `None` for success or when no line matches.
- `open_incident(get=httpx.get) -> str | None`: `GET https://status.claude.com/api/v2/summary.json` with a 5-second timeout; the name of the first incident in `incidents` (Statuspage lists only unresolved ones there) whose `components` include one named `Claude Code`. Any HTTP or parsing error logs a warning and returns `None`.
- `message(failure: str, incident: str | None) -> str`: the text above; without a status, "didn't respond, so it wasn't read."

**`backend/src/todohub/sweep.py`:**

- `_invoke_claude` adds `--debug=claudeai-mcp --debug-file <sweep_dir>/claudeai-<run_id>.log` to the command. After the run it reads that file (missing means no lines), appends its lines to the run's log under `--- claude.ai connectors ---`, deletes it, and returns `fetch_failure(lines)` as `out["connector_failure"]`. The flags go here rather than in `claude_command`, which `connectors.py` also uses for discovery runs it stops at start-up.
- `run_sweep`, after marking unreported sources: when `out["connector_failure"]` is not `None`, it calls `open_incident()` once and rewrites the detail of each connector source with `ok = 0` in this run, keeping its `items_scanned`.

**`README.md`:** next to the `--restricted` note, one line saying what an outage looks like and that the next sweep catches up.

## Errors

- No debug file (the run timed out, or Claude Code didn't write one): no lines, no change.
- status.claude.com unreachable, slow or malformed: the message has no second sentence.
- An unknown `--debug-file` flag would make Claude Code exit with an error, failing the sweep. The installed Claude Code (2.1.319) accepts it.

## Testing

- `fetch_failure`, with this morning's real lines: the failed attempts ending on `Connector-list fetch failed transiently; background retry …` → `"HTTP 503"`; a failure then `Fetched 14 servers` → `None`; `Fetching from …` then `Fetched 14 servers` → `None`; unknown wording → `None`; `Fetch failed (ECONNRESET) after 3 attempt(s)` → `"ECONNRESET"`.
- `open_incident`, with a fake `get`: this morning's two incidents (the Claude Code outage and the Microsoft 365 connector one, which lists only claude.ai and Cowork) → the outage's name; no incidents → `None`; an HTTP error → `None`.
- `run_sweep`, with the fake `claude` writing failure lines to the `--debug-file` it's given and reporting Slack failed and Linear fine, and `open_incident` patched: Slack's and the unreported Grain's details are rewritten; Linear, GitHub and Calendar's prep line are not; the log holds the `--- claude.ai connectors ---` section; the debug file is gone.
- The existing sweep tests, whose fake `claude` writes no debug lines, keep Claude's messages.

## Assumptions

- **Claude Code's debug wording** (`[claudeai-mcp]`, `Fetched `, `Fetch failed (…)`, `Transient fetch error (…)`) is internal and may change. If it does, detection stops and Claude's own message returns; it can't produce a wrong outage message unless a failure line keeps its wording while the success line changes.
- **A failed connector source in a run whose fetch failed** is blamed on the fetch, even if it also had its own problem. Both mean it wasn't read.
- **The Claude Code component** is how Anthropic tags incidents that affect Claude Code's connector fetch. An incident tagged only claude.ai (like the Microsoft 365 connector one) isn't shown.
- **status.claude.com's summary.json** keeps its Statuspage shape (`incidents[].name`, `incidents[].components[].name`).
