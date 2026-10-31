import { useEffect, useRef } from "react";
import { Activity, FileText, RadioTower, Volume2 } from "lucide-react";

import { FishQuakeLogo } from "@/components/FishQuakeLogo";
import { createLogger } from "@/lib/logger";
import { unlockSpeech } from "@/lib/speechClient";
import { webAudio } from "@/lib/webAudio";

const REPO = "https://github.com/ExpTechTW/TREM-Lite";

/**
 * The web's welcome, shown at every load and closed only by its button. A
 * browser plays no sound and speaks nothing until the page has been clicked,
 * so without this an EEW's alarm would be silent; the button's click is what
 * unlocks both (webAudio, speechClient). There is no other way out: no close
 * button, no backdrop click, no Esc.
 */
const log = createLogger("app");

export function WebWelcome({ onStart }: { onStart: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);

  const start = () => {
    log.info("使用者按下「開始使用」：解鎖音效與語音");
    webAudio.unlock();
    unlockSpeech();
    onStart();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="web-welcome-title"
      className="ww-root fixed inset-0 z-[5000] flex items-center justify-center p-4"
    >
      <div className="ww-card">
        <div className="flex items-center gap-4">
          <div className="ww-logo">
            <span className="ww-radar" aria-hidden />
            <FishQuakeLogo className="h-14 w-14" />
          </div>
          <div>
            <h1 id="web-welcome-title" className="ww-title">
              肥鱼 <span>QUAKE</span>
            </h1>
            <p className="ww-sub">全球地震即时监测</p>
          </div>
        </div>

        <p className="ww-desc">
          开源的地震速报软件：整合日本 JMA、中国 CENC、韩国 KMA、四川与福建等多家机构的即时预警，并以自建测站网显示各地即时震度，地震发生的第一时间就能收到强震警报与地震情报。
        </p>

        <div className="ww-features">
          <div className="ww-feature">
            <Activity aria-hidden />
            <b>即时震度</b>
            <span>自建测站网</span>
          </div>
          <div className="ww-feature">
            <RadioTower aria-hidden />
            <b>全球预警</b>
            <span>多机构接入</span>
          </div>
          <div className="ww-feature">
            <FileText aria-hidden />
            <b>地震列表</b>
            <span>多源即时</span>
          </div>
        </div>

        <div className="ww-note">
          <Volume2 aria-hidden />
          <span>浏览器要先点一下页面才能发出声音。按「开始使用」后，警报音效与语音播报才会启用。</span>
        </div>

        <button ref={button} type="button" onClick={start} className="ww-start">
          开始使用
        </button>

        <a href={REPO} target="_blank" rel="noopener noreferrer" className="ww-gh">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          GitHub：源代码与桌面版下载
        </a>

        <p className="ww-fine">信息仅供参考，实际情况请以各地官方机构发布为准。</p>
      </div>
    </div>
  );
}
