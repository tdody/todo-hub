// Start in periscope: the ⋯ menu item (or p) opens a popover with the repo, Linear's branch and the
// prompt; Start asks periscope to start Claude on that branch with the prompt. For a review ticket, the
// popover selects one of its PRs, and periscope checks the PR out in place of the branch. The toast's
// Show brings periscope to the front with that Claude selected.
import { api } from "./api";
import type { Issue, PeriscopeOptions, PeriscopePr } from "./api";
import { h } from "./dom";

export interface PeriscopeCtx {
  render: () => void;
  toast: (message: string, action?: { label: string; run: () => void }) => void;
  fail: (e: unknown) => void;
}

interface Popover {
  issueId: string;
  options: PeriscopeOptions | null;     // null while periscope is asked
  pr: PeriscopePr | null;               // the selected PR; null starts on the branch
  repo: string;
  branch: string;
  prompt: string;
  promptEdited: boolean;                // you typed in the prompt: a PR change keeps it
  starting: boolean;
}

let ctx: PeriscopeCtx;
let popover: Popover | null = null;

export function setupPeriscope(c: PeriscopeCtx) {
  ctx = c;
}

/** The popover is on the page. A refresh can take its issue off the page; the keys then go back to it. */
export function isPeriscopeOpen(): boolean {
  return popover !== null && document.querySelector(".pp-pop") !== null;
}

/** A tab switch takes the popover off the page; the switch renders, so this does not. */
export function forgetPeriscope() {
  popover = null;
}

export function closePeriscope() {
  if (!popover) return;
  popover = null;
  ctx.render();
}

/** A pointer down outside the popover closes it in place, not by a re-render, so the click still
 *  lands on its target. */
export function dismissPeriscope(target: Element) {
  if (!popover || target.closest?.(".pp-pop")) return;
  popover = null;
  document.querySelector(".pp-pop")?.remove();
}

/** The ⋯ menu item. p clicks it through paneKey (data-pane="periscope"). */
export function periscopeItem(i: Issue): HTMLElement {
  return h("button", {
    type: "button", "data-pane": "periscope",
    onclick: (e: Event) => {
      (e.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
      void openFor(i);
    },
  }, "Start in periscope", h("kbd", {}, "p"));
}

/** Select ``pr`` (null: Linear's branch): its repo with a worktree already on pr-<N>, else its first repo,
 *  and its prompt; or the remembered repo and the normal prompt. A prompt you typed stays. */
function selectPr(p: Popover, o: PeriscopeOptions, pr: PeriscopePr | null) {
  p.pr = pr;
  p.repo = pr ? pr.branch_worktrees[0] ?? pr.repos[0] : o.repo ?? "";
  if (!p.promptEdited) p.prompt = pr ? pr.prompt : o.prompt;
}

async function openFor(i: Issue) {
  if (popover?.issueId === i.id) return;
  popover = { issueId: i.id, options: null, pr: null, repo: "", branch: "", prompt: "", promptEdited: false,
    starting: false };
  ctx.render();
  try {
    const o = await api.periscopeOptions(i.id);
    if (popover?.issueId !== i.id) return;           // closed, or opened for another issue, meanwhile
    popover = { ...popover, options: o, branch: o.branch };
    selectPr(popover, o, o.prs[0] ?? null);
    ctx.render();
    const pop = document.querySelector<HTMLElement>(".pp-pop");
    pop?.scrollIntoView({ block: "nearest" });
    pop?.querySelector<HTMLElement>(popover.repo ? ".pp-start" : ".pp-repo")?.focus();
  } catch (e) {
    if (popover?.issueId === i.id) closePeriscope();
    ctx.fail(e);
  }
}

/** Start can run: a repo, a PR or a branch, and a prompt, and no start already running. */
function canStart(p: Popover): boolean {
  return !p.starting && !!p.repo && (p.pr !== null || !!p.branch.trim()) && !!p.prompt.trim();
}

async function start(i: Issue) {
  const p = popover;
  if (!p || p.issueId !== i.id || !canStart(p)) return;
  p.starting = true;
  ctx.render();
  try {
    const target = p.pr ? { pr: p.pr.number } : { branch: p.branch };
    const r = await api.startInPeriscope(i.id, { repo: p.repo, prompt: p.prompt, ...target });
    if (popover === p) closePeriscope();
    ctx.toast(r.mode === "existing" ? `${i.identifier} is already open in periscope` : `Started ${i.identifier} in periscope`,
      { label: "Show", run: () => void api.showInPeriscope(r.pid).catch(ctx.fail) });
    for (const w of r.warnings) ctx.fail(w);
  } catch (e) {
    p.starting = false;
    if (popover === p) ctx.render();
    ctx.fail(e);
  }
}

/** The popover under the pane's ⋯, when it is open for ``i``. main.ts's keydown closes it on Esc and
 *  keeps the page's keys off the issue behind it. */
export function periscopePopover(i: Issue): HTMLElement | "" {
  const p = popover;
  if (!p || p.issueId !== i.id) return "";
  const label = `Start ${i.identifier} in periscope`;
  const o = p.options;
  if (!o) {
    return h("div", { class: "pp-pop", role: "dialog", "aria-label": label },
      h("div", { class: "pp-title" }, label), h("p", { class: "pp-wait" }, "Asking periscope…"));
  }
  const pr = p.pr;
  const prSelect = o.prs.length ? h("select", {
    class: "pp-input", "aria-label": "PR", "data-focus": "periscope-pr", disabled: p.starting,
    onchange: (e: Event) => {
      const value = (e.target as HTMLSelectElement).value;
      selectPr(p, o, o.prs.find((x) => x.url === value) ?? null);
      ctx.render();
    },
  },
    ...o.prs.map((x) => h("option", { value: x.url, selected: x === pr }, x.label)),
    h("option", { value: "", selected: p.pr === null }, "None: start on the Linear branch")) : null;
  const worktreeHint = !pr ? ""
    : pr.branch_worktrees.includes(p.repo) ? `A worktree is already on pr-${pr.number}.`
    : "Periscope checks out the PR in a new worktree.";
  // A PR's repos are the ones whose origin is the PR's repo: another repo would fetch another PR.
  const repos = pr ? o.repos.filter((r) => pr.repos.includes(r.repo)) : o.repos;
  const repo = h("select", {
    class: "pp-input pp-repo", "aria-label": "Repo", "data-focus": "periscope-repo", disabled: p.starting,
    onchange: (e: Event) => { p.repo = (e.target as HTMLSelectElement).value; ctx.render(); },
  },
    !p.repo && h("option", { value: "", selected: true, disabled: true }, "Pick a repo"),
    ...repos.map((r) => h("option", { value: r.repo, selected: r.repo === p.repo }, r.label)));
  const startButton = h("button", { type: "button", class: "td-btn primary pp-start", "data-focus": "periscope-start",
    onclick: () => void start(i) }, p.starting ? "Starting…" : "Start", h("kbd", {}, "↵"));
  const branchHint = h("p", { class: "pp-hint" });
  // Typing does not re-render: Start and the branch's hint follow the fields here.
  const update = () => {
    startButton.disabled = !canStart(p);
    const fromLinear = p.branch.trim() === o.branch;
    branchHint.textContent = fromLinear && o.branch_worktrees.includes(p.repo)
      ? "A worktree is already on this branch."
      : `${fromLinear ? "From Linear. " : ""}A new worktree, or the one already on this branch.`;
  };
  update();
  // Read-only, not disabled, while starting: the field keeps the focus and the cursor.
  const branch = h("input", {
    type: "text", class: "pp-input mono", value: p.branch, "aria-label": "Branch", "data-edit": "periscope-branch",
    readOnly: p.starting, oninput: (e: Event) => { p.branch = (e.target as HTMLInputElement).value; update(); },
  });
  const prompt = h("textarea", {
    class: "pp-input", rows: 4, value: p.prompt, "aria-label": "Prompt", "data-edit": "periscope-prompt",
    readOnly: p.starting,
    oninput: (e: Event) => { p.prompt = (e.target as HTMLTextAreaElement).value; p.promptEdited = true; update(); },
  });
  const repoHint = !pr && p.repo && p.repo === o.repo ? o.hint : "";
  return h("div", {
    class: "pp-pop", role: "dialog", "aria-label": label,
    onkeydown: (e: KeyboardEvent) => {
      // keyCode 229: WebKit's Enter that commits an IME composition, with isComposing false.
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "BUTTON" || (tag === "TEXTAREA" && !e.metaKey && !e.ctrlKey)) return;
      e.preventDefault();
      void start(i);
    },
  },
    h("div", { class: "pp-title" }, label),
    o.pr_hint ? h("p", { class: "pp-hint lead" }, o.pr_hint) : "",
    prSelect ? h("label", { class: "pp-field" }, h("span", {}, "PR"), prSelect) : "",
    worktreeHint ? h("p", { class: "pp-hint" }, worktreeHint) : "",
    h("label", { class: "pp-field" }, h("span", {}, "Repo"), repo),
    repoHint ? h("p", { class: "pp-hint" }, repoHint) : "",
    pr ? "" : h("label", { class: "pp-field" }, h("span", {}, "Branch"), branch),
    pr ? "" : branchHint,
    h("label", { class: "pp-field top" }, h("span", {}, "Prompt"), prompt),
    h("div", { class: "pp-acts" },
      h("button", { type: "button", class: "td-btn", "data-focus": "periscope-cancel", disabled: p.starting,
        onclick: () => closePeriscope() }, "Cancel", h("kbd", {}, "esc")),
      startButton));
}
