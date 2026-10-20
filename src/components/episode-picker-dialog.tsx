"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@core/client/utils";
import type { EpisodeSummary } from "@core/shared/projects";

export function EpisodePickerDialog({
  open,
  onOpenChange,
  seriesName,
  episodes,
  currentId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seriesName: string;
  episodes: EpisodeSummary[];
  currentId?: string;
  onSelect: (episode: EpisodeSummary) => void;
}) {
  const [query, setQuery] = useState("");

  function handleOpenChange(next: boolean) {
    if (!next) setQuery("");
    onOpenChange(next);
  }

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return episodes;
    return episodes.filter((episode) =>
      episode.name.toLowerCase().includes(keyword),
    );
  }, [episodes, query]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(82vh,40rem)] w-full flex-col gap-3 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>选择分集</DialogTitle>
          <DialogDescription>
            {seriesName} · 共 {episodes.length} 集
          </DialogDescription>
        </DialogHeader>

        {episodes.length > 6 && (
          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索分集名称"
              className="pl-8"
              autoFocus
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              没有匹配的分集
            </div>
          ) : (
            filtered.map((episode) => {
              const active = episode.id === currentId;
              return (
                <button
                  key={episode.id}
                  type="button"
                  onClick={() => {
                    onSelect(episode);
                    handleOpenChange(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 border-b px-3 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/60",
                    active && "bg-muted/40",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {episode.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      创建于 {new Date(episode.createdAt).toLocaleString("zh-CN")}
                    </span>
                  </span>
                  {active ? (
                    <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
                  )}
                </button>
              );
            })
          )}
        </div>

        <p className="shrink-0 text-xs text-muted-foreground">
          分集较多时列表会在固定高度内滚动。
        </p>
      </DialogContent>
    </Dialog>
  );
}
