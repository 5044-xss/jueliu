"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LibraryStyle } from "@core/shared/library/types";

export function ProjectStyleSwitcher({
  projectId,
  styleId,
  style,
  locked = false,
}: {
  projectId: string;
  styleId: string | null;
  style: string;
  locked?: boolean;
}) {
  const router = useRouter();
  const [styles, setStyles] = useState<LibraryStyle[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState({ styleId, style });
  const [draftStyleId, setDraftStyleId] = useState(styleId ?? "");
  const [draftCustom, setDraftCustom] = useState(style);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/library/styles")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setStyles((data.styles ?? []) as LibraryStyle[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const currentName =
    (current.styleId && styles.find((s) => s.id === current.styleId)?.name) ||
    (current.style ? "自定义" : "未设置");

  function openDialog() {
    setDraftStyleId(current.styleId ?? "");
    setDraftCustom(current.styleId ? "" : current.style);
    setOpen(true);
  }

  async function save() {
    const chosen = styles.find((s) => s.id === draftStyleId);
    const nextStyle = chosen ? chosen.prompt : draftCustom.trim();
    if (!chosen && !nextStyle) {
      toast.error("请填写自定义风格提示词");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          styleId: chosen ? chosen.id : null,
          style: nextStyle,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "保存失败");
      setCurrent({
        styleId: data.project.styleId ?? null,
        style: data.project.style,
      });
      setOpen(false);
      toast.success("风格已更新，资产提示词已同步");
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
        disabled={locked}
        title={
          locked
            ? "已按剧本生成资产，风格已锁定（避免素材风格串味）。如需换风格请新建项目。"
            : current.style || "未设置风格"
        }
      >
        {locked ? (
          <Lock className="size-3.5" />
        ) : (
          <Palette className="size-3.5" />
        )}
        {currentName}
        {locked && <span className="text-[11px] opacity-70">已锁定</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>切换风格</DialogTitle>
            <DialogDescription>
              风格会影响剧本、资产、分镜与成片提示词。资产提示词只存画面内容，风格在展示/复制时自动拼接，切换后即时生效。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="switch-style">风格</Label>
            <select
              id="switch-style"
              value={draftStyleId}
              onChange={(e) => setDraftStyleId(e.target.value)}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="">自定义</option>
              {styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {!draftStyleId && (
              <Input
                value={draftCustom}
                onChange={(e) => setDraftCustom(e.target.value)}
                placeholder="自定义风格提示词"
              />
            )}
            <p className="text-xs text-muted-foreground">
              风格库在「资源库 → 风格库」中管理。
            </p>
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
