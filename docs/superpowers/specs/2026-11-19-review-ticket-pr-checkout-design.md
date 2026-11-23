# Start a review ticket in periscope on the PR's code

## Goal

When a ticket is a code review, **Start in periscope** starts Claude in the repo of the pull request, on the pull request's code.

Today the popover selects the repo that todo-hub remembers for the ticket's project or client, and it uses Linear's branch name. For a review ticket, both are wrong: periscope makes a new branch from the default branch, and Claude does not see the code to review.

## What happens today

- A review ticket has the task type `review`. The sweep gives this type to each GitHub review request, and Claude gives it to a review that someone asks for in Slack or another source. When you approve the candidate, todo-hub adds the PR's URL to the Linear issue as a link (an attachment).
- The issue lists apply the type that you approved, and use the rules in `categories.py` only for issues that todo-hub did not create. The popover route uses only the rules.
- Periscope's `POST /api/linear/start` always makes a new branch from the default branch (`git worktree add -b`). A PR's branch name sent as `branch` gives a new branch with that name, without the PR's commits.
- Periscope already has a PR helper, `projects.fetch_pr_into_worktree`. It fetches `pull/<N>/head` into a local branch `pr-<N>` and adds a worktree on it. ⌘K's PR open and `/api/reviews/prepare` use it. It works for a PR from a fork.
- Periscope finds a repo's GitHub `owner/name` from its origin remote (`gitutil.github_slug`). Its catalog does not send it.

## Scope

In:

- periscope: a `slug` for each repo in the catalog, and a `pr` in `POST /api/linear/start`.
- todo-hub: the PR links of a review ticket, a **PR** select in the popover, and a **Review prompt** on the Settings page.

Out:

- Tickets that are not of type `review`, for example "Answer Sam's comments on acme/api#790". They start on the Linear branch, as today.
- A PR URL in the description or the comments. Only the issue's links count.
- A clone whose origin is a fork of the PR's repo.
- An update of a reused `pr-<N>` worktree when the PR has new commits. This gets a Linear ticket.
- Periscope's review queue and walkthrough (`/api/reviews/prepare`).
- A review posted on GitHub. The prompt tells Claude not to post anything.

## Behavior

### A review ticket

A ticket is a review ticket when both are true:

1. Its type is `review`. This is the type that the lists show: the type you approved, else the rules.
2. Its Linear links include at least one URL `https://github.com/<owner>/<name>/pull/<N>`.

The popover uses PR mode for a review ticket when at least one of its PRs has a periscope repo. A periscope repo matches a PR when the repo's `slug` is the PR's `owner/name`. The match ignores case.

### The popover in PR mode

> **Start ENG-123 in periscope**
>
> PR `[acme/api#812 ▾]` — "Periscope checks out the PR in a new worktree."
> Repo `[api ▾]`
> Prompt `[Read Linear ticket ENG-123 (https://linear.app/…) and its comments … Then review https://github.com/acme/api/pull/812 …]`
>
> `Cancel esc` `Start ↵`

- **PR** is a select. Its options are the ticket's PRs that have a periscope repo, in the order Linear lists the links, with no duplicates. The first one is selected. The select knows each PR by its URL, because two repos can have a PR with the same number. The last option is always "None: start on the Linear branch".
- The hint under **PR** says "A worktree is already on pr-812." when the selected repo has a worktree on `pr-<N>`. Else it says "Periscope checks out the PR in a new worktree."
- **Repo** lists only the periscope repos that match the selected PR. It selects the one with a worktree already on `pr-<N>`, else the first one.
- PR mode has no **Branch** field. Periscope uses the branch `pr-<N>`.
- **Prompt** holds the review prompt, filled in for the ticket and the selected PR. It follows the **PR** select until you edit it.
- **None: start on the Linear branch** shows the popover as it is without PR mode: all the repos, the remembered repo and its hint, Linear's branch and the normal prompt.
- The popover opens with the focus on **Start**, because the repo is already selected.
- The keys, the toasts and **Show** do not change.

### No periscope repo matches

When a review ticket has PR links but no periscope repo matches them, the popover is the same as without PR mode. A hint under the title names the PRs' repos: "No periscope repo has acme/web as its origin. This starts on the Linear branch."

### After Start

- A PR start sends `pr` to periscope and no branch.
- Periscope answers as today: mode "spawned" with the session, or mode "existing" when a Claude is already on `pr-<N>`. The toasts are the same.
- A PR start does not change the remembered repos. The PR chose the repo, not you.
- The session comment on the issue is the same.

### Errors

Each one is an error toast. They add to the errors of **Start in periscope** today.

| Cause | Message |
|---|---|
| Periscope cannot find the PR | Periscope's message, for example "PR #812 not found in …". |
| The branch `pr-812` exists with no worktree, or the worktree path is taken | Periscope's message, for example "local branch 'pr-812' already in use — remove …". |
| The PR fetch fails (network, GitHub sign-in) | Periscope's message, "git fetch failed: …". |
| todo-hub cannot read the ticket's links | Linear's error. The popover closes, as for each Linear error while it asks. |
| A start request has both `branch` and `pr`, or neither | 400 "Send a branch or a PR." The popover never sends this. |

## Periscope contract

One PR to the periscope repo.

1. `GET /api/open/catalog`: each repo gets `slug`, the `owner/name` from `gitutil.github_slug(repo)`, or `null` when its origin is not on GitHub.
2. `POST /api/linear/start` takes `pr` (an integer above 0) in place of `branch`. A body with both or neither answers 400. With `pr`:
   1. The guard key is `(repo label, "pr-<N>")`.
   2. A Claude on the branch `pr-<N>` in the repo: the answer is `{mode: "existing", pid}`.
   3. A worktree on `pr-<N>`: Claude starts there, and the answer has `reused: true`. Periscope does not fetch or update it.
   4. Else `fetch_pr_into_worktree(repo, pr)` makes the worktree, and the answer has `reused: false`. Its 409s (the branch `pr-<N>` in use, the worktree path taken) become 400 with the same message, so a 409 from this route still means only "a start is already running".
   5. The pane gets `linked_linear`, `linked_linear_title` and `linked_pr`. When periscope fetched the PR, it also gets `is_fork`, as ⌘K's PR open stamps it. A reused worktree gets no `is_fork`, because periscope does not ask GitHub then.
   6. The answer for mode "spawned" has the same fields as with `branch`: `{mode, pid, path, reused, session_id, email}`.
3. README: the `slug` field, and `pr` in the `/api/linear/start` section.

Tests, in periscope's `tests/routes/test_linear.py` and its catalog tests:

- The catalog gives `slug` from origin, and `null` for a repo with no GitHub origin.
- A start with `pr` calls the PR helper (patched), stamps the four fields, and answers "spawned" with `session_id`.
- A Claude on `pr-<N>` gives "existing". A worktree on `pr-<N>` is reused and nothing is fetched.
- Both `branch` and `pr`, or neither, gives 400. A 409 from the PR helper gives 400 with its message.

## todo-hub changes

**`backend/src/todohub/api.py`**

- One function gives an issue's type: the type you approved, from `db.categories_by_identifier()`, else the rules. `GET /api/issues` and the popover route both use it.
- `GET /api/issues/{issue_id}/periscope`: for a review ticket only, it reads the links with `Linear.attachment_urls` and keeps the PR URLs. The answer gets two fields:
  - `prs`: one entry for each PR with a matching repo: `{number, label, url, repos, branch_worktrees, prompt}`. `label` is `owner/name#N`. `repos` holds the matching repo paths. `branch_worktrees` holds the ones with a worktree on `pr-<N>`. `prompt` is the review prompt filled in for the ticket and this PR.
  - `pr_hint`: the "No periscope repo has …" text when the ticket has PR links, the catalog's repos have `slug`, and no repo matches. Else `""`.
  - The other fields do not change.
  - A ticket that is not a review gets `prs: []` and `pr_hint: ""`, and todo-hub does not read its links.
  - An older periscope sends repos with no `slug` key. todo-hub then does not read the links, and gives `prs: []` and `pr_hint: ""`, because it cannot send `pr` to that periscope.
- `POST /api/issues/{issue_id}/periscope`: `PeriscopeStartIn` gets `pr: int | None`, and `branch` becomes optional. The route answers 400 "Send a branch or a PR." unless exactly one is given. With `pr`, it calls `Periscope.start` with `pr` and does not call `remember_repo`.
- `PUT /api/settings/periscope` takes `prompt`, `review_prompt` or both. A prompt that the body does not name stays as it is: `save_override` merges the `periscope` section, as it merges `sources`. An empty text gives the default. The settings body's `periscope` gets `review_prompt` and `default_review_prompt`.

**`backend/src/todohub/linear.py`**

- `attachment_urls` returns a list in the order Linear gives, not a set. The merge route only tests membership, so it does not change.

**`backend/src/todohub/periscope.py`**

- `pr_links(urls) -> list[tuple[str, int]]`: the `owner/name` and the number of each GitHub PR URL, in order, with no duplicates.
- `fill_prompt(template, issue, pr="")`: also fills `{pr}` when `pr` is given. The normal prompt gets no `pr`, so a `{pr}` in it stays as typed.
- `Periscope.start` takes `branch` or `pr` and sends the one it gets.

**`backend/src/todohub/config.py`**

- `Settings.periscope_review_prompt`, with this default, from `settings.json` at `{"periscope": {"review_prompt": …}}`:

  > Read Linear ticket {identifier} ({url}) and its comments with the Linear tools. Then review {pr} in this worktree: sum up the change and list the problems you find. Do not post anything on GitHub.

**`app/src/api.ts`**: `PeriscopeOptions` gets `prs` and `pr_hint`. `startInPeriscope` takes `branch` or `pr`. The settings type gets the review prompt, and `setPeriscopePrompt` sends both prompts.

**`app/src/periscope.ts`**: the **PR** select, its hint, the repos of the selected PR, the prompt that follows the PR until you edit it, the "None" option and `pr_hint`.

**`app/src/settings.ts`**: the Periscope card gets a second text area, **Review prompt**. Its hint names `{identifier}`, `{title}`, `{url}` and `{pr}`. One **Save** saves both text areas. Each text area has its own **Reset to default**, which sends only that prompt, so the other text area keeps its saved text.

**`app/src/styles.css`**: only if the PR row needs a style. The popover stays no wider than the issue's fields row.

**`README.md`**: in "Start in periscope", review tickets and the review prompt.

## Tests

`backend/tests/test_periscope.py`:

- `pr_links` keeps PR URLs in order, drops duplicates, and skips URLs that are not PRs (an issue, a commit, a Slack link).
- `fill_prompt` fills `{pr}` when it is given, and keeps it as typed when it is not.
- A review ticket with one PR link in a periscope repo gives one `prs` entry with its label, repos, `branch_worktrees` and filled prompt.
- Two PR links give two entries in Linear's order. The same link twice gives one entry.
- A PR whose repo periscope does not have gives `prs: []` and a `pr_hint` with its `owner/name`. A repo whose `slug` differs only in case matches.
- A ticket that is not a review gives `prs: []` and does not read the links.
- A ticket approved as a review, with a title that the rules do not mark as a review, gets `prs`.
- A catalog with no `slug` gives `prs: []` and an empty `pr_hint`.
- A start with `pr` sends `pr` and no branch, leaves the remembered repos as they were, and adds the session comment.
- A start with both `branch` and `pr`, or neither, gives 400.

`backend/tests/test_settings.py`: `periscope_review_prompt` from `settings.json` overrides the default. An empty text gives the default. A PUT with one prompt leaves the other as it was.

The app has no frontend test runner. Check the popover in a browser with a scratch `TODOHUB_HOME` and periscope's dev instance on port 17375: PR mode, two PRs, "None", no matching repo, a reused `pr-<N>` worktree, and the Settings card.

## Order

The two PRs can merge in any order. todo-hub with an older periscope gets no `slug`, so it never sends `pr`. A newer periscope with an older todo-hub sends a `slug` that todo-hub ignores.

## Assumptions

- A periscope repo matches a PR only when its origin is the PR's repo. A clone whose origin is a fork, with the PR's repo as `upstream`, does not match.
- todo-hub adds the PR's URL as a Linear link when you approve a review candidate. Linear's GitHub integration can add PR links too.
- The rules can give the type `review` to a ticket that is not a review, for example a title with "review comments". The "None" option starts it on the Linear branch.
- A reused `pr-<N>` worktree can be behind the PR. Claude can see this with `gh pr view`. The fix is a separate Linear ticket.
- `fetch_pr_into_worktree` fetches from origin with `pull/<N>/head`. That works because the matching repo's origin is the PR's repo.
- The spawned Claude has `gh` signed in, so it can read the PR's description and comments.
