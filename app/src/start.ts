// Start Claude on an issue, from its ⋯ menu. Start in periscope and Start in Claude Code open a popover with
// the repo, Linear's branch and the code prompt; Start asks periscope, or todo-hub, to start Claude on that
// branch. Start in Claude Desktop opens a new chat with the chat prompt in its message box. Periscope's toast
// has Show, which brings periscope to the front with that Claude selected.
import { api } from "./api";
import type { Issue, Meta, StartOptions } from "./api";
import { h } from "./dom";

export interface StartCtx {
  render: () => void;
  toast: (message: string, action?: { label: string; run: () => void }) => void;
  fail: (e: unknown) => void;
}

type Target = "periscope" | "claude-code";

interface Popover {
  issueId: string;
  target: Target;
  options: StartOptions | null;         // null while they load
  repo: string;
  branch: string;
  prompt: string;
  starting: boolean;
}

let ctx: StartCtx;
let popover: Popover | null = null;
const starting = new Set<string>();    // `${target}:${issueId}` while a start request runs, even if its popover is closed

export function setupStart(c: StartCtx) {
  ctx = c;
}

/** The popover is on the page. A refresh can take its issue off the page; the keys then go back to it. */
export function isStartOpen(): boolean {
  return popover !== null && document.querySelector(".start-pop") !== null;
}

/** A tab switch takes the popover off the page; the switch renders, so this does not. */
export function forgetStart() {
  popover = null;
}

export function closeStart() {
  if (!popover) return;
  popover = null;
  ctx.render();
}

/** A pointer down outside the popover closes it in place, not by a re-render, so the click still
 *  lands on its target. */
export function dismissStart(target: Element) {
  if (!popover || target.closest?.(".start-pop")) return;
  popover = null;
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
  if (starting.has(key)) return;
  starting.add(key);
  try {
    await api.startInClaudeDesktop(i.id);
    ctx.toast(`Opened a chat for ${i.identifier} in Claude Desktop`);
  } catch (e) {
    ctx.fail(e);
  } finally {
    starting.delete(key);
  }
}

async function openFor(i: Issue, target: Target) {
  if (popover?.issueId === i.id && popover.target === target) return;
  const mine: Popover = popover = { issueId: i.id, target, options: null, repo: "", branch: "", prompt: "",
    starting: starting.has(`${target}:${i.id}`) };
  ctx.render();
  try {
    const o = await (target === "periscope" ? api.periscopeOptions(i.id) : api.claudeCodeOptions(i.id));
    if (popover !== mine) return;     // closed, or opened again, meanwhile
    popover = { ...mine, options: o, repo: o.repo ?? "", branch: o.branch, prompt: o.prompt };
    ctx.render();
    const pop = document.querySelector<HTMLElement>(".start-pop");
    pop?.scrollIntoView({ block: "nearest" });
    pop?.querySelector<HTMLElement>(popover.repo ? ".start-go" : ".start-repo")?.focus();
  } catch (e) {
    if (popover === mine) closeStart();
    ctx.fail(e);
  }
}

/** Start can run: a repo, a branch and a prompt, and no start already running. */
function canStart(p: Popover): boolean {
  return !p.starting && !!p.repo && !!p.branch.trim() && !!p.prompt.trim();
}

async function start(i: Issue) {
  const p = popover;
  if (!p || p.issueId !== i.id || !canStart(p)) return;
  const key = `${p.target}:${i.id}`;
  if (starting.has(key)) return;
  starting.add(key);
  p.starting = true;
  ctx.render();
  const body = { repo: p.repo, branch: p.branch, prompt: p.prompt };
  // The popover can be closed, or opened again, while the request runs: act on the one that is open now.
  const isOpen = () => popover?.issueId === i.id && popover.target === p.target;
  try {
    if (p.target === "periscope") {
      const r = await api.startInPeriscope(i.id, body);
      if (isOpen()) closeStart();
      ctx.toast(r.mode === "existing" ? `${i.identifier} is already open in periscope` : `Started ${i.identifier} in periscope`,
        { label: "Show", run: () => void api.showInPeriscope(r.pid).catch(ctx.fail) });
      for (const w of r.warnings) ctx.fail(w);
    } else {
      const r = await api.startInClaudeCode(i.id, body);
      if (isOpen()) closeStart();
      ctx.toast(`Started ${i.identifier} in Claude Code`);
      for (const w of r.warnings) ctx.fail(w);
    }
  } catch (e) {
    p.starting = false;
    if (popover && isOpen()) { popover.starting = false; ctx.render(); }
    ctx.fail(e);
  } finally {
    starting.delete(key);
  }
}

/** The popover under the pane's ⋯, when it is open for ``i``. main.ts's keydown closes it on Esc and
 *  keeps the page's keys off the issue behind it. */
export function startPopover(i: Issue): HTMLElement | "" {
  const p = popover;
  if (!p || p.issueId !== i.id) return "";
  const label = `Start ${i.identifier} in ${p.target === "periscope" ? "periscope" : "Claude Code"}`;
  const o = p.options;
  if (!o) {
    return h("div", { class: "start-pop", role: "dialog", "aria-label": label },
      h("div", { class: "start-title" }, label),
      h("p", { class: "start-wait" }, p.target === "periscope" ? "Asking periscope…" : "Loading…"));
  }
  const repo = h("select", {
    class: "start-input start-repo", "aria-label": "Repo", "data-focus": "start-repo", disabled: p.starting,
    onchange: (e: Event) => { p.repo = (e.target as HTMLSelectElement).value; ctx.render(); },
  },
    !p.repo && h("option", { value: "", selected: true, disabled: true }, "Pick a repo"),
    ...o.repos.map((r) => h("option", { value: r.repo, selected: r.repo === p.repo }, r.label)));
  const startButton = h("button", { type: "button", class: "td-btn primary start-go", "data-focus": "start-go",
    onclick: () => void start(i) }, p.starting ? "Starting…" : "Start", h("kbd", {}, "↵"));
  const branchHint = h("p", { class: "start-hint" });
  const newWorktreeHint = p.target === "periscope" ? "A new worktree, or the one already on this branch."
    : "A new worktree next to the repo, or the one already on this branch.";
  // Typing does not re-render: Start and the branch's hint follow the fields here.
  const update = () => {
    startButton.disabled = !canStart(p);
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
  const prompt = h("textarea", {
    class: "start-input", rows: 4, value: p.prompt, "aria-label": "Prompt", "data-edit": "start-prompt",
    readOnly: p.starting, oninput: (e: Event) => { p.prompt = (e.target as HTMLTextAreaElement).value; update(); },
  });
  const repoHint = p.repo && p.repo === o.repo ? o.hint : "";
  return h("div", {
    class: "start-pop", role: "dialog", "aria-label": label,
    onkeydown: (e: KeyboardEvent) => {
      // keyCode 229: WebKit's Enter that commits an IME composition, with isComposing false.
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "BUTTON" || (tag === "TEXTAREA" && !e.metaKey && !e.ctrlKey)) return;
      e.preventDefault();
      void start(i);
    },
  },
    h("div", { class: "start-title" }, label),
    h("label", { class: "start-field" }, h("span", {}, "Repo"), repo),
    repoHint ? h("p", { class: "start-hint" }, repoHint) : "",
    h("label", { class: "start-field" }, h("span", {}, "Branch"), branch),
    branchHint,
    h("label", { class: "start-field top" }, h("span", {}, "Prompt"), prompt),
    h("div", { class: "start-acts" },
      h("button", { type: "button", class: "td-btn", "data-focus": "start-cancel", disabled: p.starting,
        onclick: () => closeStart() }, "Cancel", h("kbd", {}, "esc")),
      startButton));
}
