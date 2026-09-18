"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { LibraryStyle } from "@/lib/library/types";

function StyleCard({
  style,
  onSaved,
  onDeleted,
}: {
  style: LibraryStyle;
  onSaved: (s: LibraryStyle) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(style.name);
  const [prompt, setPrompt] = useState(style.prompt);
  const [saving, setSaving] = useState(false);
  const dirty = name !== style.name || prompt !== style.prompt;

  async function save() {
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
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`确定删除风格「${style.name}」？`)) return;
    const res = await fetch(`/api/library/styles/${style.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      onDeleted(style.id);
      toast.success("已删除");
    } else {
      toast.error("删除失败");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 max-w-xs text-sm"
          />
          {style.builtin && <Badge variant="secondary">内置</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="风格提示词，会注入到所有生成提示词中"
          className="min-h-[80px] text-sm"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            保存
          </Button>
          <Button size="sm" variant="destructive" onClick={remove}>
            <Trash2 className="size-3.5" />
            删除
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function StylesPage() {
  const [styles, setStyles] = useState<LibraryStyle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);

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
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          新建项目时可从此处选择风格，风格提示词会注入到剧本/资产/分镜与厂商提示词中。
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
      <div className="grid gap-4 lg:grid-cols-2">
        {styles.map((style) => (
          <StyleCard
            key={style.id}
            style={style}
            onSaved={(s) =>
              setStyles((prev) => prev.map((x) => (x.id === s.id ? s : x)))
            }
            onDeleted={(id) =>
              setStyles((prev) => prev.filter((x) => x.id !== id))
            }
          />
        ))}
      </div>
    </div>
  );
}
