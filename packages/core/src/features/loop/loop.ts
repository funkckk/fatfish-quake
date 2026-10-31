// Ported from legacy/src/js/index/core/loop.js
// The #time text + internet-warning DOM move to React overlays; this drives the
// map flash (cross/box), the internet-error flag, and periodic NTP sync (Rust).
import { LAST_DATA_TIMEOUT_ERROR } from "@/lib/constants";
import { events } from "@/lib/events";
import { realNow, startClock } from "@/lib/ntp";
import { ui } from "@/lib/variable.ui";
import { variable } from "@/lib/variable";

import { refresh_box } from "@/features/box/box";
import { rtsAsleep } from "@/features/data/data";
import { refresh_cross } from "@/features/cross/cross";

let flash = false;
let mapInitialized = false;
let mapLoopInterval: ReturnType<typeof setInterval> | null = null;

/** A cross that blinks, or detection boxes / their stand-in wavefronts. */
function needsBeat(): boolean {
  for (const eew of variable.data.eew) if (eew.status != 3) return true;
  const box = variable.data.rts?.box;
  return !!box && Object.keys(box).length > 0;
}

function stopBeat(): void {
  if (!mapLoopInterval) return;
  clearInterval(mapLoopInterval);
  mapLoopInterval = null;
}

function beat(): void {
  if (!needsBeat()) {
    refresh_cross(false);
    refresh_box(false);
    stopBeat();
    return;
  }
  flash = !flash;
  refresh_cross(flash);
  refresh_box(flash);
}

/** Start the blink if something needs it. Idle, this timer does not run. */
function poke(): void {
  if (!mapInitialized || mapLoopInterval || !needsBeat()) return;
  flash = true;
  refresh_cross(flash);
  refresh_box(flash);
  mapLoopInterval = setInterval(beat, 500);
}

export function initLoop(): void {
  // 1s 斷線偵測（沒有資料事件可依賴，故仍需週期檢查）；只有旗標改變時才發事件。
  // 主視窗隱藏時 RTS 串流休眠，只在有測站觸發時才送資料——沒資料不代表斷線。
  setInterval(() => {
    const err =
      variable.play_mode !== 2 &&
      variable.play_mode !== 3 &&
      !rtsAsleep() &&
      realNow() - variable.cache.last_data_time > LAST_DATA_TIMEOUT_ERROR;
    if (err !== ui.internetError) {
      ui.internetError = err;
      events.emit("InternetErrorChange", err);
    }
  }, 1000);

  // 500ms 閃爍只在有十字或警戒框時跑。平時沒有東西要閃，計時器不啟動。
  events.on("MapLoad", () => {
    if (mapInitialized) return;
    mapInitialized = true;
    poke();
  });
  events.on("DataRts", poke);
  events.on("EewRelease", poke);
  events.on("EewUpdate", poke);

  startClock();
}
