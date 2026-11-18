// The sidebar's frame, remembered on this Mac: its width (drag its right edge) and the icon column
// (the hide button or ⌃⌘S; a window 820px or narrower always has it). main.ts renders what is inside.
import { h, loadPref, savePref, svg } from "./dom";

const WIDTH_KEY = "todohub.sidebarWidth";
const COLLAPSED_KEY = "todohub.sidebarCollapsed";
const DEFAULT_WIDTH = 224;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const narrow = matchMedia("(max-width: 820px)");     // styles.css hides the hide button at the same width
const SIDEBAR_ICON = "M4.5 3.5h11A1.5 1.5 0 0 1 17 5v10a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15V5a1.5 1.5 0 0 1 1.5-1.5zM8 3.5v13";

let width = DEFAULT_WIDTH;
let collapsed = false;
let rerender: () => void;

function app(): HTMLElement {
  return document.querySelector<HTMLElement>("#app")!;
}

/** Kept between 200 and 400px. styles.css also caps it, so the page keeps 600px of the window. */
function setWidth(px: number) {
  width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px)));
  app().style.setProperty("--side-w", `${width}px`);
}

function applyIconColumn() {
  app().classList.toggle("side-icons", collapsed || narrow.matches);
}

/** Before the first render. ``rerender`` re-renders the sidebar, so the hide button's label follows. */
export function setupSidebar(c: { rerender: () => void }) {
  rerender = c.rerender;
  collapsed = loadPref(COLLAPSED_KEY) === "1";
  setWidth(Number(loadPref(WIDTH_KEY)) || DEFAULT_WIDTH);
  applyIconColumn();
  narrow.addEventListener("change", applyIconColumn);
}

/** The hide button and ⌃⌘S: the icon column, or the full sidebar again. A narrow window keeps the icons. */
export function toggleSidebar() {
  if (narrow.matches) return;
  collapsed = !collapsed;
  savePref(COLLAPSED_KEY, collapsed ? "1" : "0");
  applyIconColumn();
  rerender();
}

/** The hide button: in the brand row after +, and under + in the icon column. */
export function hideButton(): HTMLElement {
  const label = collapsed ? "Show sidebar" : "Hide sidebar";
  return h("button", { class: "icon side-toggle", title: `${label} (⌃⌘S)`, "aria-label": label, onclick: toggleSidebar },
    svg("svg", { viewBox: "0 0 20 20", width: 18, height: 18, fill: "none", stroke: "currentColor",
      "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
      svg("path", { d: SIDEBAR_ICON })));
}

/** The sidebar follows the pointer; the width is saved when the pointer is released. */
function startDrag(e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();                        // no text selection while dragging
  const edge = e.currentTarget as HTMLElement;
  edge.setPointerCapture(e.pointerId);
  document.body.classList.add("side-drag");
  const follow = (m: PointerEvent) => setWidth(m.clientX);
  edge.addEventListener("pointermove", follow);
  edge.addEventListener("lostpointercapture", () => {
    edge.removeEventListener("pointermove", follow);
    document.body.classList.remove("side-drag");
    savePref(WIDTH_KEY, String(width));
  }, { once: true });
}

/** The drag edge on the sidebar's right side. It is beside the sidebar, not in it: renderHeader()
 *  replaces the sidebar's children, and that would stop a drag. A double-click sets 224px again.
 *  It is hidden from screen readers: the hide button and ⌃⌘S are the keyboard path. */
export function sidebarEdge(): HTMLElement {
  return h("div", {
    class: "side-edge", "aria-hidden": "true",
    onpointerdown: startDrag,
    ondblclick: () => { setWidth(DEFAULT_WIDTH); savePref(WIDTH_KEY, String(width)); },
  });
}
