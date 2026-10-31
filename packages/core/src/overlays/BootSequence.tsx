import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** [label, status] — rendered as `> LABEL ....... STATUS`, then a green [ OK ]. */
const LINES: [string, string][] = [
  ["SEISMIC NET", "ONLINE"],
  ["P/S WAVE ENGINE", "READY"],
  ["STATION MESH", "128 NODES"],
  ["SAT UPLINK", "SYNCED"],
  ["MAP RENDERER", "WEBGL2"],
  ["ALERT AUDIO", "ARMED"],
  ["NTP CLOCK", "LOCKED"],
  ["ALL SYSTEMS", "GO"],
];

const TEXT = LINES.map(([label, status]) => {
  const head = `> ${label} `;
  const dots = ".".repeat(Math.max(2, 30 - head.length - status.length));
  return `${head}${dots} ${status}`;
});
const TOTAL = TEXT.reduce((sum, line) => sum + line.length, 0);
const LINE_START = TEXT.map((_, i) => TEXT.slice(0, i).reduce((sum, line) => sum + line.length, 0));

const CHAR_MS = 9;
const HOLD_MS = 320;
const EXIT_MS = 620;
const DONE_KEY = "trem.boot.done";

/**
 * First-visit boot self-check: monospace status lines typed over black, then
 * the sheet slides up and away, revealing whatever is under it (the welcome
 * card on the web, the map on the desktop). Once per session; never under
 * prefers-reduced-motion. Pure decoration — nothing waits on it.
 */
export function BootSequence() {
  const [skip] = useState(() => {
    try {
      return (
        sessionStorage.getItem(DONE_KEY) === "1" ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    } catch {
      return false;
    }
  });
  const [chars, setChars] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (skip) return;
    try {
      sessionStorage.setItem(DONE_KEY, "1");
    } catch {
      /* private mode: the sequence simply replays next load */
    }
    const typer = setInterval(() => setChars((n) => Math.min(n + 1, TOTAL)), CHAR_MS);
    return () => clearInterval(typer);
  }, [skip]);

  useEffect(() => {
    if (chars < TOTAL) return;
    const hold = setTimeout(() => setLeaving(true), HOLD_MS);
    const out = setTimeout(() => setGone(true), HOLD_MS + EXIT_MS);
    return () => {
      clearTimeout(hold);
      clearTimeout(out);
    };
  }, [chars]);

  if (skip || gone) return null;

  return (
    <div className={cn("boot-seq", leaving && "is-leaving")} aria-hidden="true">
      <div className="boot-panel">
        <div className="boot-head">肥鱼QUAKE // SEISMIC COMMAND BOOT</div>
        {TEXT.map((line, i) => {
          const shown = Math.max(0, Math.min(chars - LINE_START[i], line.length));
          if (shown <= 0) return null;
          return (
            <div className="boot-line" key={i}>
              {line.slice(0, shown)}
              {shown === line.length && <span className="boot-ok"> [ OK ]</span>}
            </div>
          );
        })}
        <span className="boot-caret">▌</span>
      </div>
    </div>
  );
}
