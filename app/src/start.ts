// Start Claude on an issue, from its ⋯ menu, or on a pull request, from Review in To review. Start in periscope
// and Start in Claude Code open a popover with the repo, Linear's branch and the code prompt; Start asks
// periscope, or todo-hub, to start Claude on that branch. For a review ticket, Start in periscope's popover
// selects one of its PRs, and periscope checks the PR out in place of the branch. Start in Claude Desktop opens a
// new chat with the chat prompt in its message box. Review's popover picks periscope or Claude Code, a repo of the
// PR and the review prompt, and Start checks the PR out there. Periscope's toast has Show, which brings periscope
// to the front with that Claude selected.
import { api } from "./api";
import type { Issue, Meta, PeriscopePr, PeriscopeStart, PullRequest, PullStartOptions, StartOptions, StartTarget } from "./api";
import { h } from "./dom";
import type { Child } from "./dom";

export interface StartCtx {
  render: () => void;
  toast: (message: string, action?: { label: string; run: () => void }) => void;
  fail: (e: unknown) => void;
}

interface Fields {
  repo: string;
  prompt: string;
  starting: boolean;
}

interface Popover extends Fields {
  issueId: string;
  target: StartTarget;
  options: StartOptions | null;         // null while they load
  pr: PeriscopePr | null;               // the selected PR (periscope only); null starts on the branch
  branch: string;
  promptEdited: boolean;                // you typed in the prompt: a PR change keeps it
}

interface Review extends Fields {
  pull: PullRequest;
  targets: StartTarget[];               // the ones that are on
  options: PullStartOptions | null;     // null while they load
  target: StartTarget | null;           // null: no target that is on has the PR's repo
}

const TARGET_NAME: Record<StartTarget, string> = { "periscope": "periscope", "claude-code": "Claude Code" };

let ctx: StartCtx;
let popover: Popover | null = null;         // an issue's
let review: Review | null = null;           // a pull request's; at most one of the two is open
// `${target}:${issueId}` or `${target}:${PR url}` while a start request runs, even if its popover is closed
const runningStarts = new Set<string>();

export function setupStart(c: StartCtx) {
  ctx = c;
}

const hasPopover = () => popover !== null || review !== null;

/** The popover is on the page. A refresh can take its issue or PR off the page; the keys then go back to it. */
export function isStartOpen(): boolean {
  return hasPopover() && document.querySelector(".start-pop") !== null;
}

/** A tab switch takes the popover off the page; the switch renders, so this does not. */
export function forgetStart() {
  popover = review = null;
}

export function closeStart() {
  if (!hasPopover()) return;
  forgetStart();
  ctx.render();
}

/** A pointer down outside the popover closes it in place, not by a re-render, so the click still
 *  lands on its target. */
export function dismissStart(target: Element) {
  if (!hasPopover() || target.closest?.(".start-pop")) return;
  forgetStart();
  document.querySelector(".start-pop")?.remove();
}

function closeMenu(e: Event) {
  (e.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
}

/** The ⋯ menu's start items that are on. p clicks Start in periscope through paneKey (data-pane="periscope"). */
export function startItems(i: Issue, meta: Meta | null): HTMLElement[] {
  const items: HTMLElement[] = [];
  if (meta?.periscope) {
    items.push(h("button", { type: "button", "data-pane": "periscope",
      onclick: (e: Event) => { closeMenu(e); void openFor(i, "periscope"); } }, "Start in periscope", h("kbd", {}, "p")));
  }
  if (meta?.claude_code) {
    items.push(h("button", { type: "button",
      onclick: (e: Event) => { closeMenu(e); void openFor(i, "claude-code"); } }, "Start in Claude Code"));
  }
  if (meta?.claude_desktop) {
    items.push(h("button", { type: "button",
      onclick: (e: Event) => { closeMenu(e); void openChat(i); } }, "Start in Claude Desktop"));
  }
  return items;
}

async function openChat(i: Issue) {
  const key = `claude-desktop:${i.id}`;
  if (runningStarts.has(key)) return;
  runningStarts.add(key);
  try {
    await api.startInClaudeDesktop(i.id);
    ctx.toast(`Opened a chat for ${i.identifier} in Claude Desktop`);
  } catch (e) {
    ctx.fail(e);
  } finally {
    runningStarts.delete(key);
  }
}

/** Select ``pr`` (null: Linear's branch): its repo with a worktree already on pr-<N>, else its first repo,
 *  and its prompt; or the remembered repo and the code prompt. A prompt you typed stays. */
function selectPr(p: Popover, o: StartOptions, pr: PeriscopePr | null) {
  p.pr = pr;
  p.repo = pr ? pr.branch_worktrees[0] ?? pr.repos[0] : o.repo ?? "";
  if (!p.promptEdited) p.prompt = pr ? pr.prompt : o.prompt;
}

async function openFor(i: Issue, target: StartTarget) {
  if (popover?.issueId === i.id && popover.target === target) return;
  review = null;
  const mine: Popover = popover = { issueId: i.id, target, options: null, pr: null, repo: "", branch: "", prompt: "",
    promptEdited: false, starting: runningStarts.has(`${target}:${i.id}`) };
  ctx.render();
  try {
    const o = await (target === "periscope" ? api.periscopeOptions(i.id) : api.claudeCodeOptions(i.id));
    if (popover !== mine) return;     // closed, or opened again, meanwhile
    popover = { ...mine, options: o, branch: o.branch };
    selectPr(popover, o, o.prs?.[0] ?? null);
    ctx.render();
    const pop = document.querySelector<HTMLElement>(".start-pop");
    pop?.scrollIntoView({ block: "nearest" });
    pop?.querySelector<HTMLElement>(popover.repo ? ".start-go" : ".start-repo")?.focus();
  } catch (e) {
    if (popover === mine) closeStart();
    ctx.fail(e);
  }
}

function toastPeriscope(what: string, r: PeriscopeStart) {
  ctx.toast(r.mode === "existing" ? `${what} is already open in periscope` : `Started ${what} in periscope`,
    { label: "Show", run: () => void api.showInPeriscope(r.pid).catch(ctx.fail) });
  for (const w of r.warnings) ctx.fail(w);
}

/** Start can run: a repo, a PR or a branch, and a prompt, and no start already running. */
function canStart(p: Popover): boolean {
  return !p.starting && !!p.repo && (p.pr !== null || !!p.branch.trim()) && !!p.prompt.trim();
}

async function start(i: Issue) {
  const p = popover;
  if (!p || p.issueId !== i.id || !canStart(p)) return;
  const key = `${p.target}:${i.id}`;
  runningStarts.add(key);
  p.starting = true;
  ctx.render();
  const body = { repo: p.repo, branch: p.branch, prompt: p.prompt };
  // The popover can be closed, or opened again, while the request runs: act on the one that is open now.
  const isOpen = () => popover?.issueId === i.id && popover.target === p.target;
  try {
    if (p.target === "periscope") {
      const r = await api.startInPeriscope(i.id, p.pr ? { repo: p.repo, prompt: p.prompt, pr: p.pr.number } : body);
      if (isOpen()) closeStart();
      toastPeriscope(i.identifier, r);
    } else {
      const r = await api.startInClaudeCode(i.id, body);
      if (isOpen()) closeStart();
      ctx.toast(`Started ${i.identifier} in Claude Code`);
      for (const w of r.warnings) ctx.fail(w);
    }
  } catch (e) {
    if (popover && isOpen()) { popover.starting = false; ctx.render(); }
    ctx.fail(e);
  } finally {
    runningStarts.delete(key);
  }
}

/** A start popover: its title, its fields, and ↵ (⌘↵ in the prompt) for ``run``. */
function frame(label: string, run: () => void, ...fields: Child[]): HTMLElement {
  return h("div", {
    class: "start-pop", role: "dialog", "aria-label": label,
    onkeydown: (e: KeyboardEvent) => {
      // keyCode 229: WebKit's Enter that commits an IME composition, with isComposing false.
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "BUTTON" || (tag === "TEXTAREA" && !e.metaKey && !e.ctrlKey)) return;
      e.preventDefault();
      run();
    },
  }, h("div", { class: "start-title" }, label), ...fields);
}

function repoField(p: Fields, repos: { repo: string; label: string }[]): HTMLElement {
  return h("label", { class: "start-field" }, h("span", {}, "Repo"), h("select", {
    class: "start-input start-repo", "aria-label": "Repo", "data-focus": "start-repo", disabled: p.starting,
    onchange: (e: Event) => { p.repo = (e.target as HTMLSelectElement).value; ctx.render(); },
  },
    !p.repo && h("option", { value: "", selected: true, disabled: true }, "Pick a repo"),
    ...repos.map((r) => h("option", { value: r.repo, selected: r.repo === p.repo }, r.label))));
}

/** Read-only, not disabled, while starting: the field keeps the focus and the cursor. */
function promptField(p: Fields, typed: () => void): HTMLElement {
  return h("label", { class: "start-field top" }, h("span", {}, "Prompt"), h("textarea", {
    class: "start-input", rows: 4, value: p.prompt, "aria-label": "Prompt", "data-edit": "start-prompt",
    readOnly: p.starting, oninput: (e: Event) => { p.prompt = (e.target as HTMLTextAreaElement).value; typed(); },
  }));
}

function startButton(p: Fields, run: () => void): HTMLButtonElement {
  return h("button", { type: "button", class: "td-btn primary start-go", "data-focus": "start-go", onclick: run },
    p.starting ? "Starting…" : "Start", h("kbd", {}, "↵"));
}

function actions(p: Fields, go: HTMLElement): HTMLElement {
  return h("div", { class: "start-acts" },
    h("button", { type: "button", class: "td-btn start-cancel", "data-focus": "start-cancel", disabled: p.starting,
      onclick: () => closeStart() }, "Cancel", h("kbd", {}, "esc")),
    go);
}

/** The popover under the pane's ⋯, when it is open for ``i``. main.ts's keydown closes it on Esc and
 *  keeps the page's keys off the issue behind it. */
export function startPopover(i: Issue): HTMLElement | "" {
  const p = popover;
  if (!p || p.issueId !== i.id) return "";
  const label = `Start ${i.identifier} in ${TARGET_NAME[p.target]}`;
  const run = () => void start(i);
  const o = p.options;
  if (!o) return frame(label, run, h("p", { class: "start-wait" }, p.target === "periscope" ? "Asking periscope…" : "Loading…"));
  const pr = p.pr;
  const prs = o.prs ?? [];
  const prSelect = prs.length ? h("select", {
    class: "start-input", "aria-label": "PR", "data-focus": "start-pr", disabled: p.starting,
    onchange: (e: Event) => {
      const value = (e.target as HTMLSelectElement).value;
      selectPr(p, o, prs.find((x) => x.url === value) ?? null);
      ctx.render();
    },
  },
    ...prs.map((x) => h("option", { value: x.url, selected: x === pr }, x.label)),
    h("option", { value: "", selected: pr === null }, "None: start on the Linear branch")) : null;
  const worktreeHint = !pr ? ""
    : pr.branch_worktrees.includes(p.repo) ? `A worktree is already on pr-${pr.number}.`
    : "Periscope checks out the PR in a new worktree.";
  // A PR's repos are the ones whose origin is the PR's repo: another repo would fetch another PR.
  const repos = pr ? o.repos.filter((r) => pr.repos.includes(r.repo)) : o.repos;
  const go = startButton(p, run);
  const branchHint = h("p", { class: "start-hint" });
  const newWorktreeHint = p.target === "periscope" ? "A new worktree, or the one already on this branch."
    : "A new worktree next to the repo, or the one already on this branch.";
  // Typing does not re-render: Start and the branch's hint follow the fields here.
  const update = () => {
    go.disabled = !canStart(p);
    const fromLinear = p.branch.trim() === o.branch;
    branchHint.textContent = fromLinear && o.branch_worktrees.includes(p.repo)
      ? "A worktree is already on this branch."
      : `${fromLinear ? "From Linear. " : ""}${newWorktreeHint}`;
  };
  update();
  // Read-only, not disabled, while starting: the field keeps the focus and the cursor.
  const branch = h("input", {
    type: "text", class: "start-input mono", value: p.branch, "aria-label": "Branch", "data-edit": "start-branch",
    readOnly: p.starting, oninput: (e: Event) => { p.branch = (e.target as HTMLInputElement).value; update(); },
  });
  const repoHint = !pr && p.repo && p.repo === o.repo ? o.hint : "";
  return frame(label, run,
    o.pr_hint ? h("p", { class: "start-hint lead" }, o.pr_hint) : "",
    prSelect ? h("label", { class: "start-field" }, h("span", {}, "PR"), prSelect) : "",
    worktreeHint ? h("p", { class: "start-hint" }, worktreeHint) : "",
    repoField(p, repos),
    repoHint ? h("p", { class: "start-hint" }, repoHint) : "",
    pr ? "" : h("label", { class: "start-field" }, h("span", {}, "Branch"), branch),
    pr ? "" : branchHint,
    promptField(p, () => { p.promptEdited = true; update(); }),
    actions(p, go));
}

// ---- Review, in Pull requests → To review ------------------------------------------------------------
/** The targets that are on, in the order of Where. Review shows when there is one. */
export function reviewTargets(meta: Meta | null): StartTarget[] {
  return (["periscope", "claude-code"] as const).filter((t) => (t === "periscope" ? meta?.periscope : meta?.claude_code));
}

/** Select ``target``, with its repo that has a worktree already on pr-<N>, else its first one. */
function selectTarget(r: Review, o: PullStartOptions, target: StartTarget) {
  const t = o.targets[target]!;
  r.target = target;
  r.repo = t.branch_worktrees[0] ?? t.repos[0].repo;
  r.starting = runningStarts.has(`${target}:${r.pull.url}`);
}

/** ``ticket`` is the Linear issue that the PR's row shows, or "". */
export async function openReview(pull: PullRequest, ticket: string, targets: StartTarget[]) {
  if (review?.pull.url === pull.url) return;
  popover = null;
  const mine: Review = review = { pull, targets, options: null, target: null, repo: "", prompt: "", starting: false };
  ctx.render();
  try {
    const o = await api.pullStartOptions(pull, ticket);
    if (review !== mine) return;      // closed, or opened for another PR, meanwhile
    mine.options = o;
    mine.prompt = o.prompt;
    const first = targets.find((t) => o.targets[t]?.repos.length);
    if (first) selectTarget(mine, o, first);
    ctx.render();
    // After the tab has put the popover under its row.
    queueMicrotask(() => {
      const pop = document.querySelector<HTMLElement>(".start-pop");
      pop?.scrollIntoView({ block: "nearest" });
      pop?.querySelector<HTMLElement>(canReview(mine) ? ".start-go" : ".start-cancel")?.focus();
    });
  } catch (e) {
    if (review === mine) closeStart();
    ctx.fail(e);
  }
}

/** Start can run: a target with a repo, and a prompt, and no start already running there. */
function canReview(r: Review): boolean {
  return !r.starting && r.target !== null && !!r.prompt.trim();
}

async function startReview() {
  const r = review;
  if (!r?.options || !r.target || !canReview(r)) return;
  const { pull, target, repo, prompt } = r, { ticket } = r.options;
  const key = `${target}:${pull.url}`;
  runningStarts.add(key);
  r.starting = true;
  ctx.render();
  // The popover can be closed, or opened again, while the request runs: act on the one that is open now.
  const isOpen = () => review?.pull.url === pull.url && review.target === target;
  try {
    if (target === "periscope") {
      const s = await api.reviewInPeriscope(pull, { repo, prompt, title: pull.title,
        ticket: ticket?.identifier ?? "", ticket_title: ticket?.title ?? "" });
      if (isOpen()) closeStart();
      toastPeriscope(`#${pull.number}`, s);
    } else {
      const s = await api.reviewInClaudeCode(pull, { repo, prompt, title: pull.title });
      if (isOpen()) closeStart();
      ctx.toast(`Started #${pull.number} in Claude Code`);
      for (const w of s.warnings) ctx.fail(w);
    }
  } catch (e) {
    if (review && isOpen()) { review.starting = false; ctx.render(); }
    ctx.fail(e);
  } finally {
    runningStarts.delete(key);
  }
}

/** The PR that Review's popover is open for. */
export const reviewedPull = (): PullRequest | null => review?.pull ?? null;

/** Review's popover. The tab puts it under its PR's row. */
export function reviewPopover(): HTMLElement | "" {
  const r = review;
  if (!r) return "";
  const n = r.pull.number, o = r.options, only = r.targets.length === 1;
  const label = `Review #${n}${only ? ` in ${TARGET_NAME[r.targets[0]]}` : ""}`;
  const run = () => void startReview();
  if (!o) return frame(label, run, h("p", { class: "start-wait" }, "Loading…"));
  const go = startButton(r, run);
  const update = () => { go.disabled = !canReview(r); };
  update();
  const where = only ? "" : h("div", { class: "start-field" }, h("span", {}, "Where"),
    h("span", { class: "segmented", role: "group", "aria-label": "Where" }, ...r.targets.map((t) => h("button", {
      type: "button", class: `seg${r.target === t ? " on" : ""}`, "aria-pressed": String(r.target === t),
      "data-focus": `start-${t}`, disabled: !o.targets[t]?.repos.length,
      onclick: () => { selectTarget(r, o, t); ctx.render(); },
    }, TARGET_NAME[t]))));
  const selected = r.target && o.targets[r.target];
  const hint = !selected ? ""
    : selected.branch_worktrees.includes(r.repo) ? `A worktree is already on pr-${n}.`
    : r.target === "periscope" ? "Periscope checks out the PR in a new worktree."
    : `A new worktree next to the repo, on pr-${n}.`;
  const reasons = r.targets.filter((t) => !o.targets[t]?.repos.length).map((t) => h("p", { class: "start-hint off" },
    o.targets[t]?.error || `No repo in ${t === "periscope" ? "periscope" : "Settings"} has ${r.pull.repo} as its origin.`));
  return frame(label, run,
    o.ticket_hint ? h("p", { class: "start-hint lead" }, o.ticket_hint) : "",
    where,
    hint ? h("p", { class: "start-hint" }, hint) : "",
    ...reasons,
    selected ? repoField(r, selected.repos) : "",
    selected ? promptField(r, update) : "",
    actions(r, go));
}
