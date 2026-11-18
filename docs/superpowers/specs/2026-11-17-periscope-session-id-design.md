# Record the Claude session on the Linear issue

## Goal

When **Start in periscope** starts a new Claude, the Linear issue gets a comment with the Claude session ID. The comment documents which Claude worked on the issue, and the ID lets you open that conversation again later (`claude --resume <id>`, or periscope's `resume_session`).

Today periscope does not send the session ID back, so nothing records it.

## Scope

In:

- periscope: each spawned Claude starts with a session ID that periscope chose. `POST /api/linear/start` sends back that ID and the email of the Claude account.
- todo-hub: the start route adds a comment to the issue with the start time, the Claude account email and the session ID.

Out:

- A comment when a Claude is already on the branch (mode "existing").
- A path in the comment: not the worktree, not the transcript file. Periscope finds both from the session ID, and a path is correct only on one Mac.
- A button in todo-hub that resumes the session.

## The comment

```
- Started: 2026-11-17T14:32:05-05:00
- Claude account: you@example.com
- Claude session: `3f2a9c1e-5b7d-4e2a-9f10-2c4d6e8a0b1c`
```

- **Started:** todo-hub's time when periscope answers, in `TZ` (America/New_York), from `datetime.now(TZ).replace(microsecond=0).isoformat()`. The plans and wrap-ups use the same format.
- **Claude account:** the `email` that periscope sends. When it sends `null`, the line says `unknown`.
- **Claude session:** the `session_id` that periscope sends, in backticks.

todo-hub adds the comment only when periscope answers mode "spawned" with a `session_id`. It adds no comment:

- for mode "existing": periscope started nothing;
- when the answer has no `session_id`: an older periscope.

## periscope (one PR to the periscope repo)

1. `config.build_agent_command` gets a `session_id` argument. For `claude`, it adds `--session-id <id>`, the same way that `resume_id` adds `--resume <id>`. Codex ignores it, as it ignores `effort`.
2. `channels.spawn_claude_with_prompt` makes a new `uuid4` for each spawn and passes it to `build_agent_command`. All 3 callers get this: the `spawn_claude` MCP tool, `/api/reviews/prepare` and `/api/linear/start`. A Claude started without the flag gets a random ID anyway, so no caller changes behavior.
3. `channels.Spawned` gets `session_id` and `account` (the account ID from `usage.choose_launch`).
4. New `store.account_email(account_id) -> str | None` reads `oauthAccount.emailAddress` from the account's `.claude.json`: `~/.claude.json` for the default account (`config_dir` is `""`), else `<config_dir>/.claude.json`. It returns `None` when the file is missing or not valid JSON, or when it has no email. An account that is not logged in has no email.
5. `/api/linear/start` answers mode "spawned" with `{mode, pid, path, reused, session_id, email}`. Mode "existing" stays `{mode, pid}`.
6. The `/api/linear/start` section of periscope's README names the 2 new fields.

Tests:

- `build_agent_command("claude", …, session_id=…)` has `--session-id <id>`. Without `session_id`, the argv does not change.
- `spawn_claude_with_prompt` returns `session_id` and `account`, and the `claude` command line it sends has `--session-id` with that ID.
- `account_email`: the default account, an account with a `config_dir`, a file with no `oauthAccount`, and a missing file.
- `/api/linear/start` mode "spawned" answers with `session_id` and `email`.

## todo-hub

1. `api.periscope_start`: after `remember_repo`, when the answer is mode "spawned" and has a `session_id`, add the comment with `Linear.create_comment(issue["id"], …)`.
2. If the comment fails (`LinearError`), the start still succeeds, because Claude is already running. The answer gets `warnings: ["The Claude session was not added to ENG-123: <error>"]`. The answer always has `warnings`, as approve and merge do.
3. The `Periscope.start` docstring names `session_id` and `email`.
4. `app/src/api.ts`: `PeriscopeStart` gets `warnings: string[]`. `app/src/periscope.ts` shows each warning as an error toast after the start toast, as `main.ts` does for approve.
5. README, "Start in periscope": when periscope starts a new Claude, todo-hub adds a comment with the start time, the Claude account email and the session ID. With a Claude already on the branch, or an older periscope, it adds none.

Tests, in `backend/tests/test_periscope.py`:

- A "spawned" answer with `session_id` and `email` adds one comment with the expected text, and the answer has `warnings: []`.
- A "spawned" answer with `email: null` writes `Claude account: unknown`.
- A "spawned" answer with no `session_id` adds no comment.
- An "existing" answer adds no comment.
- A comment that fails returns 200 with one warning.
- Test data uses `example.com` emails only. The repo is public.

## Order

The 2 PRs can merge in any order. todo-hub with an older periscope adds no comment. A newer periscope with an older todo-hub sends 2 fields that todo-hub ignores.

## Assumptions

- Claude Code accepts `--session-id <uuid>` in interactive mode. `claude --help` lists it.
- The default account keeps its email in `~/.claude.json` under `oauthAccount.emailAddress`. An account with a `config_dir` keeps it in `<config_dir>/.claude.json`. Checked on one Mac with 2 accounts: the logged-in default account has the email. The second account is not logged in and has none.
- A new `uuid4` never matches an existing session, so `--session-id` never collides.
- The Linear comment is written with your Linear key, so it shows you as the author.
