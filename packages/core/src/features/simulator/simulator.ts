/**
 * Earthquake simulator — clicking the map places a synthetic epicentre.
 *
 * It feeds the real pipeline (`processEEWData`) rather than drawing anything
 * itself: the EEW module draws the epicentre and wavefronts, the info box and
 * the graded alert sound behave exactly as they would for a real event. The
 * event expires by itself: 20 s after placement a status-3 serial cancels it.
 */
import { getConfig, onConfigUpdated, simEnabled, withSimEnabled, writeConfig } from "@/lib/config";
import { events } from "@/lib/events";
import { createLogger } from "@/lib/logger";
import { now, realNow } from "@/lib/ntp";
import type { EewData } from "@/lib/types";
import { variable } from "@/lib/variable";

import { initData } from "../data/data";

const log = createLogger("simulator");

export interface SimParams {
  mag: number;
  depth: number;
}

export interface SimState {
  enabled: boolean;
  params: SimParams;
  last: { mag: number; lat: number; lon: number } | null;
}

const DEFAULT_PARAMS: SimParams = { mag: 5.0, depth: 20 };
/** Two clicks closer than this are one placement. */
const CLICK_THROTTLE = 1500;
/** How long a simulated EEW stays up before it cancels itself. */
const LIFETIME = 20_000;

let initialized = false;
let enabled = false;
/** Opened by `?sim=1`: this session only, until the switch is used directly. */
let forcedByUrl = false;
let params: SimParams = { ...DEFAULT_PARAMS };
let last: SimState["last"] = null;
let lastClickAt = 0;
let cancelTimer: ReturnType<typeof setTimeout> | null = null;
let boundMap = false;

/** Coarse magnitude → CWA intensity index, enough to colour the card and rings. */
export function maxOfMag(mag: number): number {
  if (mag < 3.0) return 0;
  if (mag < 3.8) return 1;
  if (mag < 4.4) return 2;
  if (mag < 4.9) return 3;
  if (mag < 5.4) return 4;
  if (mag < 6.0) return 5;
  if (mag < 6.6) return 6;
  if (mag < 7.3) return 7;
  if (mag < 8.0) return 8;
  return 9;
}

export function getSimState(): SimState {
  return { enabled, params: { ...params }, last };
}

/** Whether a map click currently places an epicentre. */
export function isSimEnabled(): boolean {
  return enabled;
}

/** Cancel whatever simulation holds the map, and drop its timer. */
function cancelCurrent(): void {
  if (cancelTimer) clearTimeout(cancelTimer);
  cancelTimer = null;
  const current = variable.data.eew.find((item) => item.author === "sim");
  if (!current) return;
  initData().processEEWData([{ ...current, serial: current.serial + 1, status: 3 }]);
}

export function setSimEnabled(on: boolean, persist = true): void {
  if (enabled === on) return;
  // A switch used by hand wins over the URL's one-session opening.
  forcedByUrl = false;
  enabled = on;
  if (!on) cancelCurrent();
  events.emit("SimStateChange");
  if (persist) void persistEnabled(on);
}

export function setSimParams(next: Partial<SimParams>): void {
  if (next.mag !== undefined && Number.isFinite(next.mag)) {
    params.mag = Math.min(9, Math.max(1, Math.round(next.mag * 10) / 10));
  }
  if (next.depth !== undefined && Number.isFinite(next.depth)) {
    params.depth = Math.min(300, Math.max(0, Math.round(next.depth / 5) * 5));
  }
  events.emit("SimStateChange");
}

async function persistEnabled(on: boolean): Promise<void> {
  const config = getConfig();
  if (simEnabled(config) === on) return;
  try {
    await writeConfig(withSimEnabled(config, on));
  } catch (e) {
    log.warn("模擬器開關存不進設定：", e);
  }
}

/** End what an earlier placement left in the list and on the map. */
function clearOldSim(): void {
  if (cancelTimer) clearTimeout(cancelTimer);
  cancelTimer = null;
  const old = variable.data.eew.filter((item) => item.author === "sim");
  for (const item of old) {
    events.emit("EewEnd", {
      info: { type: variable.play_mode },
      data: { ...item, EewEnd: true },
    });
  }
  if (old.length) variable.data.eew = variable.data.eew.filter((item) => item.author !== "sim");
}

function place(lat: number, lon: number): void {
  if (!enabled) return;
  const at = realNow();
  if (at - lastClickAt < CLICK_THROTTLE) return;
  lastClickAt = at;

  clearOldSim();

  const mag = params.mag;
  const time = now();
  const event: EewData = {
    id: `sim-${at}`,
    author: "sim",
    serial: 1,
    status: 1,
    eq: {
      lat,
      lon,
      depth: params.depth,
      mag,
      max: maxOfMag(mag),
      loc: "模拟地震",
      time,
    },
    time,
  };

  initData().processEEWData([event]);
  last = { mag, lat, lon };
  events.emit("SimPlaced", { mag, lat, lon });
  log.info(`模擬地震：M${mag.toFixed(1)}、深度 ${params.depth} km，位於 ${lat.toFixed(2)}, ${lon.toFixed(2)}`);

  cancelTimer = setTimeout(() => {
    cancelTimer = null;
    const current = variable.data.eew.find((item) => item.id === event.id);
    if (!current) return;
    initData().processEEWData([{ ...current, serial: 2, status: 3 }]);
  }, LIFETIME);
}

function bindMap(): void {
  if (boundMap) return;
  const map = variable.map;
  if (!map) return;
  boundMap = true;
  map.on("click", (e) => place(e.lngLat.lat, e.lngLat.lng));
}

/** Wire the simulator to the map and the config (idempotent). */
export function initSimulator(): void {
  if (initialized) return;
  initialized = true;

  // `?sim=1` opens it for a demo; it is not written back to the config.
  const forced = typeof location !== "undefined" && new URLSearchParams(location.search).get("sim") === "1";
  if (forced) {
    forcedByUrl = true;
    enabled = true;
    events.emit("SimStateChange");
  } else if (simEnabled()) {
    enabled = true;
  }

  events.on("MapLoad", () => bindMap());
  bindMap();

  // The settings window writes the switch; the main window follows. A
  // `?sim=1` session is left alone until its own switch is used.
  void onConfigUpdated((config) => {
    if (forcedByUrl) return;
    const on = simEnabled(config);
    if (on !== enabled) setSimEnabled(on, false);
  });
}
