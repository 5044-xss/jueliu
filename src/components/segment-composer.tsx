"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";import { toast } from "sonner";
import {
  ChevronDown,
  ImagePlus,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  Stethoscope,
  Upload,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PreviewImage } from "@/components/preview-image";
import { PromptRepairDialog } from "@/components/prompt-repair-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/confirm-dialog";
import { readError } from "@/lib/http";
import { cn } from "@core/client/utils";
import type {
  StoredSegment,
  StoredSceneStoryboard,
} from "@core/shared/schemas/storyboard";
import type {
  StoredAsset,
  StoredVariant,
  StoredView,
} from "@core/shared/schemas/assets";
import type {
  ManifestItem,
  RefOverrideItem,
  RenderedPrompt,
} from "@core/shared/render-types";

const TYPE_LABEL = {
  character: "角色",
  scene: "场景",
  prop: "道具",
} as const;

function toOverride(manifest: ManifestItem[]): RefOverrideItem[] {
  return manifest.map((item) => ({
    role: item.role,
    label: item.label,
    viewId: item.viewId,
    frameId: item.frameId,
    uploadId: item.uploadId ?? null,
  }));
}

function refLabel(
  asset: StoredAsset,
  variant: StoredVariant,
  view: StoredView,
): string {
  return [asset.name, variant.label, view.label].filter(Boolean).join("·");
}

function isKeyframeOnly(manifest: ManifestItem[]): boolean {
  const starts = manifest.filter((item) => item.role === "start").length;
  return starts > 0 && starts === manifest.length;
}

export function SegmentComposer({
  projectId,
  segment,
  scene,
  assets,
  platform,
  aspectRatio,
  maxRefs,
  minDurationSec,
  maxDurationSec,
  durationStepSec,
  timeRange,
  reloadToken,
  onRefresh,
  onRegenerateSegment,
  onRestoreSegment,
  onEditBlocking,
  onOpenPreflight,
}: {
  projectId: string;
  segment: StoredSegment;
  scene: StoredSceneStoryboard;
  assets: StoredAsset[];
  platform: string;
  aspectRatio: string;
  maxRefs: number;
  minDurationSec: number;
  maxDurationSec: number;
  durationStepSec: number;
  timeRange: string;
  reloadToken: number;
  onRefresh: () => Promise<void> | void;
  onRegenerateSegment: (segmentId: string) => void;
  onRestoreSegment: (segmentId: string) => void;
  onEditBlocking: (scene: StoredSceneStoryboard) => void;
  onOpenPreflight: () => void;
}) {
  const confirm = useConfirm();
  const [rendered, setRendered] = useState<RenderedPrompt | null>(null);
  const [prompt, setPrompt] = useState("");
  const [baseline, setBaseline] = useState("");
  const [promptStale, setPromptStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refBusy, setRefBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [durationDraft, setDurationDraft] = useState(() =>
    Math.round(segment.targetMs / 1000),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const loadSeq = useRef(0);
  const autoTried = useRef<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const generatePrompt = useCallback(
    async (
      opts: {
        silent?: boolean;
        successMessage?: string;
        keyframeOnly?: boolean;
      } = {},
    ) => {
      if (!alive.current) return false;
      setPromptBusy(true);
      try {
        const res = await fetch("/api/skills/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            skillId: "storyboard-to-ai-prompt",
            projectId,
            input: {
              segmentId: segment.id,
              platform,
              keyframeOnly: opts.keyframeOnly === true,
            },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "生成提示词失败");
        const text = String(data.result ?? "");
        if (!text.trim()) throw new Error("提示词生成结果为空");
        if (!alive.current) return false;
        setPrompt(text);
        setBaseline(text);
        setPromptStale(false);
        if (opts.successMessage) {
          toast.success(opts.successMessage);
        } else if (!opts.silent) {
          toast.success("提示词已重新编译");
        }
        return true;
      } catch (error) {
        if (!opts.silent) {
          toast.error((error as Error).message || "生成提示词失败");
        }
        return false;
      } finally {
        if (alive.current) setPromptBusy(false);
      }
    },
    [projectId, segment.id, platform],
  );

  const reloadRender = useCallback(async () => {
    const res = await fetch("/api/render/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        segmentId: segment.id,
        platform,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "读取提交信息失败");
    if (alive.current) setRendered(data as RenderedPrompt);
    return data as RenderedPrompt;
  }, [projectId, segment.id, platform]);

  useEffect(() => {
    let cancelled = false;
    const seq = ++loadSeq.current;
    (async () => {
      try {
        const [renderRes, settingsRes] = await Promise.all([
          fetch("/api/render/platform", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              segmentId: segment.id,
              platform,
            }),
          }),
          fetch("/api/settings").catch(() => null),
        ]);
        const renderData = await renderRes.json().catch(() => ({}));
        if (!renderRes.ok) {
          throw new Error(renderData?.error || "读取提交信息失败");
        }
        if (cancelled || seq !== loadSeq.current) return;
        const renderedData = renderData as RenderedPrompt;
        const keyframeOnly = isKeyframeOnly(renderedData.manifest ?? []);
        const aiRes = await fetch(
          `/api/projects/${projectId}/segments/${segment.id}/ai-prompt?platform=${encodeURIComponent(platform)}&keyframeOnly=${keyframeOnly ? "1" : "0"}`,
        );
        const aiData = await aiRes.json().catch(() => null);
        const settingsData = settingsRes
          ? await settingsRes.json().catch(() => null)
          : null;
        if (cancelled || seq !== loadSeq.current) return;
        setRendered(renderedData);
        const cached =
          typeof aiData?.prompt === "string" ? aiData.prompt : "";
        setPrompt(cached);
        setBaseline(cached);
        setPromptStale(Boolean(aiData?.stale));
        setLoading(false);
        const auto = settingsData?.settings?.autoGenerateAiPrompt !== false;
        const key = `${segment.id}:${platform}:${keyframeOnly ? "k" : "r"}`;
        // 没有提示词时必须自动编译一版（否则输入框和下方按钮都不可用）；
        // 已有旧版本时按设置决定是否自动重编译，避免无谓的 LLM 调用。
        if (
          (!cached || (aiData?.stale && auto)) &&
          autoTried.current !== key
        ) {
          autoTried.current = key;
          void generatePrompt({ silent: true, keyframeOnly });
        }
      } catch (error) {
        if (cancelled || seq !== loadSeq.current) return;
        setLoadError((error as Error).message || "读取提交信息失败");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, segment.id, platform, reloadToken]);

  async function savePrompt(
    promptText: string,
    keyframeOnly: boolean,
  ): Promise<boolean> {
    const res = await fetch(
      `/api/projects/${projectId}/segments/${segment.id}/ai-prompt`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText, platform, keyframeOnly }),
      },
    );
    if (!res.ok) throw new Error(await readError(res, "保存提示词失败"));
    setPromptStale(false);
    return true;
  }

  async function saveOnly() {
    if (!prompt.trim()) {
      toast.error("提示词为空，无法保存");
      return;
    }
    setSaving(true);
    try {
      await savePrompt(prompt, isKeyframeOnly(manifest));
      toast.success("提示词已保存");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    if (!prompt.trim()) {
      toast.error("提示词为空，无法保存");
      return;
    }
    if (sending) return;
    setSending(true);
    try {
      if (durationDraft !== Math.round(segment.targetMs / 1000)) {
        const durationRes = await fetch(
          `/api/projects/${projectId}/segments/${segment.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetMs: durationDraft * 1000 }),
          },
        );
        if (!durationRes.ok) {
          throw new Error(await readError(durationRes, "保存时长失败"));
        }
      }
      await savePrompt(prompt, isKeyframeOnly(manifest));
      toast.success("提示词已保存", {
        description: "可复制到第三方生成视频，完成后回传到预览区。",
      });
      await onRefresh();
    } catch (error) {
      toast.error((error as Error).message || "保存失败");
    } finally {
      setSending(false);
    }
  }

  function restorePrompt() {
    setPrompt(baseline);
    toast.success("已还原为打开时的提示词");
  }

  async function applyRepairedPrompt(promptText: string): Promise<boolean> {
    if (!promptText.trim()) {
      toast.error("修改结果为空，未应用");
      return false;
    }
    setSaving(true);
    try {
      await savePrompt(promptText, isKeyframeOnly(manifest));
      setPrompt(promptText);
      setPromptStale(false);
      toast.success("提示词已按意见修改", {
        description: "检查无误后即可复制使用。",
      });
      return true;
    } catch (error) {
      toast.error((error as Error).message || "保存提示词失败");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function persistRefs(next: RefOverrideItem[] | null, message: string) {
    if (refBusy) return;
    setRefBusy(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segment.id}/refs`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refs: next }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "保存参考图失败");
      await onRefresh();
      const nextRendered = await reloadRender();
      const ok = await generatePrompt({
        silent: true,
        keyframeOnly: isKeyframeOnly(nextRendered.manifest ?? []),
      });
      if (ok) toast.success(message);
      else toast.warning(`${message}，但提示词重新编译失败，请点「重新编译」。`);
    } catch (error) {
      toast.error((error as Error).message || "保存参考图失败");
    } finally {
      setRefBusy(false);
    }
  }

  async function removeRef(index: number) {
    if (!rendered || refBusy) return;
    const target = rendered.manifest[index];
    if (!target) return;
    const ok = await confirm({
      title: "移除参考图",
      description: `从本段提交清单移除「图${target.slot} ${target.label}」？会自动重新编译提示词。`,
      confirmText: "移除",
      destructive: true,
    });
    if (!ok) return;
    const next = toOverride(rendered.manifest).filter((_, i) => i !== index);
    await persistRefs(next, "参考图已移除");
  }

  async function resetRefs() {
    if (!rendered || refBusy) return;
    const ok = await confirm({
      title: "恢复默认参考图",
      description: "恢复为按分镜与起始画面自动生成的参考图清单？",
      confirmText: "恢复",
    });
    if (!ok) return;
    await persistRefs(null, "已恢复默认参考图");
  }

  async function addRef(
    asset: StoredAsset,
    variant: StoredVariant,
    view: StoredView,
  ) {
    if (!rendered || refBusy) return;
    if (rendered.manifest.some((item) => item.viewId === view.id)) {
      toast.error("这张参考图已在清单里");
      return;
    }
    if (rendered.manifest.length >= maxRefs) {
      toast.error(`参考图最多 ${maxRefs} 张`);
      return;
    }
    const next: RefOverrideItem[] = [
      ...toOverride(rendered.manifest),
      {
        role: asset.type,
        label: refLabel(asset, variant, view),
        viewId: view.id,
        frameId: null,
      },
    ];
    setPickerOpen(false);
    await persistRefs(next, "参考图已添加");
  }

  async function addUploads(files: File[]) {
    if (!rendered || refBusy || uploadBusy) return;
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      toast.error("请选择图片文件");
      return;
    }
    const room = maxRefs - rendered.manifest.length;
    if (room <= 0) {
      toast.error(`参考图最多 ${maxRefs} 张`);
      return;
    }
    const picked = images.slice(0, room);
    if (images.length > room) {
      toast.warning(`参考图最多 ${maxRefs} 张，已忽略多余的 ${images.length - room} 张`);
    }
    setUploadBusy(true);
    try {
      const added: RefOverrideItem[] = [];
      for (const file of picked) {
        const form = new FormData();
        form.append("file", file);
        form.append("label", file.name);
        const res = await fetch(
          `/api/projects/${projectId}/segments/${segment.id}/ref-uploads`,
          { method: "POST", body: form },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || `上传「${file.name}」失败`);
        }
        const upload = data.upload as
          | { id?: string; label?: string }
          | undefined;
        if (!upload?.id) throw new Error(`上传「${file.name}」失败`);
        added.push({
          role: "upload",
          label: upload.label || file.name,
          viewId: null,
          frameId: null,
          uploadId: upload.id,
        });
      }
      if (!alive.current) return;
      await persistRefs(
        [...toOverride(rendered.manifest), ...added],
        `已添加 ${added.length} 张本地参考图`,
      );
    } catch (error) {
      toast.error((error as Error).message || "上传本地参考图失败");
    } finally {
      if (alive.current) setUploadBusy(false);
    }
  }

  function removeUpload(uploadId: string) {
    if (!rendered) return;
    const index = rendered.manifest.findIndex(
      (item) => item.uploadId === uploadId,
    );
    if (index >= 0) void removeRef(index);
  }

  const manifest = rendered?.manifest ?? [];
  const currentSeconds = Math.round(segment.targetMs / 1000);
  const durationOptions = useMemo(() => {
    const min = Math.max(1, Math.round(minDurationSec));
    const max = Math.max(min, Math.round(maxDurationSec));
    const step = Math.max(1, Math.round(durationStepSec));
    const options: number[] = [];
    for (let sec = min; sec <= max; sec += step) options.push(sec);
    for (const value of [currentSeconds, durationDraft]) {
      if (!options.includes(value)) options.push(value);
    }
    options.sort((a, b) => a - b);
    return options;
  }, [
    minDurationSec,
    maxDurationSec,
    durationStepSec,
    currentSeconds,
    durationDraft,
  ]);
  const dirty = prompt !== baseline;
  // 只看本段是否在生成：其它段落批量生成时，本段仍可编辑/重新提交。
  const busy = sending || saving || promptBusy;

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border bg-muted/20 p-5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在读取本段提交信息…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <span className="text-destructive">{loadError}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.location.reload()}
        >
          刷新页面
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 p-3">
      <div className="flex shrink-0 items-center gap-2">
        <span className="shrink-0 text-[11px] text-muted-foreground">
          参考图 {manifest.length} / {maxRefs}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
          {manifest.map((item, index) => (
            <div key={`${item.slot}:${item.viewId ?? item.frameId ?? index}`} className="relative shrink-0">
              {item.viewUrl ? (
                <PreviewImage
                  src={item.viewUrl}
                  alt={`图${item.slot} ${item.label}`}
                  title={`图${item.slot} · ${item.label}`}
                  className="size-9 rounded-lg border bg-muted object-cover"
                />
              ) : (
                <div className="flex size-9 items-center justify-center rounded-lg border bg-muted text-[9px] text-muted-foreground">
                  无图
                </div>
              )}
              <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 py-0.5 font-mono text-[8px] leading-none text-white">
                {item.slot}
              </span>
              <button
                type="button"
                onClick={() => void removeRef(index)}
                disabled={refBusy}
                title={`移除图${item.slot} ${item.label}`}
                aria-label={`移除图${item.slot}`}
                className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-border bg-background text-[10px] text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:bg-destructive hover:text-white disabled:opacity-40"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={refBusy || manifest.length >= maxRefs}
            title="添加参考图"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed bg-background text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            {refBusy ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5 [scrollbar-gutter:stable]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="font-mono text-foreground/75">{timeRange}</span>
          <span className="ml-auto shrink-0">
            {segment.shots.length} 镜 ·{" "}
            {(segment.shots.reduce((sum, shot) => sum + shot.durationMs, 0) / 1000).toFixed(1)}s
          </span>
        </div>

        {!prompt && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-2.5 py-1.5 text-[11px] text-muted-foreground">
            {promptBusy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                正在按本段分镜生成提示词…
              </>
            ) : (
              <>
                <span>尚无提示词。</span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void generatePrompt({
                      keyframeOnly: isKeyframeOnly(manifest),
                    })
                  }
                >
                  <Sparkles className="size-3" />
                  生成提示词
                </Button>
              </>
            )}
          </div>
        )}

        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void send();
            }
          }}
          spellCheck={false}
          placeholder={
            promptBusy
              ? "正在按本段分镜生成提示词…"
              : "输入视频提示词；可自由编辑，保存后复制到第三方生成。"
          }
          className="min-h-32 w-full flex-1 resize-none rounded-lg border border-input bg-transparent p-2.5 text-sm leading-6 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />

        {promptStale && (
          <p className="px-1 text-[10.5px] leading-4 text-amber-700 dark:text-amber-400">
            提示词是上次编译的版本，分镜或参数已变化；可直接编辑或重新编译。
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t pt-2">
        <span
          title="画面比例由项目设置决定"
          className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-background px-3 text-[0.8rem] text-muted-foreground"
        >
          {aspectRatio}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="sm" />}
          >
            {durationDraft}s
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-72 min-w-44 overflow-y-auto">
            <div className="px-2.5 py-1 text-xs font-medium text-muted-foreground">
              生成时长（{Math.max(1, Math.round(minDurationSec))}–
              {Math.max(1, Math.round(maxDurationSec))}s）
            </div>
            {durationOptions.map((sec) => (
              <DropdownMenuItem
                key={sec}
                onClick={() => setDurationDraft(sec)}
              >
                {sec}s
                {sec === durationDraft && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    已选
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <Wand2 className="size-3.5" />
            更多
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
            <DropdownMenuItem onClick={() => onRegenerateSegment(segment.id)}>
              <Sparkles className="size-4" />
              重新生成本段分镜
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRestoreSegment(segment.id)}>
              <RotateCcw className="size-4" />
              复原本段分镜
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenPreflight}>
              <Stethoscope className="size-4" />
              本段体检与修复
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onEditBlocking(scene)}>
              编辑站位（高级）
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void resetRefs()}
              disabled={refBusy}
            >
              <RotateCcw className="size-4" />
              恢复默认参考图
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void generatePrompt({
                  keyframeOnly: isKeyframeOnly(manifest),
                })
              }
              disabled={promptBusy}
            >
              {promptBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )}
              重新编译提示词
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setBodyOpen(true)}>
              查看分镜编译正文
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void saveOnly()}
              disabled={saving || !prompt.trim()}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              只保存提示词
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-1.5">
          {prompt.trim() && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRepairOpen(true)}
              disabled={sending || promptBusy || saving}
              title="描述问题，让 AI 在当前提示词上做针对性修改"
            >
              <Wand2 className="size-3.5" />
              按意见修改
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={restorePrompt}
            disabled={!dirty || promptBusy}
            title="还原为打开本段时的提示词"
            className={cn(
              dirty && "text-amber-700 hover:text-amber-800 dark:text-amber-400",
            )}
          >
            <RotateCcw className="size-3.5" />
            还原
          </Button>
          <Button
            onClick={() => void send()}
            disabled={busy || !prompt.trim()}
          >
            {sending || promptBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {sending ? "保存中" : promptBusy ? "编译中" : "保存提示词"}
          </Button>
        </div>
      </div>

      <ReferencePicker
        projectId={projectId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        assets={assets}
        manifest={manifest}
        maxRefs={maxRefs}
        busy={refBusy}
        uploading={uploadBusy}
        onPick={addRef}
        onUpload={addUploads}
        onRemoveUpload={removeUpload}
      />

      <PromptRepairDialog
        open={repairOpen}
        onOpenChange={setRepairOpen}
        projectId={projectId}
        segmentId={segment.id}
        platform={platform}
        keyframeOnly={isKeyframeOnly(manifest)}
        currentPrompt={prompt}
        onApply={applyRepairedPrompt}
      />

      <Dialog open={bodyOpen} onOpenChange={setBodyOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>分镜编译正文</DialogTitle>
            <DialogDescription>
              只读内容，用于核对提示词来源；实际提交以输入框内的提示词为准。
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[62vh] overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-xs leading-6">
            {rendered?.body || "暂无正文"}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReferencePicker({
  projectId,
  open,
  onOpenChange,
  assets,
  manifest,
  maxRefs,
  busy,
  uploading,
  onPick,
  onUpload,
  onRemoveUpload,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assets: StoredAsset[];
  manifest: ManifestItem[];
  maxRefs: number;
  busy: boolean;
  uploading: boolean;
  onPick: (asset: StoredAsset, variant: StoredVariant, view: StoredView) => void;
  onUpload: (files: File[]) => Promise<void> | void;
  onRemoveUpload: (uploadId: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const used = new Set(
    manifest.map((item) => item.viewId).filter((id): id is string => Boolean(id)),
  );
  const groups = assets
    .map((asset) => ({
      asset,
      items: asset.variants.flatMap((variant) =>
        variant.views
          .filter((view) => Boolean(view.imagePath))
          .map((view) => ({ variant, view })),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const assetCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const uploads = manifest.filter(
    (item) => item.role === "upload" && item.uploadId,
  );
  const remaining = Math.max(0, maxRefs - manifest.length);
  const atLimit = remaining === 0;
  const addDisabled = busy || uploading || atLimit;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>添加参考图</DialogTitle>
          <DialogDescription>
            从「本集的资产」里选，或「本地图片上传」临时补图；都会加入本段提交清单并按图号顺序提交。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <section className="flex min-h-0 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <h3 className="text-sm font-medium">本集的资产</h3>
              <span className="text-[11px] text-muted-foreground">
                {assetCount} 张可选 · 点选加入
              </span>
            </div>
            <div className="flex max-h-[56vh] min-h-52 flex-col gap-3 overflow-y-auto rounded-xl border bg-muted/10 p-3">
              {groups.length === 0 && (
                <p className="rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                  本集还没有可用的资产视图。
                </p>
              )}
              {groups.map(({ asset, items }) => (
                <div key={asset.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{asset.name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {TYPE_LABEL[asset.type]}
                    </Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {items.map(({ variant, view }) => {
                      const disabled = busy || uploading || used.has(view.id);
                      return (
                        <button
                          key={view.id}
                          type="button"
                          onClick={() => onPick(asset, variant, view)}
                          disabled={disabled}
                          title={refLabel(asset, variant, view)}
                          className={cn(
                            "flex items-center gap-2 rounded-lg border bg-background p-2 text-left transition-colors",
                            disabled
                              ? "cursor-not-allowed opacity-50"
                              : "hover:border-foreground/25 hover:bg-muted/40",
                          )}
                        >
                          <AssetThumb projectId={projectId} view={view} />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium">
                              {view.label || "未命名视角"}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {variant.label || "默认造型"}
                              {used.has(view.id) ? " · 已使用" : ""}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex min-h-0 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <h3 className="text-sm font-medium">本地图片上传</h3>
              <span className="text-[11px] text-muted-foreground">
                已添加 {uploads.length} 张
              </span>
            </div>
            <div className="flex flex-col gap-2 rounded-xl border bg-muted/10 p-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={addDisabled}
                className={cn(
                  "flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed bg-background px-3 py-6 text-center transition-colors",
                  addDisabled
                    ? "cursor-not-allowed opacity-50"
                    : "hover:border-foreground/30 hover:bg-muted/40",
                )}
              >
                {uploading ? (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                ) : (
                  <Upload className="size-5 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">
                  {uploading ? "上传中…" : "点击选择本地图片"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  PNG / JPG / WebP / GIF · 可多选
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (files.length > 0) void onUpload(files);
                }}
              />
              <p className="text-[11px] leading-5 text-muted-foreground">
                {atLimit
                  ? `已达参考图上限 ${maxRefs} 张。`
                  : `还可添加 ${remaining} 张；上传图片仅用于本段提交。`}
              </p>
              {uploads.length > 0 && (
                <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto pr-1">
                  {uploads.map((item) => (
                    <div
                      key={item.uploadId}
                      className="flex items-center gap-2 rounded-lg border bg-background p-1.5"
                    >
                      <PreviewImage
                        src={item.viewUrl ?? ""}
                        alt={item.label}
                        title={item.label}
                        className="size-10 shrink-0 rounded-md border object-cover"
                      />
                      <span
                        className="min-w-0 flex-1 truncate text-xs"
                        title={item.label}
                      >
                        {item.label}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          item.uploadId && onRemoveUpload(item.uploadId)
                        }
                        disabled={busy || uploading}
                        title="移除这张本地参考图"
                        aria-label="移除这张本地参考图"
                        className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive hover:text-white disabled:opacity-40"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="border-t border-border/60 pt-2 text-[11px] leading-5 text-muted-foreground">
                资产图用于保持人物与场景一致；本地图片适合补充构图或临时参考。两类图片会一起按图号提交。
              </p>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssetThumb({ projectId, view }: { projectId: string; view: StoredView }) {
  if (!view.imagePath) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted text-[9px] text-muted-foreground">
        无图
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/projects/${projectId}/assets/views/${view.id}/image`}
      alt={view.label}
      className="size-10 shrink-0 rounded-md border object-cover"
    />
  );
}
