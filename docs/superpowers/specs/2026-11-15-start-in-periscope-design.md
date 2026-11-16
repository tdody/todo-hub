# Start a Linear issue in periscope

## Goal

From an issue in Today, Client or Dev, start work on it in periscope in one step. Periscope makes a worktree for the issue's branch, starts Claude Code in it, and sends Claude a prompt to read the issue. todo-hub then selects that Claude in periscope. It brings periscope to the front when you set an app ID.

Today this takes six manual steps: copy the branch name from Linear, open periscope, open ⌘K, make the worktree, wait for Claude, then type the prompt.

## Scope

In:

- An optional integration, off until `app.periscope_url` is set.
- A **Start in periscope** item in the ⋯ menu of the Today pane and of the Client and Dev pane, and the **p** key.
- A popover that shows the repo, the branch and the prompt before the start.
- The repo that todo-hub remembers for each Linear project.
- A prompt template on the Settings page.
- **Show**, which selects the Claude and, with an app ID, brings periscope to the front.

Out:

- How periscope works inside. This spec gives only the HTTP contract that todo-hub uses (see "Periscope contract").
- A menu label that changes to "Show in periscope" when a Claude is already on the branch. todo-hub would have to ask periscope each time a pane opens. The start already finds that Claude and offers **Show**.
- The Inbox. Its cards are candidates, not Linear issues, and have no branch.
- A browser fallback for **Show**. You use the Periscope app.

## Behavior

### The control

- The control shows only when `app.periscope_url` is set. When it is off, the app has no menu item, no **p** (it does nothing), no shortcuts row and no Periscope section on the Settings page. The app reads this from `periscope` in `GET /api/meta` and `enabled` in the settings body.
- The ⋯ menu in both panes gets **Start in periscope** with its key, `p`, after **Open in Linear ↗** (Client and Dev) or first (Today).
- **p** opens the popover for the selected issue in Today, Client and Dev, as **o** opens Linear. It does nothing when a text field has the focus or the balance popover is open.
- While the popover is open, page shortcuts do nothing, wherever the focus is. Tab and Space on a focused page control still act natively. ⌘1-⌘7, ⌘, and ⌘R still work. So does ⌘Z: Edit → Undo still undoes your last change. A tab switch forgets the popover.

### The popover

It opens under the pane's ⋯ row, at its right edge. While todo-hub asks periscope for its repos, it shows "Asking periscope…". Then it shows:

> **Start ENG-9512 in periscope**
>
> Repo `[api ▾]` — "Remembered for Pipelines."
> Branch `thibaultdody/eng-9512-retry-stuck-uploads` — "From Linear. A new worktree, or the one already on this branch."
> Prompt `[Read Linear ticket ENG-9512 (https://linear.app/…) and its comments …]`
>
> `Cancel esc` `Start ↵`

- **Repo** is a select. Its options are periscope's catalog repos, by label. The first choice is, in order:
  1. the repo last used for the issue's Linear project;
  2. for an issue with no project, the repo last used for its client label;
  3. the repo last picked for any issue;
  4. nothing, so you must pick one before **Start** is enabled.
- The hint under Repo says which rule chose it: "Remembered for Pipelines.", "Remembered for Globex.", "The last repo you used." or nothing.
- **Branch** is a text field with Linear's `branchName`. If the selected repo already has a worktree on Linear's branch (`branch_worktrees`), and you did not change the branch, the hint says "A worktree is already on this branch." If you changed the branch, it says "A new worktree, or the one already on this branch."
- **Prompt** is a text area. It holds the template from Settings, filled in for this issue.
- **↵** starts, except in the Prompt box, where **↵** adds a new line and **⌘↵** starts. **Esc**, a click outside, and **Cancel** close the popover.
- **Start** is disabled until Repo, Branch and Prompt all have text.
- While periscope starts Claude, **Start** shows "Starting…" and is disabled. **Cancel** is disabled too, because it could not stop the start. Esc or a click outside hides the popover, and the result still comes as a toast.

### After Start

- Periscope started a Claude: the popover closes, and a toast says "Started ENG-9512 in periscope" with **Show**. The toast stays 9 s, like an Undo toast.
- A Claude was already on the branch: periscope starts nothing and sends no prompt. The popover closes, and a toast says "ENG-9512 is already open in periscope" with **Show**.
- In both cases, todo-hub remembers the repo for the issue's Linear project (or client label) and as the last repo picked.
- **Show** asks periscope to select that Claude, then, when `app.periscope_app_id` is set, runs `open -b <app id>`. Periscope comes to the front, and its rail selects the Claude on its next state update (about 1 s).

### Errors

Each one is an error toast. The popover opens with "Asking periscope…". An error while it asks closes it. An error at **Start** leaves it open. An error at **Show** comes after the popover closed.

| Cause | Message |
|---|---|
| `app.periscope_url` is not set | 404 "Start in periscope is off. Set app.periscope_url in config.toml." The app hides the control, so you see this only from a stale page. |
| Periscope does not answer at `periscope_url` | "Periscope is not running at 127.0.0.1:17374." At the first ask, the popover closes. At **Start**, it stays open. |
| Periscope answers 409 (a start for this branch is running, or a Claude started less than 60 s ago has not attached yet) | "Periscope is already starting ENG-9512." |
| Periscope answers 400 or 502 | Periscope's own message, for example "spawn failed: …". |
| Periscope does not answer in time (15 s; 120 s for a start) | "Periscope didn't answer in 15 s." For a start: "Periscope didn't answer in 120 s. It may still start Claude." |
| The branch is blank | "The branch is empty" (400). The popover's **Start** is already disabled then. |
| `open -b <app id>` fails | "Could not bring Periscope to the front." |

## Periscope contract

todo-hub calls three periscope routes. Periscope has no auth and listens on 127.0.0.1.

- `GET /api/open/catalog` (exists) → `{repos: [{repo, label, default_branch, branches}], worktrees: [{path, repo, branch, is_main}], roots}`.
- `POST /api/linear/start` (new) with `{repo, branch, ticket, title, prompt}` → `{mode: "spawned", pid, path, reused}` or `{mode: "existing", pid}`. `repo` is a path from the catalog. `pid` is always given. Errors: 400, 409 and 502, each with `detail`.
- `POST /api/select` (new) with `{pid}` → `{ok: true}`. The periscope UI selects that pane on its next state update.

## Changes

**`backend/src/todohub/linear.py`**

- Add `branchName` to `ISSUE_FIELDS`. The popover route reads it from `Linear.get_issue`. The frontend `Issue` type does not change.

**`backend/src/todohub/config.py`**

- `Settings.periscope_url: str = ""`, set in `config.toml` under `[app]`. Empty means the integration is off. `Settings.periscope_on` answers that question.
- `Settings.periscope_app_id: str = ""`, set in `config.toml` under `[app]`. Empty means **Show** does not bring the app to the front.
- `Settings.periscope_prompt: str`, with the default below. The Settings page writes it to `settings.json` as `{"periscope": {"prompt": …}}`, like `daylight`, and `apply_overrides` lays it over the default. An empty text means the default.

  > Read Linear ticket {identifier} ({url}) and its comments with the Linear tools. Sum up the ask, then propose a plan. Do not change code until I agree.

**New `backend/src/todohub/periscope.py`**

- `Periscope(url, transport=None)`, shaped like `Linear`: `catalog()`, `start(...)` and `select(pid)`. `catalog()` and `select()` wait 15 s. `start()` waits 120 s. The worst case is about 130 s: fetch 30 s, worktree add 30 s, reset 60 s, then about 10 s for Claude's screen. Periscope keeps going after todo-hub stops waiting. A quick call times out with "Periscope didn't answer in 15 s." A start times out with "Periscope didn't answer in 120 s. It may still start Claude."
- `fill_prompt(template, issue) -> str`: replaces only `{identifier}`, `{title}` and `{url}`. Other braces stay as typed.
- `PeriscopeError(message, status)`: a connection error becomes the "not running" message. A 4xx or 5xx carries periscope's `detail`.
- The remembered repos are in the `meta` table: `periscope_repos` holds `{"project:<name>": <repo path>, "client:<label>": <repo path>}`, and `periscope_last_repo` holds a repo path. `default_repo(db, issue, repos)` applies the order above and returns the repo and the hint. A remembered repo that is not in the catalog any more is skipped.

**`backend/src/todohub/api.py`**

- `GET /api/issues/{issue_id}/periscope` → `{repos: [{repo, label}], repo, hint, branch, branch_worktrees, prompt}`. It reads the issue with `Linear.get_issue` and the catalog from periscope.
- `POST /api/issues/{issue_id}/periscope` with `{repo, branch, prompt}` → periscope's answer. It strips the branch and answers 400 when it is blank. It reads the issue for the ticket and title, calls `start`, then remembers the repo.
- `POST /api/periscope/show` with `{pid}` → calls `select`, then runs `open -b <app id>` when `periscope_app_id` is set, in one `periscope_call`, so a failure of either becomes one error toast.
- All three routes answer 404 "Start in periscope is off. Set app.periscope_url in config.toml." when `periscope_on` is false. One dependency checks this before any Linear or periscope call.
- `GET /api/meta` gives `periscope` (`periscope_on`). The settings body gives `periscope.enabled`.
- A `PeriscopeError` becomes an HTTP error with its message. Periscope's 409 becomes a 409 with "Periscope is already starting ENG-…"; the others become 502.

**`app/src/api.ts`**: the three calls.

**New `app/src/periscope.ts`**: the menu item, the popover, Start and Show, set up from `main.ts` like `pane.ts`. **`app/src/main.ts`**: the menu item in `issuePane` and `stageBody` (only when `state.meta.periscope`), the setup, outside click, Esc and the shortcuts sheet (the **p** row only when on). The keydown handler holds the page shortcuts while the popover is open. A tab switch forgets the popover. **p** does nothing while the balance popover is open. **`app/src/pane.ts`**: `p` in `PANE_KEYS`, and `data-tick` becomes `data-focus`, so a control keeps its focus across a re-render.

**`app/src/settings.ts`**: a **Periscope** section (only when `periscope.enabled`) with the Prompt text area, its placeholders listed in the hint, and **Reset to default**.

**`app/src/styles.css`**: the popover, with the Popover shadow and 12px corners (DESIGN.md, "Menus and popovers" and "Elevation & Depth"). It is no wider than the issue's fields row, so the pane never clips it.

**`README.md`**: a **Start in periscope** group before "Safety model", the Periscope section of the Settings page, and `app.periscope_url` and `app.periscope_app_id` in the `config.toml` table.

## Tests

`backend/tests/test_periscope.py`, with `httpx.MockTransport` for periscope:

- `fill_prompt` fills the three tokens and keeps other braces.
- `default_repo`: project match, client match for an issue with no project, last repo, nothing; a remembered repo that left the catalog is skipped.
- The GET route returns the catalog repos, the default repo and hint, Linear's branch, `branch_worktrees` and the filled prompt.
- The POST route sends ticket and title, returns periscope's answer, and remembers the repo for both `spawned` and `existing`.
- Errors: connection refused → "not running"; the route answers 409 with "Periscope is already starting ENG-…"; 502 carries periscope's `detail`. No repo is remembered after an error.
- `show` calls `/api/select` with the pid. With an app ID, it runs `open -b <id>` (patched). Without one, it only selects.
- The default is off. The three routes answer 404 and make no periscope call when it is off. `/api/meta` says `periscope` false or true.

`backend/tests/test_settings.py`: `periscope_url` and `periscope_app_id` default to empty, and `config.toml` sets them. `periscope_prompt` from `settings.json` overrides the default; an empty text gives the default.

The app has no frontend test runner. Check the UI in the running app: both panes, the key, the popover keys, the two toasts, **Show**, and the error toast with periscope stopped.

## Assumptions

- You turn the feature on by setting `app.periscope_url`. A page that is open when you change config.toml keeps its old state until you reload.
- Periscope runs a version with `POST /api/linear/start` and `POST /api/select`. With an older one, **Start** and **Show** show "Not Found".
- While the TodoHub window is hidden, WebKit can suspend the page. A start's toast can then appear only when the window comes back. A 100 s fetch succeeds in a visible WKWebView. In a hidden one it does not settle.
- Linear's `branchName` is never empty. Linear's schema types it `String!`.
- Periscope's catalog lists every repo that you start issues in. It scans `~/dev` one level deep and adds every project periscope has registered.
- When you set `app.periscope_app_id`, `open -b <app id>` finds the app. LaunchServices must know the app.
- The spawned Claude has a Linear MCP server for the issue's workspace. The prompt says "the Linear tools" and does not name a server.
- A Linear project name is a stable key for the remembered repo. A renamed project starts with no remembered repo, and falls back to the last repo picked.
