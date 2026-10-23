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
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/components/ui/select";
import { ASPECT_OPTIONS, DEFAULT_ASPECT_RATIO } from "@/lib/aspect";
import type { LibraryStyle } from "@core/shared/library/types";

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
  const [videoStyle, setVideoStyle] = useState("");
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  // 打开时的原始风格，用于判断「本次是否真的改了风格」（风格是锁定字段）。
  const [loadedStyle, setLoadedStyle] = useState("");
  const [loadedStyleId, setLoadedStyleId] = useState<string | null>(null);

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
        setLoadedStyleId(project.styleId ?? null);
        setLoadedStyle(project.style ?? "");
        setVideoStyle(project.videoStyle ?? "");
        setAspectRatio(project.aspectRatio ?? DEFAULT_ASPECT_RATIO);
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
      const nextStyle = chosen ? chosen.prompt : style;
      const nextStyleId = chosen ? chosen.id : null;
      const url =
        mode === "create"
          ? `/api/series/${seriesId}/episodes`
          : `/api/projects/${projectId}`;
      const base = {
        name: name.trim(),
        videoStyle: videoStyle.trim(),
        aspectRatio,
      };
      // 风格是锁定字段：只有本次真的改了风格才提交它，避免「只改时长」被风格锁一起拒掉。
      const styleChanged =
        mode === "create" ||
        nextStyle !== loadedStyle ||
        nextStyleId !== loadedStyleId;

      const send = (payload: Record<string, unknown>) =>
        fetch(url, {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

      let res = await send(
        styleChanged ? { ...base, style: nextStyle, styleId: nextStyleId } : base,
      );
      let data = await res.json().catch(() => null);

      // 改了风格但被锁（已有资产）：退回只保存其余设置，避免时长等改动一起丢失。
      if (!res.ok && res.status === 409 && styleChanged) {
        res = await send(base);
        data = await res.json().catch(() => null);
        if (res.ok) {
          toast.warning("风格已锁定（已生成资产），未改动；其余设置已保存");
          onSaved(data.project);
          return;
        }
      }

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
            设定子集名称、风格与画面比例；段时长按所选厂商的能力自动协商。
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
              <SelectField
                id="pf-style"
                value={styleId}
                onChange={(id) => {
                  setStyleId(id);
                  const chosen = styles.find((s) => s.id === id);
                  setVideoStyle(chosen?.videoStyle?.trim() ?? "");
                }}
                options={[
                  { value: "", label: "自定义" },
                  ...styles.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
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
            {mode === "edit" && (
              <div className="grid gap-2">
                <Label htmlFor="pf-video-style">视频风格（可选）</Label>
                <Textarea
                  id="pf-video-style"
                  value={videoStyle}
                  onChange={(e) => setVideoStyle(e.target.value)}
                  placeholder="留空＝沿用上面的风格，但自动剔除特效词（粒子/法阵/剑气等）。想要特效就写这里。"
                  className="min-h-[70px]"
                />
                <p className="text-xs text-muted-foreground">
                  选择风格时自动带出；留空＝沿用上方画面风格并自动去掉特效类词。只影响视频。
                </p>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="pf-ratio">画面比例</Label>
              <SelectField
                id="pf-ratio"
                value={aspectRatio}
                onChange={setAspectRatio}
                options={ASPECT_OPTIONS.map((r) => ({ value: r, label: r }))}
              />
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
