"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@core/client/utils";

export interface VendorOption {
  id: string;
  name: string;
  platform: string;
  note: string;
  isDefault?: boolean;
  supportMultiShot?: boolean;
  maxShotsPerSegment?: number;
  maxRefImages?: number;
  minSegmentMs?: number;
  maxSegmentMs?: number;
  durationStepMs?: number;
}

export function VendorSwitchDialog({
  open,
  onOpenChange,
  vendors,
  current,
  hasStoryboard,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendors: VendorOption[];
  current: string;
  hasStoryboard: boolean;
  busy?: boolean;
  onConfirm: (id: string) => void;
}) {
  const [selected, setSelected] = useState(current);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-full flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>切换厂商</DialogTitle>
          <DialogDescription>
            {hasStoryboard
              ? "切换后会按新厂商的镜数 / 时长 / 参考图规则重新编排分镜。各段已回传的视频与截帧按厂商分别缓存，之后切回原厂商可自动恢复。"
              : "当前还没有分镜，切换只更新项目的厂商设置。"}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-2">
            {vendors.map((v) => {
              const active = v.id === current;
              const isSelected = v.id === selected;
              const cloud = v.platform === "h3";
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={busy}
                  onClick={() => setSelected(v.id)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                    isSelected ? "border-foreground/40 bg-muted/50" : "hover:bg-muted/30",
                    busy && "cursor-not-allowed opacity-60",
                  )}
                >
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border">
                    {isSelected && (
                      <Check className="size-3 text-emerald-500 dark:text-emerald-400" />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{v.name}</span>
                      <Badge variant={cloud ? "secondary" : "outline"}>
                        {cloud ? "支持云端生成" : "仅第三方生成"}
                      </Badge>
                      {active && (
                        <span className="text-[11px] text-muted-foreground">
                          当前厂商
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {[
                        v.maxShotsPerSegment != null
                          ? `单段≤${v.maxShotsPerSegment} 镜`
                          : null,
                        v.supportMultiShot ? "支持段内多镜" : "仅单镜",
                        v.maxRefImages != null
                          ? `参考图≤${v.maxRefImages} 张`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {v.note && (
                      <span className="text-xs leading-5 text-muted-foreground">
                        {v.note}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={busy || selected === current}
            onClick={() => onConfirm(selected)}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            切换
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
