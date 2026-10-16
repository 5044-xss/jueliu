"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  Download,
  ImagePlus,
  Loader2,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CopyButton } from "@/components/copy-button";
import { PreviewImage } from "@/components/preview-image";
import { DEFAULT_PLATFORM } from "@core/shared/templates-defaults";
import { downloadImage } from "@core/client/download";
import type { RenderedPrompt } from "@core/shared/render-types";
import type { KeyframePrompt, StartFrameState } from "@core/shared/keyframe";
import { cn } from "@core/client/utils";

interface VendorInfo {
  id: string;
  name: string;
  platform: string;
  supportMultiShot: boolean;
  maxShotsPerSegment: number;
  maxRefImages: number;
}

export function GenerationDialog({
  projectId,
  segmentId,
  segmentLabel,
  open,
  onOpenChange,
  onStale,
  onChanged,
  defaultPlatform,
}: {
  projectId: string;
  segmentId: string;
  segmentLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStale?: () => void;
  onChanged?: () => void;
  defaultPlatform?: string;
}) {
  const platform = defaultPlatform ?? DEFAULT_PLATFORM;
  const [rendered, setRendered] = useState<RenderedPrompt | null>(null);
  const [startState, setStartState] = useState<StartFrameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [vendors, setVendors] = useState<VendorInfo[]>([]);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [tab, setTab] = useState<"ai" | "body">("ai");
  const [autoGen, setAutoGen] = useState(true);
  const [showSingle, setShowSingle] = useState(false);
  const [singlePrompt, setSinglePrompt] = useState<KeyframePrompt | null>(null);
  const [singleLoading, setSingleLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // 打开弹窗后是否已尝试过自动生成，避免无缓存时无限重试。
  const aiAutoTriedRef = useRef(false);
  // AI 提示词请求序号：只应用最新一次请求的结果，避免并发/过期响应互相覆盖。
  const aiReqRef = useRef(0);
  // 是否正在重新生成：期间忽略列表式 GET 的旧缓存，防止覆盖新结果。
  const generatingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (reloadKey === 0) setAiText("");
      aiAutoTriedRef.current = false;
      try {
        const [renderRes, vendorRes, startRes, settingsRes, aiRes] =
          await Promise.all([
            fetch("/api/render/platform", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectId, segmentId, platform }),
            }),
            fetch(`/api/library/vendors`).then((r) => r.json()),
            fetch(
              `/api/projects/${projectId}/segments/${segmentId}/start-frame`,
            ),
            fetch(`/api/settings`)
              .then((r) => r.json())
              .catch(() => null),
            fetch(
              `/api/projects/${projectId}/segments/${segmentId}/ai-prompt?platform=${encodeURIComponent(platform)}`,
            )
              .then((r) => r.json())
              .catch(() => null),
          ]);
        const data = await renderRes.json();
        const start = await startRes.json();
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
        setStartState(startRes.ok ? (start as StartFrameState) : null);
        setVendors((vendorRes.vendors ?? []) as VendorInfo[]);
        setAutoGen(settingsRes?.settings?.autoGenerateAiPrompt !== false);
        // 正在重新生成时不应用 GET 的旧缓存，避免覆盖新结果。
        if (aiRes?.prompt && !generatingRef.current) {
          setAiText(String(aiRes.prompt));
        }
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
  }, [open, platform, projectId, segmentId, reloadKey]);

  // 首次打开且没有可用缓存时，自动生成一次 AI 翻译提示词（可在设置里关闭）。
  useEffect(() => {
    if (!open || !autoGen || !rendered || aiLoading || aiText) return;
    if (aiAutoTriedRef.current) return;
    aiAutoTriedRef.current = true;
    void generateAiPrompt();
    // generateAiPrompt 每次渲染都会重建，不入依赖；用 ref 保证只尝试一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoGen, rendered, aiLoading, aiText]);

  // 展开「单独生成起始画面」时才拉取其提示词。
  useEffect(() => {
    if (!open || !showSingle || singlePrompt) return;
    let cancelled = false;
    (async () => {
      setSingleLoading(true);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/segments/${segmentId}/keyframe-prompt`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) setSinglePrompt(data as KeyframePrompt);
      } finally {
        if (!cancelled) setSingleLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, showSingle, singlePrompt, projectId, segmentId]);

  // 起始画面变化会改变渲染正文与签名，原来的 AI 提示词随即失效；
  // 这里刷新渲染数据并自动重生成一次，保证提示词包含新的起始画面。
  function reloadAfterStartChange() {
    setAiText("");
    setSinglePrompt(null);
    aiAutoTriedRef.current = false;
    setReloadKey((k) => k + 1);
    onChanged?.();
    void generateAiPrompt();
  }

  async function adopt(frameId: string | null) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segmentId}/first-frame`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frameId }),
        },
      );
      if (!res.ok) throw new Error("设置失败");
      toast.success(frameId ? "已设为本段起始画面（图1）" : "已取消起始画面");
      reloadAfterStartChange();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadStart(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segmentId}/first-frame-image`,
        { method: "POST", body: form },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "上传失败");
      toast.success("起始画面已设置（图1）");
      reloadAfterStartChange();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function downloadStart(imageUrl: string, name: string) {
    try {
      await downloadImage(imageUrl, `${segmentLabel}-${name}`);
    } catch {
      toast.error("下载失败");
    }
  }

  // 能力不匹配告警：当前段的镜数/参考图是否超出厂商能力。
  const previewVendor = vendors.find((v) => v.platform === platform) ?? null;
  const warnings: string[] = [];
  if (previewVendor && rendered) {
    if (!previewVendor.supportMultiShot && rendered.shotCount > 1) {
      warnings.push(
        `「${previewVendor.name}」不支持段内多镜，本段含 ${rendered.shotCount} 个分镜，可能无法一次生成。`,
      );
    }
    if (rendered.manifest.length > previewVendor.maxRefImages) {
      warnings.push(
        `本段参考图 ${rendered.manifest.length} 张，超过「${previewVendor.name}」上限 ${previewVendor.maxRefImages} 张。`,
      );
    }
  }

  async function generateAiPrompt() {
    const token = ++aiReqRef.current;
    generatingRef.current = true;
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
      if (!mountedRef.current || token !== aiReqRef.current) return;
      if (!res.ok) throw new Error(data?.error || "生成失败");
      setAiText(String(data.result ?? ""));
      toast.success("AI 提示词已生成");
    } catch (error) {
      if (mountedRef.current && token === aiReqRef.current) {
        toast.error((error as Error).message);
      }
    } finally {
      if (token === aiReqRef.current) {
        generatingRef.current = false;
        if (mountedRef.current) setAiLoading(false);
      }
    }
  }

  const adopted = startState?.adopted ?? null;
  const candidate = startState?.candidate ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-full flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>第三方生成 · {segmentLabel}</DialogTitle>
          <DialogDescription>
            按下方图片顺序上传参考图，复制提示词到平台生成，再回传视频。
          </DialogDescription>
        </DialogHeader>

        {warnings.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
            {warnings.map((w, i) => (
              <span key={i}>⚠ {w}</span>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 渲染中…
            </div>
          ) : rendered ? (
            <div className="flex flex-col gap-4">
              {/* 1. 起始画面：可选，不设置则只按参考图生成 */}
              <section className="flex flex-col gap-2">
                <h4 className="text-sm font-medium">起始画面（可选）</h4>
                <p className="text-xs text-muted-foreground">
                  本段视频开头的那一帧。不设置时，视频按参考图生成。
                </p>
                {adopted ? (
                  <div className="flex flex-wrap items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={adopted.imageUrl}
                      alt="本段起始画面"
                      className="size-20 rounded-md border object-cover"
                    />
                    <div className="flex flex-col items-start gap-1.5">
                      <span className="text-xs">已设置，作为图1上传</span>
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => fileRef.current?.click()}
                        >
                          <ImagePlus className="size-3.5" />
                          更换图片
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            downloadStart(adopted.imageUrl, "起始画面")
                          }
                        >
                          <Download className="size-3.5" />
                          下载
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => adopt(null)}
                        >
                          <Trash2 className="size-3.5" />
                          不使用
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    {candidate && (
                      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={candidate.imageUrl}
                          alt="上一段结尾画面"
                          className="size-16 rounded-md border object-cover"
                        />
                        <div className="flex flex-col gap-1">
                          <span className="text-xs">上一段的结尾画面</span>
                          <div className="flex gap-1.5">
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={busy}
                              onClick={() => adopt(candidate.id)}
                            >
                              用作起始画面
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() =>
                                downloadStart(candidate.imageUrl, "上一段结尾画面")
                              }
                            >
                              <Download className="size-3.5" />
                              下载
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => fileRef.current?.click()}
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <ImagePlus className="size-3.5" />
                      )}
                      上传起始画面
                    </Button>
                    {!candidate && startState?.reason && (
                      <p className="text-xs text-muted-foreground">
                        {startState.reason}
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* 起始画面的单独生成入口，与上方起始画面放在一起 */}
              <section className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setShowSingle((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform",
                      !showSingle && "-rotate-90",
                    )}
                  />
                  没有合适的画面？单独生成一张起始画面
                </button>
                {showSingle && (
                  <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">
                      复制下面的提示词到图像平台，按图号顺序上传参考图，生成后用上方「上传起始画面」回传。
                    </p>
                    {singleLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" /> 生成提示词…
                      </div>
                    ) : singlePrompt ? (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">
                            画面比例：{singlePrompt.aspect}
                          </span>
                          <CopyButton
                            text={singlePrompt.prompt}
                            label="复制"
                            size="xs"
                          />
                        </div>
                        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border bg-background p-2.5 text-xs leading-6">
                          {singlePrompt.prompt}
                        </pre>
                        {singlePrompt.refs.length > 0 && (
                          <p className="text-[11px] text-muted-foreground">
                            参考图顺序：
                            {singlePrompt.refs
                              .map((r) => `图${r.slot} ${r.label}`)
                              .join("；")}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        暂时无法生成起始画面的提示词。
                      </p>
                    )}
                  </div>
                )}
              </section>

              <Separator />

              {/* 2. 上传清单（图N 顺序） */}
              <section className="flex flex-col gap-1.5">
                <h4 className="text-sm font-medium">上传这些图片</h4>
                {rendered.manifest.length > 0 ? (
                  <>
                    <div className="flex flex-wrap items-start gap-2 rounded-lg border bg-muted/30 p-2">
                      {rendered.manifest.map((m) => (
                        <div key={m.slot} className="relative">
                          {m.viewUrl ? (
                            <PreviewImage
                              src={m.viewUrl}
                              alt={m.label}
                              title={`图${m.slot} · ${m.label}`}
                              className="size-16 rounded-md border object-cover"
                            />
                          ) : (
                            <div className="flex size-16 items-center justify-center rounded-md border bg-muted text-[10px] text-muted-foreground">
                              未上传
                            </div>
                          )}
                          <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[10px] leading-4 text-white">
                            图{m.slot}
                          </span>
                        </div>
                      ))}
                    </div>
                    <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                      {rendered.manifest.map((m) => (
                        <li key={m.slot}>
                          图{m.slot}：{m.label}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-muted-foreground">
                      按「图1、图2…」顺序上传（共 {rendered.manifest.length} 张）。点击小图可放大预览。
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    本段没有参考图。
                  </p>
                )}
              </section>

              <Separator />

              {/* 3. 提示词（tab：视频生成提示词 / 正文） */}
              <section className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setTab("ai")}
                      className={cn(
                        "rounded-md px-2.5 py-1 font-medium transition-colors",
                        tab === "ai"
                          ? "bg-background shadow-sm"
                          : "text-muted-foreground",
                      )}
                    >
                      视频生成提示词
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab("body")}
                      className={cn(
                        "rounded-md px-2.5 py-1 font-medium transition-colors",
                        tab === "body"
                          ? "bg-background shadow-sm"
                          : "text-muted-foreground",
                      )}
                    >
                      正文
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {tab === "ai" ? (
                      <>
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
                        {aiText && (
                          <CopyButton text={aiText} label="复制" size="xs" />
                        )}
                      </>
                    ) : (
                      <CopyButton text={rendered.body} label="复制" size="xs" />
                    )}
                  </div>
                </div>
                {tab === "ai" ? (
                  aiLoading && !aiText ? (
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      正在生成 AI 视频生成提示词…
                    </div>
                  ) : aiText ? (
                    <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-xs leading-6">
                      {aiText}
                    </pre>
                  ) : (
                    <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                      尚无 AI 提示词。点「生成 AI 提示词」按当前厂商的翻译提示词把正文编译成可执行版本
                      {autoGen ? "" : "（自动生成已关闭）"}。
                    </p>
                  )
                ) : (
                  <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-xs leading-6">
                    {rendered.body}
                  </pre>
                )}
              </section>

              <section className="flex flex-col gap-1.5">
                <h4 className="text-sm font-medium">生成参数（引导）</h4>
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-xs leading-6">
                  {rendered.params}
                </pre>
              </section>

            </div>
          ) : null}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadStart(file);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
