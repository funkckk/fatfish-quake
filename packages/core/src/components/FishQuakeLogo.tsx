/**
 * The 肥鱼quake mark: a fat fish inside a seismic ripple ring, drawn as SVG so
 * it stays crisp at every size and needs no bitmap asset. The ripples read as
 * both sonar and an arriving wave, which is the whole point of the app.
 */
export function FishQuakeLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="肥鱼quake"
      fill="none"
    >
      <defs>
        <radialGradient id="fq-bg" cx="0.35" cy="0.28" r="0.9">
          <stop offset="0" stopColor="#10263a" />
          <stop offset="1" stopColor="#060b12" />
        </radialGradient>
        <linearGradient id="fq-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8af4ff" />
          <stop offset="0.55" stopColor="#3fd6ec" />
          <stop offset="1" stopColor="#1787a3" />
        </linearGradient>
      </defs>

      <circle cx="32" cy="32" r="30" fill="url(#fq-bg)" stroke="#38d6e8" strokeOpacity="0.5" strokeWidth="1.6" />
      <circle
        cx="32"
        cy="32"
        r="25"
        stroke="#38d6e8"
        strokeOpacity="0.18"
        strokeWidth="1"
        strokeDasharray="2 3.5"
      />

      {/* 地震波：从鱼身向外扩的两道弧 */}
      <path d="M45.5 21a17 17 0 0 1 0 22" stroke="#38d6e8" strokeOpacity="0.55" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M50 16.5a23 23 0 0 1 0 31" stroke="#38d6e8" strokeOpacity="0.26" strokeWidth="1.7" strokeLinecap="round" />

      {/* 肥鱼：身体、尾巴、背鳍、眼睛 */}
      <ellipse cx="28.5" cy="30.5" rx="14.5" ry="9.4" transform="rotate(-9 28.5 30.5)" fill="url(#fq-body)" />
      <path d="M15.5 25.5 7.5 20.5v20l8-5z" fill="#2ec9e0" />
      <path d="M27 21.4 30.6 15.6l3.6 6.6z" fill="#a6f6ff" opacity="0.85" />
      <path d="M21 38.5c2.6 1.6 9.8 1.9 14 .2" stroke="#0d3a4a" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="38.2" cy="27.6" r="2.3" fill="#06202b" />
      <circle cx="38.9" cy="26.9" r="0.75" fill="#ffffff" />

      {/* 底部余波：一道细波形 */}
      <path
        d="M14 47h5l2.2-3.4 2.6 6.4 2.4-4.6 1.7 2.2H50"
        stroke="#38d6e8"
        strokeOpacity="0.6"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
