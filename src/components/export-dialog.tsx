"use client";

import { useState } from "react";
import { Archive, Loader2 } from "lucide-react";
import { cn } from "cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type ExportMode = "slim" | "full";

const OPTIONS: {
  value: ExportMode;
  title: string;
  description: string;
}[] = [
  {
    value: "slim",
    title: "精简导出（推荐）",
    description: "只包含当前视频、资产图、分镜帧与成品，体积小，适合分享案例。",
  },
  {
    value: "full",
    title: "完整导出",
    description: "包含 QC 截图、历史视频版本等全部中间文件，体积可能非常大。",
  },
];

export function ExportDialog({
  seriesName,
  busy,
  onClose,
  onConfirm,
}: {
  seriesName: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (mode: ExportMode) => void;
}) {
  const [mode, setMode] = useState<ExportMode>("slim");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导出项目</DialogTitle>
          <DialogDescription>
            将「{seriesName}」及其分集、资产库打包为 zip，可在其他设备通过「导入项目」还原。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setMode(option.value)}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                mode === option.value
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border",
                  mode === option.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground",
                )}
              >
                <Archive className="size-3.5" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{option.title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => onConfirm(mode)} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            导出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
