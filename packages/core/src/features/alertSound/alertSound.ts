/**
 * Graded alert sound — the EEW's magnitude picks which clip is heard.
 *
 * The clips are MP4s, but only their audio track is wanted: one video element
 * lives outside the layout (0×0, fully transparent) and never covers the map.
 * A new alert stops the previous sound first; the same event is not replayed
 * unless its tier rises (light → medium → strong). A cancel takes it down at
 * once and releases the clip.
 */
import lightVideo from "@/assets/alert/alert-light.mp4";
import mediumVideo from "@/assets/alert/alert-medium.mp4";
import strongVideo from "@/assets/alert/alert-strong.mp4";

import { alertSettings, onConfigUpdated, type AlertSettings } from "@/lib/config";
import { events } from "@/lib/events";
import { createLogger } from "@/lib/logger";
import type { EewData } from "@/lib/types";

const log = createLogger("alertSound");

export type AlertTier = "light" | "medium" | "strong";

/** Tier metadata shared with the simulator panel and the settings page. */
export const ALERT_TIER: Record<AlertTier, { label: string; color: string }> = {
  light: { label: "轻度", color: "#ffc53d" },
  medium: { label: "中等", color: "#ff8a3d" },
  strong: { label: "强烈", color: "#ff3d55" },
};

const TIER_RANK: Record<AlertTier, number> = { light: 1, medium: 2, strong: 3 };

const CLIP: Record<AlertTier, string> = {
  light: lightVideo,
  medium: mediumVideo,
  strong: strongVideo,
};

/** Magnitude → tier. An unusable magnitude is the mildest tier. */
export function tierOfMag(mag: number): AlertTier {
  if (!Number.isFinite(mag) || mag <= 4.0) return "light";
  if (mag <= 7.0) return "medium";
  return "strong";
}

let initialized = false;
let enabled = true;
let volume = 0.7;
let video: HTMLVideoElement | null = null;
/** What is sounding now — the event and the tier it is playing. */
let playing: { id: string; tier: AlertTier } | null = null;

/**
 * The hidden player. `preload="none"` until a clip is played; the element is
 * fixed at 0×0 and transparent so it never shows a frame.
 */
function ensureVideo(): HTMLVideoElement | null {
  if (typeof document === "undefined") return null;
  if (!video) {
    video = document.createElement("video");
    video.id = "alert-sound-video";
    video.preload = "none";
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;";
    document.body.appendChild(video);
  }
  return video;
}

/** Stop the sound and drop its clip from memory. */
export function stopAlert(): void {
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  playing = null;
}

function play(id: string, tier: AlertTier): void {
  if (!enabled) return;
  const current = playing;
  // Same event, same or lower tier: it is already heard, do not start again.
  if (current?.id === id && TIER_RANK[tier] <= TIER_RANK[current.tier]) return;

  const el = ensureVideo();
  if (!el) return;

  // A new round: the old clip stops and is released before the new one starts.
  el.pause();
  el.removeAttribute("src");
  el.load();
  el.src = CLIP[tier];
  el.volume = volume;
  el.muted = false;
  playing = { id, tier };

  log.debug(`預警 ${id} 分級 ${ALERT_TIER[tier].label}，播放 ${tier} 音軌`);
  void el.play().catch((e) => {
    // A browser may still want a gesture; the welcome page's click usually
    // covers that, so a failure here is left silent.
    console.debug("[alertSound] 警報音軌沒能播放：", e);
  });
}

function applySettings(next: AlertSettings): void {
  enabled = next.sound;
  volume = next.volume;
  if (video) video.volume = volume;
  if (!enabled) stopAlert();
}

export function setEnabled(on: boolean): void {
  enabled = on;
  if (!on) stopAlert();
}

export function setVolume(next: number): void {
  volume = Math.min(1, Math.max(0, next));
  if (video) video.volume = volume;
}

function onEew(data: EewData): void {
  // A cancel ends the sound; it never starts one.
  if (data.status === 3) {
    stopAlert();
    return;
  }
  play(data.id, tierOfMag(data.eq?.mag));
}

/** Wire the graded clips into the EEW lifecycle (idempotent). */
export function initAlertSound(): void {
  if (initialized) return;
  initialized = true;

  applySettings(alertSettings());

  events.on("EewRelease", ({ data }) => onEew(data));
  events.on("EewUpdate", ({ data }) => onEew(data));
  events.on("EewAlert", ({ data }) => onEew(data));
  events.on("EewCancel", () => stopAlert());

  // Settings may change in another window (desktop) or in this one (web).
  void onConfigUpdated((config) => applySettings(alertSettings(config)));
}
