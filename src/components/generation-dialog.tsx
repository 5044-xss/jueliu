"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, RefreshCw, Save, Wand2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { CopyButton } from "@/components/copy-button";
import {
  DEFAULT_PLATFORM,
  platformLabel,
  sortPlatforms,
} from "@/lib/templates-defaults";
import type { RenderedPrompt } from "@/lib/render-types";

interface TemplateInfo {
  id: string;
  platform: string;
  name: string;
  bodyTemplate: string;
  paramsTemplate: string;
  legendTemplate: string;
}

export function GenerationDialog({
  projectId,
  segmentId,
  segmentLabel,
  open,
  onOpenChange,
  onStale,
}: {
  projectId: string;
  segmentId: string;
  segmentLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStale?: () => void;
}) {
  const [platform, setPlatform] = useState<string>(DEFAULT_PLATFORM);
  const [platformTabs, setPlatformTabs] = useState<string[]>([
    DEFAULT_PLATFORM,
  ]);
  const [rendered, setRendered] = useState<RenderedPrompt | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [template, setTemplate] = useState<TemplateInfo | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setAiText("");
      try {
        const [renderRes, tplRes] = await Promise.all([
          fetch("/api/render/platform", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, segmentId, platform }),
          }),
          fetch(`/api/library/templates`).then((r) => r.json()),
        ]);
        const data = await renderRes.json();
        if (cancelled) return;
        if (!renderRes.ok) {
          if (renderRes.status === 404 || data?.error === "段落不存在") {
            throw new Error(
              "该段落已失效（分镜可能已重新生成），请关闭弹窗后刷新页面",
            );
          }
          throw new Error(data?.error || "渲染失败");
        }
        setRendered(data);
        const templates = (tplRes.templates ?? []) as TemplateInfo[];
        setPlatformTabs(
          sortPlatforms([...new Set(templates.map((t) => t.platform))]),
        );
        const found = templates.find((t) => t.platform === platform);
        setTemplate(found ?? null);
        setDraftBody(found?.bodyTemplate ?? "");
      } catch (error) {
        if (cancelled) return;
        const message = (error as Error).message;
        toast.error(message);
        if (message.includes("已失效")) {
          onStale?.();
          onOpenChange(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // onStale/onOpenChange 故意不入依赖：父级每次渲染会重建回调，入依赖会导致重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, platform, projectId, segmentId, refreshKey]);

  async function saveTemplate() {
    if (!template) return;
    try {
      const res = await fetch(`/api/library/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyTemplate: draftBody }),
      });
      if (!res.ok) throw new Error();
      toast.success("模板已保存");
      setEditing(false);
      setPlatform((p) => p);
      const again = await fetch("/api/render/platform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, segmentId, platform }),
      });
      setRendered(await again.json());
    } catch {
      toast.error("保存模板失败");
    }
  }

  const allText = rendered
    ? [
        rendered.body,
        "",
        "【图片清单】",
        rendered.legend,
        "",
        "【生成参数】",
        rendered.params,
      ].join("\n")
    : "";

  async function generateAiPrompt() {
    setAiLoading(true);
    try {
      const res = await fetch("/api/skills/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId: "storyboard-to-ai-prompt",
          projectId,
          input: { segmentId, platform },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "生成失败");
      setAiText(String(data.result ?? ""));
      toast.success("AI 提示词已生成");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>第三方生成 · {segmentLabel}</DialogTitle>
          <DialogDescription>
            复制提示词到平台，按图片清单顺序上传参考图后生成，再回传视频。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1">
          {platformTabs.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={platform === p ? "default" : "outline"}
              onClick={() => setPlatform(p)}
            >
              {platformLabel(p)}
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            {template && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing((v) => !v)}
              >
                <Pencil className="size-3.5" />
                {editing ? "取消编辑" : "编辑模板"}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRefreshKey((v) => v + 1)}
            >
              <RefreshCw className="size-3.5" />
              重渲染
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 渲染中…
            </div>
          ) : editing && template ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                可用变量：{"{{style}}"} {"{{shotList}}"} {"{{manifestLegend}}"}{" "}
                {"{{blockingText}}"} {"{{anchorText}}"} {"{{negativeText}}"} 等
              </p>
              <Textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                className="min-h-[320px] font-mono text-xs"
              />
              <div>
                <Button size="sm" onClick={saveTemplate}>
                  <Save className="size-3.5" />
                  保存模板
                </Button>
              </div>
            </div>
          ) : rendered ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={allText} label="复制全部" />
                <CopyButton text={rendered.body} label="复制正文" />
                <CopyButton text={rendered.legend} label="复制图例" />
                <CopyButton text={rendered.params} label="复制参数" />
              </div>

              <section className="flex flex-col gap-1.5">
                <h4 className="text-sm font-medium">图片清单（按序上传）</h4>
                <div className="flex flex-wrap gap-2">
                  {rendered.manifest.map((m) => (
                    <div
                      key={m.slot}
                      className="flex w-28 flex-col gap-1 rounded-lg border p-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary">图{m.slot}</Badge>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {m.role === "first_frame" ? "首帧" : m.role}
                        </span>
                      </div>
                      {m.viewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.viewUrl}
                          alt={m.label}
                          className="h-20 w-full rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-20 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
                          未上传
                        </div>
                      )}
                      <span className="line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                        {m.label}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <Separator />

              <section className="flex flex-col gap-1.5">
                <h4 className="text-sm font-medium">提示词正文</h4>
                <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-xs leading-6">
                  {rendered.body}
                </pre>
              </section>

              <section className="flex flex-col gap-1.5">
                <h4 className="text-sm font-medium">生成参数（引导）</h4>
                <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-xs leading-6">
                  {rendered.params}
                </pre>
              </section>

              <Separator />

              <section className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-medium">AI 可执行提示词</h4>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={generateAiPrompt}
                    disabled={aiLoading}
                  >
                    {aiLoading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="size-3.5" />
                    )}
                    {aiText ? "重新生成" : "生成 AI 提示词"}
                  </Button>
                  {aiText && <CopyButton text={aiText} label="复制 AI 提示词" />}
                </div>
                {aiText ? (
                  <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-xs leading-6">
                    {aiText}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    按「分镜 → AI 提示词」技能把上面的提示词编译成 AI 可执行版；可在「资源库 →
                    技能」里调整该技能的提示词。
                  </p>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
