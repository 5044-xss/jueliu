"use client";

import { Loader2, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { VendorOption } from "@/components/vendor-switch-dialog";
import type { LibraryStoryboardStrategy } from "@core/shared/library/storyboard-strategies";

export function StoryboardSettingsDialog({
  open,
  onOpenChange,
  vendors,
  vendor,
  strategies,
  strategyId,
  extra,
  hasStoryboard,
  orchestrating,
  onVendorChange,
  onStrategyChange,
  onExtraChange,
  onReorchestrate,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendors: VendorOption[];
  vendor: string;
  strategies: LibraryStoryboardStrategy[];
  strategyId: string;
  extra: string;
  hasStoryboard: boolean;
  orchestrating: boolean;
  onVendorChange: (vendor: string) => void;
  onStrategyChange: (strategyId: string) => void;
  onExtraChange: (extra: string) => void;
  onReorchestrate: () => void;
  onClear: () => void;
}) {
  const selectedVendor = vendors.find((item) => item.id === vendor);
  const selectedStrategy = strategies.find((item) => item.id === strategyId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>分镜设置</DialogTitle>
          <DialogDescription>
            默认厂商与策略包会直接用于「生成分镜」。高级操作只在需要时展开。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[68vh] flex-col gap-5 overflow-y-auto pr-1">
          <section className="flex flex-col gap-2">
            <label className="text-sm font-medium">厂商</label>
            <SelectField
              value={vendor}
              onChange={onVendorChange}
              disabled={orchestrating}
              options={vendors.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              {selectedVendor?.note ||
                "厂商决定单段镜数、时长和参考图上限。"}
              {hasStoryboard && (
                <span className="mt-1 block text-amber-700 dark:text-amber-400">
                  已有分镜时切换厂商，会立即按新厂商重新编排段落。
                </span>
              )}
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <label className="text-sm font-medium">分镜策略包</label>
            <SelectField
              value={strategyId}
              onChange={onStrategyChange}
              disabled={orchestrating}
              options={strategies.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              {selectedStrategy?.description || "选择题材策略：影响切镜节奏、覆盖模式与镜头语言。"}
              <span className="mt-1 block">
                策略包在下一次「生成分镜」时生效。
              </span>
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <label className="text-sm font-medium">额外要求</label>
            <Textarea
              value={extra}
              onChange={(event) => onExtraChange(event.target.value)}
              placeholder="例如：多用户外自然光；避免快速推拉运镜。"
              className="min-h-20 resize-y text-sm"
            />
            <p className="text-xs text-muted-foreground">
              可选，只在下一次生成分镜时生效。
            </p>
          </section>

          <section className="flex flex-col gap-2 border-t pt-4">
            <div>
              <p className="text-sm font-medium">高级操作</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                以下操作会改动现有分镜或生成任务，请按需使用。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onReorchestrate}
                disabled={!hasStoryboard || orchestrating}
              >
                {orchestrating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Wand2 className="size-3.5" />
                )}
                按当前厂商重新编排
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={onClear}
                disabled={!hasStoryboard}
              >
                <Trash2 className="size-3.5" />
                清空分镜
              </Button>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
