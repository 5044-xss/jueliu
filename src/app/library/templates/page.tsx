"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Save, Trash2, Variable } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import {
  DEFAULT_PLATFORM,
  platformLabel,
  sortPlatforms,
  TEMPLATE_VARIABLES,
} from "@/lib/templates-defaults";
import type { LibraryTemplate } from "@/lib/library/types";

function TemplateDialog({
  template,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  template: LibraryTemplate | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (t: LibraryTemplate) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [version, setVersion] = useState(template?.version ?? "");
  const [body, setBody] = useState(template?.bodyTemplate ?? "");
  const [params, setParams] = useState(template?.paramsTemplate ?? "");
  const [legend, setLegend] = useState(template?.legendTemplate ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = template
    ? name !== template.name ||
      version !== template.version ||
      body !== template.bodyTemplate ||
      params !== template.paramsTemplate ||
      legend !== template.legendTemplate
    : false;

  async function save() {
    if (!template) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/library/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          version,
          bodyTemplate: body,
          paramsTemplate: params,
          legendTemplate: legend,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      onSaved(data.template);
      toast.success("已保存");
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!template) return;
    if (!window.confirm(`确定删除模板「${template.name}」？`)) return;
    const res = await fetch(`/api/library/templates/${template.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      onDeleted(template.id);
      toast.success("已删除");
      onOpenChange(false);
    } else {
      toast.error("删除失败");
    }
  }

  return (
    <Dialog open={template !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-full sm:max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {template && <Badge>{platformLabel(template.platform)}</Badge>}
            {template?.platform === DEFAULT_PLATFORM && (
              <Badge variant="outline">默认生成</Badge>
            )}
            <span>{template?.name || "模板"}</span>
            {template?.builtin && <Badge variant="secondary">内置</Badge>}
          </DialogTitle>
          <DialogDescription>
            生成弹窗按厂商 Tab 切换渲染；正文/参数/图例中的变量会被实际值替换。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid flex-1 gap-1.5">
              <label className="text-xs font-medium">名称</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium">版本</label>
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="h-8 w-20 text-sm"
              />
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
            <Variable className="mt-0.5 size-3.5 shrink-0" />
            <span>
              可用变量：{TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(" ")}
            </span>
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">正文模板</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[240px] font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">参数模板</label>
            <Textarea
              value={params}
              onChange={(e) => setParams(e.target.value)}
              className="min-h-[110px] font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">图例模板</label>
            <Textarea
              value={legend}
              onChange={(e) => setLegend(e.target.value)}
              className="min-h-[70px] font-mono text-xs"
            />
          </div>
        </div>
        <Separator />
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

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<LibraryTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newVendor, setNewVendor] = useState("");
  const [editing, setEditing] = useState<LibraryTemplate | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/library/templates");
    const data = await res.json();
    return (data.templates ?? []) as LibraryTemplate[];
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await load();
        if (!cancelled) {
          setTemplates(list);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) toast.error("读取模板库失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function create() {
    const platform = newVendor.trim().toLowerCase().replace(/\s+/g, "-");
    if (!platform) {
      toast.error("请填写厂商名称");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/library/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, name: `${platform} 模板` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      setTemplates((prev) => [...prev, data.template]);
      setEditing(data.template);
      setNewVendor("");
      toast.success("已创建厂商模板");
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

  const platformOrder = sortPlatforms([
    ...new Set(templates.map((t) => t.platform)),
  ]);
  const ordered = [...templates].sort(
    (a, b) =>
      platformOrder.indexOf(a.platform) - platformOrder.indexOf(b.platform),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl bg-block-lime p-4 text-sm leading-relaxed">
        「默认（通用）」始终可用；为豆包/即梦等厂商各配一套模板。点击卡片查看或编辑。
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Input
          value={newVendor}
          onChange={(e) => setNewVendor(e.target.value)}
          placeholder="厂商名称，如 doubao"
          className="h-8 w-44"
        />
        <Button onClick={create} disabled={creating}>
          {creating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          新增厂商模板
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ordered.map((template) => (
          <Card key={template.id} size="sm">
            <CardContent className="flex items-start justify-between gap-2">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setEditing(template)}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge>{platformLabel(template.platform)}</Badge>
                  <span className="truncate text-sm font-medium">
                    {template.name}
                  </span>
                  {template.builtin && (
                    <Badge variant="secondary">内置</Badge>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 font-mono text-xs text-muted-foreground">
                  {template.bodyTemplate.trim() || "未填写正文模板"}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  版本 {template.version || "—"}
                </p>
              </button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="编辑"
                onClick={() => setEditing(template)}
              >
                <Pencil />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <TemplateDialog
        key={editing?.id ?? "closed"}
        template={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={(t) =>
          setTemplates((prev) => prev.map((x) => (x.id === t.id ? t : x)))
        }
        onDeleted={(id) =>
          setTemplates((prev) => prev.filter((x) => x.id !== id))
        }
      />
    </div>
  );
}
