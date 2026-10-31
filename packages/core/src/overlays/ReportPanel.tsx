import { useState } from "react";
import { ChevronLeft } from "lucide-react";

import { IntensityBadge } from "@/components/IntensityBadge";
import { extractLocation, formatReportTime } from "@/domain/utils";
import { useRerenderOn } from "@/hooks/useTremEvent";
import {
  getActiveReplayReportId,
  getReports,
  openReportUrl,
  replayReport,
} from "@/features/report/report";
import {
  getGlobalQuakes,
  sourceLabel,
  type GlobalQuake,
} from "@/features/glist/glist";
import type { ReportListItem } from "@/lib/types";
import { variable } from "@/lib/variable";
import { cn } from "@/lib/utils";

type Row =
  | { kind: "tw"; time: number; report: ReportListItem }
  | { kind: "global"; time: number; quake: GlobalQuake };

/** Right-side report list, including the legacy survey and replay-highlight states. */
export function ReportPanel() {
  // Legacy collapses the 275px panel below 1080px so it does not cover most of
  // the map at the 900px minimum window width.
  const [open, setOpen] = useState(() => window.innerWidth >= 1080);
  useRerenderOn("ReportListUpdate", "ReportRelease", "GlobalListUpdate");

  // An intensity survey under way is featured above every report; otherwise
  // the latest report is.
  const survey = variable.cache.intensity;
  const reports = getReports();
  const featured = reports[0] && !survey.time ? reports[0] : null;

  // Taiwan reports and every other agency's quakes share one time-ordered
  // list; each row is tinted by the agency that published it.
  const rows: Row[] = [];
  for (const report of featured ? reports.slice(1) : reports) {
    rows.push({ kind: "tw", time: report.time, report });
  }
  for (const quake of getGlobalQuakes()) {
    rows.push({ kind: "global", time: quake.time, quake });
  }
  rows.sort((a, b) => b.time - a.time);

  return (
    <div className={cn("legacy-report-panel", !open && "is-closed")}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="地震列表"
        className="legacy-report-toggle"
      >
        <ChevronLeft className={cn("h-4 w-4", open && "rotate-180")} />
      </button>

      <div className="legacy-report-list hud-corners">
        {survey.time ? <SurveyCard time={survey.time} int={survey.max} /> : null}
        {featured ? <FeaturedReport report={featured} /> : null}
        {rows.map((row) =>
          row.kind === "tw" ? (
            <CompactReportRow key={`tw-${row.report.id}`} item={row.report} />
          ) : (
            <CompactGlobalRow key={row.quake.key} quake={row.quake} />
          ),
        )}
      </div>
    </div>
  );
}

/** Fly to a listed earthquake's epicentre, for a one-click locate. */
function locateQuake(quake: GlobalQuake): void {
  variable.map?.flyTo({ center: [quake.lon, quake.lat], zoom: 8, duration: 600 });
}


function SurveyCard({ time, int }: { time: number; int: number }) {
  return (
    <div className="legacy-report-card legacy-report-featured is-survey">
      <div className="legacy-report-featured-content">
        <div className="flex flex-col items-center">
          <IntensityBadge i={int} className="legacy-report-featured-badge h-[80px] w-[80px] rounded-[12px] text-[48px]" />
          <div className="legacy-report-featured-label mt-[0.3em] text-center text-[13px] font-bold">观测最大震度</div>
        </div>
        <div className="ml-2 flex min-w-0 flex-1 flex-col">
          <div className="legacy-report-featured-loc truncate text-[28px] font-bold leading-tight">震源调查中</div>
          <div className="legacy-report-featured-time text-[13px] font-bold">{formatReportTime(time)}</div>
        </div>
      </div>
    </div>
  );
}

function FeaturedReport({ report }: { report: ReportListItem }) {
  return (
    <div
      className={cn(
        "legacy-report-card legacy-report-featured",
        isReplayActive(report) && "legacy-report-flashing",
      )}
      data-src="cwa"
    >
      <div className="legacy-report-featured-content">
        <div className="flex flex-col items-center">
          <IntensityBadge i={report.int ?? 0} className="legacy-report-featured-badge h-[80px] w-[80px] rounded-[12px] text-[48px]" />
          <div className="legacy-report-featured-label mt-[0.3em] text-center text-[13px] font-bold">观测最大震度</div>
        </div>

        <div className="ml-2 flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="legacy-report-src shrink-0">CWA</span>
            <div className="legacy-report-featured-loc truncate text-[26px] font-bold leading-tight">
              {extractLocation(report.loc)}
            </div>
          </div>
          <div className="legacy-report-featured-time text-[13px] font-bold">{formatReportTime(report.time)}</div>
          <div className="mt-auto flex w-full items-baseline justify-between pt-[0.3em]">
            <div
              className="legacy-report-featured-mag -mt-[5px] text-[30px] font-bold leading-none tabular-nums"
              style={isNumbered(report) ? { color: "var(--warning)" } : undefined}
            >
              <span className="mr-1">𝖬</span>
              {report.mag ? report.mag.toFixed(1) : "--"}
            </div>
            <div className="legacy-report-featured-depth -mt-[3px] text-[24px] font-bold leading-9 tabular-nums">
              {report.depth}
              <span className="ml-1 text-[14px] font-normal">km</span>
            </div>
          </div>
        </div>
      </div>
      <ReportActions item={report} />
    </div>
  );
}

function CompactReportRow({ item }: { item: ReportListItem }) {
  return (
    <div
      className={cn(
        "legacy-report-card legacy-report-global flex items-center gap-2",
        isReplayActive(item) && "legacy-report-flashing",
      )}
      data-src="cwa"
    >
      <IntensityBadge
        i={item.int ?? 0}
        className="legacy-report-row-badge ml-[3px] h-[50px] w-[55px] shrink-0 rounded-[12px] text-[30px]"
      />
      <div className="flex min-w-0 flex-1 items-center justify-between pr-[0.3em]">
        <div className="min-w-0">
          <div className="legacy-report-row-loc max-w-[170px] truncate text-[19px] font-bold leading-tight">
            {extractLocation(item.loc)}
          </div>
          <div className="legacy-report-row-time text-[13px] font-bold">{formatReportTime(item.time)}</div>
        </div>
        <div className="flex w-[58px] shrink-0 flex-col items-end justify-center gap-[2px] pl-2">
          <span className="legacy-report-src">CWA</span>
          <div
            className="legacy-report-row-mag text-[19px] font-bold leading-none tabular-nums"
            style={isNumbered(item) ? { color: "var(--warning)" } : undefined}
          >
            <span className="mr-[2px]">𝖬</span>
            {item.mag ? item.mag.toFixed(1) : "--"}
          </div>
        </div>
      </div>
      <ReportActions item={item} />
    </div>
  );
}

/** A row from another agency (JMA / CENC / USGS), tinted by its source. */
function CompactGlobalRow({ quake }: { quake: GlobalQuake }) {
  return (
    <div
      className="legacy-report-card legacy-report-global flex items-center gap-2"
      data-src={quake.author}
      onClick={() => locateQuake(quake)}
      title={`${sourceLabel(quake.author)}｜M${quake.mag}｜点击定位震中`}
    >
      <IntensityBadge
        i={quake.int}
        className="legacy-report-row-badge ml-[3px] h-[50px] w-[55px] shrink-0 rounded-[12px] text-[30px]"
      />
      <div className="flex min-w-0 flex-1 items-center justify-between pr-[0.3em]">
        <div className="min-w-0">
          <div className="legacy-report-row-loc max-w-[170px] truncate text-[19px] font-bold leading-tight">
            {quake.loc}
          </div>
          <div className="legacy-report-row-time text-[13px] font-bold">
            {formatReportTime(quake.time)}
          </div>
        </div>
        <div className="flex w-[58px] shrink-0 flex-col items-end justify-center gap-[2px] pl-2">
          <span className="legacy-report-src">{sourceLabel(quake.author)}</span>
          <div className="legacy-report-row-mag text-[19px] font-bold leading-none tabular-nums">
            <span className="mr-[2px]">𝖬</span>
            {quake.mag ? quake.mag.toFixed(1) : "--"}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportActions({ item }: { item: ReportListItem }) {
  return (
    <div className="legacy-report-actions">
      <button type="button" onClick={() => openReportUrl(item)}>
        {item.trem ? "检知" : "报告"}
      </button>
      <button type="button" onClick={() => replayReport(item)}>
        重播
      </button>
    </div>
  );
}

function isNumbered(item: ReportListItem): boolean {
  return !item.id.split("-")[0]?.includes("000");
}

function isReplayActive(item: ReportListItem): boolean {
  return getActiveReplayReportId() === item.id;
}
