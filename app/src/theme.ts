// Light / dark / follow-the-Mac / follow-the-day theme, remembered on this Mac.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { daylightLabel, daylightShort, startDaylight, stopDaylight } from "./daylight";

export type ThemeChoice = "system" | "light" | "dark" | "daylight";
const KEY = "todohub.theme";
const ORDER: ThemeChoice[] = ["system", "light", "dark", "daylight"];
const LABEL: Record<ThemeChoice, string> = {
  system: "Theme: follow the Mac", light: "Theme: light", dark: "Theme: dark", daylight: "Theme: daylight",
};

export function currentTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system" || v === "daylight") return v;
  } catch {
    /* storage unavailable: follow the Mac */
  }
  return "system";
}

function titleBar(theme: "light" | "dark" | null) {
  // Match the native title bar too (no-op outside the Tauri app).
  try {
    if ("__TAURI_INTERNALS__" in window) void getCurrentWindow().setTheme(theme).catch(() => undefined);
  } catch {
    /* the page theme is what matters; never let the title bar break startup */
  }
}

let onDaylightChange: (() => void) | undefined;

/** Called when Daylight moves to a new phase, so the theme button's tooltip can update. */
export function onDaylightPhase(fn: () => void) {
  onDaylightChange = fn;
}

export function applyTheme(choice: ThemeChoice = currentTheme()) {
  const root = document.documentElement;
  if (choice === "daylight") {
    let last = "";
    startDaylight((s) => {
      titleBar(s.dark ? "dark" : "light");
      if (last && last !== s.phase) onDaylightChange?.();
      last = s.phase;
    });
    return;
  }
  stopDaylight();
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  titleBar(choice === "system" ? null : choice);
}

/** Pick a theme and remember it. */
export function setTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* still applies for this session */
  }
  applyTheme(choice);
}

/** Cycle System → Light → Dark → Daylight (the t key) and remember the choice. Returns the new choice. */
export function nextTheme(): ThemeChoice {
  const next = ORDER[(ORDER.indexOf(currentTheme()) + 1) % ORDER.length];
  setTheme(next);
  return next;
}

/** The theme menu's rows, in cycling order: name and a short note. */
export function themeOptions(): { choice: ThemeChoice; name: string; note: string }[] {
  return [
    { choice: "system", name: "System", note: "follows the Mac" },
    { choice: "light", name: "Light", note: "" },
    { choice: "dark", name: "Dark", note: "" },
    { choice: "daylight", name: "Daylight", note: daylightShort() },
  ];
}

export function themeLabel(choice: ThemeChoice = currentTheme()) {
  return { choice, label: choice === "daylight" ? daylightLabel() : LABEL[choice] };
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
  } else if (choice === "dark") {
    svg.append(el("path", { d: "M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z" }));
  } else {
    // Daylight: a sun half below the horizon, like the logo.
    svg.append(el("path", { d: "M3.5 10.5a4.5 4.5 0 0 1 9 0" }), el("line", { x1: "1.5", y1: "10.5", x2: "14.5", y2: "10.5" }),
      el("line", { x1: "8", y1: "2.5", x2: "8", y2: "4" }), el("line", { x1: "3.2", y1: "4.7", x2: "4.2", y2: "5.7" }),
      el("line", { x1: "12.8", y1: "4.7", x2: "11.8", y2: "5.7" }), el("line", { x1: "5", y1: "13", x2: "11", y2: "13" }));
  }
  return svg;
}
