// Light / dark / follow-the-Mac theme, remembered on this Mac.
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "todohub.theme";
const ORDER: ThemeChoice[] = ["system", "light", "dark"];
const LABEL: Record<ThemeChoice, string> = { system: "Theme: follow the Mac", light: "Theme: light", dark: "Theme: dark" };

export function currentTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable: follow the Mac */
  }
  return "system";
}

export function applyTheme(choice: ThemeChoice = currentTheme()) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  // Match the native title bar too (no-op outside the Tauri app).
  try {
    if ("__TAURI_INTERNALS__" in window) {
      void getCurrentWindow().setTheme(choice === "system" ? null : choice).catch(() => undefined);
    }
  } catch {
    /* the page theme above is what matters; never let the title bar break startup */
  }
}

/** Cycle System → Light → Dark and remember the choice. Returns the new choice. */
export function nextTheme(): ThemeChoice {
  const next = ORDER[(ORDER.indexOf(currentTheme()) + 1) % ORDER.length];
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* still applies for this session */
  }
  applyTheme(next);
  return next;
}

export function themeLabel(choice: ThemeChoice = currentTheme()) {
  return { choice, label: LABEL[choice] };
}

const NS = "http://www.w3.org/2000/svg";
function el(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** A 16px line icon in the current text color: half circle, sun, or moon. */
export function themeIcon(choice: ThemeChoice = currentTheme()): SVGElement {
  const svg = el("svg", { viewBox: "0 0 16 16", width: "14", height: "14", fill: "none", stroke: "currentColor",
    "stroke-width": "1.5", "stroke-linecap": "round", "aria-hidden": "true" });
  if (choice === "system") {
    svg.append(el("circle", { cx: "8", cy: "8", r: "5.5" }), el("path", { d: "M8 2.5a5.5 5.5 0 0 1 0 11z", fill: "currentColor" }));
  } else if (choice === "light") {
    svg.append(el("circle", { cx: "8", cy: "8", r: "3" }));
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const x = (r: number) => (8 + r * Math.cos(a)).toFixed(2);
      const y = (r: number) => (8 + r * Math.sin(a)).toFixed(2);
      svg.append(el("line", { x1: x(5), y1: y(5), x2: x(6.8), y2: y(6.8) }));
    }
  } else {
    svg.append(el("path", { d: "M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z" }));
  }
  return svg;
}
