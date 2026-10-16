"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LibraryStyle } from "@core/shared/library/types";

const ASPECT_OPTIONS = ["9:16", "16:9", "1:1"];

export function ProjectFormDialog({
  mode,
  projectId,
  seriesId,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  projectId?: string;
  seriesId?: string;
  onClose: () => void;
  onSaved: (project: { id: string }) => void;
}) {
  const [styles, setStyles] = useState<LibraryStyle[]>([]);
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [styleId, setStyleId] = useState("");
  const [style, setStyle] = useState("");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [defaultSegmentMs, setDefaultSegmentMs] = useState(10000);

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

  useEffect(() => {
    if (mode !== "edit" || !projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const project = data.project;
        if (!project) throw new Error("子集不存在");
        setName(project.name ?? "");
        setStyleId(project.styleId ?? "");
        setStyle(project.style ?? "");
        setAspectRatio(project.aspectRatio ?? "9:16");
        setDefaultSegmentMs(project.defaultSegmentMs ?? 10000);
      })
      .catch((error: Error) => {
        if (!cancelled) toast.error(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, projectId]);

  async function save() {
    if (!name.trim()) {
      toast.error("请填写子集名");
      return;
    }
    setSaving(true);
    try {
      const chosen = styles.find((s) => s.id === styleId);
      const url =
        mode === "create"
          ? `/api/series/${seriesId}/episodes`
          : `/api/projects/${projectId}`;
      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          style: chosen ? chosen.prompt : style,
          styleId: chosen ? chosen.id : null,
          aspectRatio,
          defaultSegmentMs,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "保存失败");
      toast.success(mode === "create" ? "子集已创建" : "子集已更新");
      onSaved(data.project);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新建子集" : "编辑子集"}</DialogTitle>
          <DialogDescription>
            设定子集名称、风格与画面比例，后续所有生成都会继承。
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 加载中…
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pf-name">子集名</Label>
              <Input
                id="pf-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：第 1 集"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pf-style">风格</Label>
              <select
                id="pf-style"
                value={styleId}
                onChange={(e) => setStyleId(e.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                <option value="">自定义</option>
                {styles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {!styleId && (
                <Input
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  placeholder="自定义风格提示词"
                />
              )}
              <p className="text-xs text-muted-foreground">
                风格库在「资源库 → 风格库」中管理。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="pf-ratio">画面比例</Label>
                <select
                  id="pf-ratio"
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                >
                  {ASPECT_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pf-ms">默认段时长 (ms)</Label>
                <Input
                  id="pf-ms"
                  type="number"
                  min={1000}
                  step={500}
                  value={defaultSegmentMs}
                  onChange={(e) => setDefaultSegmentMs(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {mode === "create" ? "创建" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
