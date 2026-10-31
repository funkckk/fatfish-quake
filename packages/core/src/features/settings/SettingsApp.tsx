import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getVersion } from "@tauri-apps/api/app";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable as disableAutostart, enable as enableAutostart } from "@tauri-apps/plugin-autostart";
import { arch, type as osType, version as osVersion } from "@tauri-apps/plugin-os";
import { BellRing, ChevronDown, Copy, Download, FolderOpen, Info, Minus, Play, SlidersHorizontal, Volume2, X } from "lucide-react";

import { region, regionReady } from "@/domain/region";
import { search_loc_name } from "@/domain/utils";
import { ALERT_TIER } from "@/features/alertSound/alertSound";
import { STATION_CACHE_KEY } from "@/features/data/resource";
import { isSimEnabled, setSimEnabled } from "@/features/simulator/simulator";
import { useTremEvent } from "@/hooks/useTremEvent";
import { preview } from "@/lib/audioClient";
import { alertSettings, loadConfig, onConfigUpdated, resetConfig, withAlertSettings, writeConfig } from "@/lib/config";
import { AUDIO } from "@/lib/constants";
import { inTauri } from "@/lib/env";
import { exportLogs } from "@/lib/logStore";
import type { IdleMap, Station, TremConfig } from "@/lib/types";
import { versionLabel } from "@/lib/version";

import { StationPicker, type CityStations } from "./StationPicker";

/**
 * The settings window. Four pages, each only what is used:
 *
 *   一般  the station shown on the map, what an idle map shows, starting
 *         with the system, the map's automatic zoom
 *   警報  which events bring the window forward, speech announcements
 *   音效  each sound effect, on or off
 *   關於  version and updates, data sources, links, and the reset
 *
 * Every change is saved at once (config.rs broadcasts it to the main window).
 * The page also follows changes made elsewhere — the main window moves the
 * station when its list changes — so it never writes back an old copy.
 *
 * The web has no second window: the same page opens over the map
 * (`SettingsModal`), without what only the desktop does — bringing a window
 * forward, starting with the system, updating itself.
 */
const TABS = [
  { id: "general", label: "一般", icon: SlidersHorizontal },
  { id: "alerts", label: "警报", icon: BellRing },
  { id: "sound", label: "音效", icon: Volume2 },
  { id: "alert-sound", label: "警报与音效", icon: Volume2 },
  { id: "about", label: "关于", icon: Info },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** The sound effects by group: [config key, name, when it plays, clip]. */
const SOUNDS: [string, [string, string, string, string][]][] = [
  [
    "地震预警",
    [
      ["sound-effects-EEW", "地震预警", "收到地震预警时", AUDIO.EEW],
      ["sound-effects-EEW2", "紧急地震速报", "预警升级为警报时", AUDIO.ALERT],
      ["sound-effects-Update", "预警更新", "预警内容更新时", AUDIO.UPDATE],
    ],
  ],
  [
    "地震检知",
    [
      ["sound-effects-Shindo0", "检知・弱", "测站侦测到摇晃", AUDIO.SHINDO0],
      ["sound-effects-Shindo1", "检知・中", "测站震度 2 以上", AUDIO.SHINDO1],
      ["sound-effects-Shindo2", "检知・强", "测站震度 4 以上", AUDIO.SHINDO2],
      ["sound-effects-PGA1", "加速度・中", "测站加速度超过 8 gal", AUDIO.PGA1],
      ["sound-effects-PGA2", "加速度・强", "测站加速度超过 200 gal", AUDIO.PGA2],
    ],
  ],
  [
    "报告",
    [
      ["sound-effects-PAlert", "震度速报", "收到震度速报或长周期地震动时", AUDIO.INTENSITY],
      ["sound-effects-Report", "地震报告", "收到地震报告时", AUDIO.REPORT],
    ],
  ],
];

const WINDOW_EVENTS: [string, string][] = [
  ["show-window-eew", "地震预警"],
  ["show-window-detect", "地震检知"],
  ["show-window-rts-intensity", "震度速报"],
  ["show-window-report", "地震报告"],
];

/** The three alert tiers, as explained on the settings page. */
const TIERS: { tier: "light" | "medium" | "strong"; label: string; rule: string }[] = [
  { tier: "light", label: "轻度警报", rule: "M ≤ 4.0" },
  { tier: "medium", label: "中等警报", rule: "4.0 < M ≤ 7.0" },
  { tier: "strong", label: "强烈警报", rule: "M > 7.0" },
];

const REPO = "https://github.com/ExpTechTW/TREM-Lite";

function loadCachedStations(): Record<string, Station> {
  try {
    const cached = localStorage.getItem(STATION_CACHE_KEY);
    return cached ? (JSON.parse(cached) as Record<string, Station>) : {};
  } catch {
    return {};
  }
}

export function SettingsApp({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState<TabId>(() => {
    const savedTab = localStorage.getItem("setting-tab");
    return TABS.find((t) => t.id === savedTab)?.id ?? "general";
  });
  const [config, setConfig] = useState<TremConfig | null>(null);
  const [version, setVersion] = useState("");
  const [system] = useState(() => {
    if (!inTauri) return "";
    try {
      return `${osType()} ${osVersion()} (${arch()})`;
    } catch {
      return ""; // unavailable for a moment during a dev reload
    }
  });
  const [status, setStatus] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [regionLoaded, setRegionLoaded] = useState(false);
  const [stationData] = useState(loadCachedStations);
  const [simOn, setSimOn] = useState(isSimEnabled);
  useTremEvent("SimStateChange", () => setSimOn(isSimEnabled()));

  useEffect(() => {
    void loadConfig(true).then(setConfig);
    const unlisten = onConfigUpdated(setConfig);
    void regionReady.then(() => setRegionLoaded(true));
    if (inTauri) {
      void getVersion()
        .then((v) => setVersion(versionLabel(v)))
        .catch(() => {});
    }
    return () => void unlisten.then((un) => un());
  }, []);

  // A message fades after a few seconds.
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(""), 3500);
    return () => clearTimeout(timer);
  }, [status]);

  const station = config ? String(config["realtime-station-id"]) : "";
  const stationTree = useMemo(() => stationsByPlace(stationData, station, regionLoaded), [stationData, station, regionLoaded]);

  if (!config) {
    return <div className="settings-loading">加载中…</div>;
  }

  const save = (next: TremConfig) => {
    setConfig(next);
    void writeConfig(next).catch((error) => setStatus(`保存失败：${String(error)}`));
  };
  const alert = alertSettings(config);
  const check = (key: string) => !!config["check-box"][key];
  const setCheck = (key: string, value: boolean) =>
    save({ ...config, "check-box": { ...config["check-box"], [key]: value } });

  const selectTab = (next: TabId) => {
    setTab(next);
    setConfirmReset(false);
    localStorage.setItem("setting-tab", next);
  };

  const toggleAutostart = async (on: boolean) => {
    try {
      if (inTauri) await (on ? enableAutostart() : disableAutostart());
      setCheck("other-auto-start", on);
    } catch (error) {
      setStatus(`开机启动设置失败：${String(error)}`);
    }
  };

  const checkUpdate = async () => {
    setStatus("正在检查更新…");
    try {
      const progress = new Channel<{ downloaded: number; total: number | null }>();
      progress.onmessage = ({ downloaded, total }) =>
        setStatus(`下载更新中…${total ? ` ${Math.round((downloaded / total) * 100)}%` : ""}`);
      const result = await invoke<{ status: "upToDate"; current: string } | { status: "staged"; version: string }>(
        "update_check",
        { onProgress: progress },
      );
      setStatus(
        result.status === "staged"
          ? `已下载 ${versionLabel(result.version)}，下次启动时更新`
          : `已是最新版本（${versionLabel(result.current)}）`,
      );
    } catch (error) {
      setStatus(`检查更新失败：${String(error)}`);
    }
  };

  const copyInfo = async () => {
    const text = `肥鱼quake ${version || "(web)"}\n${system || navigator.userAgent}`;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("已复制版本信息");
    } catch {
      setStatus("复制失败");
    }
  };

  /** Desktop: the log folder. Web: every hour kept, in one file. */
  const openLogs = async () => {
    if (inTauri) {
      try {
        await invoke("logs_open");
      } catch {
        setStatus("无法打开日志文件夹");
      }
      return;
    }
    const text = await exportLogs();
    if (!text) return setStatus("还没有日志");
    const d = new Date();
    const two = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    link.download = `trem-lite-${stamp}.log`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  };

  const reset = async () => {
    setConfirmReset(false);
    setConfig(await resetConfig());
    setStatus("已还原默认设置");
  };

  /** Web: close settings so the map is clickable. Desktop: it is another window. */
  const openSimulator = () => {
    setSimEnabled(true);
    if (onClose) onClose();
    else setStatus("已开启模拟器，回到主窗口在地图上点击放置震中");
  };

  return (
    <div className={onClose ? "settings-shell is-embedded" : "settings-shell"}>
      <aside className="settings-sidebar" data-tauri-drag-region>
        <div className="settings-brand" data-tauri-drag-region>
          肥鱼quake
        </div>
        <nav>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "is-active" : undefined}
              onClick={() => selectTab(id)}
            >
              <Icon aria-hidden />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="settings-main">
        <header className="settings-header" data-tauri-drag-region>
          <h1 data-tauri-drag-region>{TABS.find((t) => t.id === tab)?.label}</h1>
          {onClose ? (
            <div className="settings-window-controls">
              <button type="button" aria-label="关闭" onClick={onClose}>
                <X />
              </button>
            </div>
          ) : (
            inTauri && (
              <div className="settings-window-controls">
                <button type="button" aria-label="最小化" onClick={() => void getCurrentWindow().minimize()}>
                  <Minus />
                </button>
                <button type="button" aria-label="关闭" onClick={() => void getCurrentWindow().close()}>
                  <X />
                </button>
              </div>
            )
          )}
        </header>

        <div className="settings-scroll">
          {tab === "general" && (
            <>
              <Group title="我的测站" note="主画面显示这个测站的即时震度与加速度。">
                <StationPicker
                  tree={stationTree}
                  value={station}
                  onPick={(id) => save({ ...config, "realtime-station-id": id })}
                />
              </Group>
              <Group title="地图">
                <Select
                  label="无地震时显示"
                  hint="没有地震预警、检知或震度速报时，地图上默认看到的内容"
                  value={config["idle-map"] === "rts" ? "rts" : "report"}
                  options={[
                    ["report", "地震报告"],
                    ["rts", "即时测站（RTS）"],
                  ]}
                  onChange={(value) => save({ ...config, "idle-map": value })}
                />
                <Toggle
                  label="自动缩放到事件"
                  hint="有地震预警、检知或报告时，地图自动移到相关区域"
                  checked={!check("graphics-block-auto-zoom")}
                  onChange={(on) => setCheck("graphics-block-auto-zoom", !on)}
                />
              </Group>
              {inTauri && (
                <Group title="系统">
                  <Toggle
                    label="开机时自动启动"
                    hint="登录后在后台启动，缩在系统托盘"
                    checked={check("other-auto-start")}
                    onChange={(on) => void toggleAutostart(on)}
                  />
                </Group>
              )}
            </>
          )}

          {tab === "alerts" && (
            <>
              {inTauri && (
                <Group title="弹出主窗口" note="主窗口缩小或隐藏时，发生以下事件会把它叫回前台。">
                  {WINDOW_EVENTS.map(([key, label]) => (
                    <Toggle key={key} label={label} checked={check(key)} onChange={(on) => setCheck(key, on)} />
                  ))}
                </Group>
              )}
              <Group title="语音">
                <Toggle
                  label="语音播报"
                  hint="朗读地震预警、震度速报与地震报告的内容"
                  checked={check("other-tts")}
                  onChange={(on) => setCheck("other-tts", on)}
                />
              </Group>
            </>
          )}

          {tab === "sound" &&
            SOUNDS.map(([group, sounds]) => (
              <Group key={group} title={group}>
                {sounds.map(([key, label, hint, clip]) => (
                  <Toggle
                    key={key}
                    label={label}
                    hint={hint}
                    checked={check(key)}
                    onChange={(on) => setCheck(key, on)}
                    extra={<PreviewButton sound={clip} />}
                  />
                ))}
              </Group>
            ))}

          {tab === "alert-sound" && (
            <>
              <Group
                title="警报声音"
                note="地震预警发生时，按规模播放对应等级的警报音；音轨在后台播放，不显示任何画面。"
              >
                <Toggle
                  label="警报声音"
                  hint="关闭后不再播放分级警报音"
                  checked={alert.sound}
                  onChange={(on) => save(withAlertSettings(config, { sound: on }))}
                />
              </Group>

              <Group title="警报音量">
                <VolumeRow
                  value={alert.volume}
                  onCommit={(volume) => save(withAlertSettings(config, { volume }))}
                />
              </Group>

              <Group title="分级说明" note="预警的规模决定播放哪一段警报音，以及面板与分级提示的颜色。">
                {TIERS.map(({ tier, label, rule }) => (
                  <Row
                    key={tier}
                    label={
                      <span className="settings-tier-label">
                        <span
                          className="settings-tier-dot"
                          style={{ backgroundColor: ALERT_TIER[tier].color }}
                        />
                        {label}
                      </span>
                    }
                  >
                    <span className="settings-value">{rule}</span>
                  </Row>
                ))}
              </Group>

              <Group title="地震模拟器">
                <Toggle
                  label="地震模拟器"
                  hint="开启后在地图上点击即可放置模拟震中，用于演示警报与波圈"
                  checked={simOn}
                  onChange={(on) => setSimEnabled(on)}
                />
                <Row label="在地图上放置模拟震中">
                  <button type="button" onClick={openSimulator}>
                    打开模拟器
                  </button>
                </Row>
              </Group>
            </>
          )}

          {tab === "about" && (
            <>
              <Group title="版本" note={inTauri ? "新版本会在后台自动下载。" : undefined}>
                <Row label="肥鱼quake">
                  <div className="settings-actions">
                    <span className="settings-value">{version || "网页版"}</span>
                    {inTauri && (
                      <button type="button" onClick={() => void checkUpdate()}>
                        检查更新
                      </button>
                    )}
                  </div>
                </Row>
                {inTauri && (
                  <Toggle
                    label="自动重新启动以完成更新"
                    hint="新版本下载后，在没有地震事件时自动重新启动并应用；关闭则等下次开启时应用"
                    checked={check("update-auto-restart")}
                    onChange={(on) => setCheck("update-auto-restart", on)}
                  />
                )}
                {system && (
                  <Row label="系統">
                    <span className="settings-value">{system}</span>
                  </Row>
                )}
                <Row label="报告问题时附上版本与系统">
                  <button type="button" onClick={() => void copyInfo()}>
                    <Copy aria-hidden />
                    复制
                  </button>
                </Row>
                <Row label={inTauri ? "日志（最近 7 天，每小时一份）" : "日志（存在这个浏览器，最近 7 天内）"}>
                  <button type="button" onClick={() => void openLogs()}>
                    {inTauri ? <FolderOpen aria-hidden /> : <Download aria-hidden />}
                    {inTauri ? "打开文件夹" : "下载"}
                  </button>
                </Row>
              </Group>
              <Group title="数据来源">
                <Row label="地震预警、地震报告">
                  <span className="settings-value">交通部中央气象署</span>
                </Row>
                <Row label="即时测站、震度速报">
                  <span className="settings-value">ExpTech Studio（TREM 测站网）</span>
                </Row>
              </Group>
              <Group title="链接">
                <Row label="源代码与问题反馈">
                  <a href={REPO} target="_blank" rel="noreferrer">
                    GitHub
                  </a>
                </Row>
                <Row label="贡献者">
                  <a href={`${REPO}/graphs/contributors`} target="_blank" rel="noreferrer">
                    查看
                  </a>
                </Row>
              </Group>
              <Group title="还原">
                <Row label="将所有设置还原为默认值">
                  {confirmReset ? (
                    <div className="settings-actions">
                      <button type="button" onClick={() => setConfirmReset(false)}>
                        取消
                      </button>
                      <button type="button" className="is-danger" onClick={() => void reset()}>
                        确定还原
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="is-danger" onClick={() => setConfirmReset(true)}>
                      还原默认
                    </button>
                  )}
                </Row>
              </Group>
            </>
          )}
        </div>

        {status && (
          <div className="settings-toast" role="status">
            {status}
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * The settings page over the map, for the web. Esc or a click outside closes
 * it. Portalled to <body>: under the nav bar it would stay within the bar's
 * stacking context, below the map's other overlays.
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="settings-modal"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <SettingsApp onClose={onClose} />
    </div>,
    document.body,
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <h2>{title}</h2>
      <div className="settings-card">{children}</div>
      {note && <p className="settings-note">{note}</p>}
    </section>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <span className="settings-label">{label}</span>
      {children}
    </div>
  );
}

/** Volume slider: the value follows the drag, the config is written on release. */
function VolumeRow({ value, onCommit }: { value: number; onCommit: (volume: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <Row label="音量">
      <div className="settings-slider-wrap">
        <input
          type="range"
          className="settings-slider"
          min={0}
          max={1}
          step={0.05}
          value={draft}
          aria-label="警报音量"
          onChange={(event) => setDraft(Number(event.target.value))}
          onPointerUp={(event) => onCommit(Number(event.currentTarget.value))}
          onKeyUp={(event) => onCommit(Number(event.currentTarget.value))}
          onBlur={(event) => onCommit(Number(event.currentTarget.value))}
        />
        <span className="settings-value tabular-nums">{Math.round(draft * 100)}%</span>
      </div>
    </Row>
  );
}

/** 試聽: plays the clip once; a second press cuts the first off. */
function PreviewButton({ sound }: { sound: string }) {
  return (
    <button type="button" className="settings-preview" onClick={() => preview(sound)}>
      <Play aria-hidden />
      试听
    </button>
  );
}

/**
 * The stations to choose from, by city and town in the region table's order
 * (north to south). Only those the server takes data from (`work`): a station
 * out of service would show nothing. The one chosen is listed even so.
 */
function stationsByPlace(stations: Record<string, Station>, chosen: string, regionLoaded: boolean): CityStations[] {
  if (!regionLoaded) return [];
  const byTown = new Map<string, string[]>();
  for (const [id, s] of Object.entries(stations)) {
    if (s.work === false && id !== chosen) continue;
    const code = s.info.at(-1)?.code;
    const place = code ? search_loc_name(code) : null;
    if (!place) continue;
    const key = `${place.city}|${place.town}`;
    byTown.set(key, [...(byTown.get(key) ?? []), id]);
  }
  return Object.keys(region).flatMap((city) => {
    const towns = Object.keys(region[city]).flatMap((town) => {
      const ids = byTown.get(`${city}|${town}`);
      return ids ? [{ town, ids: ids.sort() }] : [];
    });
    return towns.length ? [{ city, towns }] : [];
  });
}

function Select({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: IdleMap;
  options: readonly (readonly [IdleMap, string])[];
  onChange: (value: IdleMap) => void;
}) {
  const id = useId();
  return (
    <div className="settings-row settings-select-row">
      <label htmlFor={id} className="settings-label">
        {label}
        {hint && <small>{hint}</small>}
      </label>
      <div className="settings-select-wrap">
        <select
          id={id}
          className="settings-select"
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "report" || next === "rts") onChange(next);
          }}
        >
          {options.map(([option, text]) => (
            <option key={option} value={option}>
              {text}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden />
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  extra,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Placed between the label and the switch, outside the label's click. */
  extra?: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="settings-row settings-toggle-row">
      <label htmlFor={id} className="settings-label">
        {label}
        {hint && <small>{hint}</small>}
      </label>
      {extra}
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="settings-switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}
