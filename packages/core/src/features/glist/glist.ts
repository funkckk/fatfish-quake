/**
 * The earthquake lists of the other agencies — JMA (Japan, via Wolfx), CENC
 * (China, via Wolfx) and USGS (worldwide, 2.5+ for the day) — merged into one
 * list the right-hand panel and the map both read.
 *
 * Each source answers a different shape and a different clock, so every row is
 * normalised here into {@link GlobalQuake}: one scale of intensity (CWA 0..9,
 * the one the badges and colours speak), one epoch time, one source tag. The
 * panel tints a row by its tag; the map dots take the same colour off the
 * layer's `match` on `src`.
 *
 * Polled, not streamed: these are post-event lists (a report arrives minutes
 * after the shaking), where a minute of latency changes nothing. USGS is the
 * largest and the slowest to update, so it is asked less often.
 */
import { HTTP_TIMEOUT } from "@/lib/constants";
import { events } from "@/lib/events";
import { http } from "@/lib/http";
import { createLogger } from "@/lib/logger";
import { setFeatures } from "@/lib/mapSource";
import { now } from "@/lib/ntp";
import { variable } from "@/lib/variable";

const log = createLogger("glist");

/** Who a row came from. `cwa` is the Taiwan report list, drawn by report.ts. */
export type GlobalSource = "jma" | "cenc" | "usgs";

/** One earthquake, whichever agency listed it. */
export interface GlobalQuake {
  /** `${author}-${id}`, unique across sources. */
  key: string;
  author: GlobalSource;
  id: string;
  lat: number;
  lon: number;
  depth: number;
  mag: number;
  /** CWA intensity index 0..9, derived where the source reports another scale. */
  int: number;
  loc: string;
  /** Epoch ms. */
  time: number;
}

/** Rows kept in the panel, per source and in total; older ones drop off. */
const PER_SOURCE = 30;
const TOTAL = 60;
/** A list row older than this is not worth a panel slot. */
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

const SOURCE_LABEL: Record<GlobalSource, string> = {
  jma: "JMA",
  cenc: "CENC",
  usgs: "USGS",
};

export function sourceLabel(author: string): string {
  return SOURCE_LABEL[author as GlobalSource] ?? author.toUpperCase();
}

/** A colour per source, shared by the panel rows and the map dots. */
export const SOURCE_COLOR: Record<GlobalSource, string> = {
  jma: "#ff6b7d",
  cenc: "#ffc53d",
  usgs: "#8b9dff",
};

const rows: GlobalQuake[] = [];
let mapReady = false;

export function getGlobalQuakes(): GlobalQuake[] {
  return rows;
}

function publish(): void {
  events.emit("GlobalListUpdate");
  const map = variable.map;
  if (!map) return;
  const features: GeoJSON.Feature[] = rows.map((r) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [r.lon, r.lat] },
    properties: { src: r.author, mag: r.mag, key: r.key },
  }));
  setFeatures(map, "global-quakes-geojson", features);
}

/** Replace one source's rows, keeping every agency's own quota. */
function replaceSource(author: GlobalSource, fresh: GlobalQuake[]): void {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].author === author) rows.splice(i, 1);
  }
  rows.push(...fresh);

  const cutoff = now() - MAX_AGE_MS;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].time < cutoff) rows.splice(i, 1);
  }

  rows.sort((a, b) => b.time - a.time);

  // Trim each source to its quota, then the whole list to TOTAL: a prolific
  // week at one agency must not push the others off the panel.
  const kept = new Map<string, number>();
  const trimmed: GlobalQuake[] = [];
  for (const r of rows) {
    const n = kept.get(r.author) ?? 0;
    if (n >= PER_SOURCE) continue;
    kept.set(r.author, n + 1);
    trimmed.push(r);
  }
  rows.length = 0;
  rows.push(...trimmed.slice(0, TOTAL));

  publish();
}

/** `-`-separated date parts as a UTC epoch, with the source's fixed offset. */
function parseClock(
  text: string | undefined,
  offsetHours: number,
): number {
  if (!text) return 0;
  const m = text.match(/(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  const [, y, mo, d, h, mi, s] = m;
  return (
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0)) -
    offsetHours * 3600_000
  );
}

/** JMA shindo ("5弱" … "7") onto the CWA index. */
function jmaShindo(value: string | undefined): number {
  if (!value) return 0;
  const v = String(value).trim();
  const shifted: Record<string, number> = {
    "5弱": 5, "5-": 5, "5強": 6, "5+": 6,
    "6弱": 7, "6-": 7, "6強": 8, "6+": 8,
    "7": 9,
  };
  if (v in shifted) return shifted[v];
  const n = Number(v.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.min(9, n)) : 0;
}

/** A rough CWA index for a magnitude, where an agency reports none (USGS). */
function magnitudeToInt(mag: number): number {
  if (!Number.isFinite(mag) || mag <= 0) return 0;
  if (mag < 2.5) return 0;
  if (mag < 3.5) return 1;
  if (mag < 4.5) return 3;
  if (mag < 5.5) return 4;
  if (mag < 6.5) return 6;
  if (mag < 7) return 8;
  return 9;
}

/** "92 km NE of Cruz Bay, U.S. Virgin Islands" → "Cruz Bay": the name alone. */
function usgsPlace(place: unknown): string {
  const text = String(place ?? "全球").split(",")[0];
  const named = text.includes(" of ") ? text.split(" of ").pop()! : text;
  return named.trim() || "全球";
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Wolfx's lists come back as `{ No1: {...}, No2: {...}, … }`. */
function wolfxRows(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  return Object.values(body as Record<string, unknown>).filter(
    (v): v is Record<string, unknown> => !!v && typeof v === "object",
  );
}

async function readJson<T>(url: string): Promise<T | null> {
  const body = await http.json<T>(url, { timeout: HTTP_TIMEOUT.REPORT });
  if (body === null) log.warn(`地震列表取得失败：${url}`);
  return body;
}

async function pollJma(): Promise<void> {
  const body = await readJson("https://api.wolfx.jp/jma_eqlist.json");
  if (!body) return;
  const fresh: GlobalQuake[] = [];
  for (const r of wolfxRows(body)) {
    const id = String(r.EventID ?? "");
    const lat = num(r.latitude);
    const lon = num(r.longitude);
    if (!id || !lat || !lon) continue;
    fresh.push({
      key: `jma-${id}`,
      author: "jma",
      id,
      lat,
      lon,
      depth: num(String(r.depth ?? "").replace(/[^0-9.]/g, "")),
      mag: num(r.magnitude),
      int: jmaShindo(r.shindo as string | undefined),
      loc: String(r.location ?? "日本"),
      time: parseClock(r.time_full as string | undefined, 9),
    });
  }
  replaceSource("jma", fresh);
  log.debug(`JMA 地震列表 ${fresh.length} 笔`);
}

async function pollCenc(): Promise<void> {
  const body = await readJson("https://api.wolfx.jp/cenc_eqlist.json");
  if (!body) return;
  const fresh: GlobalQuake[] = [];
  for (const r of wolfxRows(body)) {
    const id = String(r.EventID ?? "");
    const lat = num(r.latitude);
    const lon = num(r.longitude);
    if (!id || !lat || !lon) continue;
    fresh.push({
      key: `cenc-${id}`,
      author: "cenc",
      id,
      lat,
      lon,
      depth: num(r.depth),
      mag: num(r.magnitude),
      int: Math.max(0, Math.min(9, Math.round(num(r.intensity) * 0.75))),
      loc: String(r.location ?? r.placeName ?? "中国"),
      time: parseClock(r.time as string | undefined, 8),
    });
  }
  replaceSource("cenc", fresh);
  log.debug(`CENC 地震列表 ${fresh.length} 笔`);
}

interface UsgsFeature {
  id?: string;
  properties?: { mag?: number; place?: string; time?: number; url?: string };
  geometry?: { coordinates?: [number, number, number] };
}

async function pollUsgs(): Promise<void> {
  const body = await readJson<{ features?: UsgsFeature[] }>(
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
  );
  if (!body?.features) return;
  const fresh: GlobalQuake[] = [];
  for (const f of body.features) {
    const [lon, lat, depth] = f.geometry?.coordinates ?? [0, 0, 0];
    const id = String(f.id ?? "");
    const mag = num(f.properties?.mag);
    if (!id || !lat || !lon) continue;
    fresh.push({
      key: `usgs-${id}`,
      author: "usgs",
      id,
      lat,
      lon,
      depth: num(depth),
      mag,
      int: magnitudeToInt(mag),
      loc: usgsPlace(f.properties?.place),
      time: num(f.properties?.time),
    });
  }
  replaceSource("usgs", fresh);
  log.debug(`USGS 地震列表 ${fresh.length} 笔`);
}

/** The map's dots: one colour per agency, one size per magnitude. */
function initializeMapLayers(): void {
  const map = variable.map;
  if (!map || map.getSource("global-quakes-geojson")) return;

  map.addSource("global-quakes-geojson", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "global-quakes-glow",
    type: "circle",
    source: "global-quakes-geojson",
    paint: {
      "circle-color": [
        "match",
        ["get", "src"],
        "jma", SOURCE_COLOR.jma,
        "cenc", SOURCE_COLOR.cenc,
        "usgs", SOURCE_COLOR.usgs,
        "#38d6e8",
      ],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 8, 8, 16],
      "circle-opacity": 0.18,
      "circle-blur": 1,
    },
  });

  map.addLayer({
    id: "global-quakes-dot",
    type: "circle",
    source: "global-quakes-geojson",
    paint: {
      "circle-color": [
        "match",
        ["get", "src"],
        "jma", SOURCE_COLOR.jma,
        "cenc", SOURCE_COLOR.cenc,
        "usgs", SOURCE_COLOR.usgs,
        "#38d6e8",
      ],
      "circle-radius": [
        "interpolate", ["linear"], ["get", "mag"],
        2, 4,
        5, 7,
        7, 11,
      ],
      "circle-stroke-color": "rgba(6, 11, 18, 0.85)",
      "circle-stroke-width": 1.2,
      "circle-opacity": 0.92,
    },
  });
}

const POLLS: { run: () => Promise<void>; every: number }[] = [
  { run: pollJma, every: 60_000 },
  { run: pollCenc, every: 5 * 60_000 },
  { run: pollUsgs, every: 5 * 60_000 },
];

/** Poll every agency, now and on its own clock. Idempotent. */
export function initGlobalList(): void {
  events.on("MapLoad", () => {
    if (mapReady) return;
    mapReady = true;
    initializeMapLayers();
    publish(); // rows fetched before the map existed get drawn now
  });

  for (const poll of POLLS) {
    void poll.run();
    setInterval(() => void poll.run(), poll.every);
  }
}
