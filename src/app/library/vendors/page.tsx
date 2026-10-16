"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Variable,
} from "lucide-react";
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
  platformLabel,
  TEMPLATE_VARIABLES,
  DEFAULT_TEMPLATES,
} from "@core/shared/templates-defaults";
import { DEFAULT_VENDORS } from "@core/shared/orchestration/vendors";
import type { LibraryVendor } from "@core/shared/library/vendors";
import type { LibraryTemplate } from "@core/shared/library/types";

function msToSec(ms: number): string {
  return (ms / 1000).toString();
}

function secToMs(sec: string, fallback: number): number {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n * 1000);
}

interface VendorForm {
  name: string;
  platform: string;
  maxShotsPerSegment: number;
  supportMultiShot: boolean;
  maxRefImages: number;
  minSegmentSec: string;
  maxSegmentSec: string;
  stepSec: string;
  supportFirstFrame: boolean;
  supportLastFrame: boolean;
  note: string;
  compilePrompt: string;
}

interface TemplateDraft {
  body: string;
  params: string;
  legend: string;
}

function toForm(v: LibraryVendor): VendorForm {
  return {
    name: v.name,
    platform: v.platform,
    maxShotsPerSegment: v.maxShotsPerSegment,
    supportMultiShot: v.supportMultiShot,
    maxRefImages: v.maxRefImages,
    minSegmentSec: msToSec(v.minSegmentMs),
    maxSegmentSec: msToSec(v.maxSegmentMs),
    stepSec: msToSec(v.durationStepMs),
    supportFirstFrame: v.supportFirstFrame,
    supportLastFrame: v.supportLastFrame,
    note: v.note,
    compilePrompt: v.compilePrompt ?? "",
  };
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}

function VendorDialog({
  vendor,
  templates,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  vendor: LibraryVendor | null;
  templates: LibraryTemplate[];
  onOpenChange: (open: boolean) => void;
  onSaved: (v: LibraryVendor) => void;
  onDeleted: (id: string) => void;
}) {
  const [form, setForm] = useState<VendorForm | null>(
    vendor ? toForm(vendor) : null,
  );
  const [tpl, setTpl] = useState<TemplateDraft>(() => {
    const t = templates.find((x) => x.platform === vendor?.platform);
    return {
      body: t?.bodyTemplate ?? "",
      params: t?.paramsTemplate ?? "",
      legend: t?.legendTemplate ?? "",
    };
  });
  const [saving, setSaving] = useState(false);

  if (!vendor || !form) return null;
  const patch = (p: Partial<VendorForm>) => setForm({ ...form, ...p });

  const defaultVendor = DEFAULT_VENDORS.find(
    (d) => d.id === vendor.id || d.platform === vendor.platform,
  );

  // 一键还原：把厂商能力、翻译提示词与提示词模板都填回内置默认（改超出问题时的兜底）。
  function restoreDefaults() {
    if (!defaultVendor) return;
    setForm({
      name: defaultVendor.name,
      platform: defaultVendor.platform,
      maxShotsPerSegment: defaultVendor.maxShotsPerSegment,
      supportMultiShot: defaultVendor.supportMultiShot,
      maxRefImages: defaultVendor.maxRefImages,
      minSegmentSec: msToSec(defaultVendor.minSegmentMs),
      maxSegmentSec: msToSec(defaultVendor.maxSegmentMs),
      stepSec: msToSec(defaultVendor.durationStepMs),
      supportFirstFrame: defaultVendor.supportFirstFrame,
      supportLastFrame: defaultVendor.supportLastFrame,
      note: defaultVendor.note,
      compilePrompt: defaultVendor.compilePrompt,
    });
    const t = DEFAULT_TEMPLATES.find(
      (x) => x.platform === defaultVendor.platform,
    );
    setTpl({
      body: t?.bodyTemplate ?? "",
      params: t?.paramsTemplate ?? "",
      legend: t?.legendTemplate ?? "",
    });
    toast.info("已填入默认值，点击「保存」生效");
  }

  // 厂商与其提示词模板一一对应：切换平台时同步载入该平台的模板。
  function changePlatform(next: string) {
    const t = templates.find((x) => x.platform === next);
    patch({ platform: next });
    setTpl({
      body: t?.bodyTemplate ?? "",
      params: t?.paramsTemplate ?? "",
      legend: t?.legendTemplate ?? "",
    });
  }

  const platformOptions = Array.from(
    new Set([form.platform, ...templates.map((t) => t.platform)]),
  );
  const currentTemplate = templates.find((t) => t.platform === form.platform);

  async function save() {
    if (!vendor || !form) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/library/vendors/${vendor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          platform: form.platform,
          maxShotsPerSegment: form.maxShotsPerSegment,
          supportMultiShot: form.supportMultiShot,
          maxRefImages: form.maxRefImages,
          minSegmentMs: secToMs(form.minSegmentSec, vendor.minSegmentMs),
          maxSegmentMs: secToMs(form.maxSegmentSec, vendor.maxSegmentMs),
          durationStepMs: secToMs(form.stepSec, 0),
          supportFirstFrame: form.supportFirstFrame,
          supportLastFrame: form.supportLastFrame,
          note: form.note,
          compilePrompt: form.compilePrompt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      if (currentTemplate) {
        const tplRes = await fetch(
          `/api/library/templates/${currentTemplate.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bodyTemplate: tpl.body,
              paramsTemplate: tpl.params,
              legendTemplate: tpl.legend,
            }),
          },
        );
        if (!tplRes.ok) throw new Error("模板保存失败");
      }
      onSaved(data.vendor);
      toast.success("已保存");
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!vendor) return;
    if (!window.confirm(`确定删除厂商「${vendor.name}」？`)) return;
    try {
      const res = await fetch(`/api/library/vendors/${vendor.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "删除失败");
      }
      onDeleted(vendor.id);
      toast.success("已删除");
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-4 overflow-hidden sm:max-w-[min(94vw,1120px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {vendor.name}
            {vendor.builtin && <Badge variant="secondary">内置</Badge>}
          </DialogTitle>
          <DialogDescription>
            能力参数决定「分镜怎么打包成段、喂几张参考图、时长怎么取」；提示词模板决定该厂商的生成提示词长什么样。
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">名称</label>
            <Input
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              className="h-8 text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">提示词模板平台</label>
            <select
              value={form.platform}
              onChange={(e) => changePlatform(e.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring dark:bg-input/30"
            >
              {platformOptions.map((p) => (
                <option key={p} value={p}>
                  {platformLabel(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">每段最多分镜</label>
            <Input
              type="number"
              min={1}
              value={form.maxShotsPerSegment}
              onChange={(e) =>
                patch({ maxShotsPerSegment: Number(e.target.value) })
              }
              className="h-8 text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">参考图上限（含场景）</label>
            <Input
              type="number"
              min={1}
              value={form.maxRefImages}
              onChange={(e) => patch({ maxRefImages: Number(e.target.value) })}
              className="h-8 text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">时长下限（秒）</label>
            <Input
              value={form.minSegmentSec}
              onChange={(e) => patch({ minSegmentSec: e.target.value })}
              className="h-8 text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">时长上限（秒）</label>
            <Input
              value={form.maxSegmentSec}
              onChange={(e) => patch({ maxSegmentSec: e.target.value })}
              className="h-8 text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">时长档位步进（秒，0=连续）</label>
            <Input
              value={form.stepSec}
              onChange={(e) => patch({ stepSec: e.target.value })}
              className="h-8 text-sm"
            />
          </div>
          <div className="col-span-full flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox
              checked={form.supportMultiShot}
              onChange={(v) => patch({ supportMultiShot: v })}
              label="支持段内多镜"
            />
            <Checkbox
              checked={form.supportFirstFrame}
              onChange={(v) => patch({ supportFirstFrame: v })}
              label="支持首帧"
            />
            <Checkbox
              checked={form.supportLastFrame}
              onChange={(v) => patch({ supportLastFrame: v })}
              label="支持尾帧"
            />
          </div>
          <div className="col-span-full grid gap-1.5">
            <label className="text-xs font-medium">说明</label>
            <Textarea
              value={form.note}
              onChange={(e) => patch({ note: e.target.value })}
              placeholder="一句话描述该厂商的限制，便于编排时判断。"
              className="min-h-[80px] text-sm"
            />
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">提示词模板</h4>
            <Badge variant="secondary">{platformLabel(form.platform)}</Badge>
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
              value={tpl.body}
              onChange={(e) => setTpl({ ...tpl, body: e.target.value })}
              className="min-h-[200px] font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">参数模板</label>
            <Textarea
              value={tpl.params}
              onChange={(e) => setTpl({ ...tpl, params: e.target.value })}
              className="min-h-[100px] font-mono text-xs"
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">图例模板</label>
            <Textarea
              value={tpl.legend}
              onChange={(e) => setTpl({ ...tpl, legend: e.target.value })}
              className="min-h-[70px] font-mono text-xs"
            />
          </div>
        </div>

        <Separator />

        <div className="grid gap-1.5">
          <h4 className="text-sm font-medium">AI 翻译提示词</h4>
          <p className="text-xs text-muted-foreground">
            点「生成 AI 提示词」时，用这段提示词把上面的正文编译成本厂商可执行的版本（厂商专属）。
            留空则使用系统通用翻译提示词。
          </p>
          <Textarea
            value={form.compilePrompt}
            onChange={(e) => patch({ compilePrompt: e.target.value })}
            placeholder="留空则使用系统通用翻译提示词"
            className="min-h-[240px] font-mono text-xs"
          />
        </div>
        </div>

        <DialogFooter className="sm:justify-between bg-background">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={restoreDefaults}
              disabled={!defaultVendor}
              title={
                defaultVendor
                  ? "把能力、翻译提示词与模板填回内置默认"
                  : "该厂商无内置默认"
              }
            >
              <RotateCcw className="size-3.5" />
              恢复内置
            </Button>
            {!vendor.builtin && (
              <Button variant="destructive" onClick={remove}>
                <Trash2 className="size-3.5" />
                删除
              </Button>
            )}
          </div>
          <Button onClick={save} disabled={saving}>
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

export default function VendorsPage() {
  const [vendors, setVendors] = useState<LibraryVendor[]>([]);
  const [templates, setTemplates] = useState<LibraryTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LibraryVendor | null>(null);

  const load = useCallback(async () => {
    const [vendorRes, tplRes] = await Promise.all([
      fetch("/api/library/vendors").then((r) => r.json()),
      fetch("/api/library/templates").then((r) => r.json()),
    ]);
    return {
      vendors: (vendorRes.vendors ?? []) as LibraryVendor[],
      templates: (tplRes.templates ?? []) as LibraryTemplate[],
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await load();
        if (!cancelled) {
          setVendors(data.vendors);
          setTemplates(data.templates);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) toast.error("读取厂商库失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function create() {
    setCreating(true);
    try {
      const res = await fetch("/api/library/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "新厂商", platform: "custom" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      setVendors((prev) => [...prev, data.vendor]);
      setEditing(data.vendor);
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
          每个厂商绑定一套提示词模板。点击卡片编辑厂商能力与对应的提示词模板，编排层会按这里的规则打包分镜。
        </p>
        <Button onClick={create} disabled={creating}>
          {creating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          新增厂商
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {vendors.map((v) => (
          <Card key={v.id} size="sm">
            <CardContent className="flex items-start justify-between gap-2">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setEditing(v)}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{v.name}</span>
                  {v.builtin && <Badge variant="secondary">内置</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {v.supportMultiShot
                    ? `每段≤${v.maxShotsPerSegment}镜`
                    : "单镜/段"}{" "}
                  · 参考图≤{v.maxRefImages} · {(v.minSegmentMs / 1000).toFixed(0)}–
                  {(v.maxSegmentMs / 1000).toFixed(0)}s ·{" "}
                  {v.supportFirstFrame ? "首帧" : "无首帧"}
                  {v.supportLastFrame ? "/尾帧" : ""}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  模板：{platformLabel(v.platform)} ·{" "}
                  {v.note.trim() || "未填写说明"}
                </p>
              </button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="编辑"
                onClick={() => setEditing(v)}
              >
                <Pencil />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <VendorDialog
        key={editing?.id ?? "closed"}
        vendor={editing}
        templates={templates}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={(s) =>
          setVendors((prev) => prev.map((x) => (x.id === s.id ? s : x)))
        }
        onDeleted={(id) =>
          setVendors((prev) => prev.filter((x) => x.id !== id))
        }
      />
    </div>
  );
}
