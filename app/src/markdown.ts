// A small Markdown renderer for Linear descriptions and comments. It builds DOM nodes directly and
// never parses HTML, so text from Linear can't inject markup or scripts into the app. It covers what
// Linear writes: headings, paragraphs, bold, italic, strikethrough, inline code, code blocks, links
// (http, https, mailto only), images (drawn through the ``image`` hook when given one, else a link),
// bullet, numbered and checkbox lists with
// nesting, block quotes, rules and simple tables. Anything else stays as plain text.
import { h, link } from "./dom";

type Inline = Node | string;
export type ImageHook = (alt: string, url: string) => Node | null;

let imageHook: ImageHook | null = null;       // set for the length of one renderMarkdown call

const SAFE_URL = /^(https?:|mailto:)/i;

function safeLink(text: Inline[], url: string): Inline {
  const u = url.trim();
  if (!SAFE_URL.test(u)) return h("span", {}, ...text);
  const a = link("", u, "link");
  a.replaceChildren(...text);
  a.title = u;
  return a;
}

// ---- inline -------------------------------------------------------------------------------------
// Earliest match wins; ties go to the pattern listed first.
const INLINE: { re: RegExp; make: (m: RegExpExecArray) => Inline }[] = [
  { re: /\\([\\`*_{}\[\]()#+\-.!~>|])/, make: (m) => m[1] },
  { re: /`([^`\n]+)`/, make: (m) => h("code", {}, m[1]) },
  // Link targets may hold one level of parentheses (Wikipedia-style URLs).
  { re: /!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/, make: (m) => imageHook?.(m[1], m[2]) ?? safeLink([`Image${m[1] ? `: ${m[1]}` : ""} ↗`], m[2]) },
  // Linear can write the target in angle brackets: [text](<url>).
  { re: /\[([^\]]+)\]\((?:<([^>\s]+)>|((?:[^()\s]|\([^()\s]*\))+))(?:\s+"[^"]*")?\)/, make: (m) => safeLink(inline(m[1]), m[2] ?? m[3]) },
  { re: /<((?:https?:\/\/|mailto:)[^>\s]+)>/, make: (m) => safeLink([m[1]], m[1]) },
  { re: /\*\*(?=\S)([\s\S]*?\S)\*\*/, make: (m) => h("strong", {}, ...inline(m[1])) },
  { re: /__(?=\S)([\s\S]*?\S)__/, make: (m) => h("strong", {}, ...inline(m[1])) },
  { re: /~~(?=\S)([\s\S]*?\S)~~/, make: (m) => h("s", {}, ...inline(m[1])) },
  { re: /\*(?=[^\s*])([^*\n]*?[^\s*])\*/, make: (m) => h("em", {}, ...inline(m[1])) },
  // _italic_, but not snake_case words (no lookbehind: older Safari doesn't have it).
  { re: /(^|[^A-Za-z0-9])_(?=[^\s_])([^_\n]*?[^\s_])_(?![A-Za-z0-9])/, make: (m) => {
    const f = document.createDocumentFragment();
    f.append(m[1], h("em", {}, ...inline(m[2])));
    return f;
  } },
  { re: /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/, make: (m) => safeLink([m[0]], m[0]) },
];

export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    let best: { at: number; m: RegExpExecArray; make: (m: RegExpExecArray) => Inline } | null = null;
    for (const p of INLINE) {
      const m = p.re.exec(rest);
      if (m && (!best || m.index < best.at)) best = { at: m.index, m, make: p.make };
    }
    if (!best) { out.push(rest); break; }
    if (best.at) out.push(rest.slice(0, best.at));
    out.push(best.make(best.m));
    rest = rest.slice(best.at + best.m[0].length);
  }
  return out;
}

/** Inline text where single line breaks stay line breaks (as Linear shows them). */
function lines(text: string): Inline[] {
  const out: Inline[] = [];
  text.split("\n").forEach((l, n) => { if (n) out.push(h("br", {})); out.push(...inline(l)); });
  return out;
}

// ---- blocks -------------------------------------------------------------------------------------
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function indentOf(s: string): number {
  return s.replace(/\t/g, "    ").match(/^ */)![0].length;
}

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** A list starting at lines[i], at the indent of that line; returns the element and the next line. */
function list(src: string[], i: number): [HTMLElement, number] {
  const base = indentOf(src[i]);
  const ordered = /^\d/.test(LIST_ITEM.exec(src[i])![2]);
  const el = h(ordered ? "ol" : "ul", {});
  const start = Number(LIST_ITEM.exec(src[i])![2].replace(/\D/g, ""));
  if (ordered && start > 1) el.setAttribute("start", String(start));
  while (i < src.length) {
    const m = LIST_ITEM.exec(src[i]);
    if (!m || indentOf(src[i]) < base || (indentOf(src[i]) === base && /^\d/.test(m[2]) !== ordered)) break;
    if (indentOf(src[i]) > base) {               // a nested list under the last item
      const [sub, next] = list(src, i);
      (el.lastElementChild ?? el).append(sub);
      i = next;
      continue;
    }
    let text = m[3];
    i++;
    // Continuation lines: indented further, not a new item.
    while (i < src.length && src[i].trim() && !LIST_ITEM.exec(src[i]) && indentOf(src[i]) > base) {
      text += "\n" + src[i].trim();
      i++;
    }
    const box = /^\[( |x|X)\]\s+(.*)$/s.exec(text);
    const li = box
      ? h("li", { class: `md-task${box[1] === " " ? "" : " done"}` },
          h("span", { class: "md-box", "aria-hidden": "true" }, box[1] === " " ? "○" : "✓"), h("span", {}, ...lines(box[2])))
      : h("li", {}, ...lines(text));
    el.append(li);
    while (i < src.length && !src[i].trim() && i + 1 < src.length && LIST_ITEM.exec(src[i + 1])
      && indentOf(src[i + 1]) >= base) i++;    // a blank line between items keeps the list going
  }
  return [el, i];
}

/** Markdown text as a list of block elements. ``image`` may draw an image (return null to leave it
 *  as a link). */
export function renderMarkdown(text: string, opts: { image?: ImageHook } = {}): HTMLElement[] {
  if (!opts.image) return blocks(text);
  const prev = imageHook;
  imageHook = opts.image;
  try { return blocks(text); } finally { imageHook = prev; }
}

function blocks(text: string): HTMLElement[] {
  const src = text.replace(/\r\n?/g, "\n").split("\n");
  const out: HTMLElement[] = [];
  let i = 0;
  while (i < src.length) {
    const line = src[i];
    if (!line.trim()) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < src.length && !src[i].trim().startsWith(fence[1])) body.push(src[i++]);
      i++;                                          // the closing fence (or the end, if it was cut)
      out.push(h("pre", {}, h("code", {}, body.join("\n"))));
      continue;
    }
    const head = HEADING.exec(line);
    if (head) {
      const level = Math.min(6, head[1].length + 2);   // # is a section title in a pane, not a page title
      out.push(h(`h${level}` as "h3", { class: "md-h" }, ...inline(head[2])));
      i++;
      continue;
    }
    if (RULE.test(line)) { out.push(h("hr", {})); i++; continue; }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < src.length && QUOTE.test(src[i])) body.push(QUOTE.exec(src[i++])![1]);
      out.push(h("blockquote", {}, ...blocks(body.join("\n"))));
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const [el, next] = list(src, i);
      out.push(el);
      i = next;
      continue;
    }
    if (line.includes("|") && i + 1 < src.length && TABLE_SEP.test(src[i + 1])) {
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < src.length && src[i].includes("|") && src[i].trim()) rows.push(cells(src[i++]));
      out.push(h("div", { class: "md-table" }, h("table", {},
        h("thead", {}, h("tr", {}, ...header.map((c) => h("th", {}, ...inline(c))))),
        h("tbody", {}, ...rows.map((r) => h("tr", {}, ...header.map((_, n) => h("td", {}, ...inline(r[n] ?? "")))))))));
      continue;
    }
    // A paragraph: lines up to a blank line or the start of another block.
    const body: string[] = [];
    while (i < src.length && src[i].trim() && !FENCE.test(src[i]) && !HEADING.test(src[i]) && !RULE.test(src[i])
      && !QUOTE.test(src[i]) && !(body.length && LIST_ITEM.test(src[i]))) body.push(src[i++]);
    out.push(h("p", {}, ...lines(body.join("\n"))));
  }
  return out;
}
