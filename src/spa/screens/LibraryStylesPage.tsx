"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { readError } from "@/lib/http";
import type { LibraryStyle } from "@core/shared/library/types";

function StyleDialog({
  style,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  style: LibraryStyle | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (s: LibraryStyle) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(style?.name ?? "");
  const [prompt, setPrompt] = useState(style?.prompt ?? "");
  const [videoStyle, setVideoStyle] = useState(style?.videoStyle ?? "");
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  const dirty = style
    ? name !== style.name ||
      prompt !== style.prompt ||
      videoStyle !== (style.videoStyle ?? "")
    : false;

  async function save() {
    if (!style) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/library/styles/${style.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, prompt, videoStyle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      onSaved(data.style);
      toast.success("已保存");
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!style) return;
    if (
      !(await confirm({
        title: "删除风格",
        description: `确定删除风格「${style.name}」？此操作不可恢复。`,
        confirmText: "删除",
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/library/styles/${style.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readError(res, "删除失败"));
      onDeleted(style.id);
      toast.success("已删除");
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message || "删除失败");
    }
  }

  return (
    <Dialog open={style !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-full sm:max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {style?.name || "风格"}
            {style?.builtin && <Badge variant="secondary">内置</Badge>}
          </DialogTitle>
          <DialogDescription>
            画面风格会注入剧本/资产/分镜与图片提示词；视频风格只用于视频，留空则用画面风格并自动剔除特效词。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">画面风格提示词</label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：国风水墨，青绿山水，留白，柔和光线"
              className="min-h-[200px] text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">视频风格（可选）</label>
            <Textarea
              value={videoStyle}
              onChange={(e) => setVideoStyle(e.target.value)}
              placeholder="留空＝沿用画面风格并自动剔除特效词。想保留特效或单独控制视频质感时填写，例如：电影级渲染，体积光，轻微胶片颗粒。"
              className="min-h-[120px] text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={remove}>
            <Trash2 className="size-3.5" />
            删除
          </Button>
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StylesPage() {
  const [styles, setStyles] = useState<LibraryStyle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LibraryStyle | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/library/styles");
    if (!res.ok) throw new Error(await readError(res, "读取风格库失败"));
    const data = await res.json();
    return (data.styles ?? []) as LibraryStyle[];
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await load();
        if (!cancelled) {
          setStyles(list);
          setLoaded(true);
        }
      } catch (error) {
        if (!cancelled) toast.error((error as Error).message || "读取风格库失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function create() {
    setCreating(true);
    try {
      const res = await fetch("/api/library/styles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "新风格", prompt: "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      setStyles((prev) => [...prev, data.style]);
      setEditing(data.style);
      toast.success("已创建");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载中…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-block-lime p-5">
        <p className="text-sm">
          新建子集时可从此处选择风格，选中后自动带出对应的视频风格。点击卡片查看或编辑提示词。
        </p>
        <Button onClick={create} disabled={creating}>
          {creating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          新增风格
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {styles.map((style) => (
          <Card key={style.id} size="sm">
            <CardContent className="flex items-start justify-between gap-2">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setEditing(style)}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {style.name}
                  </span>
                  {style.builtin && <Badge variant="secondary">内置</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {style.prompt.trim() || "未填写提示词"}
                </p>
                {style.videoStyle?.trim() && (
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/70">
                    视频：{style.videoStyle.trim()}
                  </p>
                )}
              </button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="编辑"
                onClick={() => setEditing(style)}
              >
                <Pencil />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <StyleDialog
        key={editing?.id ?? "closed"}
        style={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={(s) =>
          setStyles((prev) => prev.map((x) => (x.id === s.id ? s : x)))
        }
        onDeleted={(id) =>
          setStyles((prev) => prev.filter((x) => x.id !== id))
        }
      />
    </div>
  );
}
