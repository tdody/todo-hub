# Review a pull request from To review

## Goal

In **Pull requests → To review**, each row gets a **Review** button. It starts Claude on the pull request's code with the review prompt, in periscope or in Claude Code.

Today this works only for a Linear ticket of type `review`, from its **⋯** menu, and only in periscope. A pull request that asks for your review has a row in To review, but no start.

## Scope

In:

- todo-hub: the Review button, its popover, a start in periscope and a start in Claude Code for a pull request.
- periscope: an optional `ticket` in `POST /api/linear/start`.

Out:

- A mark on a row whose review already runs.
- A memory for **Where**.
- The Mine side, and Claude Desktop.
- Periscope's review queue and walkthrough (`/api/reviews/prepare`).
- A review posted on GitHub. The default prompt tells Claude not to post anything.
- Review tickets. Their **⋯** menu does not change.

## Behavior

### The button

- Each row in To review has **Review** in the Waiting column, after the waiting time.
- It shows when the pointer is on the row, and on the selected row. Else it keeps its space, so the row does not move.
- **p** opens it for the selected row. The button is not a tab stop, like the row's ID chip.
- The line under the table has "p review". The shortcut list has "p: Pull requests (To review): review the selected pull request".
- There is no button, no **p** and no "p review" when Start in periscope and Start in Claude Code are both off.

### The popover

> **Review #812**
>
> Where `[periscope | Claude Code]` — "Periscope checks out the PR in a new worktree."
> Repo `[api ▾]`
> Prompt `[Read Linear ticket ENG-123 (https://linear.app/…) … Then review https://github.com/acme/api/pull/812 …]`
>
> `Cancel esc` `Start ↵`

It opens under the row, in `.pr-wrap`, the box around the table. It is the popover of Start in periscope, with the same keys: ↵ starts (⌘↵ in the prompt), and Esc or a click outside closes it. One start popover is open at a time.

- **Where** shows when periscope and Claude Code are both on. With one on, the title names it: "Review #812 in periscope". periscope is selected when it has the PR's repo, else Claude Code.
- A target with no repo for the PR cannot be selected. Its button in **Where** is disabled, and one line gives the reason:
  - "No repo in periscope has acme/web as its origin."
  - "No repo in Settings has acme/web as its origin."
  - Periscope's error, for example "Periscope is not running at 127.0.0.1:17374."
- When no target that is on has a repo for the PR, **Repo** and **Prompt** do not show, and **Start** is disabled.
- **Repo** lists only the target's repos whose origin is the PR's repo. It selects one with a worktree already on `pr-<N>`, else the first one.
- The hint under **Where** follows the target and the repo:
  - "A worktree is already on pr-812."
  - "Periscope checks out the PR in a new worktree."
  - "A new worktree next to the repo, on pr-812."
- **Prompt** is the same for both targets. A change of **Where** or **Repo** keeps your text.
- The focus goes to **Start**, to **Cancel** when **Start** is disabled, else to the popover: while it loads, and while a start runs. A pick in **Where** gives it back to **Start**, so ↵ starts.
- A GitHub read, a refresh of the page or a re-render keeps the popover, your text, the focus, the cursor and the page's scroll. When the PR leaves the table (merged, or hidden by a view or the filter), the popover leaves the page with its row, and the keys go back to the page.

### The PR's ticket and the prompt

The PR's ticket is the Linear issue that its row shows: `linearOf` in `pulls.ts`. There is no second rule.

- **With a ticket**, the prompt is the review prompt from Settings, filled in for the ticket and the PR.
- **With no ticket**, the prompt is the review prompt without each sentence that names `{identifier}`, `{title}` or `{url}`. A sentence ends at `.`, `!` or `?` before a space, or at a line end. A list number ("1. ") belongs to its sentence, and "e.g." and "i.e." do not end one. A line with no sentence left goes away, and the other lines stay lines. The default prompt becomes "Then review https://github.com/acme/api/pull/812 in this worktree: …". If nothing is left, **Prompt** is empty and **Start** waits for your text.
- **When Linear does not give the ticket** (it is down, or the ticket is gone), the popover continues as with no ticket. A line says why: "The prompt leaves ENG-123 out: " and Linear's error.

### Start

| | periscope | Claude Code |
|---|---|---|
| Worktree | Periscope checks the PR out as `pr-<N>`, or fast-forwards the worktree already there | todo-hub does the same, in `<repo>-worktrees/pr-<N>` |
| Claude's name | `pr-812` and up to three words from Haiku for the PR's title | the same |
| Ticket on periscope's card | the PR's ticket and its title, if any | none |
| Toast | "Started #812 in periscope", with **Show** | "Started #812 in Claude Code" |

- A Claude already on `pr-<N>` in periscope: "#812 is already open in periscope", with **Show**. Nothing starts.
- **No session comment.** The ticket that a PR names can belong to the author of the PR, and a comment there can notify them. A review ticket's start still adds one.
- A review does not change the remembered repos. The PR chose the repo.
- While a start runs, a second start of the same PR in the same target is blocked. When you open the popover again, it selects that target and shows "Starting…".

### Claude Code's checkout

todo-hub makes or updates the worktree on `pr-<N>`:

1. A worktree is already on `pr-<N>`: fetch `pull/<N>/head` there, then `git merge --ff-only`. When one of them fails, use the worktree as it is, with the warning "pr-812 may be behind #812: …" and git's reason. Git refuses the fast-forward when it would overwrite local changes or an ignored file (`--no-overwrite-ignore`), so none is lost.
2. Else fetch `pull/<N>/head` into the local branch `pr-<N>`, then add the worktree `<repo>-worktrees/pr-<N>` on it. The branch has no upstream, so a push has no default target.
3. The fetch of step 2 fails and the local branch `pr-<N>` exists (diverged, or offline): add the worktree on the local branch, with the same warning.
4. The fetch of step 2 fails and there is no local branch: an error toast with git's message.

Then todo-hub writes and opens the start script, as for an issue. The script's name is `<repo name>-pr-<N>.command`.

### Errors

Each one is an error toast, except where the popover shows it.

| Cause | Message |
|---|---|
| Periscope is not running when the popover opens | periscope cannot be selected in **Where**, and its line shows periscope's error |
| Linear does not give the ticket | a line in the popover (see above) |
| todo-hub's backend does not answer | its error; the popover closes |
| Periscope is already starting this PR (409) | "Periscope is already starting #812." |
| Periscope refuses the start | periscope's message |
| A periscope that still needs `ticket` gets a PR with no ticket (422) | "ticket: Field required" |
| git cannot fetch the PR, or cannot add the worktree | git's message |

## Periscope contract

One PR to the periscope repo, first.

1. `StartBody.ticket` becomes `ticket: str = ""`. With an empty ticket, the pane gets no `linked_linear`.
2. Nothing else changes in the route.
3. README and the route's docstring: a start can have no ticket.

Test, in `tests/routes/test_linear.py`: a `pr` start with no ticket answers "spawned", stamps `linked_pr`, and stamps no `linked_linear`.

## todo-hub changes

### Backend routes (`api.py`)

`owner`, `name` and `number` name the PR, as in `POST /api/pulls/{owner}/{name}/{number}`.

- `GET /api/pulls/{owner}/{name}/{number}/start?ticket=ENG-123` gives what the popover shows first. `ticket` is optional.

  ```
  {
    "ticket": {"identifier", "title"} or null,
    "ticket_hint": "",
    "prompt": "…",
    "targets": {
      "periscope":   {"repos": [{"repo", "label"}], "branch_worktrees": ["…"], "error": ""},
      "claude-code": {"repos": [{"repo", "label"}], "branch_worktrees": ["…"], "error": ""}
    }
  }
  ```

  `targets` has only the targets that are on. `repos` has only the repos whose origin is the PR's repo. `branch_worktrees` has the ones with a worktree on `pr-<N>`. `error` is periscope's error when its catalog cannot be read, else empty. The popover takes the targets from this answer. The match with the PR's repo ignores case.
- `POST /api/pulls/{owner}/{name}/{number}/periscope` takes `{repo, prompt, title, ticket, ticket_title}`. `title` is the PR's title, for Claude's name. `ticket` and `ticket_title` come from the GET, and are empty with no ticket. It answers `{mode, pid, warnings}`, as the issue route does.
- `POST /api/pulls/{owner}/{name}/{number}/claude-code` takes `{repo, prompt, title}`. It answers 400 for a repo that is not on the Settings list, because git and the script run only in a repo you listed. It answers `{path, reused, session_id, warnings}`.
- The POST routes use `require_periscope` and `require_claude_code`, as the issue routes do.

### Backend modules

- `claude_code.py`: `catalog(repos)` gives the Settings repos in the shape of periscope's catalog. `github_slug(repo)` gives the `owner/name` of the repo's origin on GitHub, or None, for the URL forms that periscope reads (`git@github.com:`, `https://github.com/`, `ssh://git@github.com/`, with or without `.git`). `find_or_add_pr_worktree(repo, number)` gives `(path, reused, warnings)`. It shares the `git worktree add` step with `find_or_add_worktree`.
- `periscope.py`: `pr_repos` gives a catalog's repos for a PR and the ones with a worktree on `pr-<N>`, for both targets. `review_prs` uses it too. `Periscope.start` sends `ticket` only when it has one.
- `start.py`: the review prompt for a PR, with a ticket or with none.
- `claude_name` takes `{"identifier": "PR-812", "title": <the PR's title>}`. Its prompt says "the work below", for an issue or a PR.

### App

- `start.ts`: the popover is for an issue or for a PR. `isStartOpen`, `closeStart`, `dismissStart` and `forgetStart` work for both. The PR's popover shares the title, repo, prompt and action parts with the issue's.
- `pulls.ts`: the button in `stepCell`, `data-act="review"`, **p** in `pullsKey`, the hint line, `.pr-wrap` around the table, and the popover's place under its row. `rebuildKeepingPane` keeps the focus and the cursor in the popover. A click in the popover does not fold or select a row.
- `main.ts`: `setupPulls` gets the meta. The shortcut list shows the new line when a target is on.
- `api.ts`: the types and the three calls.
- `settings.ts`: the Review prompt's hint also names Review in To review, and says what happens with no ticket.
- `styles.css`: the rules of the prototype (`.pr-wrap`, `td.st.rv`, `.rv-line`, `.rv-btn`, the popover's right edge at each width, `.start-hint.off`).
- `README.md`: Pull requests, Settings → Start Claude, and the two start sections.

## Tests

Backend:

- `test_start.py`: the prompt with no ticket. The default prompt loses its first sentence. A URL, "e.g." or a list number does not split a sentence. The other lines stay lines. A prompt that names the ticket in each sentence gives an empty prompt.
- `test_claude_code.py`, on a real git repo with a `refs/pull/<N>/head` in its origin: `github_slug` for each URL form and for no origin; a new `pr-<N>` worktree at the PR's head; a fast-forward of a worktree already there; local changes that block it stay, with a warning; a fetch that fails with and without a local branch; the POST route (the repo check, the script, no session comment, no remembered repo).
- `test_periscope.py`: the options (a match that ignores case, no match, periscope not running, each target on or off, a ticket, no ticket, a ticket that Linear does not give); the POST route with and without a ticket (what periscope gets, no session comment, no remembered repo, 409).

The app has no test runner. In a browser, with a scratch `TODOHUB_HOME`, at 1120 px and 760 px, in light and dark, check:

- the button on hover and on the selected row, and **p**
- each state of **Where**, and the keys in the popover
- a GitHub read while you type in the prompt
- the last row of a long table
- a start in periscope's dev instance on port 17375, and a start in Claude Code

## Order

1. The periscope PR merges, and your periscope gets it.
2. The todo-hub PR merges.

Until step 1, a PR with a ticket starts in periscope, and a PR with no ticket gives periscope's error.

## Assumptions

- A PR whose ticket has a team key that none of your open issues use counts as a PR with no ticket, as in its row today.
- A repo matches a PR only when its origin is the PR's repo on github.com. A clone whose origin is a fork does not match.
- `git fetch origin pull/<N>/head` works for a PR from a fork, because the repo's origin is the PR's repo.
- A prompt that names `{pr}` only in a sentence about the ticket loses the PR when there is no ticket. The popover shows the prompt before the start.
- A PR can carry its own `CLAUDE.md` and `.claude` settings, and Claude can load them. A review ticket's start in periscope has the same risk today.
- Claude has `gh` signed in, so it can read the PR's description and comments.
