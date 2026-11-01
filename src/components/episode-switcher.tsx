"use client";

import { useRouter } from "@/spa/compat/navigation";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hasUnsavedChanges } from "@/lib/unsaved-guard";
import type { EpisodeSummary } from "@core/shared/projects";

export function EpisodeSwitcher({
  seriesId,
  currentId,
  episodes,
}: {
  seriesId: string;
  currentId: string;
  episodes: EpisodeSummary[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const current = episodes.find((e) => e.id === currentId);

  if (episodes.length <= 1) {
    return (
      <span className="truncate text-foreground">
        {current?.name ?? "当前子集"}
      </span>
    );
  }

  async function go(episode: EpisodeSummary) {
    if (episode.id === currentId) return;
    if (hasUnsavedChanges()) {
      const ok = await confirm({
        title: "放弃未保存的修改？",
        description: "当前页面有未保存的修改，切换子集后将会丢失。",
        confirmText: "放弃并切换",
        destructive: true,
      });
      if (!ok) return;
    }
    router.push(`/projects/${seriesId}/${episode.id}`);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="max-w-[220px] gap-1 px-1.5 text-sm font-normal text-foreground"
            title="切换子集"
          />
        }
      >
        <span className="truncate">{current?.name ?? "选择子集"}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(60vh,18rem)] overflow-y-auto overscroll-contain"
      >
        {episodes.map((e) => (
          <DropdownMenuItem key={e.id} onClick={() => void go(e)}>
            <span className="truncate">{e.name}</span>
            {e.id === currentId && <Check className="ml-auto size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
