// Tiny DOM helpers: text is always set as text, never parsed as HTML.
import { openUrl } from "@tauri-apps/plugin-opener";

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === "class") {
      el.className = String(v);
    } else if (k in el && k !== "list") {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** SVG element with attributes; children appended as nodes or text. */
export function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

export function link(text: string, url: string | null, cls = "link"): HTMLElement {
  if (!url) return h("span", { class: cls }, text);
  return h("a", { class: cls, href: url, onclick: (e: Event) => { e.preventDefault(); void openUrl(url); } }, text);
}

/** A simple dialog over the page. Esc or the backdrop closes it. */
export function modal(title: string, body: Node, actions: Node[] = []): () => void {
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  const overlay = h("div", { class: "overlay", onclick: (e: Event) => { if (e.target === overlay) close(); } },
    h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "dialog-head" }, h("h3", {}, title),
        h("button", { class: "icon", "aria-label": "Close", onclick: close }, "×")),
      body,
      actions.length ? h("div", { class: "dialog-actions" }, ...actions) : "",
    ),
  );
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  return close;
}
