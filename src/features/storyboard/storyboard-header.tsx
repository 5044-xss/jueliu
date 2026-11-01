"use client";

import {
  ChevronDown,
  Film,
  Loader2,
  Settings2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  vendorName,
  strategyName,
  busyGenerate,
  onGenerateStoryboard,
  onOpenSettings,
  onOpenSource,
}: {
  hasStoryboard: boolean;
  hasScript: boolean;
  storyboardCount: number;
  returnedCount: number;
  totalTargetMs: number;
  staleCount: number;
  vendorName: string;
  strategyName: string;
  busyGenerate: boolean;
  onGenerateStoryboard: () => void;
  onOpenSettings: () => void;
  onOpenSource: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-xl bg-block-mint p-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:rounded-2xl sm:p-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <h2 className="text-base font-medium">分镜</h2>
          <span className="hidden rounded-full border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground sm:inline">
            {vendorName} · {strategyName}
          </span>
          {hasStoryboard && (
            <span className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground">
              {storyboardCount} 段 · {clock(totalTargetMs)}
            </span>
          )}
        </div>
        <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
          {hasStoryboard
            ? `已回传 ${returnedCount}/${storyboardCount} 段视频${
                staleCount > 0 ? ` · ${staleCount} 段已过期` : ""
              }`
            : "按剧本生成分镜，再把第三方生成的视频逐段回传。"}
        </p>
      </div>

      <div className="flex items-center justify-end gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible sm:pb-0">
        <Button size="sm" variant="outline" onClick={onOpenSettings}>
          <Settings2 className="size-4" />
          设置
        </Button>

        {hasStoryboard && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
              disabled={busyGenerate}
            >
              更多
              <ChevronDown className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={onGenerateStoryboard}
                disabled={busyGenerate}
              >
                <Wand2 className="size-4" />
                重新生成分镜
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenSource}>
                <Film className="size-4" />
                查看分镜原文
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

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
          {busyGenerate ? "生成中…" : hasStoryboard ? "重新生成分镜" : "生成分镜"}
        </Button>
      </div>
    </div>
  );
}
