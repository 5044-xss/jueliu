"use client";

import {
  ChevronDown,
  Film,
  Loader2,
  Settings2,
  Sparkles,
  Square,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

export function StoryboardHeader({
  hasStoryboard,
  hasScript,
  storyboardCount,
  returnedCount,
  totalTargetMs,
  staleCount,
  pendingVideoCount,
  missingStartFrames,
  vendorName,
  strategyName,
  isH3,
  busyGenerate,
  cloudRunning,
  batchBusy,
  generatingSegmentLabel,
  generatingProgress,
  generatingProgressCurrent,
  onGenerateStoryboard,
  onGenerateVideos,
  onCancelVideos,
  onOpenSettings,
  onOpenSource,
}: {
  hasStoryboard: boolean;
  hasScript: boolean;
  storyboardCount: number;
  returnedCount: number;
  totalTargetMs: number;
  staleCount: number;
  pendingVideoCount: number;
  missingStartFrames: number;
  vendorName: string;
  strategyName: string;
  isH3: boolean;
  busyGenerate: boolean;
  cloudRunning: boolean;
  batchBusy: "videos" | "start-frames" | null;
  /** 正在出视频的段（不需要点选就能看到是哪一段）。 */
  generatingSegmentLabel: string | null;
  generatingProgress: number | null;
  generatingProgressCurrent: number | null;
  onGenerateStoryboard: () => void;
  onGenerateVideos: () => void;
  onCancelVideos: () => void;
  onOpenSettings: () => void;
  onOpenSource: () => void;
}) {
  const videoBusy = cloudRunning || batchBusy !== null;
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl bg-block-mint p-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-medium">分镜</h2>
          <span className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground">
            {vendorName} · {strategyName}
          </span>
          {hasStoryboard && (
            <span className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground">
              {storyboardCount} 段 · {clock(totalTargetMs)}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {hasStoryboard
            ? `已生成 ${returnedCount}/${storyboardCount} 段视频${
                staleCount > 0 ? ` · ${staleCount} 段已过期` : ""
              }`
            : "按剧本生成分镜，再用一键生成视频。厂商与策略包默认已选好。"}
        </p>
        {generatingSegmentLabel && (
          <div className="mt-2 flex max-w-xl flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border/60 bg-background/60 px-2.5 py-1.5">
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium">
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
              {generatingSegmentLabel}
            </span>
            <span className="relative h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted">
              {typeof generatingProgressCurrent === "number" && (
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-primary/35 transition-all"
                  style={{ width: `${generatingProgressCurrent}%` }}
                />
              )}
              {typeof generatingProgress === "number" ? (
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
                  style={{ width: `${generatingProgress}%` }}
                />
              ) : (
                <span className="absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full bg-primary/60" />
              )}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {typeof generatingProgress === "number"
                ? `总 ${generatingProgress}%`
                : "生成中"}
              {typeof generatingProgressCurrent === "number"
                ? ` · 节点 ${generatingProgressCurrent}%`
                : ""}
            </span>
          </div>
        )}
        {hasStoryboard && !isH3 && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            云端视频生成仅适配 MiniMax H3；当前厂商请手动回传视频。
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button size="sm" variant="outline" onClick={onOpenSettings}>
          <Settings2 className="size-4" />
          设置
        </Button>

        {hasStoryboard && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
              disabled={busyGenerate || videoBusy}
            >
              更多
              <ChevronDown className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={onGenerateStoryboard}
                disabled={busyGenerate || videoBusy}
              >
                <Wand2 className="size-4" />
                重新生成分镜
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenSource}>
                <Film className="size-4" />
                查看分镜原文
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onCancelVideos}
                disabled={!cloudRunning}
                className="text-destructive data-highlighted:bg-destructive/10"
              >
                <Square className="size-4" />
                取消生成
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {!hasStoryboard ? (
          <Button
            size="sm"
            onClick={onGenerateStoryboard}
            disabled={busyGenerate || !hasScript}
          >
            {busyGenerate ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {busyGenerate ? "生成中…" : "生成分镜"}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onGenerateVideos}
            disabled={
              busyGenerate || videoBusy || !isH3 || pendingVideoCount === 0
            }
            title={
              !isH3
                ? "云端视频生成仅支持 MiniMax H3"
                : pendingVideoCount === 0
                  ? "所有段落都已有视频"
                  : missingStartFrames > 0
                    ? `将自动补 ${missingStartFrames} 段首帧`
                    : undefined
            }
          >
            {videoBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {videoBusy
              ? "生成中…"
              : pendingVideoCount === 0
                ? "视频已全部生成"
                : returnedCount > 0
                  ? `继续生成视频（${pendingVideoCount}）`
                  : "一键生成视频"}
          </Button>
        )}
      </div>
    </div>
  );
}
