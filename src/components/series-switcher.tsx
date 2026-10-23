"use client";

import { useRouter } from "next/navigation";
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
import type { SeriesSummary } from "@core/shared/projects";

export function SeriesSwitcher({
  currentId,
  series,
}: {
  currentId: string;
  series: SeriesSummary[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const current = series.find((item) => item.id === currentId);

  if (series.length <= 1) {
    return <span className="truncate text-foreground">{current?.name ?? "项目"}</span>;
  }

  async function go(next: SeriesSummary) {
    if (next.id === currentId) return;
    if (hasUnsavedChanges()) {
      const ok = await confirm({
        title: "放弃未保存的修改？",
        description: "当前页面有未保存的修改，切换项目后将会丢失。",
        confirmText: "放弃并切换",
        destructive: true,
      });
      if (!ok) return;
    }
    router.push(`/projects/${next.id}`);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="max-w-[220px] gap-1 px-1.5 text-sm font-normal text-foreground"
            title="切换项目"
          />
        }
      >
        <span className="truncate">{current?.name ?? "选择项目"}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(60vh,18rem)] overflow-y-auto overscroll-contain"
      >
        {series.map((item) => (
          <DropdownMenuItem key={item.id} onClick={() => void go(item)}>
            <span className="truncate">{item.name}</span>
            {item.id === currentId && <Check className="ml-auto size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
