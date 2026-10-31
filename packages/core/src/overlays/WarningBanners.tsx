import { AlertTriangle, WifiOff } from "lucide-react";

import { ui } from "@/lib/variable.ui";
import { useRerenderIf } from "@/hooks/useTremEvent";

/** Top-right warning banners (ports warning-message-box): no-internet + unstable. */
export function WarningBanners() {
  useRerenderIf(() => `${ui.internetError}|${ui.unstable}`, "DataRts", "InternetErrorChange");
  if (!ui.internetError && !ui.unstable) return null;

  return (
    <div className="legacy-warning-banners pointer-events-none absolute right-[315px] top-[30px] z-40 flex flex-col items-center gap-[5px] p-[5px] text-[15px]">
      {ui.internetError && (
        <Banner
          icon={<WifiOff className="h-[25px] w-[25px]" />}
          title="网络异常"
          lines={["网络连接异常", "请稍后重试"]}
          tone="error"
        />
      )}
      {ui.unstable && (
        <Banner
          icon={<AlertTriangle className="h-[25px] w-[25px]" />}
          title="不稳定"
          lines={["受地震活动的影响", "观测点可能不稳定"]}
          tone="warn"
        />
      )}
    </div>
  );
}

function Banner({
  icon,
  title,
  lines,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  lines: string[];
  tone: "error" | "warn";
}) {
  const accent = tone === "warn" ? "var(--rts-trigger-middle)" : "var(--rts-trigger-high)";
  return (
    <div
      className="min-w-[160px] rounded-[10px] border"
      style={{ backgroundColor: "var(--panel-bg)", borderColor: "rgba(140, 180, 220, 0.2)" }}
    >
      <div
        className="flex flex-col gap-[3px] rounded-[9px] px-2.5 py-[7px]"
        style={{ backgroundColor: "rgba(4, 8, 14, 0.5)" }}
      >
        <div className="flex items-center gap-2 font-bold" style={{ color: accent }}>
          {icon}
          <span>{title}</span>
        </div>
        <div className="flex flex-col text-[14px]" style={{ color: "var(--light)" }}>
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
