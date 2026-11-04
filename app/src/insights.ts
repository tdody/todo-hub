// Insights tab: client vs dev balance, approval rate, and sweep history.
import { api, ApiError } from "./api";
import type { ApprovalStats, BalanceStats, Run } from "./api";
import { h, modal, svg } from "./dom";

const REASONS: Record<string, string> = {
  not_mine: "Not mine", already_done: "Already done", noise: "Not a task", duplicate: "Duplicate", other: "Other",
};
const SOURCES: Record<string, string> = {
  slack: "Slack", gmail: "Email", grain: "Grain", calendar: "Calendar", linear: "Linear", github: "GitHub", all: "All sources",
};

let cache: { at: number; balance?: BalanceStats; approval?: ApprovalStats; runs?: Run[]; error?: string } = { at: 0 };

function weekLabel(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" });
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "–" : `${Math.round(v * 100)}%`;
}

// ---- charts -----------------------------------------------------------------------------------
function balanceChart(b: BalanceStats): Node {
  const W = 860, H = 190, top = 22, bottom = 36, left = 38, right = 78;
  const plotH = H - top - bottom;
  const n = b.weeks.length;
  const band = (W - left - right) / n;
  const barW = Math.min(46, band * 0.6);
  const y = (share: number) => top + plotH * (1 - share);
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img",
    "aria-label": "Share of completed issues that were client work, per week" });
  for (const t of [0, 0.5, 1]) {
    g.append(svg("text", { x: left - 6, y: y(t) + 4, class: "axis", "text-anchor": "end" }, `${t * 100}%`));
  }
  b.weeks.forEach((w, i) => {
    const x = left + band * i + (band - barW) / 2;
    const total = w.client + w.dev;
    if (!total) {
      g.append(svg("rect", { x, y: top, width: barW, height: plotH, class: "bar-empty", rx: 3 }));
    } else {
      const share = w.client / total;
      g.append(svg("rect", { x, y: top, width: barW, height: plotH * (1 - share), class: "bar-dev", rx: 3 },
        svg("title", {}, `${weekLabel(w.week)}: ${w.dev} dev`)));
      g.append(svg("rect", { x, y: y(share), width: barW, height: plotH * share, class: "bar-client", rx: 3 },
        svg("title", {}, `${weekLabel(w.week)}: ${w.client} client`)));
      g.append(svg("text", { x: x + barW / 2, y: top - 7, class: "value", "text-anchor": "middle" }, pct(share)));
    }
    g.append(svg("text", { x: x + barW / 2, y: H - bottom + 16, class: "axis", "text-anchor": "middle" }, weekLabel(w.week)));
    g.append(svg("text", { x: x + barW / 2, y: H - bottom + 29, class: "axis faint", "text-anchor": "middle" },
      total ? `${total} done` : "none"));
  });
  // target line drawn last so it sits on top of the bars
  g.append(svg("line", { x1: left, x2: W - right + 6, y1: y(b.target), y2: y(b.target), class: "target" }));
  g.append(svg("text", { x: W - right + 12, y: y(b.target) + 4, class: "axis" }, `target ${pct(b.target)}`));
  return g;
}

function approvalChart(a: ApprovalStats): Node {
  const W = 860, H = 170, top = 16, bottom = 24, left = 38, right = 78;
  const plotH = H - top - bottom;
  const n = a.weeks.length;
  const band = (W - left - right) / n;
  const x = (i: number) => left + band * i + band / 2;   // same columns as the balance chart
  const y = (r: number) => top + plotH * (1 - r);
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Weekly approval rate, all sources" });
  for (const t of [0, 0.5, 1]) {
    g.append(svg("line", { x1: left, x2: W - right + 6, y1: y(t), y2: y(t), class: "grid" }));
    g.append(svg("text", { x: left - 6, y: y(t) + 4, class: "axis", "text-anchor": "end" }, `${t * 100}%`));
  }
  const pts = a.weeks.map((w, i) => ({ i, r: w.sources.all?.rate ?? null, w }));
  let d = "";
  let pen = false;
  for (const p of pts) {
    if (p.r === null) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${x(p.i)},${y(p.r)} `;
    pen = true;
  }
  if (d) g.append(svg("path", { d, class: "line" }));
  for (const p of pts) {
    g.append(svg("text", { x: x(p.i), y: H - 6, class: "axis", "text-anchor": "middle" }, weekLabel(p.w.week)));
    if (p.r === null) continue;
    const all = p.w.sources.all;
    g.append(svg("circle", { cx: x(p.i), cy: y(p.r), r: 4, class: "dot-pt" },
      svg("title", {}, `${weekLabel(p.w.week)}: ${pct(p.r)} (${all.approved} kept, ${all.dropped} dropped)`)));
  }
  return g;
}

function approvalTable(a: ApprovalStats): Node {
  const sources = Object.keys(a.weeks.at(-1)?.sources ?? {}).filter((s) => s !== "all");
  if (!sources.length) return h("p", { class: "muted small" }, "No decisions yet.");
  const recent = a.weeks.slice(-4);
  return h("table", { class: "stats" },
    h("thead", {}, h("tr", {}, h("th", {}, "Source"), ...recent.map((w) => h("th", {}, weekLabel(w.week))))),
    h("tbody", {}, ...[...sources, "all"].map((s) =>
      h("tr", { class: s === "all" ? "total" : "" }, h("td", {}, SOURCES[s] ?? s), ...recent.map((w) => {
        const c = w.sources[s];
        return h("td", { title: c ? `${c.approved} kept, ${c.dropped} dropped` : "" },
          pct(c?.rate), c && c.approved + c.dropped ? h("span", { class: "muted small" }, ` (${c.approved + c.dropped})`) : "");
      })))),
  );
}

function reasonBars(a: ApprovalStats): Node {
  const entries = Object.entries(a.drop_reasons).sort((x, y) => y[1] - x[1]);
  if (!entries.length) return h("p", { class: "muted small" }, "Nothing dropped in this period.");
  const max = Math.max(...entries.map((e) => e[1]));
  return h("div", { class: "reasons" }, ...entries.map(([k, v]) =>
    h("div", { class: "reason" }, h("span", {}, REASONS[k] ?? k),
      h("span", { class: "reason-bar", style: `width:${Math.max(4, (v / max) * 100)}%` }),
      h("span", { class: "muted small" }, String(v)))));
}

// ---- runs ---------------------------------------------------------------------------------------
async function showLog(run: Run) {
  try {
    const log = await api.runLog(run.id!);
    modal(`Log: ${run.trigger} run ${run.id}`,
      log.missing ? h("p", { class: "muted" }, "The log file is gone.")
                  : h("pre", { class: "log" }, (log.truncated ? "…(start cut)\n" : "") + log.text));
  } catch (e) {
    modal("Log", h("p", {}, e instanceof ApiError ? e.message : String(e)));
  }
}

function runsTable(runs: Run[]): Node {
  if (!runs.length) return h("p", { class: "muted small" }, "No runs yet.");
  return h("table", { class: "stats runs" },
    h("thead", {}, h("tr", {}, ...["When", "Kind", "Status", "Added", "Cost", "Turns", "Note", ""].map((t) => h("th", {}, t)))),
    h("tbody", {}, ...runs.map((r) => {
      const failed = (r.sources ?? []).filter((s) => !s.ok).map((s) => SOURCES[s.source] ?? s.source);
      const note = r.error ?? (failed.length ? `Problem: ${failed.join(", ")}` : "");
      return h("tr", {},
        h("td", {}, new Date(r.started_at!).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })),
        h("td", {}, r.trigger === "schedule" ? "Scheduled" : r.trigger === "capture" ? "Capture" : "Run now"),
        h("td", { class: `run-${r.status}` }, r.status === "ok" ? "OK" : r.status === "running" ? "Running" : "Failed"),
        h("td", { class: "num" }, String(r.added ?? 0)),
        h("td", { class: "num" }, r.cost_usd != null ? `$${r.cost_usd.toFixed(2)}` : "–"),
        h("td", { class: "num" }, r.num_turns != null ? String(r.num_turns) : "–"),
        h("td", { class: "note", title: note }, note),
        h("td", {}, h("button", { class: "ghost small-btn", onclick: () => void showLog(r) }, "Log")),
      );
    })),
  );
}

// ---- view ---------------------------------------------------------------------------------------
async function load(rerender: () => void) {
  try {
    const [balance, approval, runs] = await Promise.all([api.balance(8), api.approval(8), api.runs(30)]);
    cache = { at: Date.now(), balance, approval, runs };
  } catch (e) {
    cache = { ...cache, at: Date.now(), error: e instanceof ApiError ? e.message : String(e) };
  }
  rerender();
}

export function insightsView(rerender: () => void): HTMLElement {
  if (Date.now() - cache.at > 60_000) {
    if (!cache.balance) cache.at = Date.now();   // avoid a burst of loads while the first one runs
    void load(rerender);
  }
  if (!cache.balance || !cache.approval || !cache.runs) {
    return h("div", { class: "empty" }, h("p", { class: "muted" }, cache.error ?? "Loading…"));
  }
  const b = cache.balance;
  const thisWeek = b.weeks.at(-1)!;
  const done8 = b.weeks.reduce((n, w) => n + w.client + w.dev, 0);
  const client8 = b.weeks.reduce((n, w) => n + w.client, 0);
  const a = cache.approval;
  const allNow = a.weeks.at(-1)?.sources.all;
  const cost = cache.runs.filter((r) => Date.now() - Date.parse(r.started_at!) < 7 * 864e5)
    .reduce((n, r) => n + (r.cost_usd ?? 0), 0);

  return h("div", { class: "insights" },
    cache.error ? h("div", { class: "banner error" }, cache.error) : "",
    h("section", { class: "panel" },
      h("h2", {}, "Client vs dev"),
      h("p", { class: "lead" },
        done8 ? `${pct(client8 / done8)} of the ${done8} issues you completed in the last 8 weeks were client work (target ${pct(b.target)}).`
              : "No completed issues in the last 8 weeks yet.",
        thisWeek.client + thisWeek.dev ? ` This week so far: ${pct(thisWeek.client_share)}.` : ""),
      h("div", { class: "legend" },
        h("span", { class: "key key-client" }), "Client", h("span", { class: "key key-dev" }), "Dev",
        h("span", { class: "key key-target" }), "Target"),
      balanceChart(b),
      h("p", { class: "muted small" }, "Share of your completed (not canceled) Linear issues each week, Monday to Sunday. Client = has a client label."),
    ),
    h("section", { class: "panel" },
      h("h2", {}, "Approval rate"),
      h("p", { class: "lead" }, allNow && allNow.rate !== null
        ? `${pct(allNow.rate)} of the candidates you decided this week were kept (${allNow.approved} of ${allNow.approved + allNow.dropped}).`
        : "No decisions this week yet."),
      approvalChart(a),
      h("div", { class: "two-col" },
        h("div", {}, h("h3", {}, "By source, last 4 weeks"), approvalTable(a)),
        h("div", {}, h("h3", {}, "Why you dropped, 8 weeks"), reasonBars(a)),
      ),
      h("p", { class: "muted small" }, "Approved ÷ (approved + dropped), for candidates decided that week. Captured notes aren't counted."),
    ),
    h("section", { class: "panel" },
      h("h2", {}, "Sweep history"),
      h("p", { class: "lead" }, `Last 7 days: ${cache.runs.filter((r) => Date.now() - Date.parse(r.started_at!) < 7 * 864e5).length} runs, $${cost.toFixed(2)} at list price.`),
      runsTable(cache.runs),
    ),
  );
}

export function invalidateInsights() {
  cache = { ...cache, at: 0 };
}
