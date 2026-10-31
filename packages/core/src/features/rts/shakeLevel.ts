/**
 * The shake level — rts-image-go's ShakeLevel (internal/intensity/
 * shakelevel.go, shared with palert-core): an earthquake's impact, range ×
 * severity, from each station's 計測震度, whatever the station density.
 *
 * Stations are binned into a 0.05° grid (about 5.5 km); each cell keeps its
 * strongest intensity, and every cell above 計測震度 0 adds (I − 0)^1.5. The sum
 * is scaled by 1.4, so quiet times score 0 and a quake felt island-wide about
 * 2000. A dense city thus scores no more than a sparsely instrumented county
 * shaking just as hard.
 *
 * `i` is the rts.v1 feed's, which is not floored at 0: sub-felt noise is
 * negative and adds nothing.
 */
const CELL = 0.05;
const I0 = 0;
const GAMMA = 1.5;
const K = 1.4;

export interface ShakePoint {
  lon: number;
  lat: number;
  i: number;
}

/** Reused across frames. `shakeLevel` does not call itself. */
const grid = new Map<number, number>();

export function shakeLevel(points: Iterable<ShakePoint>): number {
  grid.clear();
  for (const p of points) {
    if (Number.isNaN(p.i)) continue;
    // lat/0.05 stays well under 100000, so each cell has one key.
    const key = Math.floor(p.lon / CELL) * 100000 + Math.floor(p.lat / CELL);
    const strongest = grid.get(key);
    if (strongest === undefined || p.i > strongest) grid.set(key, p.i);
  }
  let sum = 0;
  for (const i of grid.values()) {
    const d = i - I0;
    if (d > 0) sum += d ** GAMMA;
  }
  return Math.round(K * sum);
}
