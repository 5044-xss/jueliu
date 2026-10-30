"use client";

import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentVideo } from "@/components/segment-video";
import { cn } from "@core/client/utils";
import type { SegmentQcRecord } from "@core/shared/qc";
import type { StoryboardSegmentEntry } from "./use-storyboard";

function qcLabel(qc: SegmentQcRecord | null): string {
  if (!qc) return "待质检";
  if (qc.status === "passed") return `通过 · ${qc.score ?? 0} 分`;
  if (qc.status === "failed") return `未通过 · ${qc.score ?? 0} 分`;
  return `待复核 · ${qc.score ?? 0} 分`;
}

function qcDot(qc: SegmentQcRecord | null): string {
  if (qc?.status === "failed") return "bg-destructive";
  if (qc?.status === "passed") return "bg-emerald-500";
  return "bg-amber-500";
}

function QcPanel({
  qc,
  hasVideo,
  busy,
  onRunQc,
  onOpenPreflight,
}: {
  qc: SegmentQcRecord | null;
  hasVideo: boolean;
  busy: boolean;
  onRunQc: () => void;
  onOpenPreflight: () => void;
}) {
  const issues = qc?.issues ?? [];
  const visibleIssues = issues.slice(0, 3);
  return (
    <div className="flex min-h-0 flex-col gap-2 rounded-xl border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">QC 质检</span>
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", qcDot(qc))} />
            {qcLabel(qc)}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onRunQc}
            disabled={!hasVideo || busy}
            title="重新质检本段视频"
          >
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
        {!hasVideo ? (
          <p className="text-[11px] text-muted-foreground">
            回传视频后自动质检
          </p>
        ) : !qc ? (
          <p className="text-[11px] text-muted-foreground">视频尚未质检</p>
        ) : issues.length === 0 ? (
          <p className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-3.5 shrink-0" />
            未发现问题
          </p>
        ) : (
          <>
            {visibleIssues.map((issue, index) => (
              <p
                key={`${issue.code}:${index}`}
                title={issue.message}
                className={cn(
                  "flex min-w-0 items-center gap-1 text-[11px] leading-4",
                  issue.level === "hard"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                <AlertTriangle className="size-3 shrink-0" />
                <span className="truncate">{issue.message}</span>
              </p>
            ))}
            {issues.length > visibleIssues.length && (
              <button
                type="button"
                onClick={onOpenPreflight}
                className="self-start text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                还有 {issues.length - visibleIssues.length} 条 · 查看全部
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function StoryboardVideoPanel({
  projectId,
  entry,
  nextSegmentId,
  qc,
  framesVersion,
  busy,
  onRefresh,
  onRunQc,
  onOpenPreflight,
}: {
  projectId: string;
  entry: StoryboardSegmentEntry;
  nextSegmentId: string | null;
  qc: SegmentQcRecord | null;
  framesVersion: number;
  busy: boolean;
  onRefresh: () => Promise<void> | void;
  onRunQc: (segmentId: string) => void;
  onOpenPreflight: () => void;
}) {
  const { scene, segment } = entry;
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-sm font-semibold">视频预览</h3>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {scene.sceneSlug || `第${scene.sceneIndex}场`} · 第{segment.index}段
          </span>
          {segment.stale && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              已过期
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onOpenPreflight}
            title="本段体检与修复"
            className="shrink-0"
          >
            <Stethoscope className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        <SegmentVideo
          projectId={projectId}
          segmentId={segment.id}
          segmentLabel={`第${segment.index}段`}
          nextSegmentId={nextSegmentId}
          refreshKey={framesVersion}
          onChanged={onRefresh}
          qcPanel={
            <QcPanel
              qc={qc}
              hasVideo={Boolean(segment.videoPath)}
              busy={busy}
              onRunQc={() => onRunQc(segment.id)}
              onOpenPreflight={onOpenPreflight}
            />
          }
        />
      </div>
    </section>
  );
}
