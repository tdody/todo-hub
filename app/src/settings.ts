// The Settings page: the style TodoHub opens with, the sources the sweep reads (add, pause,
// remove, check now), when the sweep runs on its own, and how the ⋯ menu's start items start Claude.
// Choices are saved by the backend in settings.json in the TodoHub folder and apply at once; nothing
// here can send anything.
import { api, ApiError } from "./api";
import type { AppSettings, Schedule, SettingsSource, Source, SourceState } from "./api";
import { daylightLocation, setDaylightLocation, sunTimes } from "./daylight";
import { h, link, pageHead } from "./dom";
import { applyTheme, currentTheme, setTheme, themeIcon } from "./theme";
import type { ThemeChoice } from "./theme";
import { checkForUpdate, RELEASES_URL, update, updatesOn } from "./update";

export interface SettingsCtx {
  rerender: () => void;              // this page
  themeChanged: () => void;          // the sidebar's theme button
  runNow: (source?: Source) => void;
  running: () => boolean;
  toast: (message: string) => void;
  metaChanged: () => void;           // a repo was added or removed: the ⋯ menus follow
  fail: (e: unknown) => void;
  when: (iso: string | null) => string;   // "10:02", "Fri 9:14"
}

let data: AppSettings | null = null;
let loadError = "";
let loading: Promise<void> | null = null;
let section = "appearance";
let busy = "";                       // the control waiting on the backend

/** Fetch the settings (on startup, so the sidebar knows the schedule, and on opening the page). */
export function loadSettings(): Promise<void> {
  loading ??= api.settings()
    .then((s) => { data = s; loadError = ""; })
    .catch((e) => { loadError = e instanceof ApiError ? e.message : String(e); })
    .finally(() => { loading = null; });
  return loading;
}

/** The sweep's schedule, once loaded: for "next 12pm" in the sidebar. */
export function currentSchedule(): Schedule | null {
  return data?.schedule ?? null;
}

const CONNECTORS_URL = "https://claude.ai/settings/connectors";

export function hourLabel(h: number): string {
  return `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
}

async function save(key: string, ctx: SettingsCtx, call: () => Promise<AppSettings>, done?: string) {
  busy = key;
  ctx.rerender();
  try {
    data = await call();
    if (done) ctx.toast(done);
  } catch (e) {
    ctx.fail(e);
    await loadSettings();          // show what was saved, whatever failed after
  } finally {
    busy = "";
    ctx.rerender();
  }
}

export function settingsView(ctx: SettingsCtx): HTMLElement {
  if (!data && !loading && !loadError) void loadSettings().then(ctx.rerender);
  const head = pageHead("Settings", { sub: "Saved as you change them. Nothing here can send anything." });
  if (!data) {
    return h("div", { class: "settings" }, head,
      loadError ? h("div", { class: "banner error" }, `Couldn't load the settings: ${loadError}`)
        : h("p", { class: "muted" }, "Loading…"));
  }
  const sections: [string, string, () => HTMLElement][] = [
    ["appearance", "Appearance", () => appearance(ctx)],
    ["sources", "Sources", () => sources(data!, ctx)],
    ["schedule", "Schedule", () => scheduleSection(data!.schedule, ctx)],
    ["start", "Start Claude", () => startSection(ctx)],
    ["updates", "Updates", () => updatesSection(ctx)],
  ];
  const toc = h("nav", { class: "set-toc", "aria-label": "Settings sections" },
    ...sections.map(([id, label]) => h("button", {
      type: "button", class: section === id ? "on" : "",
      onclick: () => {
        section = id;
        document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        document.querySelectorAll(".set-toc button").forEach((b) => b.classList.toggle("on", b.textContent?.endsWith(label) ?? false));
      },
    }, sectionIcon(id), label)));
  return h("div", { class: "settings" }, head,
    h("div", { class: "set-wrap" }, toc,
      h("div", { class: "set-body" }, ...sections.map(([, , build]) => build()))));
}

function sectionIcon(id: string): Node {
  if (id === "appearance") return themeIcon("system");     // not the sun: that's Today
  return h("span", { class: "set-ico", "aria-hidden": "true" },
    id === "sources" ? "⇄" : id === "start" ? "↗" : id === "updates" ? "↑" : "◷");
}

function card(id: string, title: string, hint: string, right: Node | "", ...body: (Node | string)[]): HTMLElement {
  return h("section", { class: "set-card", id: `set-${id}` },
    h("div", { class: "set-card-head" },
      h("div", {}, h("h2", {}, sectionIcon(id), title), h("p", { class: "set-hint" }, hint)), right),
    ...body);
}

// ---- appearance ---------------------------------------------------------------------------------
const STYLES: { choice: ThemeChoice; name: string }[] = [
  { choice: "system", name: "System" }, { choice: "light", name: "Light" },
  { choice: "dark", name: "Dark" }, { choice: "daylight", name: "Daylight" },
];

function appearance(ctx: SettingsCtx): HTMLElement {
  const now = currentTheme();
  const styles = h("div", { class: "set-styles", role: "radiogroup", "aria-label": "Style" },
    ...STYLES.map((s) => h("button", {
      type: "button", role: "radio", "aria-checked": String(s.choice === now),
      class: `set-style${s.choice === now ? " on" : ""}`,
      onclick: () => { setTheme(s.choice); ctx.themeChanged(); ctx.rerender(); },
    }, h("span", { class: `set-preview pv-${s.choice}`, "aria-hidden": "true" }, h("i"), h("b")), s.name)));
  return card("appearance", "Appearance",
    "The style TodoHub opens with. The theme button at the bottom of the sidebar, and the t key, change it too.", "",
    styles, daylightPlace(ctx));
}

function daylightPlace(ctx: SettingsCtx): HTMLElement {
  const d = data!.daylight;
  const loc = daylightLocation();
  const sun = sunTimes(new Date(), loc.lat, loc.lon);
  const fmt = (m: number) => new Date(new Date().setHours(0, Math.round(m), 0, 0))
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const place = h("input", { type: "text", class: "set-input", value: d.place, placeholder: "Shelburne, VT", "aria-label": "Place name" });
  const lat = h("input", { type: "number", class: "set-input num", step: "0.01", min: "-90", max: "90",
    value: d.latitude ?? "", placeholder: "44.39", "aria-label": "Latitude" });
  const lon = h("input", { type: "number", class: "set-input num", step: "0.01", min: "-180", max: "180",
    value: d.longitude ?? "", placeholder: "-73.23", "aria-label": "Longitude" });
  const num = (el: HTMLInputElement) => (el.value.trim() === "" ? null : Number(el.value));
  const apply = (s: AppSettings) => {
    const { latitude: la, longitude: lo, place: p } = s.daylight;
    setDaylightLocation(la != null && lo != null ? { lat: la, lon: lo, place: p || `${la.toFixed(2)}, ${lo.toFixed(2)}` } : null);
    if (currentTheme() === "daylight") { applyTheme(); ctx.themeChanged(); }
  };
  const saveBtn = h("button", {
    type: "button", class: "ghost small-btn", disabled: busy === "daylight",
    onclick: () => {
      const la = num(lat), lo = num(lon);
      if ((la === null) !== (lo === null)) { ctx.toast("Give both latitude and longitude, or neither"); return; }
      void save("daylight", ctx, async () => {
        const s = await api.setDaylightPlace({ place: place.value.trim(), latitude: la, longitude: lo });
        apply(s);
        return s;
      }, "Daylight place saved");
    },
  }, busy === "daylight" ? "Saving…" : "Save");
  const clear = d.latitude != null ? h("button", {
    type: "button", class: "link-btn small",
    onclick: () => void save("daylight", ctx, async () => {
      const s = await api.setDaylightPlace({ place: "", latitude: null, longitude: null });
      apply(s);
      return s;
    }, "Daylight follows your Mac's time zone"),
  }, "Use my time zone") : "";
  return h("div", { class: "set-daylight" },
    h("label", { class: "set-label" }, "Daylight follows the sun at"),
    h("div", { class: "set-row-inline" }, place, lat, lon, saveBtn, clear),
    h("div", { class: "set-sub" },
      loc.fromTimeZone ? `Now: ${loc.place}, from your Mac's time zone. ` : `Now: ${loc.place}. `,
      sun ? `Sunrise ${fmt(sun.rise)} · sunset ${fmt(sun.set)} today.` : ""));
}

// ---- sources ------------------------------------------------------------------------------------
function badge(s: SettingsSource): HTMLElement {
  return h("span", { class: `set-badge sb-${s.key}`, "aria-hidden": "true" }, s.name.slice(0, 1));
}

function setState(s: SettingsSource, state: SourceState, ctx: SettingsCtx) {
  const done = state === "on" ? (s.state === "removed" ? `${s.name} added. The next sweep reads it.` : `${s.name} is back on.`)
    : state === "paused" ? `${s.name} paused. Sweeps skip it until you tick it again.`
    : `${s.name} removed. Add it back from + Add a source.`;
  void save(`src-${s.key}`, ctx, () => api.setSource(s.key, state), done);
}

function statusLine(s: SettingsSource, ctx: SettingsCtx): HTMLElement {
  if (s.state === "paused") return h("div", { class: "set-sub" }, "Paused");
  const st = s.status;
  if (!st || st.ok === null) return h("div", { class: "set-sub" }, "Not checked yet");
  if (st.ok === false) {
    const streak = st.fail_streak ?? 0;
    return h("div", { class: "set-sub bad" }, st.detail ?? "Problem during the last sweep",
      h("span", { class: "muted" }, streak >= 2 ? ` · failed ${streak} sweeps in a row` : "",
        st.last_ok_at ? ` · last worked ${ctx.when(st.last_ok_at)}` : " · hasn't worked yet"));
  }
  return h("div", { class: "set-sub" }, `OK · read ${ctx.when(st.last_ok_at ?? st.at)}`);
}

function sources(d: AppSettings, ctx: SettingsCtx): HTMLElement {
  const listed = d.sources.filter((s) => s.state !== "removed");
  const addable = d.sources.filter((s) => s.state === "removed");
  const running = ctx.running();
  const addMenu = h("details", { class: "drop-menu set-add" },
    h("summary", { class: "set-add-btn" }, "+ Add a source"),
    h("div", { class: "menu set-add-menu" },
      h("div", { class: "set-menu-head" }, "Add to the sweep"),
      ...(addable.length ? addable.map((s) => h("button", {
        type: "button", class: "set-add-item", disabled: busy === `src-${s.key}`,
        onclick: (e: Event) => { (e.currentTarget as HTMLElement).closest("details")?.removeAttribute("open"); setState(s, "on", ctx); },
      }, badge(s), h("span", {}, h("b", {}, s.name), h("span", { class: "set-sub" }, s.reads)), h("span", { class: "set-add-go" }, "Add")))
        : [h("p", { class: "set-sub set-menu-empty" }, "Every source TodoHub can read is already in your list.")]),
      h("p", { class: "set-menu-foot" },
        "Another app needs TodoHub support first: its read-only tools and what to look for.")));
  const rows = listed.map((s) => {
    const on = s.state === "on";
    const key = `src-${s.key}`;
    return h("div", { class: `set-src${on ? "" : " paused"}` },
      badge(s),
      h("div", { class: "set-src-main" }, h("div", { class: "set-src-name" }, s.name, h("small", {}, s.via)), statusLine(s, ctx)),
      h("span", { class: "set-src-acts" },
        h("button", { type: "button", class: "link-btn danger-link set-remove", disabled: busy === key,
          onclick: () => setState(s, "removed", ctx) }, "Remove"),
        s.status?.ok === false && s.via.includes("claude.ai")
          ? link("Open claude.ai ↗", CONNECTORS_URL, "link-btn") : "",
        h("button", { type: "button", class: "link-btn", disabled: !on || running,
          title: on ? `Check ${s.name} now` : "Paused", onclick: () => ctx.runNow(s.key) }, "Check now")),
      h("input", { type: "checkbox", class: "set-check", checked: on, disabled: busy === key,
        "aria-label": `${on ? "Pause" : "Resume"} ${s.name}`, title: on ? "Untick to pause" : "Tick to resume",
        onchange: () => setState(s, on ? "paused" : "on", ctx) }));
  });
  return card("sources", "Sources",
    "What the sweep reads, each with its own read-only tools. Untick a source to pause it; Remove takes it off the list.",
    addMenu,
    rows.length ? h("div", { class: "set-src-list" }, ...rows)
      : h("p", { class: "set-sub" }, "No sources: the sweep has nothing to read. Use + Add a source."),
    h("div", { class: "set-btns" },
      h("button", { type: "button", class: "ghost small-btn", disabled: running || !listed.some((s) => s.state === "on"),
        onclick: () => ctx.runNow() }, running ? "Sweeping…" : "Check all now"),
      link("Manage connectors in claude.ai ↗", CONNECTORS_URL, "ghost-btn small-btn")));
}

// ---- schedule -----------------------------------------------------------------------------------
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function scheduleSection(s: Schedule, ctx: SettingsCtx): HTMLElement {
  const change = (patch: Partial<Schedule>) => {
    const next = { every: s.every, start: s.start, end: s.end, days: s.days, ...patch };
    if (next.end < next.start) next.end = next.start;
    void save("schedule", ctx, () => api.setSchedule(next),
      s.installed ? "Schedule saved. The Mac uses the new hours from now on." : "Schedule saved.");
  };
  const select = (label: string, value: string | number, options: [string | number, string][], onPick: (v: string) => void) =>
    h("select", { class: "set-select", "aria-label": label, disabled: busy === "schedule",
      onchange: (e: Event) => onPick((e.target as HTMLSelectElement).value) },
      ...options.map(([v, t]) => h("option", { value: String(v), selected: String(v) === String(value) }, t)));
  const hours: [number, string][] = Array.from({ length: 18 }, (_, n) => n + 5).map((x) => [x, hourLabel(x)]);
  const controls = h("div", { class: "set-sched-form" },
    h("div", { class: "set-f" }, h("label", {}, "Sweep"),
      select("How often", s.every, [[1, "Every hour"], [2, "Every 2 hours"], [3, "Every 3 hours"], [4, "Every 4 hours"]],
        (v) => change({ every: Number(v) }))),
    h("div", { class: "set-f" }, h("label", {}, "From"),
      select("First sweep", s.start, hours.filter(([x]) => x <= 20), (v) => change({ start: Number(v) })),
      h("span", {}, "to"),
      select("Last sweep", s.end, hours.filter(([x]) => x >= s.start), (v) => change({ end: Number(v) }))),
    h("div", { class: "set-f" }, h("label", {}, "On"),
      select("Days", s.days, [["weekdays", "Weekdays"], ["every day", "Every day"]], (v) => change({ days: v as Schedule["days"] }))),
    h("div", { class: "set-sub" }, `${s.hours.length * (s.days === "weekdays" ? 5 : 7)} runs a week.`));

  const cols = Array.from({ length: s.end - s.start + 1 }, (_, n) => s.start + n);
  const grid = h("div", { class: "set-week", style: `grid-template-columns: 30px repeat(${cols.length}, minmax(0, 1fr))` },
    h("span"), ...cols.map((c) => h("span", { class: "set-week-h" }, String(c % 12 || 12))),
    ...DAYS.flatMap((day, n) => {
      const weekday = n < 5;
      const runs = weekday || s.days === "every day";
      return [h("span", { class: "set-week-d" }, day), ...cols.map((c) => {
        const run = runs && s.hours.includes(c);
        const kind = !run ? "" : weekday && c === s.plan_hour ? " plan" : weekday && c === s.wrapup_hour ? " wrap" : " on";
        return h("i", { class: `set-cell${kind}`, title: run ? `${day} ${hourLabel(c)}${kind === " plan" ? ": sweep and morning plan"
          : kind === " wrap" ? ": sweep and wrap-up" : ": sweep"}` : "" });
      })];
    }));
  const notes: string[] = [];
  if (s.plan_hour === null) notes.push("No sweep between 6am and 11am, so the morning plan won't come on its own: use ↻ Re-plan on Today.");
  if (s.wrapup_hour === null) notes.push("No sweep at 3pm or later, so the wrap-up won't come on its own: use Ask Claude to wrap up on Today.");
  const install = !s.supported ? h("div", { class: "banner warn" }, "The schedule needs macOS; sweeps here run only when you click Run all.")
    : !s.installed ? h("div", { class: "banner warn set-install" },
        h("span", {}, "The schedule isn't set up on this Mac, so sweeps only run when you start one."),
        h("button", { type: "button", class: "primary small-btn", disabled: busy === "install",
          onclick: () => void save("install", ctx, () => api.installSchedule(), "Schedule set up on this Mac") },
          busy === "install" ? "Setting up…" : "Set it up"))
    : "";
  return card("schedule", "Schedule", "When the sweep runs on its own. If the Mac is asleep, the run happens when it wakes.", "",
    install,
    h("div", { class: "set-sched" }, controls,
      h("div", {}, grid,
        h("div", { class: "set-legend" },
          s.plan_hour !== null ? h("span", {}, h("i", { class: "set-cell plan" }), "with morning plan") : "",
          h("span", {}, h("i", { class: "set-cell on" }), "sweep"),
          s.wrapup_hour !== null ? h("span", {}, h("i", { class: "set-cell wrap" }), "with wrap-up") : ""))),
    ...notes.map((n) => h("p", { class: "set-sub set-note" }, n)));
}

// ---- start claude -------------------------------------------------------------------------------
let repoPath = "";                   // the + Add field's text, kept across re-renders
let repoError = "";                  // why the last + Add failed, shown under the field
const promptDrafts: Partial<Record<"code" | "review" | "chat", string>> = {};   // typed, not saved yet; kept across re-renders

async function addRepo(ctx: SettingsCtx) {
  if (!repoPath.trim() || busy) return;
  busy = "repo-add";
  repoError = "";
  ctx.rerender();
  try {
    data = await api.addRepo(repoPath.trim());
    repoPath = "";
    ctx.metaChanged();
  } catch (e) {
    repoError = e instanceof ApiError ? e.message : String(e);
  } finally {
    busy = "";
    ctx.rerender();
  }
}

function removeRepo(r: { repo: string; label: string }, ctx: SettingsCtx) {
  void save(`repo-${r.repo}`, ctx, async () => {
    const s = await api.removeRepo(r.repo);
    ctx.metaChanged();
    return s;
  }, `${r.label} removed`);
}

function promptField(kind: "code" | "review" | "chat", title: string, hint: string, ctx: SettingsCtx): HTMLElement {
  const s = data!.start;
  const [value, fallback] = {
    code: [s.code_prompt, s.default_code_prompt],
    review: [s.review_prompt, s.default_review_prompt],
    chat: [s.chat_prompt, s.default_chat_prompt],
  }[kind];
  const key = `prompt-${kind}`;
  const box = h("textarea", {
    class: "set-input set-prompt", rows: 4, value: promptDrafts[kind] ?? value, "aria-label": title, "data-edit": key, readOnly: busy === key,
    oninput: () => { promptDrafts[kind] = box.value; },
  });
  const saveBtn = h("button", {
    type: "button", class: "ghost small-btn", disabled: busy === key,
    onclick: () => void save(key, ctx, async () => {
      const saved = await api.setPrompt(kind, box.value);
      delete promptDrafts[kind];
      return saved;
    }, `${title} saved`),
  }, busy === key ? "Saving…" : "Save");
  const reset = value !== fallback ? h("button", {
    type: "button", class: "link-btn small",
    onclick: () => void save(key, ctx, async () => {
      const saved = await api.setPrompt(kind, "");
      delete promptDrafts[kind];
      return saved;
    }, `${title} back to the default`),
  }, "Reset to default") : "";
  return h("div", { class: "set-start-part" },
    h("div", { class: "set-label" }, title), h("p", { class: "set-sub" }, hint),
    box, h("div", { class: "set-row-inline" }, saveBtn, reset));
}

function startSection(ctx: SettingsCtx): HTMLElement {
  const s = data!.start;
  const field = h("input", {
    type: "text", class: "set-input set-repo-field", value: repoPath, placeholder: "~/code/api",
    "aria-label": "Path to a repo", "data-edit": "repo-path",
    oninput: (e: Event) => {
      repoPath = (e.target as HTMLInputElement).value;
      if (repoError) { repoError = ""; ctx.rerender(); }
    },
    onkeydown: (e: KeyboardEvent) => {
      // keyCode 229: WebKit's Enter that commits an IME composition, with isComposing false.
      if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); void addRepo(ctx); }
    },
  });
  const rows = s.repos.map((r) => h("div", { class: "set-repo" },
    h("span", { class: "set-repo-path" }, r.label),
    h("button", { type: "button", class: "link-btn danger-link set-remove", disabled: busy === `repo-${r.repo}`,
      "aria-label": `Remove ${r.label}`, onclick: () => removeRepo(r, ctx) },
      busy === `repo-${r.repo}` ? "Removing…" : "Remove")));
  return card("start", "Start Claude",
    "How the ⋯ menu's start items start Claude on an issue. In the prompts, {identifier}, {title} and {url} become the issue's.",
    "",
    h("div", { class: "set-start-part" },
      h("div", { class: "set-label" }, "Repos"),
      h("p", { class: "set-sub" }, s.repos.length ? "Start in Claude Code picks from these." : "Add a repo to turn on Start in Claude Code."),
      rows.length ? h("div", { class: "set-repo-list" }, ...rows) : "",
      h("div", { class: "set-row-inline" }, field,
        h("button", { type: "button", class: "ghost small-btn", "data-focus": "repo-add", disabled: busy === "repo-add", onclick: () => void addRepo(ctx) },
          busy === "repo-add" ? "Adding…" : "+ Add")),
      repoError ? h("p", { class: "set-sub bad", role: "alert" }, repoError) : ""),
    promptField("code", "Code prompt", "Start in periscope and Start in Claude Code send it to the new Claude.", ctx),
    promptField("review", "Review prompt",
      "Start in periscope sends it for a review ticket whose GitHub PR is in a periscope repo. {pr} becomes the PR's link.", ctx),
    promptField("chat", "Chat prompt", "Start in Claude Desktop puts it in a new chat. It cannot start with /.", ctx));
}

// ---- updates ------------------------------------------------------------------------------------
let upToDate = false;                // the last Check for updates found no newer release
let checkError = "";                 // or why it failed

async function checkForUpdatesNow(ctx: SettingsCtx) {
  busy = "updates";
  upToDate = false;
  checkError = "";
  ctx.rerender();
  try {
    upToDate = !(await checkForUpdate());
  } catch (e) {
    checkError = `Couldn't check: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy = "";
    ctx.rerender();
  }
}

function updatesSection(ctx: SettingsCtx): HTMLElement {
  const version = h("span", {}, update.version ? `TodoHub ${update.version}` : "TodoHub");
  if (!updatesOn) {
    return card("updates", "Updates", "Updates are off outside the installed app.", "", h("div", { class: "set-row-inline" }, version));
  }
  const result = update.ready ? `v${update.ready.version} is ready: see the bottom of the sidebar.`
    : checkError || (upToDate ? "You have the latest version." : "");
  return card("updates", "Updates",
    "TodoHub checks for a new release at launch and every hour, and shows it at the bottom of the sidebar.", "",
    h("div", { class: "set-row-inline" },
      version,
      h("button", { type: "button", class: "ghost small-btn", disabled: busy === "updates", onclick: () => void checkForUpdatesNow(ctx) },
        busy === "updates" ? "Checking…" : "Check for updates"),
      link("All releases", RELEASES_URL)),
    result ? h("p", { class: "set-hint" }, result) : "");
}
