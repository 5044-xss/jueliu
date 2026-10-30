"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Circle,
  Download,
  Film,
  ImageDown,
  Loader2,
  Maximize2,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import {
  PREVIEW_CHIP_CLASS,
  PREVIEW_THUMB_CLASS,
  PreviewDialog,
} from "@/components/preview-image";
import { readError } from "@/lib/http";
import { downloadImage } from "@core/client/download";

export interface FrameInfo {
  id: string;
  kind: "first" | "last" | "start";
  imagePath: string;
  confirmed: boolean;
  adoptedBy?: {
    segmentId: string;
    origin: "manual" | "auto";
  } | null;
}

const FRAME_ORDER: Record<FrameInfo["kind"], number> = {
  first: 0,
  last: 1,
  start: 2,
};

function frameTitle(frame: FrameInfo): string {
  if (frame.kind === "first") return "首帧";
  if (frame.kind === "start") return "起始画面";
  return "尾帧";
}

function frameStatus(
  frame: FrameInfo,
  firstFrameId: string | null,
): { text: string; active: boolean } {
  if (frame.kind === "last") {
    const adopted = frame.adoptedBy ?? null;
    if (!adopted) return { text: "候选尾帧（未采用）", active: false };
    return {
      text:
        adopted.origin === "auto"
          ? "已自动接续下一段"
          : "已人工设为下一段起始画面",
      active: true,
    };
  }
  if (frame.kind === "start") {
    return { text: "本段起始画面（图1）", active: true };
  }
  return {
    text: firstFrameId === frame.id ? "本段视频首帧（图1）" : "本段视频首帧",
    active: firstFrameId === frame.id,
  };
}

export function SegmentVideo({
  projectId,
  segmentId,
  segmentLabel,
  nextSegmentId,
  refreshKey = 0,
  onChanged,
  qcPanel,
}: {
  projectId: string;
  segmentId: string;
  segmentLabel?: string;
  nextSegmentId?: string | null;
  refreshKey?: number;
  onChanged?: () => void;
  qcPanel?: ReactNode;
}) {
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [firstFrameId, setFirstFrameId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [previewFrameId, setPreviewFrameId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    // refreshKey 只用于触发重新读取（父级在起始画面变化后递增）。
    const res = await fetch(
      `/api/projects/${projectId}/segments/${segmentId}/frames?v=${refreshKey}`,
    );
    const data = await res.json();
    return data as {
      frames: FrameInfo[];
      videoPath: string | null;
      firstFrameId: string | null;
    };
  }, [projectId, segmentId, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await load();
        if (cancelled) return;
        setFrames(data.frames ?? []);
        setVideoPath(data.videoPath);
        setFirstFrameId(data.firstFrameId);
        setLoaded(true);
      } catch {
        if (!cancelled) toast.error("读取段视频失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function refresh() {
    const data = await load();
    setFrames(data.frames ?? []);
    setVideoPath(data.videoPath);
    setFirstFrameId(data.firstFrameId);
    setVersion((v) => v + 1);
    onChanged?.();
  }

  async function uploadVideo(file: File) {
    setBusy("upload");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segmentId}/video`,
        { method: "POST", body: form },
      );
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        qc?: {
          hardFail?: boolean;
          issues?: { level: string; message: string }[];
        } | null;
      } | null;
      if (!res.ok) throw new Error(data?.error || "上传失败");
      if (data?.qc?.hardFail) {
        toast.error("QC 未通过，视频已保存并参与合成", {
          description: (data.qc.issues ?? [])
            .filter((issue) => issue.level === "hard")
            .map((issue) => issue.message)
            .join("；"),
        });
      } else {
        toast.success("视频已回传");
      }
      await refresh();
    } catch (error) {
      toast.error((error as Error).message || "上传失败");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeVideo() {
    if (
      !(await confirm({
        title: "移除视频",
        description: "确定移除该段已回传的视频？此操作不可恢复。",
        confirmText: "移除",
        destructive: true,
      }))
    ) {
      return;
    }
    setBusy("remove");
    try {
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segmentId}/video`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(await readError(res, "移除失败"));
      toast.success("已移除视频");
      await refresh();
    } catch (error) {
      toast.error((error as Error).message || "移除失败");
    } finally {
      setBusy(null);
    }
  }

  async function extract(kind: "first" | "last") {
    setBusy(`extract-${kind}`);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segmentId}/frames`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "截帧失败");
      toast.success(kind === "last" ? "尾帧已提取" : "首帧已提取");
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function download(frame: FrameInfo) {
    try {
      await downloadImage(
        `/api/projects/${projectId}/frames/${frame.id}/image`,
        `${segmentLabel ? `${segmentLabel}-` : ""}${frameTitle(frame)}`,
      );
    } catch {
      toast.error("下载失败");
    }
  }

  async function removeFrame(frame: FrameInfo) {
    if (
      !(await confirm({
        title: "删除图片",
        description: "确定删除这张图片？此操作不可恢复。",
        confirmText: "删除",
        destructive: true,
      }))
    ) {
      return;
    }
    setBusy(`remove-${frame.id}`);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/frames/${frame.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(await readError(res, "删除失败"));
      toast.success("已删除");
      setPreviewFrameId(null);
      await refresh();
    } catch (error) {
      toast.error((error as Error).message || "删除失败");
    } finally {
      setBusy(null);
    }
  }

  async function anchorToNext(frame: FrameInfo) {
    if (!nextSegmentId) {
      toast.error("没有下一段可锚定");
      return;
    }
    setBusy(`anchor-${frame.id}`);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/segments/${nextSegmentId}/first-frame`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frameId: frame.id }),
        },
      );
      if (!res.ok) throw new Error(await readError(res, "设置失败"));
      toast.success("已设为下一段起始画面（图1）");
      onChanged?.();
    } catch (error) {
      toast.error((error as Error).message || "设置失败");
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> 加载段视频…
      </div>
    );
  }

  const sortedFrames = [...frames].sort(
    (a, b) => FRAME_ORDER[a.kind] - FRAME_ORDER[b.kind],
  );
  const previewFrame =
    sortedFrames.find((frame) => frame.id === previewFrameId) ?? null;
  const previewStatus = previewFrame
    ? frameStatus(previewFrame, firstFrameId)
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge
            variant={videoPath ? "default" : "secondary"}
            className="shrink-0"
          >
            <Film className="size-3" />
            {videoPath ? "已回传" : "未回传"}
          </Badge>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={busy === "upload"}
            >
              {busy === "upload" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              回传视频
            </Button>
            {videoPath && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => extract("first")}
                  disabled={busy !== null}
                >
                  {busy === "extract-first" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ImageDown className="size-3.5" />
                  )}
                  截首帧
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => extract("last")}
                  disabled={busy !== null}
                >
                  {busy === "extract-last" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ImageDown className="size-3.5" />
                  )}
                  截尾帧
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={removeVideo}
                  disabled={busy !== null}
                  title="移除视频"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border bg-black lg:aspect-auto lg:min-h-0 lg:flex-1">
          {videoPath ? (
            <video
              key={version}
              controls
              src={`/api/projects/${projectId}/segments/${segmentId}/video`}
              className="size-full object-contain"
            />
          ) : (
            <div className="max-w-[260px] px-4 text-center">
              <Film className="mx-auto size-6 text-neutral-500" />
              <p className="mt-2 text-xs font-medium text-neutral-300">
                本段还没有视频
              </p>
              <p className="mt-1 text-[11px] leading-5 text-neutral-500">
                在第三方生成视频后，把视频回传到这里。
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {qcPanel}

        <div className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">首尾帧</span>
            <span className="text-[11px] text-muted-foreground">
              点击预览
            </span>
          </div>
          {sortedFrames.length === 0 ? (
            <div className="flex min-h-14 flex-1 items-center justify-center rounded-lg border border-dashed text-[11px] text-muted-foreground">
              暂无截帧
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {sortedFrames.map((frame) => {
                const status = frameStatus(frame, firstFrameId);
                return (
                  <button
                    key={frame.id}
                    type="button"
                    onClick={() => setPreviewFrameId(frame.id)}
                    title={`${frameTitle(frame)} · ${status.text}`}
                    className={`${PREVIEW_THUMB_CLASS} group text-left outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/projects/${projectId}/frames/${frame.id}/image?v=${version}`}
                      alt={frameTitle(frame)}
                      className="aspect-video w-full object-cover transition-opacity group-hover:opacity-75"
                    />
                    <span
                      className={`absolute left-1 top-1 ${PREVIEW_CHIP_CLASS}`}
                    >
                      {frameTitle(frame)}
                    </span>
                    <span className="absolute right-1 top-1">
                      {status.active ? (
                        <CheckCircle2 className="size-3 text-emerald-400" />
                      ) : (
                        <Circle className="size-3 text-white/70" />
                      )}
                    </span>
                    <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                      <Maximize2 className="size-4 text-white" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <PreviewDialog
        open={previewFrame !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewFrameId(null);
        }}
        title={previewFrame ? `${frameTitle(previewFrame)}预览` : "画面预览"}
        description={
          previewFrame && previewStatus
            ? `${previewStatus.text}${segmentLabel ? ` · ${segmentLabel}` : ""}`
            : "查看截取画面并执行操作"
        }
        footer={
          previewFrame ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => download(previewFrame)}
              >
                <Download className="size-3.5" />
                下载图片
              </Button>
              {previewFrame.kind === "last" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => anchorToNext(previewFrame)}
                  disabled={busy !== null}
                >
                  {busy === `anchor-${previewFrame.id}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  用作下一段起始画面
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeFrame(previewFrame)}
                disabled={busy !== null}
                className="ml-auto text-muted-foreground"
              >
                {busy === `remove-${previewFrame.id}` ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                删除
              </Button>
            </>
          ) : null
        }
      >
        {previewFrame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/projects/${projectId}/frames/${previewFrame.id}/image?v=${version}`}
            alt={frameTitle(previewFrame)}
            className="max-h-[66vh] w-auto max-w-full rounded-md object-contain shadow-sm ring-1 ring-black/5"
          />
        ) : null}
      </PreviewDialog>

      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadVideo(file);
        }}
      />
    </div>
  );
}
