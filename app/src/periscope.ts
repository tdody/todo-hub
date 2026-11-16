// Start in periscope: the ⋯ menu item (or p) opens a popover with the repo, Linear's branch and the
// prompt; Start asks periscope to start Claude on that branch with the prompt. The toast's Show
// brings periscope to the front with that Claude selected.
import { api } from "./api";
import type { Issue, PeriscopeOptions } from "./api";
import { h } from "./dom";

export interface PeriscopeCtx {
  render: () => void;
  toast: (message: string, action?: { label: string; run: () => void }) => void;
  fail: (e: unknown) => void;
}

interface Popover {
  issueId: string;
  options: PeriscopeOptions | null;     // null while periscope is asked
  repo: string;
  branch: string;
  prompt: string;
  starting: boolean;
}

let ctx: PeriscopeCtx;
let open: Popover | null = null;

export function setupPeriscope(c: PeriscopeCtx) {
  ctx = c;
}

export function isPeriscopeOpen(): boolean {
  return open !== null;
}

export function closePeriscope() {
  if (!open) return;
  open = null;
  ctx.render();
}

/** A pointer down outside the popover closes it in place, not by a re-render, so the click still
 *  lands on its target. */
export function dismissPeriscope(target: Element) {
  if (!open || target.closest?.(".pp-pop")) return;
  open = null;
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

async function openFor(i: Issue) {
  if (open?.issueId === i.id) return;
  open = { issueId: i.id, options: null, repo: "", branch: "", prompt: "", starting: false };
  ctx.render();
  try {
    const o = await api.periscopeOptions(i.id);
    if (open?.issueId !== i.id) return;           // closed, or opened for another issue, meanwhile
    open = { ...open, options: o, repo: o.repo ?? "", branch: o.branch, prompt: o.prompt };
    ctx.render();
    const pop = document.querySelector<HTMLElement>(".pp-pop");
    pop?.scrollIntoView({ block: "nearest" });
    pop?.querySelector<HTMLElement>(open.repo ? ".pp-start" : ".pp-repo")?.focus();
  } catch (e) {
    if (open?.issueId === i.id) closePeriscope();
    ctx.fail(e);
  }
}

async function start(i: Issue) {
  const p = open;
  if (!p || p.issueId !== i.id || p.starting || !p.repo || !p.branch.trim() || !p.prompt.trim()) return;
  p.starting = true;
  ctx.render();
  try {
    const r = await api.startInPeriscope(i.id, { repo: p.repo, branch: p.branch.trim(), prompt: p.prompt });
    if (open === p) closePeriscope();
    ctx.toast(r.mode === "existing" ? `${i.identifier} is already open in periscope` : `Started ${i.identifier} in periscope`,
      { label: "Show", run: () => void showPane(r.pid) });
  } catch (e) {
    p.starting = false;
    if (open === p) ctx.render();
    ctx.fail(e);
  }
}

async function showPane(pid: string) {
  try {
    await api.showInPeriscope(pid);
  } catch (e) {
    ctx.fail(e);
  }
}

/** The popover under the pane's ⋯, when it is open for ``i``. */
export function periscopePopover(i: Issue): HTMLElement | "" {
  const p = open;
  if (!p || p.issueId !== i.id) return "";
  const label = `Start ${i.identifier} in periscope`;
  const o = p.options;
  if (!o) {
    return h("div", { class: "pp-pop", role: "dialog", "aria-label": label },
      h("div", { class: "pp-title" }, label), h("p", { class: "pp-wait" }, "Asking periscope…"));
  }
  const repo = h("select", {
    class: "pp-input pp-repo", "aria-label": "Repo", disabled: p.starting,
    onchange: (e: Event) => { p.repo = (e.target as HTMLSelectElement).value; ctx.render(); },
  },
    !p.repo && h("option", { value: "", selected: true, disabled: true }, "Pick a repo"),
    ...o.repos.map((r) => h("option", { value: r.repo, selected: r.repo === p.repo }, r.label)));
  const branch = h("input", {
    type: "text", class: "pp-input mono", value: p.branch, "aria-label": "Branch", "data-edit": "periscope-branch",
    disabled: p.starting, oninput: (e: Event) => { p.branch = (e.target as HTMLInputElement).value; },
  });
  const prompt = h("textarea", {
    class: "pp-input", rows: 4, value: p.prompt, "aria-label": "Prompt", "data-edit": "periscope-prompt",
    disabled: p.starting, oninput: (e: Event) => { p.prompt = (e.target as HTMLTextAreaElement).value; },
  });
  const repoHint = p.repo && p.repo === o.repo ? o.hint : "";
  const branchHint = o.branch_worktrees.includes(p.repo) && p.branch.trim() === o.branch
    ? "A worktree is already on this branch."
    : "From Linear. A new worktree, or the one already on this branch.";
  return h("div", {
    class: "pp-pop", role: "dialog", "aria-label": label,
    onkeydown: (e: KeyboardEvent) => {
      // The page's keys (m, d, ⌘↵ …) must not act on the issue behind the popover.
      e.stopPropagation();
      if (e.key === "Escape") { closePeriscope(); return; }
      if (e.key !== "Enter" || e.isComposing) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "BUTTON" || (tag === "TEXTAREA" && !e.metaKey && !e.ctrlKey)) return;
      e.preventDefault();
      void start(i);
    },
  },
    h("div", { class: "pp-title" }, label),
    h("label", { class: "pp-field" }, h("span", {}, "Repo"), repo),
    repoHint ? h("p", { class: "pp-hint" }, repoHint) : "",
    h("label", { class: "pp-field" }, h("span", {}, "Branch"), branch),
    h("p", { class: "pp-hint" }, branchHint),
    h("label", { class: "pp-field top" }, h("span", {}, "Prompt"), prompt),
    h("div", { class: "pp-acts" },
      h("button", { type: "button", class: "td-btn", onclick: () => closePeriscope() }, "Cancel", h("kbd", {}, "esc")),
      h("button", { type: "button", class: "td-btn primary pp-start", disabled: !p.repo || p.starting,
        onclick: () => void start(i) }, p.starting ? "Starting…" : "Start", h("kbd", {}, "↵"))));
}
