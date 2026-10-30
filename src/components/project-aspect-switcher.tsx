"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Ratio } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/ui/select";
import { ASPECT_OPTIONS } from "@/lib/aspect";

export function ProjectAspectSwitcher({
  projectId,
  aspectRatio,
  videoCount = 0,
}: {
  projectId: string;
  aspectRatio: string;
  videoCount?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState(aspectRatio);
  const [draft, setDraft] = useState(aspectRatio);

  function openDialog() {
    setDraft(current);
    setOpen(true);
  }

  async function save() {
    if (draft === current) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aspectRatio: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "保存失败");
      setCurrent(draft);
      setOpen(false);
      toast.success(`画面比例已切换为 ${draft}`, {
        description: "重新生成起始画面 / 视频后按新比例生效",
      });
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={openDialog}
        title="切换画面比例"
      >
        <Ratio className="size-3.5" />
        {current}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>画面比例</DialogTitle>
            <DialogDescription>
              影响起始画面、视频与最终合成；在回传视频前切换最稳妥。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="project-aspect">画面比例</Label>
            <SelectField
              id="project-aspect"
              value={draft}
              onChange={setDraft}
              options={ASPECT_OPTIONS.map((r) => ({ value: r, label: r }))}
            />
            {videoCount > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                已有 {videoCount} 段视频。切换比例后建议重新生成这些段的视频（以及起始画面），否则成片会按新比例裁切或留边。
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
