import { useState } from "react";
import { Crosshair, Settings } from "lucide-react";

import { SettingsModal } from "@/features/settings/SettingsApp";
import { inTauri } from "@/lib/env";
import { openSettings } from "@/lib/windows";
import { focus_reset, isAutoFocusLocked } from "@/features/focus/focus";
import { useTremEvent } from "@/hooks/useTremEvent";

import { TimeBar } from "./TimeBar";

/**
 * Bottom-left control cluster — ports legacy `.nav-bar-wrapper`: a single flex ROW
 * of icon buttons followed by the inline time pill (legacy `.connect #time`).
 * left:3px / bottom:5px, 30×30 buttons with 20px icons, exactly like nav_bar/box.css.
 */
export function NavBar() {
  // 自動聚焦被使用者手動操作鎖定時，定位鈕變紅（對應舊版 #focus 紅/白）。
  const [locked, setLocked] = useState(isAutoFocusLocked());
  // The web opens settings over the map; the desktop has a window for it.
  const [settingsOpen, setSettingsOpen] = useState(false);
  useTremEvent("FocusLockChange", (v) => setLocked(v));

  return (
    <div
      className="legacy-nav absolute bottom-[5px] left-[3px] z-30 flex flex-row items-center gap-[3px] text-[15px] font-medium"
      style={{ color: "var(--light)" }}
    >
      <NavPanelButton title="设置" onClick={() => (inTauri ? void openSettings() : setSettingsOpen(true))}>
        <Settings className="h-5 w-5" />
      </NavPanelButton>
      <NavPanelButton
        title={locked ? "定位（自动追踪已暂停，点击恢复）" : "定位"}
        onClick={() => focus_reset(true)}
      >
        <Crosshair className="h-5 w-5" style={locked ? { color: "#ff4d4d" } : undefined} />
      </NavPanelButton>
      <TimeBar />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function NavPanelButton({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[#00000008] bg-[var(--panel-bg)] transition-colors hover:border-[#38d6e873] hover:bg-[#16283ab8] hover:text-[#7ee7f2]"
      style={{ color: "var(--light)" }}
    >
      {children}
    </button>
  );
}
