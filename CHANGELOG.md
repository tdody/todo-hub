# Changelog

What changed in each TodoHub release, newest first. The app's update panel shows the newest section, and anyone can read this file.

## v0.4.0

- **Start in Claude Code:** an issue's ⋯ menu has **Start in Claude Code**, after Start in periscope. Pick a repo, a branch and a prompt, then click **Start**. TodoHub uses or adds a worktree for the issue's branch in `<repo>-worktrees/<branch>`. Then your app for `.command` files, for example Terminal, starts `claude` there with the prompt. The issue gets a comment with the Claude session, as with Start in periscope.
- **Start in Claude Desktop:** when Claude Desktop is installed, the ⋯ menu also has **Start in Claude Desktop**. It opens a new chat with the chat prompt in the message box. You send the message.
- **A review ticket starts on its PR:** Start in periscope on a review ticket with a GitHub PR link starts Claude on the PR's code. The popover has a **PR** select, and **Repo** lists only the repos whose origin is the PR's repo. Periscope checks out the PR, or brings the worktree that is already on it up to the PR's latest commit. This needs a periscope from 2026-11-22 or later. With an older periscope, the popover starts on the issue's branch, as before.
- **Settings → Start Claude:** this section replaces **Periscope**. It has the repos for Start in Claude Code and 3 prompts: the code prompt for periscope and Claude Code, the review prompt for a review ticket's PR, and the chat prompt for Claude Desktop. In the review prompt, `{pr}` becomes the PR's URL. Each prompt has its own **Save** and **Reset to default**.
- **The type you approved stays:** after an approve, a merge, an edit or a restore, the issue shows the type that you approved. Before, it showed the type from the rules until the next refresh. The brief's list of issues done today shows the approved type too.
- **Periscope's warnings:** when periscope starts Claude but reports a problem, the toast shows it. For example, periscope cannot update a worktree that has local changes.
- **If you update from v0.3.0 or earlier:** TodoHub forgets the repo that it remembered for each project, one time. Pick each project's repo again at its next start. A custom periscope prompt goes back to the default. Set it again as the code prompt under **Settings → Start Claude**.

## v0.3.0

- **New client labels:** when a sweep or a capture finds a task for a customer that has no client label in Linear, the Inbox card proposes a new label. The card shows a **New client label** box, the client select shows "Hooli (new)", and the button reads **Approve, add label**. Approve creates the label in your client label group, then the issue with it. The other cards for that customer get the label too.
- **Your choice:** pick another client in the select, and Approve creates no label. **Undo** after an approve puts the card back and keeps the label. The client label group belongs to the whole workspace, so your teammates see a label that you create.
- **Customers only:** with HubSpot tools, the sweep proposes a label only for a company whose lifecycle stage is "customer". Prospects and partners get no client.
- **No duplicate labels:** a name that matches a label, for example "Globex, Inc." for "Globex", gets that label. A name that matches two labels gets no client, and you pick one.

## v0.2.1

- **Install:** step 3 of the README now names the message that macOS shows before the first open: Apple "could not verify that TodoHub is free of malware". Run the `xattr` command in that step before you open TodoHub the first time.

## v0.2.0

The first release that you can install from GitHub. Install it from the `.dmg`, then follow **Install** in the README. Later releases come to you in the app.

- **Updates in the app:** TodoHub checks for a new release at launch and every hour. **↑ Update to vX.Y.Z** at the bottom of the sidebar shows what changed, and **Update and restart** installs it. **Settings → Updates** has **Check for updates**.
- **Pull requests tab:** your open pull requests and your review requests, with one next step for each. Fold a stack from its rail. Mine groups them by client or project.
- **Start in periscope:** from an issue's ⋯ menu, or with p, start Claude on the issue's branch. Haiku names the new Claude, and the issue records the Claude session.
- **Inbox:** when a card links to an open issue, you make one choice and see the plan before you approve.
- **Insights:** lines merged this week, and an 8-week pull request chart in the Overview.
- **Window:** drag the sidebar's edge to resize it, or hide it to icons with ⌃⌘S. ⌘+ and ⌘− zoom, and ⌘0 goes back to 100%.
