"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Circle,
  Film,
  ImageDown,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface FrameInfo {
  id: string;
  kind: "first" | "last";
  imagePath: string;
  confirmed: boolean;
}

export function SegmentVideo({
  projectId,
  segmentId,
  nextSegmentId,
  onChanged,
}: {
  projectId: string;
  segmentId: string;
  nextSegmentId?: string | null;
  onChanged?: () => void;
}) {
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [firstFrameId, setFirstFrameId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/projects/${projectId}/segments/${segmentId}/frames`,
    );
    const data = await res.json();
    return data as {
      frames: FrameInfo[];
      videoPath: string | null;
      firstFrameId: string | null;
    };
  }, [projectId, segmentId]);

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
      if (!res.ok) throw new Error();
      toast.success("视频已回传");
      await refresh();
    } catch {
      toast.error("上传失败");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeVideo() {
    if (!window.confirm("确定移除已回传视频？")) return;
    setBusy("remove");
    await fetch(`/api/projects/${projectId}/segments/${segmentId}/video`, {
      method: "DELETE",
    });
    toast.success("已移除视频");
    await refresh();
    setBusy(null);
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
      toast.success(kind === "last" ? "尾帧已提取，请人工确认" : "首帧已提取");
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleConfirm(frame: FrameInfo) {
    await fetch(`/api/projects/${projectId}/frames/${frame.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: !frame.confirmed }),
    });
    await refresh();
  }

  async function anchorToNext(frame: FrameInfo) {
    if (!nextSegmentId) {
      toast.error("没有下一段可锚定");
      return;
    }
    if (!frame.confirmed && !window.confirm("该尾帧尚未确认，仍要设为下一段首帧？"))
      return;
    await fetch(
      `/api/projects/${projectId}/segments/${nextSegmentId}/first-frame`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameId: frame.id }),
      },
    );
    toast.success("已设为下一段首帧（图1）");
    onChanged?.();
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> 加载段视频…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={videoPath ? "default" : "secondary"}>
          <Film className="size-3" />
          {videoPath ? "已回传" : "未回传"}
        </Badge>
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
              size="sm"
              variant="ghost"
              onClick={removeVideo}
              disabled={busy !== null}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
      </div>

      {videoPath && (
        <video
          key={version}
          controls
          src={`/api/projects/${projectId}/segments/${segmentId}/video`}
          className="max-h-64 w-full rounded-md bg-black"
        />
      )}

      {frames.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {frames.map((frame) => {
            const isFirstOfThis = firstFrameId === frame.id;
            return (
              <div key={frame.id} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">
                    {frame.kind === "first" ? "首帧" : "尾帧"}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleConfirm(frame)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {frame.confirmed ? (
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                    ) : (
                      <Circle className="size-3.5" />
                    )}
                    {frame.confirmed ? "已确认" : "未确认"}
                  </button>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/projects/${projectId}/frames/${frame.id}/image?v=${version}`}
                  alt={frame.kind}
                  className="max-h-48 w-full rounded-md object-contain"
                />
                <div className="flex flex-wrap gap-1.5">
                  {frame.kind === "last" && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => anchorToNext(frame)}
                    >
                      设为下一段首帧
                    </Button>
                  )}
                  {isFirstOfThis && (
                    <Badge variant="secondary" className="text-[10px]">
                      本段图1
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

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
