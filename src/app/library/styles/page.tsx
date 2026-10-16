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
  const [saving, setSaving] = useState(false);

  const dirty = style ? name !== style.name || prompt !== style.prompt : false;

  async function save() {
    if (!style) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/library/styles/${style.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, prompt }),
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
    if (!window.confirm(`确定删除风格「${style.name}」？`)) return;
    const res = await fetch(`/api/library/styles/${style.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      onDeleted(style.id);
      toast.success("已删除");
      onOpenChange(false);
    } else {
      toast.error("删除失败");
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
            风格提示词会注入到剧本/资产/分镜与厂商提示词中。
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
            <label className="text-xs font-medium">风格提示词</label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：国风水墨，青绿山水，留白，柔和光线"
              className="min-h-[200px] text-sm"
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
      } catch {
        if (!cancelled) toast.error("读取风格库失败");
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
          新建项目时可从此处选择风格。点击卡片查看或编辑提示词。
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
