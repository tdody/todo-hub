// The Daylight theme: colors that follow the time of day, the way the morning tile and the
// wrap-up tile do.
//
// Phases (local time):
//   Morning    from dawn (the earlier of 6:00 and 30 min before sunrise) to 10:30
//   Day        10:30 to 14:00
//   Afternoon  14:00 to an hour before sunset
//   Dusk       an hour before sunset to an hour after
//   Night      an hour after sunset until dawn
// Sunset and sunrise are worked out on this Mac (NOAA's formulas) for a location: the one in
// config.toml ([app] daylight_latitude / daylight_longitude), or else the city the Mac's time zone
// is named after. Neighboring light phases blend over 30 minutes; Dusk to Night and Night to
// Morning switch at once, since half-light, half-dark colors would be hard to read.
import { TZ_COORDS } from "./tzcoords";

export type Phase = "morning" | "day" | "afternoon" | "dusk" | "night";
export type Location = { lat: number; lon: number; place: string; fromTimeZone: boolean };

const PHASE_NAME: Record<Phase, string> = {
  morning: "Morning", day: "Day", afternoon: "Afternoon", dusk: "Dusk", night: "Night",
};

/** The colors each phase sets on top of the light or dark base (status colors stay as they are). */
type Palette = Record<"bg" | "surface" | "surface-2" | "border" | "ink" | "muted" | "accent" | "accent-ink" | "warn-bg", string>;
const PALETTE: Record<Phase, Palette> = {
  morning: { bg: "#fbf6ec", surface: "#fffdf8", "surface-2": "#f5eddc", border: "#ecdfc6", ink: "#2a2418",
             muted: "#7a6a52", accent: "#a4551a", "accent-ink": "#ffffff", "warn-bg": "#fff1d6" },
  day: { bg: "#f6f7f9", surface: "#ffffff", "surface-2": "#f0f2f5", border: "#dfe3e8", ink: "#1b2330",
         muted: "#5d6878", accent: "#1f3a5f", "accent-ink": "#ffffff", "warn-bg": "#fff4dc" },
  afternoon: { bg: "#f7f2ea", surface: "#fffcf7", "surface-2": "#f1e9dc", border: "#e6dccb", ink: "#262019",
               muted: "#73675a", accent: "#7b4a2a", "accent-ink": "#ffffff", "warn-bg": "#f6e6d3" },
  dusk: { bg: "#efebf5", surface: "#fbf9fd", "surface-2": "#e7e1f0", border: "#ddd5ea", ink: "#231e38",
          muted: "#6b6688", accent: "#5b4596", "accent-ink": "#ffffff", "warn-bg": "#fbe7cf" },
  night: { bg: "#16152a", surface: "#201e38", "surface-2": "#2a2746", border: "#39355a", ink: "#e9e6f5",
           muted: "#a29dc0", accent: "#b9a7f0", "accent-ink": "#16152a", "warn-bg": "#3a2f17" },
};

// ---- where -----------------------------------------------------------------------------------
let configured: Location | null = null;

/** From config.toml, via the backend. Null keeps the time-zone default. */
export function setDaylightLocation(loc: { lat: number; lon: number; place: string } | null) {
  configured = loc ? { ...loc, fromTimeZone: false } : null;
}

export function daylightLocation(): Location {
  if (configured) return configured;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const hit = TZ_COORDS[zone];
  if (hit) return { lat: hit[0], lon: hit[1], place: zone.split("/").pop()!.replace(/_/g, " "), fromTimeZone: true };
  // An alias zone (US/Eastern) or none: the time zone's offset gives a longitude; mid-latitude.
  const offsetHours = -new Date().getTimezoneOffset() / 60;
  return { lat: 40, lon: offsetHours * 15, place: zone || "your time zone", fromTimeZone: true };
}

// ---- when: sunrise and sunset (NOAA) ----------------------------------------------------------
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Minutes after local midnight of sunrise and sunset on ``date`` at lat/lon; null when the sun
 *  doesn't rise or set that day (far north or south). */
export function sunTimes(date: Date, lat: number, lon: number): { rise: number; set: number } | null {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - start.getTime()) / 864e5);
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + 0.5);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl)) - Math.tan(rad(lat)) * Math.tan(decl);
  if (cosH < -1 || cosH > 1) return null;
  const ha = deg(Math.acos(cosH));
  const tzMinutes = -date.getTimezoneOffset();
  const noon = 720 - 4 * lon - eqtime + tzMinutes;          // solar noon, local minutes
  return { rise: noon - 4 * ha, set: noon + 4 * ha };
}

// ---- which phase ----------------------------------------------------------------------------
type Schedule = { dawn: number; dayStart: number; afternoon: number; duskStart: number; nightStart: number;
                  rise: number | null; set: number | null };

function schedule(now: Date, loc: Location): Schedule {
  const sun = sunTimes(now, loc.lat, loc.lon);
  const set = sun ? sun.set : 17 * 60;
  return {
    dawn: Math.min(6 * 60, (sun ? sun.rise : 6 * 60) - 30),
    dayStart: 10 * 60 + 30,
    afternoon: 14 * 60,
    duskStart: Math.max(14 * 60 + 30, set - 60),
    nightStart: set + 60,
    rise: sun?.rise ?? null,
    set: sun?.set ?? null,
  };
}

const BLEND = 15;     // minutes on each side of a light-to-light boundary

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

export type DaylightState = { phase: Phase; vars: Palette; dark: boolean; next: { phase: Phase; at: number };
                              sunset: number | null; location: Location };

export function daylightAt(now: Date = new Date(), loc: Location = daylightLocation()): DaylightState {
  const s = schedule(now, loc);
  const m = now.getHours() * 60 + now.getMinutes();
  const order: [Phase, number][] = [["morning", s.dawn], ["day", s.dayStart], ["afternoon", s.afternoon],
                                    ["dusk", s.duskStart], ["night", s.nightStart]];
  let phase: Phase = "night";
  for (const [p, at] of order) if (m >= at) phase = p;
  const idx = order.findIndex(([p]) => p === phase);
  const next = m < s.dawn ? { phase: "morning" as Phase, at: s.dawn }
    : idx < order.length - 1 ? { phase: order[idx + 1][0], at: order[idx + 1][1] }
    : { phase: "morning" as Phase, at: s.dawn + 24 * 60 };
  let vars = { ...PALETTE[phase] };
  // Blend across Morning → Day → Afternoon → Dusk boundaries.
  const blends: [Phase, Phase, number][] = [["morning", "day", s.dayStart], ["day", "afternoon", s.afternoon],
                                            ["afternoon", "dusk", s.duskStart]];
  for (const [a, b, at] of blends) {
    if (Math.abs(m - at) < BLEND) {
      const t = (m - (at - BLEND)) / (2 * BLEND);
      vars = Object.fromEntries(Object.entries(PALETTE[a]).map(([k, v]) =>
        [k, mix(v, PALETTE[b][k as keyof Palette], t)])) as Palette;
    }
  }
  return { phase, vars, dark: phase === "night", next, sunset: s.set, location: loc };
}

// ---- applying it ----------------------------------------------------------------------------
let timer: number | undefined;

export function clockText(minutes: number): string {
  const d = new Date();
  d.setHours(0, Math.round(minutes) % (24 * 60), 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Sets the theme on <html>: data-theme day-light or day-dark (the status colors' base), plus
 *  this phase's colors. Re-checks every 5 minutes. Returns whether the page is dark now. */
export function startDaylight(onChange?: (s: DaylightState) => void): DaylightState {
  const apply = () => {
    const s = daylightAt();
    const root = document.documentElement;
    root.setAttribute("data-theme", s.dark ? "day-dark" : "day-light");
    root.dataset.phase = s.phase;
    for (const [k, v] of Object.entries(s.vars)) root.style.setProperty(`--${k}`, v);
    onChange?.(s);
    return s;
  };
  stopDaylight();
  timer = window.setInterval(apply, 5 * 60_000);
  return apply();
}

export function stopDaylight() {
  window.clearInterval(timer);
  timer = undefined;
  const root = document.documentElement;
  delete root.dataset.phase;
  for (const k of Object.keys(PALETTE.day)) root.style.removeProperty(`--${k}`);
}

/** "now Dusk · Night at 5:28 PM", for the theme menu. */
export function daylightShort(s: DaylightState = daylightAt()): string {
  return `now ${PHASE_NAME[s.phase]} · ${PHASE_NAME[s.next.phase]} at ${clockText(s.next.at)}`;
}

/** "Daylight: Dusk now · Night at 5:28 PM · sunset 4:28 PM in New York (from the time zone)" */
export function daylightLabel(s: DaylightState = daylightAt()): string {
  const where = `${s.location.place}${s.location.fromTimeZone ? " (from the time zone)" : ""}`;
  return `Theme: daylight. ${PHASE_NAME[s.phase]} now, ${PHASE_NAME[s.next.phase]} at ${clockText(s.next.at)}`
    + (s.sunset !== null ? `; sunset ${clockText(s.sunset)} in ${where}` : `; no sunset today in ${where}`);
}
