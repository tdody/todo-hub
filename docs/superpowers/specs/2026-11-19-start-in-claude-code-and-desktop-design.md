# Start a Linear issue in Claude Code or Claude Desktop

## Goal

Start in periscope is the only way to start Claude on an issue, and it needs periscope. Add two more ways, next to it in the ⋯ menu:

- **Start in Claude Code** makes a worktree on Linear's branch and starts Claude Code in it, in a terminal, with a prompt.
- **Start in Claude Desktop** opens a new chat in the Claude Desktop app, with a prompt in the message box.

People without periscope can then start Claude on an issue. People who write no code can start a chat, because a chat needs no repo.

## Scope

In:

- **Start in Claude Code**: a popover like periscope's (repo, branch, prompt), a worktree next to the repo, a `.command` script that the Mac's default app for `.command` files runs, the Haiku name and the session comment.
- **Start in Claude Desktop**: a link that opens a new chat with the prompt. No popover.
- One popover module for periscope and Claude Code, and one repo memory for both.
- A **Start Claude** section on the Settings page: the repo list, the code prompt and the chat prompt.

Out:

- **Keyboard shortcuts for the new items.** They are in the ⋯ menu only. **p** stays Start in periscope.
- **A browser fallback** (claude.ai) when Claude Desktop is not installed. The item does not show then. The setup walkthrough of the team release checks that Claude Desktop is installed.
- **The Code tab of Claude Desktop.** Its link (`claude://code/new?folder=…`) has no prompt parameter that we know of.
- **A choice of terminal app in todo-hub.** The Mac's default app for `.command` files runs the script.
- **A Show action for Claude Code.** todo-hub cannot select a window in the terminal app.
- **A check for a Claude that already runs on the branch.** Periscope does this check. Without periscope, todo-hub cannot see the terminal's processes, so a second start opens a second Claude in the same worktree.

## Behavior

### The ⋯ menu

The ⋯ menu of the Today pane and of the Client and Dev pane has these items, in this order:

1. Open in Linear ↗ (Client and Dev only, as now)
2. **Start in periscope** `p`, when `app.periscope_url` is set (as now)
3. **Start in Claude Code**, when the Settings repo list has at least one repo
4. **Start in Claude Desktop**, when Claude Desktop is installed
5. Remove from Today, Delete… (as now)

The app reads `periscope`, `claude_code` and `claude_desktop` from `GET /api/meta`. It reads meta at most every 10 minutes and on ⌘R. So after you install Claude Desktop, or add the first repo on the Settings page, ⌘R shows the item.

### Start in Claude Code: the popover

It is the Start in periscope popover, with these differences:

> **Start ENG-9512 in Claude Code**
>
> Repo `[~/code/api ▾]` — "Remembered for Pipelines."
> Branch `thibaultdody/eng-9512-retry-stuck-uploads` — "From Linear. A new worktree next to the repo, or the one already on this branch."
> Prompt `[Read Linear ticket ENG-9512 (https://linear.app/…) and its comments …]`
>
> `Cancel esc` `Start ↵`

- While todo-hub reads the repos, the popover shows "Loading…".
- **Repo** lists the Settings repos. Each label is the path, with the home folder shown as `~`.
- **The repo memory is the one that Start in periscope uses.** Both items use absolute paths. So a repo picked with one item is remembered for the other. The first choice follows the same order: the issue's project, then its client label, then the last repo picked. An item skips a remembered repo that is not in its own list.
- **The Branch hint** says "A worktree is already on this branch." when the selected repo has a worktree on Linear's branch and you did not change the branch. Else it says "From Linear. A new worktree next to the repo, or the one already on this branch." ("From Linear." only when you did not change it.)
- **Prompt** holds the code prompt, filled in for this issue.
- The keys, **Cancel**, and "Starting…" work as in the periscope popover.

### Start in Claude Code: after Start

1. **The worktree.** todo-hub runs `git worktree prune`, then reads `git worktree list --porcelain`. If a worktree is on the branch, todo-hub uses it. Else it runs `git fetch origin` and adds a worktree in `<repo>-worktrees/<branch>`, with each `/` in the branch changed to `-`:
   - on the local branch, if it exists;
   - else on a new local branch that tracks `origin/<branch>`, if that exists;
   - else on a new branch from `origin/HEAD`.

   Example: `~/code/api` and `thibaultdody/eng-9512-retry-stuck-uploads` give `~/code/api-worktrees/thibaultdody-eng-9512-retry-stuck-uploads`.
2. **The name.** Haiku names the Claude, as for periscope: `eng-9512-retry-stuck-uploads`. This adds 2 to 5 seconds.
3. **The session ID.** todo-hub makes a new UUID.
4. **The script.** todo-hub writes `<TodoHub folder>/start/<identifier>.command`, makes it executable, and runs `open` on it. The script:
   - goes to the worktree;
   - deletes itself;
   - runs `claude --name <name> --session-id <uuid> "<prompt>"`.

   `claude` is the absolute path that todo-hub uses for the sweeps, so the terminal's PATH does not matter. `shlex.quote` quotes each value, because the title comes from Linear.
5. **The comment.** todo-hub reads the account email from `claude auth status --json` and adds the comment that Start in periscope adds: the start time, the Claude account and the Claude session ID.
6. **The memory.** todo-hub remembers the repo for the issue's project (or client label) and as the last repo picked.
7. **The toast.** The popover closes, and a toast says "Started ENG-9512 in Claude Code". Each warning is an error toast, as for periscope.

To open the conversation again, run `claude --resume <id>` in the worktree.

### Start in Claude Desktop

- A click fills the chat prompt for the issue and runs `open "claude://claude.ai/new?q=<prompt>"`, with the prompt URL-encoded.
- Claude Desktop opens a new chat, with the prompt in the message box. It does not send it. You change the prompt or send it there. (Tested on 2026-11-19 with Claude Desktop 6.6395.1.)
- A toast says "Opened a chat for ENG-9512 in Claude Desktop".
- There is no Haiku name and no comment. Claude Desktop gives no session ID.

**Is Claude Desktop installed?** todo-hub asks Launch Services for the app with the bundle ID `com.anthropic.claudefordesktop`:

```sh
osascript -l JavaScript -e "ObjC.import('AppKit'); \$.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier('com.anthropic.claudefordesktop').isNil()"
```

It sends no Apple Events, so macOS asks for no permission. It takes about 70 ms.

### The Settings page

The **Periscope** section becomes **Start Claude**. It always shows, so the page always has five sections.

> **Start Claude**
>
> **Repos** — for Start in Claude Code
> `~/code/api` · **Remove** (on hover)
> `~/code/web`
> `[ path to a repo ]` **+ Add**
>
> **Code prompt** — Start in periscope and Start in Claude Code send it.
> `[text area]` **Save** · **Reset to default**
>
> **Chat prompt** — Start in Claude Desktop puts it in a new chat.
> `[text area]` **Save** · **Reset to default**

- **+ Add** takes a path, such as `~/code/api`. todo-hub runs `git -C <path> rev-parse --show-toplevel` and saves that absolute top folder. A path in no git repo shows "Not a git repo: ~/foo" under the field. A repo that is already on the list is not added again.
- With an empty list, a hint says "Add a repo to turn on Start in Claude Code."
- **The code prompt** default is the periscope default, unchanged:

  > Read Linear ticket {identifier} ({url}) and its comments with the Linear tools. Sum up the ask, then propose a plan. Do not change code until I agree.

- **The chat prompt** default is:

  > Read Linear ticket {identifier} ({url}) and its comments with the Linear connector. Sum up the ask, then help me with it.

- **Save refuses a chat prompt that starts with `/`**, with "The chat prompt cannot start with /." Claude Desktop's link check refuses a `q` that starts with `/`.
- An empty prompt means the default, as now.

### Errors

Each one is an error toast. An error at **Start** leaves the popover open. A warning does not stop the start.

| Cause | Message |
|---|---|
| A Settings repo is gone, or is no longer a git repo | "Not a git repo: ~/code/api" |
| `git fetch origin` fails or takes more than 30 s | Warning: "Could not fetch origin. The worktree uses the local branches." |
| The repo has no `origin/HEAD` | Warning: "~/code/api has no origin/HEAD. The new branch starts from HEAD." |
| `git worktree add` fails or takes more than 60 s | Git's own message, or "git worktree add took more than 60 s." |
| `open` fails on the script | "Could not open the start script: …" |
| `claude auth status` fails | The comment says "Claude account: unknown", as with periscope. |
| Linear refuses the comment | Warning, as now: "The Claude session was not added to ENG-9512: …" |
| `open` fails on the Claude Desktop link | "Could not open Claude Desktop." |
| Start in Claude Code is off (no repos) | 404 "Start in Claude Code is off. Add a repo on the Settings page." The app hides the item, so you see this only from a stale page. |
| Claude Desktop is not installed | 404 "Claude Desktop is not installed." Same as above. |
| The branch is blank | "The branch is empty" (400). **Start** is already disabled then. |

## Changes

**New `backend/src/todohub/start.py`**: what every start item shares, moved from `periscope.py`.

- `fill_prompt(template, issue)`, unchanged.
- `claude_name(settings, issue)`: the Haiku name. It was `pane_name`. The name now also names a Claude Code session, not only a periscope pane.
- `default_repo(db, issue, repos)` and `remember_repo(db, issue, repo)`, unchanged. Their meta keys become `start_repos` and `start_last_repo`. The old `periscope_repos` and `periscope_last_repo` are not copied: you pick the repo again one time for each project.
- `session_comment(...)`: the comment text, now used by two routes.

**`backend/src/todohub/periscope.py`**: only `Periscope`, `PeriscopeError` and `bring_to_front`.

**New `backend/src/todohub/claude_code.py`**

- `worktree_for(repo, branch) -> (path, reused, warnings)`: the steps in "After Start".
- `write_script(home, identifier, worktree, claude, name, session_id, prompt) -> Path`: the `.command` file, mode 700.
- `open_script(path)`: runs `open`.
- `account_email(settings) -> str | None`: `claude auth status --json`, 15 s.
- `ClaudeCodeStartError(message)`: for the messages in the errors table.

**New `backend/src/todohub/claude_desktop.py`**

- `BUNDLE_ID = "com.anthropic.claudefordesktop"`.
- `is_installed() -> bool`: the Launch Services check.
- `open_chat(prompt)`: runs `open "claude://claude.ai/new?q=…"`.

**`backend/src/todohub/config.py`**

- `periscope_prompt` becomes `code_prompt`. `DEFAULT_PERISCOPE_PROMPT` becomes `DEFAULT_CODE_PROMPT`.
- New: `chat_prompt` with `DEFAULT_CHAT_PROMPT`, and `repos: list[str]`.
- `claude_code_on` answers "is the repo list not empty?", as `periscope_on` does for periscope.
- `settings.json` holds the three under one key: `{"start": {"repos": [...], "code_prompt": "...", "chat_prompt": "..."}}`. The `periscope` key goes away. No migration: nobody has it saved.

**`backend/src/todohub/api.py`**

- `GET /api/issues/{issue_id}/claude-code` → `{repos: [{repo, label}], repo, hint, branch, branch_worktrees, prompt}`.
- `POST /api/issues/{issue_id}/claude-code` with `{repo, branch, prompt}` → `{path, reused, session_id, warnings}`.
- `POST /api/issues/{issue_id}/claude-desktop` → `{ok: true}`.
- `GET /api/meta` adds `claude_code` and `claude_desktop`.
- The settings body: `start: {repos: [{repo, label}], code_prompt, chat_prompt, default_code_prompt, default_chat_prompt}` replaces `periscope`.
- `POST /api/settings/repos` with `{path}` adds a repo. `DELETE /api/settings/repos?repo=<path>` removes one.
- `PUT /api/settings/prompts/{kind}` with `{prompt}`, where `kind` is `code` or `chat`, replaces `PUT /api/settings/periscope`.
- A dependency answers 404 for each new route that is off, before any Linear or git call, as `require_periscope` does.

**`app/src/periscope.ts` becomes `app/src/start.ts`**

- The popover has a target: `periscope` or `claude-code`. The title, the wait text, the hints, the start call and the toast follow the target.
- `startItems(i)` gives the menu items that are on. The Claude Desktop item calls its route and shows the toast.
- The `.pp-*` classes and the `periscope-*` focus keys get `start` names.

**`app/src/main.ts`**: the ⋯ menus call `startItems(i)`. **`app/src/api.ts`**: the new calls and types. **`app/src/settings.ts`**: the **Start Claude** section. **`app/src/styles.css`**: the renamed classes, and the repo rows.

**`README.md`**: a **Start in Claude Code** and **Start in Claude Desktop** part after "Start in periscope", the **Start Claude** section of the Settings page, and `settings.json`'s new key. **`CHANGELOG.md`**: one entry.

## Tests

`backend/tests/test_claude_code.py`, on a temporary repo with a bare `origin`:

- `worktree_for` uses a worktree that is already on the branch.
- It adds one from a local branch, from `origin/<branch>`, and as a new branch from `origin/HEAD`.
- With no `origin`, it warns and starts the new branch from `HEAD`.
- The worktree path is `<repo>-worktrees/<branch with - for />`.
- The script: a title with quotes, `$(…)` and a new line stays plain text in the prompt. The file is executable and has the self-delete line.

`backend/tests/test_claude_desktop.py`, with `subprocess` patched:

- `open_chat` URL-encodes the prompt, with spaces, `&`, `#` and new lines.
- `is_installed` gives true and false.

`backend/tests/test_start.py`: the tests for `fill_prompt`, `default_repo` and the Haiku name move here from `test_periscope.py`.

`backend/tests/test_api.py`:

- The Claude Code routes: options, start (the script, the comment, the memory), and the 404 when off.
- The Claude Desktop route, and its 404 when the app is not installed.
- `/api/meta` gives `claude_code` and `claude_desktop`.
- Settings: add a repo (resolved top folder, no duplicate), "Not a git repo", remove a repo, save and reset each prompt, and refuse a chat prompt that starts with `/`.

The app has no frontend test runner. Check in Playwright, with a scratch `TODOHUB_HOME` and the Tauri shim: the ⋯ menus with each item on and off, the Claude Code popover, the toasts, and the Settings section. Check the widths at a 1120 px window.

Before the merge, check on the Mac:

- Start in Claude Code opens the default app for `.command` files, in the worktree, and Claude has the name and the prompt.
- `claude --resume <id>` opens the session in the worktree.
- Start in Claude Desktop opens a new chat with the prompt in the message box.

## Assumptions

- **todo-hub adds the session comment when `open` returns.** If the terminal app then fails to run the script, the comment names a session that never ran.
- **The terminal Claude and the backend use the same Claude account.** The email in the comment comes from the backend's `claude auth status`.
- **`claude` takes `--` before the prompt**, so a prompt that starts with `-` is not read as a flag. The plan checks this. If it does not, a prompt that starts with `-` is refused at Save.
- **The `claude://claude.ai/new?q=` link keeps working.** Claude Desktop's own "Ask Claude" service uses it. A Claude Desktop update can change it.
- **The default app for `.command` files runs the file.** Terminal and iTerm2 do. Another app may not.
- **A file that todo-hub writes has no quarantine mark**, so macOS runs the script with no warning.
- **A repo has an `origin` remote** in most cases. Without one, the start warns and uses local branches.
