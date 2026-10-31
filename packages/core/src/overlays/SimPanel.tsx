import { useEffect, useState } from "react";

import { ALERT_TIER, tierOfMag, type AlertTier } from "@/features/alertSound/alertSound";
import { getSimState, setSimEnabled, setSimParams } from "@/features/simulator/simulator";
import { useTremEvent } from "@/hooks/useTremEvent";

/** Left-side earthquake simulator: magnitude/depth sliders, live tier, last placement. */
export function SimPanel() {
  const [state, setState] = useState(getSimState);
  useTremEvent("SimStateChange", () => setState(getSimState()));
  useTremEvent("SimPlaced", () => setState(getSimState()));
  // The simulator boots with the map, after this component's first render.
  useEffect(() => setState(getSimState()), []);

  if (!state.enabled) return null;

  const tier = tierOfMag(state.params.mag);
  const meta = ALERT_TIER[tier];

  return (
    <div className="sim-panel hud-corners" role="region" aria-label="地震模拟器">
      <div className="sim-panel-head">
        <span className="sim-panel-title">地震模拟器</span>
        <input
          type="checkbox"
          role="switch"
          className="settings-switch"
          aria-label="开启或关闭地震模拟器"
          checked={state.enabled}
          onChange={(event) => setSimEnabled(event.target.checked)}
        />
      </div>

      <label className="sim-field">
        <span className="sim-field-row">
          <span>震级</span>
          <span className="tabular-nums">M {state.params.mag.toFixed(1)}</span>
        </span>
        <input
          type="range"
          className="sim-range"
          min={1}
          max={9}
          step={0.1}
          value={state.params.mag}
          onChange={(event) => setSimParams({ mag: Number(event.target.value) })}
        />
      </label>

      <label className="sim-field">
        <span className="sim-field-row">
          <span>深度</span>
          <span className="tabular-nums">{state.params.depth} km</span>
        </span>
        <input
          type="range"
          className="sim-range"
          min={0}
          max={300}
          step={5}
          value={state.params.depth}
          onChange={(event) => setSimParams({ depth: Number(event.target.value) })}
        />
      </label>

      <div className="sim-tier">
        <span
          className="sim-tier-dot"
          style={{ backgroundColor: meta.color, color: meta.color }}
        />
        <span>警报分级：{meta.label}</span>
        <span className="sim-tier-rule">{tierRule(tier)}</span>
      </div>

      <p className="sim-hint">开启后在地图上点击即可放置震中。</p>
      <div className="sim-last">
        最近一次：
        {state.last
          ? `${state.last.lat.toFixed(2)}, ${state.last.lon.toFixed(2)} · M${state.last.mag.toFixed(1)}`
          : "尚未放置"}
      </div>
    </div>
  );
}

function tierRule(tier: AlertTier): string {
  if (tier === "light") return "M ≤ 4.0";
  if (tier === "medium") return "4.0 < M ≤ 7.0";
  return "M > 7.0";
}
