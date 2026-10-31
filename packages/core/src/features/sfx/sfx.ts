/**
 * Synthesized sci-fi sound effects — no audio files, every tone is built on
 * the spot with oscillators and gain envelopes.
 *
 * What plays here and what does not: lib/audioClient.ts already routes
 * EewRelease (EEW/ALERT), EewAlert (ALERT) and ReportRelease (REPORT) to real
 * clips — on the web through lib/webAudio.ts, whose mp3s ship with the build
 * — so subscribing those events here too would double every sound. This
 * module only covers what is otherwise silent: EewCancel (no clip anywhere)
 * and a quiet UI click "blip". The alert/release/report synths still exist as
 * functions so `?demo-sfx=1` can audition the full set.
 *
 * The AudioContext is created lazily and resumed on the first user gesture
 * (browsers refuse sound before one); the welcome dialog's button click
 * satisfies that naturally. Everything runs through one master gain, capped
 * well below clipping.
 */
import { events } from "@/lib/events";
import { createLogger } from "@/lib/logger";

const log = createLogger("sfx");

/** Master ceiling: every voice's own gain sits under this. */
const MASTER_GAIN = 0.4;
/** UI blips are meant to be felt more than heard. */
const BLIP_GAIN = 0.05;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** Create/resume the context; returns null where Web Audio is unavailable. */
function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
    } catch (e) {
      log.warn("這個環境不能用 Web Audio，合成音效都不會播：", e);
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** One enveloped voice: an oscillator from `at` for `dur` seconds. */
function tone(opts: {
  type: OscillatorType;
  at: number;
  dur: number;
  from: number;
  to?: number;
  gain: number;
  attack?: number;
}): void {
  const audio_ = audio();
  if (!audio_ || !master) return;
  const t0 = audio_.currentTime + opts.at;
  const t1 = t0 + opts.dur;
  const osc = audio_.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.from, t0);
  if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t1);
  const env = audio_.createGain();
  const attack = opts.attack ?? 0.005;
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(opts.gain, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t1 + 0.05);
}

/** 警報：急促三連上升掃頻 + 持續低頻脈衝，約 1.2 s。 */
export function playEewAlert(): void {
  for (let i = 0; i < 3; i++) {
    tone({ type: "sawtooth", at: i * 0.18, dur: 0.16, from: 520 + i * 160, to: 900 + i * 240, gain: 0.5 });
  }
  // 低頻脈衝墊在掃頻下，撐滿整段。
  for (let i = 0; i < 6; i++) {
    tone({ type: "sine", at: i * 0.2, dur: 0.14, from: 110, gain: 0.35, attack: 0.01 });
  }
}

/** 預警：兩聲清脆高頻「滴-滴」。 */
export function playEewRelease(): void {
  tone({ type: "sine", at: 0, dur: 0.09, from: 1568, gain: 0.5 });
  tone({ type: "sine", at: 0.16, dur: 0.09, from: 1568, gain: 0.5 });
}

/** 取消：一聲低沉下掃。 */
export function playEewCancel(): void {
  tone({ type: "triangle", at: 0, dur: 0.5, from: 320, to: 70, gain: 0.6, attack: 0.01 });
}

/** 報告：柔和鐘聲短音（基音 + 泛音，指數衰減）。 */
export function playReportRelease(): void {
  tone({ type: "sine", at: 0, dur: 0.6, from: 1046.5, gain: 0.4, attack: 0.003 });
  tone({ type: "sine", at: 0, dur: 0.45, from: 2093, gain: 0.12, attack: 0.003 });
}

/** 8 ms 的輕微 blip，點按鈕/連結時墊在底下。 */
function playBlip(): void {
  tone({ type: "square", at: 0, dur: 0.008, from: 2400, gain: BLIP_GAIN, attack: 0.001 });
}

function isInteractive(el: Element | null): boolean {
  return !!el?.closest?.("button, a, [role=button]");
}

/** `?demo-sfx=1`：載入 3 秒後依序試播四種音效各一次。 */
function armDemo(): void {
  if (typeof location === "undefined") return;
  if (new URLSearchParams(location.search).get("demo-sfx") !== "1") return;
  setTimeout(() => {
    log.info("demo-sfx：依序試播 警報 → 預警 → 取消 → 報告");
    playEewAlert();
    setTimeout(playEewRelease, 1_500);
    setTimeout(playEewCancel, 2_200);
    setTimeout(playReportRelease, 3_000);
  }, 3_000);
}

let bound = false;

/** Wire the synth into the event bus and UI clicks (idempotent). */
export function initSfx(): void {
  if (bound || typeof document === "undefined") return;
  bound = true;

  // 首次手勢解鎖；歡迎頁按鈕的點擊天然滿足。capture 確保搶在頁面邏輯前。
  document.addEventListener("pointerdown", () => audio(), { capture: true, once: true });

  // EewRelease/EewAlert/ReportRelease 已由 audioClient 播實體音效，這裡不疊；
  // EewCancel 全端都沒有聲音，由合成補上。
  events.on("EewCancel", () => {
    log.info("預警取消，播放下掃音");
    playEewCancel();
  });

  document.addEventListener(
    "click",
    (ev) => {
      if (isInteractive(ev.target as Element | null)) playBlip();
    },
    { capture: true },
  );

  armDemo();
}
