"use client";

import { useRef } from "react";
import { Film, Hourglass, Loader2 } from "lucide-react";
import { cn } from "@core/client/utils";
import { PREVIEW_THUMB_CLASS } from "@/components/preview-image";
import type { SegmentQcRecord } from "@core/shared/qc";
import type { StoredSegment } from "@core/shared/schemas/storyboard";
import {
  segmentGenPhase,
  type StoryboardSegmentEntry,
} from "./use-storyboard";

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

function linkLabel(segment: StoredSegment): string {
  if (segment.linkMode === "text-bridge") return "文锚";
  if (segment.linkMode === "tail-frame") return "连续";
  return "硬切";
}

function linkClass(segment: StoredSegment): string {
  if (segment.linkMode === "text-bridge") return "bg-sky-500/90";
  if (segment.linkMode === "tail-frame") return "bg-emerald-500/90";
  return "bg-amber-500/90";
}

function SegmentThumb({
  projectId,
  segment,
}: {
  projectId: string;
  segment: StoredSegment;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  if (!segment.videoPath) {
    return (
      <div className="flex aspect-video w-full items-center justify-center text-muted-foreground">
        <Film className="size-4" />
      </div>
    );
  }
  return (
    <video
      ref={videoRef}
      src={`/api/projects/${projectId}/segments/${segment.id}/video#t=0.1`}
      muted
      loop
      playsInline
      preload="metadata"
      className="aspect-video w-full object-cover"
      onMouseEnter={() => {
        void videoRef.current?.play().catch(() => {});
      }}
      onMouseLeave={() => {
        const video = videoRef.current;
        if (!video) return;
        video.pause();
        video.currentTime = 0;
      }}
    />
  );
}

export function StoryboardSegmentStrip({
  projectId,
  entries,
  activeId,
  totalTargetMs,
  videoRunning,
  qcBySegment,
  onSelect,
}: {
  projectId: string;
  entries: StoryboardSegmentEntry[];
  activeId: string | null;
  totalTargetMs: number;
  videoRunning: boolean;
  qcBySegment: Map<string, SegmentQcRecord>;
  onSelect: (segmentId: string) => void;
}) {
  return (
    <div className="shrink-0 border-t bg-background pt-3">
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <span className="text-sm font-medium">段落（{entries.length}）</span>
        <span className="text-xs text-muted-foreground">
          总时长 {clock(totalTargetMs)} · 点击切换
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {entries.map(({ scene, segment }) => {
          const active = segment.id === activeId;
          const phase = segmentGenPhase(segment.genStatus);
          const running = videoRunning && phase === "running";
          const queued = videoRunning && phase === "queued";
          const qc = qcBySegment.get(segment.id);
          const total = segment.shots.reduce(
            (sum, shot) => sum + shot.durationMs,
            0,
          );
          return (
            <button
              key={segment.id}
              type="button"
              data-segment-id={segment.id}
              onClick={() => onSelect(segment.id)}
              className={cn(
                "flex w-44 shrink-0 flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors",
                active
                  ? "border-foreground/40 bg-muted/50"
                  : "hover:bg-muted/30",
              )}
            >
              <div
                className={cn(
                  PREVIEW_THUMB_CLASS,
                  "aspect-video w-full",
                )}
              >
                <SegmentThumb projectId={projectId} segment={segment} />
                {segment.index > 1 && (
                  <span
                    className={cn(
                      "absolute left-1 top-1 rounded px-1 py-0.5 text-[10px] font-medium leading-3 text-black",
                      linkClass(segment),
                    )}
                    title={segment.seamReason ?? undefined}
                  >
                    {linkLabel(segment)}
                  </span>
                )}
                {running && (
                  <span className="absolute inset-0 flex items-center justify-center gap-1 bg-black/40 text-[10px] text-white">
                    <Loader2 className="size-3 animate-spin" />
                    生成中
                  </span>
                )}
                {queued && (
                  <span className="absolute inset-0 flex items-center justify-center gap-1 bg-black/40 text-[10px] text-white">
                    <Hourglass className="size-3" />
                    排队中
                  </span>
                )}
                {segment.stale && !running && !queued && (
                  <span className="absolute bottom-1 left-1 rounded bg-amber-500/90 px-1 py-0.5 text-[10px] font-medium leading-3 text-black">
                    已过期
                  </span>
                )}
              </div>
              <span className="truncate text-sm font-medium">
                {scene.sceneSlug || `第${scene.sceneIndex}场`} · 第
                {segment.index}段
              </span>
              <span className="text-xs text-muted-foreground">
                {segment.shots.length} 镜 · {(total / 1000).toFixed(1)}s
              </span>
              <span className="flex items-center justify-between gap-1.5">
                <span
                  className={cn(
                    "flex items-center gap-1 text-xs",
                    running
                      ? "text-blue-600 dark:text-blue-400"
                      : queued
                        ? "text-sky-600 dark:text-sky-400"
                        : segment.stale
                          ? "text-amber-700 dark:text-amber-400"
                          : segment.videoPath
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      running
                        ? "bg-blue-500"
                        : queued
                          ? "bg-sky-500"
                          : segment.stale
                            ? "bg-amber-500"
                            : segment.videoPath
                              ? "bg-emerald-500"
                              : "bg-muted-foreground/40",
                    )}
                  />
                  {running
                    ? "生成中"
                    : queued
                      ? "排队中"
                      : segment.stale
                        ? "已过期"
                        : segment.videoPath
                          ? "已生成"
                          : "未生成"}
                </span>
                {qc && (
                  <span
                    className="text-[10px] text-muted-foreground"
                    title={`QC ${qc.status}${qc.score != null ? ` · ${qc.score} 分` : ""}`}
                  >
                    QC {qc.score ?? "—"}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
