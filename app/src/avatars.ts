// Task icons: the client's logo (or a generic company logo when it isn't known), with a small task-type badge; or, for work
// with no client, the task-type icon on its own.
import { api } from "./api";
import { h } from "./dom";

export type Category = "code" | "analysis" | "model" | "review" | "meeting" | "email" | "writing" | "admin";

export const CATEGORY_NAME: Record<Category, string> = {
  code: "Code / dev", analysis: "Analysis / data", model: "Model work", review: "Review",
  meeting: "Meeting", email: "Email / reply", writing: "Writing / docs", admin: "Admin / ops",
};

// 16×16 line drawings, stroked in the category color.
const ICONS: Record<Category, { d?: string[]; dots?: [number, number, number][] }> = {
  code: { d: ["M5.5 4.5 2 8l3.5 3.5", "M10.5 4.5 14 8l-3.5 3.5"] },
  analysis: { d: ["M2.5 13.5h11", "M4.5 11V8", "M8 11V3.5", "M11.5 11V6"] },
  model: { d: ["M4 4l8 4-8 4", "M4 4v8"], dots: [[4, 4, 1.7], [12, 8, 1.7], [4, 12, 1.7]] },
  review: { d: ["M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"], dots: [[8, 8, 1.9]] },
  meeting: { d: ["M2.5 4.5h11v9h-11z", "M2.5 7.5h11", "M5.5 2.5v3", "M10.5 2.5v3"] },
  email: { d: ["M2 4h12v8.5H2z", "M2.5 4.5 8 9l5.5-4.5"] },
  writing: { d: ["M4 2h5.5L12.5 5v9H4z", "M9.5 2v3h3", "M6 8.5h4.5", "M6 11h4.5"] },
  admin: { d: ["M2.5 5h11", "M2.5 11h11"], dots: [[6, 5, 1.9], [10.5, 11, 1.9]] },
};

const NS = "http://www.w3.org/2000/svg";
export const CATEGORIES = Object.keys(CATEGORY_NAME) as Category[];

/** The line icon for a task type, in the current text color. */
export function categoryIcon(cat: Category, px: number): SVGElement {
  return icon(cat, px);
}

function icon(cat: Category, px: number): SVGElement {
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 16 16", width: px, height: px, fill: "none",
    stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round",
    "aria-hidden": "true" })) svg.setAttribute(k, String(v));
  const spec = ICONS[cat] ?? ICONS.admin;
  for (const d of spec.d ?? []) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  for (const [cx, cy, r] of spec.dots ?? []) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", String(cx)); c.setAttribute("cy", String(cy)); c.setAttribute("r", String(r));
    c.setAttribute("class", "dot-fill");
    svg.append(c);
  }
  return svg;
}

// ---- client logos -------------------------------------------------------------------------------
const logos = new Map<string, string | null>();
const asked = new Set<string>();

/** Fetch logos for clients not seen yet, then swap them into the icons already on screen.
 *  The swap is done in place, so it works even while you're typing in a field. */
export function ensureLogos(clients: (string | null | undefined)[]) {
  const missing = [...new Set(clients.filter((c): c is string => !!c && !asked.has(c)))];
  if (!missing.length) return;
  missing.forEach((c) => asked.add(c));
  api.logos(missing)
    .then((found) => {
      for (const c of missing) logos.set(c, found[c] ?? null);
      applyLogos();
    })
    // Backend not ready or failing: forget these so the next render asks again.
    .catch(() => missing.forEach((c) => asked.delete(c)));
}

function applyLogos() {
  for (const mark of document.querySelectorAll<HTMLElement>(".mark.anon[data-client]")) {
    const uri = logos.get(mark.dataset.client!);
    if (uri) mark.replaceWith(logoMark(uri));
  }
}

function logoMark(uri: string): HTMLElement {
  return h("span", { class: "mark logo" }, h("img", { src: uri, alt: "" }));
}

// The generic company logo: a plain building, used whenever a client's own logo isn't known
// (no website on file, or the site has no usable icon). It names no brand.
const ANON = ["M3.5 14V3.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1V14", "M10.5 6.5h2a1 1 0 0 1 1 1V14",
  "M2 14h12", "M5.75 5h1.5", "M5.75 7.75h1.5", "M5.75 10.5h1.5", "M7 14v-1.75"];

function anonMark(px: number, client: string): HTMLElement {
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 16 16", width: px, height: px, fill: "none",
    stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round",
    "aria-hidden": "true" })) svg.setAttribute(k, String(v));
  for (const d of ANON) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return h("span", { class: "mark anon", "data-client": client }, svg);
}

function clientMark(client: string, size: "lg" | "sm"): HTMLElement {
  const uri = logos.get(client);
  return uri ? logoMark(uri) : anonMark(size === "lg" ? 18 : 12, client);
}

/** A client's logo (or its generic mark) without the task-type badge. */
export function clientLogo(client: string): HTMLElement {
  return h("span", { class: "avatar sm", title: client }, clientMark(client, "sm"));
}

/** A client or a project; null is none ("No project", "No client or project"). */
export type Group = { kind: "client" | "project"; name: string } | null;
/** A group's mark in group headings and lists: the client's logo, the project's initial, or "–". */
export function groupMark(g: Group): HTMLElement {
  return g?.kind === "client" ? clientLogo(g.name)
    : h("span", { class: "ll-initial", "aria-hidden": "true" }, g ? g.name.slice(0, 1).toUpperCase() : "–");
}

/** The icon for a task: client logo + type badge, or the type icon alone. */
export function taskAvatar(client: string | null | undefined, category: string | null | undefined,
                           size: "lg" | "sm" = "lg"): HTMLElement {
  const cat = (category && category in ICONS ? category : "admin") as Category;
  const title = client ? `${client} · ${CATEGORY_NAME[cat]}` : CATEGORY_NAME[cat];
  if (!client) {
    return h("span", { class: `avatar ${size}`, title, "aria-label": title },
      h("span", { class: `mark cat cat-${cat}` }, icon(cat, size === "lg" ? 18 : 13)));
  }
  return h("span", { class: `avatar ${size}`, title, "aria-label": title },
    clientMark(client, size),
    h("span", { class: `badge cat-${cat}` }, icon(cat, size === "lg" ? 10 : 8)));
}
