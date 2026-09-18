"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2, Variable } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import {
  DEFAULT_PLATFORM,
  platformLabel,
  sortPlatforms,
  TEMPLATE_VARIABLES,
} from "@/lib/templates-defaults";
import type { LibraryTemplate } from "@/lib/library/types";

function TemplateCard({
  template,
  onSaved,
  onDeleted,
}: {
  template: LibraryTemplate;
  onSaved: (t: LibraryTemplate) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(template.name);
  const [version, setVersion] = useState(template.version);
  const [body, setBody] = useState(template.bodyTemplate);
  const [params, setParams] = useState(template.paramsTemplate);
  const [legend, setLegend] = useState(template.legendTemplate);
  const [saving, setSaving] = useState(false);
  const dirty =
    name !== template.name ||
    version !== template.version ||
    body !== template.bodyTemplate ||
    params !== template.paramsTemplate ||
    legend !== template.legendTemplate;

  async function save() {
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
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`确定删除模板「${template.name}」？`)) return;
    const res = await fetch(`/api/library/templates/${template.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      onDeleted(template.id);
      toast.success("已删除");
    } else {
      toast.error("删除失败");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Badge>{platformLabel(template.platform)}</Badge>
          {template.platform === DEFAULT_PLATFORM && (
            <Badge variant="outline">默认生成</Badge>
          )}
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 max-w-[220px] text-sm"
          />
          <span className="text-xs text-muted-foreground">版本</span>
          <Input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="h-7 w-16 text-sm"
          />
          {template.builtin && <Badge variant="secondary">内置</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start gap-2 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
          <Variable className="mt-0.5 size-3.5 shrink-0" />
          <span>可用变量：{TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(" ")}</span>
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
            className="min-h-[60px] font-mono text-xs"
          />
        </div>
        <Separator />
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

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<LibraryTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newVendor, setNewVendor] = useState("");

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          「默认（通用）」模板始终可用；为豆包/即梦等厂商各配一套模板，生成弹窗按
          Tab 切换渲染。
        </p>
        <div className="flex items-center gap-2">
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
      </div>
      <div className="grid gap-4">
        {ordered.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onSaved={(t) =>
              setTemplates((prev) =>
                prev.map((x) => (x.id === t.id ? t : x)),
              )
            }
            onDeleted={(id) =>
              setTemplates((prev) => prev.filter((x) => x.id !== id))
            }
          />
        ))}
      </div>
    </div>
  );
}
