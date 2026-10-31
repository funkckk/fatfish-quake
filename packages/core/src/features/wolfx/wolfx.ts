/**
 * Wolfx global EEW feed — wolfx.jp aggregates the non-CWA sources this app
 * shows (JMA 日本, CENC 中國, SC 四川, FJ 福建, KMA 韓國) behind one WebSocket,
 * `wss://ws-api.wolfx.jp/all_eew`, each JSON message tagged `type`
 * (`jma_eew`, `cenc_eew`, `sc_eew`, `fj_eew`, `kma_eew`, …). Normalized into
 * `EewData` they go through the
 * same DataManager pipeline as the CWA stream, so rendering, camera focus,
 * alerts and expiry need nothing new.
 *
 * The socket pushes one event at a time while DataManager expects the whole
 * current frame, so the latest report of every live event is kept in
 * `current` and the whole map is fed on each message; DataManager merges by
 * id+serial and ages entries out, exactly as it is designed to. Entries leave
 * the map once older than its 240 s window.
 *
 * Reconnect is exponential backoff from 3 s to 30 s, and the socket stays up
 * in a hidden tab: the traffic is a few KB a day and an earthquake does not
 * wait for a foreground tab.
 *
 * `?demo-eew=jma|cenc|sc|fj|kma` injects a synthetic event once the map is up
 * and cancels it 30 s later, so the full chain (cross, waves, camera, info
 * card) can be demoed without waiting for a real quake.
 */
import { events } from "@/lib/events";
import { createLogger, fmtDur } from "@/lib/logger";
import { now } from "@/lib/ntp";
import type { EewData } from "@/lib/types";
import { variable } from "@/lib/variable";

import { initData } from "../data/data";

const log = createLogger("wolfx");

const WS_URL = "wss://ws-api.wolfx.jp/all_eew";
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 30_000;
/** Matches DataManager's 240 s expiry window; the local map holds no older. */
const EVENT_TTL_MS = 240_000;
const DEMO_CANCEL_AFTER_MS = 30_000;

type Raw = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/** First present, non-empty of the candidate keys (APIs differ in casing). */
function first(raw: Raw, keys: string[]): unknown {
  for (const key of keys) {
    const v = raw[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/**
 * "YYYY/MM/DD HH:mm:ss" (or "-"/"T") at a fixed UTC offset → epoch ms.
 * The Wolfx payloads carry no zone designator: JMA speaks JST, CENC speaks
 * CST, so `new Date(text)` — which would read it as local time — is wrong
 * everywhere but those zones.
 */
function parseTime(value: unknown, offsetHours: number): number {
  const m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(str(value));
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) - offsetHours * 3_600_000;
}

/** Epoch ms → "YYYY/MM/DD HH:mm:ss" at a fixed UTC offset (the inverse of parseTime). */
function fmtZone(t: number, offsetHours: number): string {
  const d = new Date(t + offsetHours * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** JMA 震度字串 → CWA 震度索引 0–9（["0".."4","5⁻","5⁺","6⁻","6⁺","7"]）。 */
const JMA_INTENSITY: Record<string, number> = {
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4,
  "5-": 5, "5弱": 5,
  "5+": 6, "5強": 6,
  "6-": 7, "6弱": 7,
  "6+": 8, "6強": 8,
  "7": 9,
};

function jmaIntensity(value: unknown): number {
  const text = str(value);
  if (!text) return 0;
  const mapped = JMA_INTENSITY[text];
  if (mapped !== undefined) return mapped;
  const n = Number(text);
  if (Number.isFinite(n)) return Math.min(9, Math.max(0, Math.round(n)));
  log.debug(`JMA 震度「${text}」認不得，當作 0`);
  return 0;
}

/** JMA payload (WS `jma_eew`,同 https://api.wolfx.jp/jma_eew.json)。注意 Magunitude 是 API 的原拼寫。 */
function normalizeJma(raw: Raw): EewData | null {
  if (raw.isTraining || raw.isAssumption) return null;
  const id = str(raw.EventID);
  const origin = parseTime(raw.OriginTime, 9);
  if (!id || !origin) {
    log.debug("jma_eew 缺少 EventID 或發震時間，略過：", raw);
    return null;
  }
  return {
    id,
    author: "jma",
    serial: num(raw.Serial, 1),
    status: raw.isCancel ? 3 : raw.isWarn ? 1 : 0,
    final: raw.isFinal ? 1 : 0,
    eq: {
      lat: num(raw.Latitude, 0),
      lon: num(raw.Longitude, 0),
      depth: num(raw.Depth, 10),
      mag: num(first(raw, ["Magunitude", "Magnitude", "magnitude"]), 0),
      max: jmaIntensity(raw.MaxIntensity),
      loc: str(first(raw, ["Hypocenter", "HypoCenter", "placeName"])) || "未知",
      time: origin,
    },
    time: parseTime(raw.AnnouncedTime, 9) || now(),
  };
}

/**
 * CENC/SC/FJ/KMA 的報文是同一種風格（EventID + OriginTime + 地名 + 烈度），
 * 共用此規範化器。實測（2026-10）：
 *   - sc_eew：EventID/ReportTime/ReportNum/OriginTime/HypoCenter/Latitude/
 *     Longitude/Magunitude+Magnitude/Depth/MaxIntensity（中國烈度 1–12）
 *   - fj_eew：同上但無 Depth、無 MaxIntensity
 *   - kma_eew：https://api.wolfx.jp/kma_eew.json 回 404，無實測樣本，比照
 *     cenc 全候選鍵防禦性讀取；KMA 亦用 1–12 烈度
 * 欄位命名沒有明文規格，全部用候選鍵防禦性讀取；缺漏的給安全預設值並記
 * debug。offsetHours 是報文時間的固定 UTC 偏移（中國 8、韓國 9）。
 */
function normalizeMeasured(raw: Raw, author: string, offsetHours: number): EewData | null {
  if (raw.isTraining || raw.isAssumption) return null;
  const label = `${author}_eew`;
  const id = str(first(raw, ["EventID", "ID", "eventId"]));
  const origin = parseTime(first(raw, ["OriginTime", "originTime", "origin_time"]), offsetHours);
  if (!id || !origin) {
    log.debug(`${label} 缺少 EventID 或發震時間，略過：`, raw);
    return null;
  }

  const defaulted: string[] = [];
  const pickNum = (fallback: number, ...keys: string[]): number => {
    const v = first(raw, keys);
    const n = num(v, NaN);
    if (v === undefined || !Number.isFinite(n)) {
      defaulted.push(keys[0]);
      return fallback;
    }
    return n;
  };
  const loc = str(first(raw, ["HypoCenter", "Hypocenter", "placeName", "location"]));
  if (!loc) defaulted.push("HypoCenter");
  // 中國/韓國烈度 1–12，近似成 CWA 震度索引 0–9。
  const localMax = pickNum(0, "MaxIntensity", "maxIntensity", "intensity");

  const data: EewData = {
    id,
    author,
    serial: pickNum(1, "ReportNum", "Serial", "serial"),
    status: raw.isCancel || raw.cancel ? 3 : raw.isWarn ? 1 : 0,
    eq: {
      lat: pickNum(0, "Latitude", "latitude", "lat"),
      lon: pickNum(0, "Longitude", "longitude", "lon"),
      depth: pickNum(10, "Depth", "depth"),
      mag: pickNum(0, "Magnitude", "magnitude", "Magunitude"),
      max: Math.min(9, Math.max(0, Math.round(localMax * 0.75))),
      loc: loc || "未知",
      time: origin,
    },
    time: parseTime(first(raw, ["ReportTime", "AnnouncedTime", "reportTime"]), offsetHours) || now(),
  };
  if (defaulted.length) {
    log.debug(`${label} ${id} 欄位缺漏或認不得，用預設值：${[...new Set(defaulted)].join("、")}`);
  }
  return data;
}

/** WS type → 規範化器；不在表裡的類型略過（每種只記一次 debug）。 */
const NORMALIZERS: Record<string, (raw: Raw) => EewData | null> = {
  jma_eew: normalizeJma,
  cenc_eew: (raw) => normalizeMeasured(raw, "cenc", 8),
  sc_eew: (raw) => normalizeMeasured(raw, "sc", 8),
  fj_eew: (raw) => normalizeMeasured(raw, "fj", 8),
  kma_eew: (raw) => normalizeMeasured(raw, "kma", 9),
};

class WolfxClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  /** `${author}-${id}` → 最新一報；整張表就是餵給 processEEWData 的當前幀。 */
  private readonly current = new Map<string, EewData>();
  /** 每種未知 type 只記一次，免得聚合流裡的其他來源洗版。 */
  private readonly unknownTypes = new Set<string>();

  start(): void {
    this.connect();
  }

  /** Demo 與測試用：把一則 Wolfx 原始報文送進正規化流程，如同 WS 收到。 */
  inject(raw: Raw): void {
    this.handle(raw);
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(WS_URL);
    } catch (e) {
      log.warn("WebSocket 建立失敗：", e);
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.retries = 0;
      log.info(`已連上 ${WS_URL}`);
    };
    this.ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        this.handle(JSON.parse(ev.data) as Raw);
      } catch {
        log.debug("收到不是 JSON 的訊息，略過");
      }
    };
    this.ws.onerror = () => {
      // onclose 隨後就到，重連在那裡處理。
      log.debug("WebSocket 發生錯誤");
    };
    this.ws.onclose = (ev) => {
      log.warn(`連線關閉（code ${ev.code}）`);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.retries, RECONNECT_MAX_MS);
    this.retries++;
    log.warn(`${fmtDur(delay)} 後重連（第 ${this.retries} 次）`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handle(msg: Raw): void {
    const type = str(msg.type);
    const normalize = NORMALIZERS[type];
    const eew = normalize ? normalize(msg) : null;
    if (!eew) {
      if (type && !normalize && !this.unknownTypes.has(type)) {
        this.unknownTypes.add(type);
        log.debug(`不支援的訊息類型 ${type}，之後同類型的略過不再記`);
      }
      return;
    }
    this.current.set(`${eew.author}-${eew.id}`, eew);
    this.feed();
  }

  private feed(): void {
    const t = now();
    for (const [key, eew] of this.current) {
      if (t - eew.eq.time > EVENT_TTL_MS) this.current.delete(key);
    }
    // 重播模式不混入即時資料（同 SSE 回呼的守門）。
    if (variable.play_mode !== 0) return;
    initData().processEEWData([...this.current.values()]);
  }
}

/** `?demo-eew=jma|cenc|sc|fj|kma`：地圖載入後注入合成預警，30 秒後發取消報。 */
function armDemo(client: WolfxClient): void {
  if (typeof location === "undefined") return;
  const kind = new URLSearchParams(location.search).get("demo-eew") ?? "";

  // 中國系與 KMA 共用報文風格（見 normalizeMeasured），只差座標、地名與時區。
  const measured = (
    type: string,
    zone: number,
    loc: string,
    lat: number,
    lon: number,
    mag: number,
    depth: number,
    maxInt: number,
  ) =>
    (id: string, serial: number, t: number, cancel: boolean): Raw => ({
      type,
      EventID: id,
      ReportNum: serial,
      ReportTime: fmtZone(t, zone),
      OriginTime: fmtZone(t, zone),
      HypoCenter: loc,
      Latitude: lat,
      Longitude: lon,
      Magnitude: mag,
      Depth: depth,
      MaxIntensity: maxInt,
      isWarn: !cancel,
      isCancel: cancel,
    });

  const DEMO: Record<string, (id: string, serial: number, t: number, cancel: boolean) => Raw> = {
    jma: (id, serial, t, cancel) => ({
      type: "jma_eew",
      EventID: id,
      Serial: serial,
      AnnouncedTime: fmtZone(t, 9),
      OriginTime: fmtZone(t, 9),
      Hypocenter: "茨城県沖",
      Latitude: 36.4,
      Longitude: 141.1,
      Magunitude: 3.6,
      Depth: 40,
      MaxIntensity: "2",
      isWarn: !cancel,
      isFinal: false,
      isCancel: cancel,
    }),
    cenc: measured("cenc_eew", 8, "新疆博尔塔拉州精河县", 44.221, 82.66, 4.2, 5, 5.4),
    sc: measured("sc_eew", 8, "四川阿坝州汶川县", 31.0, 103.4, 4.5, 10, 5),
    fj: measured("fj_eew", 8, "福建泉州近海", 24.9, 119.6, 4.5, 10, 5),
    kma: measured("kma_eew", 9, "首爾特別市近郊", 37.3, 127.0, 4.5, 10, 5),
  };
  const payload = DEMO[kind];
  if (!payload) return;

  // 等地圖載入：EewRelease 時還沒有 map 的話，波圈圖層建了也不會補畫。
  events.on("MapLoad", () => {
    setTimeout(() => {
      const t = now();
      const id = `demo${t}`;
      client.inject(payload(id, 1, t, false));
      log.info(`已注入 demo 預警（${kind}），${fmtDur(DEMO_CANCEL_AFTER_MS)} 後取消`);
      setTimeout(() => {
        client.inject(payload(id, 2, now(), true));
        log.info("demo 預警已發送取消報");
      }, DEMO_CANCEL_AFTER_MS);
    }, 1_000);
  });
}

let client: WolfxClient | null = null;

/** Connect the Wolfx feed (idempotent). */
export function initWolfx(): void {
  if (client) return;
  client = new WolfxClient();
  client.start();
  armDemo(client);
}
