import { IntensityBadge } from "@/components/IntensityBadge";
import { formatTime } from "@/domain/utils";
import { useRerenderIf } from "@/hooks/useTremEvent";
import type { EewDisplay, RtsTriggerDisplay } from "@/lib/variable.ui";
import { ui } from "@/lib/variable.ui";
import { cn } from "@/lib/utils";

interface EewPanelProps {
  eew: EewDisplay | null;
  trigger?: RtsTriggerDisplay | null;
  variant?: "main" | "pip";
}

/** Top-left EEW / RTS trigger card, preserving the three legacy visual states. */
export function EewInfoBox() {
  // show_eew() sends this every 5 s and on each RTS frame while towns trigger,
  // with new objects even when the card would read the same. The signature is
  // every field the card shows (an EEW's id is not shown); idle is "-", never
  // the hook's starting "".
  useRerenderIf(() => {
    const e = ui.currentEew;
    if (e) return `${e.statusClass}|${e.unitText}|${e.serial}|${e.final}|${e.max}|${e.loc}|${e.time}|${e.mag}|${e.depth}`;
    const t = ui.currentTrigger;
    return t ? `${t.max}|${t.locations.map((l) => l.name).join("|")}` : "-";
  }, "EewDisplayUpdate");
  return <EewPanel eew={ui.currentEew} trigger={ui.currentTrigger} />;
}

/** Shared by the main overlay and the independent PiP webview. */
export function EewPanel({ eew, trigger = null, variant = "main" }: EewPanelProps) {
  const triggerTone = trigger
    ? trigger.max > 3
      ? "trigger-high"
      : trigger.max > 1
        ? "trigger-middle"
        : "trigger-low"
    : null;

  const stateClass = eew?.statusClass ?? triggerTone ?? "idle";
  const heading = eew
    ? `${unitPrefix(eew)}${eew.unitText}`
    : trigger
      ? triggerLabel(trigger.max)
      : "暂无生效中的地震预警";

  return (
    <div className={cn("legacy-eew-panel hud-corners", `is-${stateClass}`, variant === "pip" && "is-pip")}>
      <div className="legacy-eew-title">
        <span>{heading}</span>
        {eew && <span className="tabular-nums">{reportNumber(eew)}</span>}
      </div>

      <div className="legacy-eew-body">
        {eew ? (
          <EewDetails eew={eew} />
        ) : trigger ? (
          <div className="legacy-trigger-grid">
            {trigger.locations.map((location, index) => (
              <span key={`${location.name}-${index}`}>{location.name}</span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EewDetails({ eew }: { eew: EewDisplay }) {
  return (
    <div className="legacy-eew-details">
      <div className="legacy-eew-intensity-wrap">
        <IntensityBadge i={eew.max} className="legacy-eew-intensity" />
        <div className="legacy-eew-intensity-label">预估最大震度</div>
      </div>

      <div className="legacy-eew-more">
        <div className="legacy-eew-location">{eew.loc}</div>
        <div className="legacy-eew-time">
          <span className="tabular-nums">{formatTime(eew.time)}</span>
          <span>发震</span>
        </div>
        <div className="legacy-eew-mag-depth">
          <Measurement label="规模">
            <span className="legacy-measure-prefix">𝖬</span>
            {eew.mag.toFixed(1)}
          </Measurement>
          <Measurement label="深度">
            {eew.depth}
            <span className="legacy-measure-suffix">㎞</span>
          </Measurement>
        </div>
      </div>
    </div>
  );
}

function Measurement({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="legacy-eew-measure">
      <span className="legacy-eew-measure-label">{label}</span>
      <span className="legacy-eew-measure-value tabular-nums">{children}</span>
    </div>
  );
}

function unitPrefix(eew: EewDisplay): string {
  if (eew.statusClass === "eew-alert") return "紧急地震速报 ";
  if (eew.statusClass === "eew-cancel") return "取消报 ";
  return "地震速报 ";
}

function reportNumber(eew: EewDisplay): string {
  const suffix = eew.statusClass === "eew-cancel" ? "(取消)" : eew.final ? "(最终报)" : "";
  return `第${eew.serial}报${suffix}`;
}

function triggerLabel(max: number): string {
  if (max > 3) return "强震检测";
  if (max > 1) return "震动检测";
  return "弱反应";
}
