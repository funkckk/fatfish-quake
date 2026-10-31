/**
 * Decorative screen-edge HUD: four breathing corner brackets, a top hairline
 * and a bottom-centre mono tag. Pointer-transparent, paint-only, mounted once
 * by the app shell — it never touches data or layout.
 */
export function HudFrame() {
  return (
    <div className="hud-frame" aria-hidden="true">
      <span className="hud-corner hud-tl" />
      <span className="hud-corner hud-tr" />
      <span className="hud-corner hud-bl" />
      <span className="hud-corner hud-br" />
      <span className="hud-edge" />
      <span className="hud-tag">SEISMIC COMMAND // GRID TW-01</span>
    </div>
  );
}
