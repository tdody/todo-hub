// The reading pane in Today, Client and Dev: an issue's description, sub-issues and comments, and
// editing them in place (the title too). main.ts owns the page and the fields row; it hands this
// module what it needs once, with setupPane.
import { api, ApiError, linearImage } from "./api";
import type { Issue, IssueEdit, IssuePreview, State, SubIssue } from "./api";
import { h, link } from "./dom";
import { dueLabel, isOpen, localToday, when } from "./issues";
import { renderMarkdown } from "./markdown";
import type { UndoEntry } from "./main";

export interface PaneCtx {
  render: () => void;
  editIssue: {
    (issue: IssuePreview, change: IssueEdit, rerender?: boolean): Promise<boolean>;
    (issue: Issue, change: Omit<IssueEdit, "description">, rerender?: boolean): Promise<boolean>;
  };
  offerUndo: (message: string, done: string, run: () => Promise<void>) => UndoEntry;
  canUndo: (entry: UndoEntry) => boolean;          // ⌘Z or its banner can still undo it (10 minutes)
  toast: (message: string) => void;
  fail: (e: unknown) => void;
  loadIssues: () => Promise<void>;
  afterPointer: (fn: () => void) => void;          // now, or once the pointer's click has landed
  doneStatus: () => State | undefined;
  todoStatus: () => State | undefined;
  state: { busy: Set<string>; issues: Issue[]; briefAt: number };
}

let ctx: PaneCtx;

export function setupPane(c: PaneCtx) {
  ctx = c;
}

/** Rebuild the page with ``rebuild``, keeping the pane field that has the cursor (its text, cursor
 *  and selection) and the reading pane's scroll. */
export function rebuildKeepingPane(rebuild: () => void) {
  const snapshot = snapshotPane();
  rebuilding = true;
  try {
    rebuild();
  } finally {
    rebuilding = false;
  }
  restorePane(snapshot);
}

type Detail = { at: number; loading?: true; error?: string; issue?: IssuePreview };
export const details = new Map<string, Detail>();           // reading pane content, by issue id

// Text typed in the pane, by "<issue id>:<field>" (title, description, comment, sub), until it's
// saved. Re-renders rebuild the fields from it, so a sweep finishing or the list reloading never
// loses what you typed. A title or description draft also means its editor is open.
const paneDrafts = new Map<string, string>();
let rebuilding = false;        // rebuildKeepingPane is replacing the page

/** A field lost focus because you left it: not because a re-render removed it, and not because you
 *  switched to another app (the field gets the focus back when you return). */
function isLeaving(e: Event): boolean {
  return !rebuilding && (e.target as Element).isConnected && document.hasFocus();
}

/** Open the title or description editor with ``text``, cursor at the end. */
function openEdit(key: string, text: string) {
  paneDrafts.set(key, text);
  ctx.render();
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-edit="${CSS.escape(key)}"]`);
  el?.focus();
  el?.setSelectionRange(el.value.length, el.value.length);
}

interface PaneSnapshot {
  edit: string | null; start: number | null; end: number | null; focus: string | null; ident: string | null; scroll: number;
}

// A control with data-focus (a sub-issue tick box, the periscope popover's select and buttons) keeps
// the focus across a re-render. One rebuilt disabled (its save or start in flight) gets it back from
// the first re-render that shows it enabled, unless you moved on.
let focusToRestore: string | null = null;

const PANE = ".td-st, .tl-pane, .ib-pane";

/** What the reading pane shows: an issue's label, or the Inbox card's id. */
function paneIdent(pane: HTMLElement): string | null {
  return pane.getAttribute("aria-label") ?? pane.querySelector<HTMLElement>(".card")?.dataset.id ?? null;
}

/** Before a re-render: the pane field holding the cursor or the data-focus control with the focus,
 *  and how far the reading pane is scrolled. */
function snapshotPane(): PaneSnapshot {
  const a = document.activeElement as HTMLInputElement | null;
  const pane = document.querySelector<HTMLElement>(PANE);
  const edit = a?.dataset?.edit ?? null;
  const focus = a?.dataset?.focus ?? (!a || a === document.body ? focusToRestore : null);
  return { edit, start: edit ? a!.selectionStart : null, end: edit ? a!.selectionEnd : null, focus,
    ident: pane ? paneIdent(pane) : null, scroll: pane?.scrollTop ?? 0 };
}

/** After a re-render: the same field gets the cursor back, the same data-focus control the focus,
 *  and the same issue's pane its scroll. */
function restorePane(k: PaneSnapshot) {
  document.querySelectorAll<HTMLTextAreaElement>(".desc-input, .pane-title-input").forEach(fitHeight);
  const pane = document.querySelector<HTMLElement>(PANE);
  if (pane && k.ident && paneIdent(pane) === k.ident) pane.scrollTop = k.scroll;
  focusToRestore = null;
  if (k.focus) {
    const control = document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(k.focus)}"]`);
    if (control?.matches(":disabled")) focusToRestore = k.focus;
    else control?.focus({ preventScroll: true });
  }
  if (!k.edit) return;
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-edit="${CSS.escape(k.edit)}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (k.start !== null) el.setSelectionRange(k.start, k.end ?? k.start);
}

/** Keep the pane's copy of a description in step with a save or an undo. */
export function setDescription(id: string, text: string) {
  const d = details.get(id);
  if (d?.issue) d.issue = { ...d.issue, description: text };
}

/** Grow a text box to fit its text, so a field opening in place keeps the text's shape. Sizing goes
 *  through "auto" for a moment; the pane and the page keep their scroll. */
function fitHeight(el: HTMLTextAreaElement) {
  const pane = el.closest<HTMLElement>(".td-st, .tl-pane");
  const page = document.scrollingElement;
  const paneTop = pane?.scrollTop ?? 0, pageTop = page?.scrollTop ?? 0;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
  if (pane) pane.scrollTop = paneTop;
  if (page) page.scrollTop = pageTop;
}

/** The issue's title in a reading pane. Click it (or press e) to rename it in place; Enter or
 *  leaving the field saves, Esc cancels. */
export function titleField(i: Issue, tag: "h2" | "h3"): HTMLElement {
  const key = `${i.id}:title`;
  const draft = paneDrafts.get(key);
  if (draft === undefined) {
    return h(tag, { class: "pane-title", "data-pane": "title", title: "Rename (e)", onclick: (e: Event) => {
      if ((e as MouseEvent).detail > 0 && window.getSelection()?.toString()) return;
      openEdit(key, i.title);
    } }, i.title);
  }
  const box = h("textarea", {
    class: "pane-title-input", value: draft, rows: 1, maxLength: 200, readOnly: ctx.state.busy.has(key), "aria-label": "Title",
    "data-edit": key, "data-pane": "title",
    oninput: (e: Event) => {
      const el = e.target as HTMLTextAreaElement;
      paneDrafts.set(key, el.value);
      fitHeight(el);
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); void saveTitle(i, tag, e.target as HTMLTextAreaElement); }
      if (e.key === "Escape") { e.stopPropagation(); paneDrafts.delete(key); ctx.render(); }
    },
    onblur: (e: Event) => { if (isLeaving(e)) void saveTitle(i, tag, e.target as HTMLTextAreaElement); },
  }) as HTMLTextAreaElement;
  requestAnimationFrame(() => fitHeight(box));
  return h(tag, { class: "pane-title editing" }, box);
}

async function saveTitle(i: Issue, tag: "h2" | "h3", input: HTMLTextAreaElement) {
  const key = `${i.id}:title`;
  const title = paneDrafts.get(key)?.replace(/\s*\n\s*/g, " ").trim();
  if (title === undefined || ctx.state.busy.has(key)) return;
  if (!title || title === i.title) {          // unchanged or empty: close the editor where it sits
    paneDrafts.delete(key);
    ctx.afterPointer(() => input.closest(".pane-title")?.replaceWith(titleField(i, tag)));
    return;
  }
  // No render() before the request: this can run from a blur, and rebuilding the page under the
  // pointer would swallow the click that moved the focus.
  ctx.state.busy.add(key);
  input.readOnly = true;
  const saved = await ctx.editIssue(i, { title }, false);
  ctx.state.busy.delete(key);
  if (saved) paneDrafts.delete(key);          // a failed save keeps the box open with your text
  const now = ctx.state.issues.find((x) => x.id === i.id) ?? i;
  document.querySelectorAll(`[data-id="${CSS.escape(i.id)}"] .tl-title`).forEach((el) => { el.textContent = now.title; });
  showAfterLeaving(key, ".pane-title", () => titleField(now, tag));
}

/** Show a save that may have begun when you left a field. Re-render once the pointer is up, unless
 *  that would take away what you went to next: an open menu, or anything on the page with the focus
 *  (a pill, button, link, select or field) that isn't one of the pane's own boxes. Then only the
 *  ``block`` around the ``key`` box is swapped for ``fresh()``, found as the page shows it now (a
 *  re-render during the save rebuilds it); the next render shows the rest. */
function showAfterLeaving(key: string, block: string, fresh: () => HTMLElement) {
  ctx.afterPointer(() => {
    const a = document.activeElement as HTMLElement | null;
    if ((a?.closest("main") && a.dataset.edit === undefined) || document.querySelector("details.drop-menu[open]")) {
      document.querySelector(`[data-edit="${CSS.escape(key)}"]`)?.closest(block)?.replaceWith(fresh());
    } else ctx.render();
  });
}

export function loadDetail(id: string, force = false) {
  const d = details.get(id);
  if (!force && d && (d.loading || Date.now() - d.at < 2 * 60_000)) return;
  const at = Date.now();                // also marks this load: an older one answering later is dropped
  details.set(id, { ...d, at, loading: true });
  api.issuePreview(id)
    .then((issue) => { if (details.get(id)?.at === at) details.set(id, { at, issue }); })
    .catch((e) => {
      // Keep showing what the pane has; say what went wrong only when it has nothing.
      const now = details.get(id);
      if (now?.at !== at) return;
      details.set(id, now.issue ? { at, issue: now.issue } : { at, error: e instanceof ApiError ? e.message : String(e) });
    })
    .finally(() => {
      const shown = [...document.querySelectorAll<HTMLElement>(`.tl-detail[data-id="${id}"]`)];
      // While you type in it, re-render the page instead: that keeps your cursor where it was.
      if (shown.some((el) => el.contains(document.activeElement))) ctx.render();
      else shown.forEach((el) => el.replaceWith(detailBody(id)));
    });
}

// Images pasted into Linear, loaded through the backend (they need the Linear key) and kept as
// data: URLs, so a re-render shows them at once. Other sites' images stay links: loading them
// would tell the sender you read the ticket.
const imageCache = new Map<string, string | Promise<string>>();

function isLinearUpload(url: string): boolean {
  try { const u = new URL(url); return u.protocol === "https:" && u.host === "uploads.linear.app"; } catch { return false; }
}

function linearImageNode(alt: string, url: string): Node | null {
  if (!isLinearUpload(url)) return null;
  const img = h("img", { class: "md-img", alt: alt || "Image from Linear" }) as HTMLImageElement;
  const box = link("", url, "md-figure");
  box.title = "Open the full image";
  box.append(img);
  const show = (src: string) => { img.src = src; box.classList.remove("loading"); box.classList.add("loaded"); };
  const got = imageCache.get(url);
  if (typeof got === "string") { show(got); return box; }
  box.classList.add("loading");
  const p = got ?? linearImage(url).then((src) => { imageCache.set(url, src); return src; });
  if (!got) imageCache.set(url, p);
  p.then(show).catch((e) => {
    imageCache.delete(url);
    box.classList.remove("loading");
    box.replaceChildren(`${alt ? `${alt}: ` : ""}image couldn't load ↗`);
    box.title = `${e instanceof Error ? e.message : String(e)} Click to open it in your browser.`;
    box.classList.add("failed");
  });
  return box;
}

export function detailBody(id: string): HTMLElement {
  const d = details.get(id);
  const i = d?.issue;
  if (!i) return h("div", { class: "tl-detail", "data-id": id },
    h("p", { class: "muted small" }, d?.error ? `Couldn't load the details: ${d.error}` : "Loading…"));
  return h("div", { class: "tl-detail", "data-id": id }, descriptionSection(i), subIssuesSection(i), commentsSection(i));
}

/** The description as Markdown. Click it (not a link or image) or press ⇧E to edit the Markdown in
 *  place; leaving the box, ⌘↵ or Esc saves. A description cut off at the pane's limit is edited in Linear. */
function descriptionSection(i: IssuePreview): HTMLElement {
  const key = `${i.id}:description`;
  const head = h("h4", {}, "Description");
  const draft = paneDrafts.get(key);
  if (draft !== undefined) {
    const busy = ctx.state.busy.has(key);
    const box = h("textarea", {
        class: "desc-input", value: draft, rows: 4, readOnly: busy, "aria-label": "Description", "data-edit": key, "data-pane": "description",
        oninput: (e: Event) => {
          const el = e.target as HTMLTextAreaElement;
          paneDrafts.set(key, el.value);
          fitHeight(el);
        },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            e.stopPropagation();
            void saveDescription(i, e.target as HTMLTextAreaElement);
          }
        },
        onblur: (e: Event) => { if (isLeaving(e)) void saveDescription(i, e.target as HTMLTextAreaElement); },
      }) as HTMLTextAreaElement;
    requestAnimationFrame(() => fitHeight(box));
    return h("section", {}, head, box,
      h("p", { class: "muted small" }, busy ? "Saving…" : "Markdown. Saves when you leave the box (or ⌘↵)."));
  }
  const md = renderMarkdown(i.description, { image: linearImageNode });
  if (i.description_truncated) {
    return h("section", {}, head, h("div", { class: "tl-desc md" }, ...md), link("Edit in Linear ↗", i.url, "link small"));
  }
  const open = (e: Event) => {
    if ((e.target as HTMLElement).closest("a, img") || ((e as MouseEvent).detail > 0 && window.getSelection()?.toString())) return;
    openEdit(key, i.description);
  };
  return h("section", {}, head, i.description.trim()
    ? h("div", { class: "tl-desc md editable", "data-pane": "description", title: "Edit (⇧E)", onclick: open }, ...md)
    : h("button", { class: "add-text", "data-pane": "description", onclick: open }, "Add a description"));
}

async function saveDescription(i: IssuePreview, box: HTMLTextAreaElement) {
  const key = `${i.id}:description`;
  const text = paneDrafts.get(key);
  if (text === undefined || ctx.state.busy.has(key)) return;
  if (text.trim() === i.description.trim()) {     // unchanged: close the editor where it sits
    paneDrafts.delete(key);
    ctx.afterPointer(() => box.closest("section")?.replaceWith(descriptionSection(i)));
    return;
  }
  // No render() before the request (see saveTitle): this can run from a blur.
  ctx.state.busy.add(key);
  box.readOnly = true;
  box.nextElementSibling?.replaceChildren("Saving…");
  const saved = await ctx.editIssue(i, { description: text }, false);
  ctx.state.busy.delete(key);
  if (saved) paneDrafts.delete(key);          // a failed save keeps the box open with your text
  showAfterLeaving(key, "section", () => descriptionSection(details.get(i.id)?.issue ?? i));
}

/** The issue's sub-issues from Linear, done ones too. Tick one to mark it done (untick: back to
 *  Todo); a canceled one, or one in another team, shows its status without a box. Type in "Add sub-issue"
 *  (⇧S) and press Enter; the box stays ready for the next. */
function subIssuesSection(i: IssuePreview): HTMLElement {
  const today = localToday();
  const key = `${i.id}:sub`;
  const subs = i.sub_issues;
  return h("section", {},
    subs.length ? h("h4", {}, `Sub-issues · ${subs.length}`) : "",
    subs.length ? h("ul", { class: "tl-subs" }, ...subs.map((s) => {
      const done = s.state.type === "completed";
      const open = isOpen(s);
      // Canceled and duplicate ones are closed but not done: no box, like another team's.
      return h("li", { class: open ? "" : "closed" },
        s.own_team && (open || done)
          ? h("input", { type: "checkbox", checked: done, disabled: ctx.state.busy.has(`${s.id}:tick`), title: done ? "Reopen" : "Mark done",
              "aria-label": `${done ? "Reopen" : "Mark done"}: ${s.identifier}`, "data-focus": s.id,
              onchange: () => void tickSubIssue(i, s) })
          : h("span", { class: "sub-gap", "aria-hidden": "true" }),
        link(s.identifier, s.url, "ident"),
        h("span", { class: "dtitle" }, s.title),
        open && s.due_date && s.due_date < today
          ? h("span", { class: "late small" }, dueLabel(s.due_date, today).replace("overdue", "late")) : "",
        h("span", { class: "muted small" }, s.assignee && s.assignee !== i.assignee ? `${s.state.name} · ${s.assignee}` : s.state.name));
    })) : "",
    h("input", {
      class: "sub-add", placeholder: "+ Add sub-issue", maxLength: 200, value: paneDrafts.get(key) ?? "", readOnly: ctx.state.busy.has(key),
      "aria-label": `Add sub-issue to ${i.identifier}`, "data-pane": "sub", "data-edit": key,
      oninput: (e: Event) => { paneDrafts.set(key, (e.target as HTMLInputElement).value); forgetPost(key); },
      onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void addSubIssue(i); } },
    }));
}

/** Tick: Done (doneStatus), as Mark done uses; untick: Todo (todoStatus). */
async function tickSubIssue(parent: IssuePreview, sub: SubIssue) {
  const key = `${sub.id}:tick`;
  const done = sub.state.type !== "completed";
  const to = done ? ctx.doneStatus() : ctx.todoStatus();
  if (!to) { ctx.toast(`Couldn't find a ${done ? "done" : "to-do"} status for this team`); ctx.render(); return; }
  // The pane's copy shows the new status at once; the reload after the save confirms it.
  const show = (st: SubIssue["state"]) => {
    const d = details.get(parent.id);
    if (d?.issue) d.issue = { ...d.issue, sub_issues: d.issue.sub_issues.map((x) => (x.id === sub.id ? { ...x, state: st } : x)) };
  };
  const reload = async () => { loadDetail(parent.id, true); await ctx.loadIssues().catch(() => undefined); };
  if (done) ctx.state.briefAt = 0;               // the wrap-up's "done today" should include it
  ctx.state.busy.add(key);
  show(to);
  ctx.render();
  try {
    await api.editIssue(sub.id, { state_id: to.id });
    ctx.offerUndo(`${sub.identifier} ${done ? "done" : `moved to ${to.name}`}`, `${sub.identifier} back to ${sub.state.name}`, async () => {
      await api.editIssue(sub.id, { state_id: sub.state.id });
      show(sub.state);
      await reload();
    });
    await reload();
  } catch (e) {
    show(sub.state);
    ctx.fail(e);
  } finally {
    ctx.state.busy.delete(key);
    ctx.render();
  }
}

// The comment or sub-issue box the last post emptied: ⌘Z there undoes that post, until you type in it.
let emptiedBy: { key: string; entry: UndoEntry } | null = null;

function forgetPost(key: string) {
  if (emptiedBy?.key === key) emptiedBy = null;
}

/** The post ⌘Z in ``el`` should undo: ``el`` is the box that post emptied, still empty, and the post
 *  can still be undone. */
export function postToUndoIn(el: Element | null): UndoEntry | null {
  if (!emptiedBy || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null;
  if (el.dataset.edit !== emptiedBy.key || el.value !== "" || !ctx.canUndo(emptiedBy.entry)) return null;
  return emptiedBy.entry;
}

async function addSubIssue(parent: IssuePreview) {
  const key = `${parent.id}:sub`;
  const title = paneDrafts.get(key)?.trim();
  if (!title || ctx.state.busy.has(key)) return;
  ctx.state.busy.add(key);
  ctx.render();
  try {
    const sub = await api.addSubIssue(parent.id, title);
    paneDrafts.delete(key);
    ctx.state.issues = [sub, ...ctx.state.issues];
    loadDetail(parent.id, true);
    emptiedBy = { key, entry: ctx.offerUndo(`${sub.identifier} added under ${parent.identifier}`, `${sub.identifier} deleted`, async () => {
      await api.deleteIssue(sub.id);
      ctx.state.issues = ctx.state.issues.filter((x) => x.id !== sub.id);
      if (!paneDrafts.get(key)?.trim()) paneDrafts.set(key, title);  // back in the box, to fix and add again
      loadDetail(parent.id, true);
    }) };
  } catch (e) {
    ctx.fail(e);                                   // the title stays in the box
  } finally {
    ctx.state.busy.delete(key);
    ctx.render();
  }
}

const COMMENT_MAX = 2000;      // the backend's limit, the same as an Inbox comment

/** A box to comment as you (⇧C; ⌘↵ posts), then the latest comments, newest first. */
function commentsSection(i: IssuePreview): HTMLElement {
  const key = `${i.id}:comment`;
  const busy = ctx.state.busy.has(key);
  const count = h("span", { class: "small" });
  const showCount = (text: string) => {
    const room = COMMENT_MAX - text.trim().length;
    count.textContent = room <= 200 ? String(room) : "";
    count.className = `small ${room < 0 ? "late" : "muted"}`;
  };
  const draft = paneDrafts.get(key) ?? "";
  showCount(draft);
  const shown = [...i.comments].sort((x, y) => (y.created_at ?? "").localeCompare(x.created_at ?? ""));
  const older = i.comment_count - shown.length;
  return h("section", {}, h("h4", {}, `Comments${i.comment_count ? ` · ${i.comment_count}` : ""}`),
    h("div", { class: "comment-box" },
      h("textarea", {
        class: "comment-input", rows: 2, placeholder: "Comment…", value: draft, readOnly: busy,
        "aria-label": `Comment on ${i.identifier}`, "data-pane": "comment", "data-edit": key,
        oninput: (e: Event) => {
          const v = (e.target as HTMLTextAreaElement).value;
          paneDrafts.set(key, v);
          forgetPost(key);
          showCount(v);
        },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void postComment(i); }
        },
      }),
      h("span", { class: "comment-hint muted small" }, busy ? "Posting…" : "⌘↵ posts it, as you", count)),
    shown.length ? h("div", {}, ...shown.map((c) => h("div", { class: "tl-comment" },
      h("span", {}, h("b", {}, c.author), " ", h("span", { class: "muted small" }, c.created_at ? when(c.created_at) : "")),
      h("div", { class: "tl-comment-body md" }, ...renderMarkdown(c.body, { image: linearImageNode }))))) : "",
    older > 0 ? link(`${older} older in Linear ↗`, i.url, "link small") : "");
}

async function postComment(i: IssuePreview) {
  const key = `${i.id}:comment`;
  const body = paneDrafts.get(key)?.trim();
  if (!body || body.length > COMMENT_MAX || ctx.state.busy.has(key)) return;
  ctx.state.busy.add(key);
  ctx.render();
  try {
    const { id } = await api.addComment(i.id, body);
    paneDrafts.delete(key);
    loadDetail(i.id, true);
    emptiedBy = { key, entry: ctx.offerUndo(`Comment posted on ${i.identifier}`, `comment on ${i.identifier} deleted`, async () => {
      await api.deleteComment(id);
      if (!paneDrafts.get(key)?.trim()) paneDrafts.set(key, body);   // back in the box, to fix and post again
      loadDetail(i.id, true);
    }) };
  } catch (e) {
    ctx.fail(e);                                   // the text stays in the box
  } finally {
    ctx.state.busy.delete(key);
    ctx.render();
  }
}

/** e, ⇧E, ⇧S, ⇧C and p in Today, Client and Dev: rename, edit the description, add a sub-issue,
 *  comment, start in periscope. */
const PANE_KEYS: Record<string, string> = { e: "title", E: "description", S: "sub", C: "comment", p: "periscope" };

export function paneKey(key: string): boolean {
  const target = PANE_KEYS[key];
  const el = target ? document.querySelector<HTMLElement>(`:is(.td-st, .tl-pane) [data-pane="${target}"]`) : null;
  if (!el) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus();
  else el.click();
  return true;
}
