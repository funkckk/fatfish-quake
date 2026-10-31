/**
 * Config client — talks to the Rust YAML config store (config.rs).
 * Replaces legacy/src/js/core/config.js (electron-store/YAML + IPC).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { inTauri } from "./env";
import { createLogger } from "./logger";
import type { TremConfig } from "./types";

const log = createLogger("config");

/** `{ a: { b: 1 } }` → `{ "a.b": 1 }`. */
function flatten(value: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = value;
  }
  return out;
}

/** 每個改了的設定一段：`鍵：舊 → 新`。 */
function changes(before: unknown, after: unknown): string[] {
  const a = flatten(before);
  const b = flatten(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => `${k}：${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`);
}

/** 整份設定一行，給啟動與還原時記錄。 */
function describe(config: TremConfig): string {
  return Object.entries(flatten(config))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");
}

/** Graded alert sound: whether it plays, and how loud. */
export interface AlertSettings {
  sound: boolean;
  volume: number;
}

const ALERT_DEFAULTS: AlertSettings = { sound: true, volume: 0.7 };

/** Extra keys this build knows beyond `TremConfig` (added without a schema bump). */
interface ExtraConfig {
  alert: AlertSettings;
  sim: { enabled: boolean };
}

/** Mirrors src-tauri/default.yml — used as the browser-mode / fallback config. */
export const DEFAULT_CONFIG: TremConfig & ExtraConfig = {
  ver: 7,
  "realtime-station-id": "1C10848",
  /** No earthquake on the map: the latest report, as before this setting existed. */
  "idle-map": "report",
  "check-box": {
    "show-window-eew": true,
    "show-window-report": true,
    "show-window-detect": true,
    "show-window-rts-intensity": true,
    "other-auto-start": true,
    "update-auto-restart": true,
    "other-tts": true,
    "graphics-block-auto-zoom": false,
    "sound-effects-EEW": true,
    "sound-effects-EEW2": true,
    "sound-effects-PAlert": true,
    "sound-effects-PGA1": true,
    "sound-effects-PGA2": true,
    "sound-effects-Report": true,
    "sound-effects-Shindo0": true,
    "sound-effects-Shindo1": true,
    "sound-effects-Shindo2": true,
    "sound-effects-Update": true,
  },
  alert: { ...ALERT_DEFAULTS },
  sim: { enabled: false },
};

let cache: TremConfig | null = null;

/**
 * Old files predate `idle-map`. Anything other than the live-station choice
 * stays on the report, which is what those files already showed. Not written
 * back here — the next save persists it.
 */
function normalize(config: TremConfig): TremConfig {
  if (config["idle-map"] !== "rts") config["idle-map"] = "report";
  (config as TremConfig & ExtraConfig).alert = readAlert(config);
  (config as TremConfig & ExtraConfig).sim = { enabled: readSimEnabled(config) };
  return config;
}

/** The graded alert settings, clamped, with defaults for a config that predates them. */
function readAlert(config: TremConfig): AlertSettings {
  const raw = (config as Partial<ExtraConfig>).alert;
  const volume = raw?.volume;
  return {
    sound: raw?.sound !== false,
    volume:
      typeof volume === "number" && Number.isFinite(volume)
        ? Math.min(1, Math.max(0, volume))
        : ALERT_DEFAULTS.volume,
  };
}

function readSimEnabled(config: TremConfig): boolean {
  return !!(config as Partial<ExtraConfig>).sim?.enabled;
}

export function alertSettings(config: TremConfig = getConfig()): AlertSettings {
  return readAlert(config);
}

/** A copy of `config` with new alert settings, for a whole-config save. */
export function withAlertSettings(config: TremConfig, next: Partial<AlertSettings>): TremConfig {
  return { ...config, alert: { ...readAlert(config), ...next } } as TremConfig;
}

export function simEnabled(config: TremConfig = getConfig()): boolean {
  return readSimEnabled(config);
}

/** A copy of `config` with the simulator switched on or off. */
export function withSimEnabled(config: TremConfig, enabled: boolean): TremConfig {
  return { ...config, sim: { enabled } } as TremConfig;
}

/** `idle-map`，缺了或不認得都當作地震報告。 */
export function idleMap(config: TremConfig = getConfig()): TremConfig["idle-map"] {
  return config["idle-map"] === "rts" ? "rts" : "report";
}

/** Load (and cache) the full config. */
export async function loadConfig(force = false): Promise<TremConfig> {
  if (cache && !force) return cache;
  const first = !cache;
  // Browser mode (headless WebKit debugging): no Rust backend — use defaults.
  if (!inTauri) {
    try {
      const saved = localStorage.getItem("trem.config");
      cache = normalize(saved ? (JSON.parse(saved) as TremConfig) : structuredClone(DEFAULT_CONFIG));
      if (first) log.info(`載入設定（${saved ? "瀏覽器儲存" : "預設值"}）：${describe(cache)}`);
    } catch (e) {
      log.warn("瀏覽器裡的設定讀不出來，改用預設值：", e);
      cache = structuredClone(DEFAULT_CONFIG);
    }
    return cache;
  }
  cache = normalize(await invoke<TremConfig>("config_get"));
  if (first) log.info(`載入設定：${describe(cache)}`);
  return cache;
}

/** Synchronous access to the last-loaded config (falls back to defaults). */
export function getConfig(): TremConfig {
  if (!cache) cache = structuredClone(DEFAULT_CONFIG);
  return cache;
}

/** Browser has one window, so a write tells listeners here. Desktop uses Rust's `config-updated`. */
const localListeners = new Set<(c: TremConfig) => void>();

function notifyLocal(): void {
  if (!cache) return;
  for (const fn of localListeners) {
    try {
      fn(cache);
    } catch (e) {
      log.warn("設定變更的通知失敗：", e);
    }
  }
}

/** Persist the whole config. Broadcasts `config-updated` from Rust. */
export async function writeConfig(config: TremConfig): Promise<void> {
  const next = normalize(config);
  const diff = changes(cache, next);
  if (diff.length) log.info(`設定變更：${diff.join("；")}`);
  cache = next;
  if (!inTauri) {
    localStorage.setItem("trem.config", JSON.stringify(cache));
    if (diff.length) notifyLocal();
    return;
  }
  await invoke("config_set", { value: cache });
}

export async function resetConfig(): Promise<TremConfig> {
  if (!inTauri) {
    cache = structuredClone(DEFAULT_CONFIG);
    localStorage.setItem("trem.config", JSON.stringify(cache));
    log.info(`所有設定還原為預設值：${describe(cache)}`);
    notifyLocal();
    return cache;
  }
  cache = normalize(await invoke<TremConfig>("config_reset"));
  log.info(`所有設定還原為預設值：${describe(cache)}`);
  return cache;
}

/** Re-read config whenever any window changes it. Returns an unlisten fn. */
export async function onConfigUpdated(fn: (c: TremConfig) => void): Promise<() => void> {
  if (!inTauri) {
    localListeners.add(fn);
    return () => {
      localListeners.delete(fn);
    };
  }
  return listen("config-updated", async () => {
    const c = await loadConfig(true);
    fn(c);
  });
}
