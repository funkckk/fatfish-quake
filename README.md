# 肥鱼quake

基于公开信息的地震监测与预警应用（网页版 / 桌面版）。**肥鱼quake** 是
[TREM-Lite](https://github.com/ExpTechTW/TREM-Lite)（由 ExpTech Studio 开发，AGPL-3.0）
的衍生修改版本，主要改动为全球多源数据接入、简体中文界面与视觉重做。

> 本项目仅用于学习、研究与个人演示，**不得作为官方地震预警依据**。

## 功能

| 模块 | 说明 |
| --- | --- |
| 全球多源预警 | 台湾 CWA、日本 JMA、中国 CENC、韩国 KMA、四川 SC、福建 FJ（后五个经 Wolfx 公开接口接入） |
| 全球地震列表 | USGS（M2.5+）、JMA、CENC 与台湾地震报告按时间合并，来源分色标记 |
| 地图 | 震度分布、P/S 波传播圈、相机跟飞、全球省级行政界线 |
| 分级警报音 | 按震级分三档（M≤4.0 / 4.1–7.0 / >7.0）播放对应音轨，仅在后台出声 |
| 地震模拟器 | 左侧参数面板，开启后点击地图即生成指定震级/深度的模拟地震 |
| 界面 | 简体中文、科幻风 HUD、欢迎页与开机自检动画 |

## 开发与运行（网页版）

需要 [Bun](https://bun.sh/)（建议 1.3+）。

```bash
bun install
bun run dev:web
```

浏览器打开 `http://localhost:5173`。

演示入口：

- `http://localhost:5173/?demo-eew=jma` — 注入一条日本预警（可选 `sc` / `cenc` / `kma` / `fj`）
- `http://localhost:5173/?demo-sfx=1` — 试播分级警报音

桌面版（Tauri v2）需额外安装 Rust 工具链：

```bash
bun run dev:desktop
```

## 数据来源

- **中央气象署（CWA）** — 台湾强震即时警报与地震报告
- **Wolfx**（`api.wolfx.jp`）— 聚合 JMA / 中国地震台网 / 韩国气象厅 / 四川 / 福建等公开预警
- **USGS** — 全球地震目录
- **TREM-Net** — 台湾即时震度观测
- **Natural Earth** — 全球省级行政界线底图

各数据源版权与使用条款归其发布机构所有，本项目仅做聚合展示。

## 与上游项目的差异

本项目在上游基础上进行了以下修改（AGPL-3.0 要求披露）：

- 新增 Wolfx 全球多源预警与全球地震列表（`packages/core/src/features/wolfx`、`features/glist`）
- 新增分级警报音与地震模拟器（`features/alertSound`、`features/simulator`）
- 新增全球省级行政界线图层（`assets/boundaries`）
- 界面本地化为简体中文，重做配色、布局与动效，品牌更名为 肥鱼quake

## 许可证

[AGPL-3.0](LICENSE)。本项目作为衍生作品，同样以 AGPL-3.0 发布；分发或部署时须保留
原作者的版权声明，并提供完整源代码。
