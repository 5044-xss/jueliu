"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  CloudUpload,
  Film,
  Loader2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { GenerationDialog } from "@/components/generation-dialog";
import { SegmentVideo } from "@/components/segment-video";
import { ShotEditDialog } from "@/components/shot-edit-dialog";
import { BlockingEditDialog } from "@/components/blocking-edit-dialog";
import { Elapsed } from "@/components/elapsed";
import { LoadErrorState, LoadingState } from "@/components/load-state";
import { LlmKeyNotice, useLlmConfigured } from "@/components/llm-notice";
import { NextStepLink } from "@/components/next-step";
import { useConfirm } from "@/components/confirm-dialog";
import {
  VendorSwitchDialog,
  type VendorOption,
} from "@/components/vendor-switch-dialog";
import { describeCascade, fetchCascadeImpact } from "@/lib/impact";
import { readError } from "@/lib/http";
import { useProjectJobs, isJobRunning } from "@core/client/use-jobs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@core/client/utils";
import type {
  StoredSceneStoryboard,
  StoredShot,
} from "@core/shared/schemas/storyboard";
import type { StoredAsset } from "@core/shared/schemas/assets";

const TERMINAL_GEN_STATUS = new Set(["completed", "failed", "cancelled"]);
function isSegmentGenerating(status: string | null): boolean {
  return !!status && !TERMINAL_GEN_STATUS.has(status);
}

function ShotView({
  projectId,
  shot,
  onEdit,
}: {
  projectId: string;
  shot: StoredShot;
  onEdit: () => void;
}) {
  const camera = shot.camera;
  const cameraText = [
    camera.shotSize,
    camera.focal,
    camera.angle,
    camera.movement,
    camera.side === "left" ? "轴线左" : camera.side === "right" ? "轴线右" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">镜{shot.index + 1}</span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {(shot.durationMs / 1000).toFixed(1)}s{cameraText && ` · ${cameraText}`}
          </span>
          <Button size="icon-xs" variant="ghost" onClick={onEdit} title="编辑本镜">
            <Pencil className="size-3" />
          </Button>
        </span>
      </div>
      {shot.lighting && (
        <p className="text-xs text-muted-foreground">光线：{shot.lighting}</p>
      )}
      {shot.action && <p className="leading-6">{shot.action}</p>}
      {shot.dialogue.length > 0 && (
        <div className="leading-6">
          <span className="text-muted-foreground">台词：</span>
          {shot.dialogue.map((line, i) => (
            <span key={i} className="block">
              {line.character ? `${line.character}：` : ""}「{line.text}」
            </span>
          ))}
        </div>
      )}
      {shot.expression && (
        <p className="text-xs text-muted-foreground">表情：{shot.expression}</p>
      )}
      {shot.refs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {shot.refs.map((ref) => (
            <span
              key={ref.id}
              className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs"
            >
              {ref.imagePath && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/projects/${projectId}/assets/views/${ref.viewId}/image`}
                  alt={ref.assetName}
                  className="size-6 rounded object-cover"
                />
              )}
              <span>
                {`${ref.assetName}${ref.variantLabel ? `·${ref.variantLabel}` : ""}${ref.viewLabel ? `·${ref.viewLabel}` : ""}`}
                {!ref.viewId && " ⚠"}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StoryboardPage() {
  const { seriesId, episodeId: id } = useParams<{
    seriesId: string;
    episodeId: string;
  }>();
  const [scenes, setScenes] = useState<StoredSceneStoryboard[]>([]);
  const [hasScript, setHasScript] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [extra, setExtra] = useState("");
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [vendor, setVendor] = useState<string>("h3");
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  const [orchestrating, setOrchestrating] = useState(false);
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [editShot, setEditShot] = useState<{
    shot: StoredShot;
    nodes: { id: string; label: string }[];
  } | null>(null);
  const [editBlocking, setEditBlocking] =
    useState<StoredSceneStoryboard | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [framesVersion, setFramesVersion] = useState(0);
  const [cloudGen, setCloudGen] = useState(false);
  const [videoGen, setVideoGen] = useState(false);
  const [batchBusy, setBatchBusy] = useState<null | "videos">(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState(id);

  if (sessionId !== id) {
    setSessionId(id);
    setLoaded(false);
    setLoadError(null);
  }

  const load = useCallback(async () => {
    async function get<T>(url: string, what: string): Promise<T> {
      const res = await fetch(url);
      if (!res.ok) throw new Error(await readError(res, `读取${what}失败`));
      return (await res.json()) as T;
    }
    const [sb, script, assetsRes, projectRes, vendorsRes] = await Promise.all([
      get<{ scenes?: StoredSceneStoryboard[] }>(
        `/api/projects/${id}/storyboard`,
        "分镜",
      ),
      get<{ script?: unknown }>(`/api/projects/${id}/script`, "剧本"),
      get<{ assets?: StoredAsset[] }>(`/api/projects/${id}/assets`, "资产"),
      get<{ project?: { vendor?: string } }>(`/api/projects/${id}`, "项目"),
      get<{ vendors?: VendorOption[] }>(`/api/library/vendors`, "厂商"),
    ]);
    const vendors = (vendorsRes.vendors ?? []) as VendorOption[];
    return {
      scenes: (sb.scenes ?? []) as StoredSceneStoryboard[],
      hasScript: Boolean(script.script),
      assets: (assetsRes.assets ?? []) as StoredAsset[],
      vendor:
        (projectRes.project?.vendor as string) ||
        vendors.find((v) => v.isDefault)?.id ||
        "h3",
      vendors,
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await load();
        if (cancelled) return;
        setScenes(data.scenes);
        setHasScript(data.hasScript);
        setAssets(data.assets);
        setVendor(data.vendor);
        setVendorOptions(data.vendors);
        setLoaded(true);
      } catch (error) {
        if (!cancelled) {
          setLoadError((error as Error).message || "读取分镜失败");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, reloadKey]);

  const refresh = useCallback(async () => {
    const data = await load();
    setScenes(data.scenes);
    setAssets(data.assets);
    setFramesVersion((v) => v + 1);
  }, [load]);

  // 生成期间只轮询分镜本身，用于刷新每段的「生成中」状态，避免整页数据重复加载。
  const refreshStoryboard = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}/storyboard`);
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    if (data?.scenes) setScenes(data.scenes as StoredSceneStoryboard[]);
    // 让预览里的 SegmentVideo 也重读视频/帧，边出边显示。
    setFramesVersion((v) => v + 1);
  }, [id]);

  const { jobs } = useProjectJobs(id, (job) => {
    // 上游（剧本/资产）重新生成会清空分镜，必须一起刷新，
    // 否则页面会残留已被删除的旧分镜，点「第三方生成」就会报「段落不存在」。
    if (
      job.kind === "script-to-storyboard" ||
      job.kind === "script-to-assets" ||
      job.kind === "story-to-script" ||
      job.kind === "segment-regenerate" ||
      job.kind === "gen-image" ||
      job.kind === "gen-video" ||
      job.kind === "gen-videos"
    ) {
      refresh();
    }
  });

  // 云端生成该段「起始画面」（Toapi）。提交后由后台轮询回填，进度看任务条。
  async function cloudGenerate() {
    if (!preview) return;
    setCloudGen(true);
    try {
      const res = await fetch(
        `/api/projects/${id}/segments/${preview.id}/generate-image`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "提交失败");
      toast.success("已提交云端生成", {
        description: `任务 ${data.taskId} · 参考图 ${data.refCount} 张（完成后自动回填起始画面）`,
      });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setCloudGen(false);
    }
  }

  // 云端生成该段视频（自建 ComfyUI · MiniMax H3）。提交后后台轮询，进度看任务条。
  async function cloudGenerateVideo() {
    if (!preview) return;
    setVideoGen(true);
    try {
      const res = await fetch(
        `/api/projects/${id}/segments/${preview.id}/generate-video`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "提交失败");
      toast.success("已提交云端生成视频", {
        description: `${data.mode} · 图片 ${data.refCount} 张（长片约 20 分钟，完成后自动回填）`,
      });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setVideoGen(false);
    }
  }

  // 顺序生成视频：整批一个任务，按场次/段顺序逐段生成；连续段尾帧自动接为下一段首帧。
  async function genAllVideos() {
    if (
      !(await confirm({
        title: "顺序生成视频",
        description:
          "为所有「未生成视频」的段落顺序生成云端视频？逐段执行、不并发，连续段的尾帧会自动接为下一段起始画面。长片耗时较长。",
        confirmText: "开始生成",
      }))
    ) {
      return;
    }
    setBatchBusy("videos");
    try {
      const res = await fetch(`/api/projects/${id}/segments/generate-videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onlyMissing: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "提交失败");
      toast.success(`已开始顺序生成 ${data.total} 段视频`, {
        description: "逐段执行，完成后自动刷新",
      });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBatchBusy(null);
    }
  }

  // 起始画面出图（Toapi）在跑时，提供「取消出图」。
  const imageRunning = isJobRunning(jobs, "gen-image");
  async function cancelImages() {
    try {
      const res = await fetch(
        `/api/projects/${id}/segments/cancel-images`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "取消失败");
      toast.success(
        data?.cancelled ? "已取消起始画面出图" : "没有正在进行的出图",
      );
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  const runningGenerate = isJobRunning(jobs, "script-to-storyboard");
  const runningGenerateJob =
    jobs.find(
      (j) => j.kind === "script-to-storyboard" && j.status === "running",
    ) ?? null;
  const busyGenerate = generating || runningGenerate;
  const llmMissing = useLlmConfigured() === "missing";
  const confirm = useConfirm();
  const hasStoryboard = scenes.some((s) => s.segments.length > 0);

  async function regenerateSegment(segmentId: string) {
    if (regeneratingId) return;
    if (
      !(await confirm({
        title: "重新生成本段分镜",
        description:
          "将只重写这一段的分镜（镜头划分、机位、表演与台词归属），前后段保持不变。已回传的视频不会被删除，但会标记为过期，需要时请重新生成视频。",
        confirmText: "重新生成",
      }))
    ) {
      return;
    }
    setRegeneratingId(segmentId);
    const toastId = toast.loading("正在重新生成本段分镜…");
    try {
      const res = await fetch(
        `/api/projects/${id}/segments/${segmentId}/regenerate`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "重新生成本段失败");
      if (Array.isArray(data?.scenes)) {
        setScenes(data.scenes as StoredSceneStoryboard[]);
        setFramesVersion((v) => v + 1);
      } else {
        await refresh();
      }
      setPreviewId(segmentId);
      toast.success("本段分镜已重新生成", { id: toastId });
    } catch (error) {
      toast.error((error as Error).message || "重新生成本段失败", {
        id: toastId,
      });
    } finally {
      setRegeneratingId(null);
    }
  }
  // 云端生成（出图/出片）只适配 MiniMax H3；其它厂商只能走「第三方生成」手动回传。
  const currentVendor = vendorOptions.find((v) => v.id === vendor) ?? null;
  const isH3 = currentVendor?.platform === "h3";

  const allSegments = scenes.flatMap((scene) =>
    scene.segments.map((segment, index) => ({
      scene,
      segment,
      index,
      isFirstOfScene: index === 0,
    })),
  );
  const returnedCount = allSegments.filter((e) => e.segment.videoPath).length;
  const cloudRunning =
    batchBusy !== null ||
    isJobRunning(jobs, "gen-image") ||
    isJobRunning(jobs, "gen-video") ||
    isJobRunning(jobs, "gen-videos");

  // 生成在跑时定期刷新分镜：批量（gen-videos）是整批一个 job，中途完成的分段
  // 和每段的生成状态都需要轮询才能及时显示。只拉分镜本身，避免整页重复加载。
  useEffect(() => {
    if (!cloudRunning) return;
    const timer = setInterval(() => {
      void refreshStoryboard();
    }, 4000);
    return () => clearInterval(timer);
  }, [cloudRunning, refreshStoryboard]);
  const previewEntry =
    allSegments.find((e) => e.segment.id === previewId) ??
    allSegments[0] ??
    null;
  const previewScene = previewEntry?.scene ?? null;
  const preview = previewEntry?.segment ?? null;
  const previewNodes = (previewScene?.blocking?.nodes ?? []).map((n) => ({
    id: n.id,
    label: n.label,
  }));
  const nextSegmentId = previewEntry
    ? (previewEntry.scene.segments[previewEntry.index + 1]?.id ?? null)
    : null;
  const previewTotal = preview
    ? preview.shots.reduce((a, s) => a + s.durationMs, 0)
    : 0;

  async function restoreSegment(segmentId: string) {
    try {
      const res = await fetch(
        `/api/projects/${id}/segments/${segmentId}/restore`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await readError(res, "还原失败"));
      await refresh();
      toast.success("已还原本段");
    } catch (error) {
      toast.error((error as Error).message || "还原失败");
    }
  }

  async function runOrchestrate(v: string, silent = false): Promise<boolean> {
    setOrchestrating(true);
    try {
      const res = await fetch(`/api/projects/${id}/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor: v }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "编排失败");
      await refresh();
      if (!silent) {
        const notes: string[] = Array.isArray(data.notes) ? data.notes : [];
        if (data.restored > 0) {
          notes.push(`已恢复该厂商此前缓存的 ${data.restored} 段视频`);
        }
        if (notes.length) {
          toast.message(`已按该厂商编排：${data.segments} 段`, {
            description:
              notes.slice(0, 3).join("；") +
              (notes.length > 3 ? ` …（共 ${notes.length} 条）` : ""),
          });
        } else {
          toast.success(`已按该厂商编排：${data.segments} 段`);
        }
      }
      return true;
    } catch (error) {
      toast.error((error as Error).message);
      return false;
    } finally {
      setOrchestrating(false);
    }
  }

  async function changeVendor(next: string) {
    if (next === vendor) return;
    if (hasStoryboard) {
      const prev = vendor;
      setVendor(next);
      // 交给编排接口更新厂商：它需要先读到「当前厂商」才能把现有编排结果缓存下来。
      const success = await runOrchestrate(next);
      if (!success) {
        // 失败回滚选择，避免界面显示与后端实际厂商不一致。
        setVendor(prev);
      }
    } else {
      const prev = vendor;
      setVendor(next);
      try {
        const res = await fetch(`/api/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vendor: next }),
        });
        if (!res.ok) throw new Error(await readError(res, "切换厂商失败"));
      } catch (error) {
        setVendor(prev);
        toast.error((error as Error).message || "切换厂商失败");
      }
    }
  }

  async function generate() {
    if (hasStoryboard) {
      const impact = await fetchCascadeImpact(id).catch(() => null);
      const detail = impact
        ? describeCascade(impact, { assets: false, storyboard: true })
        : "";
      if (
        !(await confirm({
          title: "重新生成分镜",
          description: `重新生成将覆盖现有分镜（含已回传视频与截帧）${
            detail ? `：${detail}` : ""
          }。此操作不可恢复。`,
          confirmText: "重新生成",
          destructive: true,
        }))
      ) {
        return;
      }
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/skills/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId: "script-to-storyboard",
          projectId: id,
          input: { extraInstructions: extra },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      const orchestrated = await runOrchestrate(vendor, true);
      if (!orchestrated) {
        throw new Error("分镜已生成，但按厂商编排失败，请点「重新编排」重试");
      }
      toast.success("分镜已生成并按所选厂商编排");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function clear() {
    if (
      !(await confirm({
        title: "清空分镜",
        description: "确定清空当前分镜？此操作不可恢复。",
        confirmText: "清空",
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/projects/${id}/storyboard`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readError(res, "清空失败"));
      await refresh();
      toast.success("已清空");
    } catch (error) {
      toast.error((error as Error).message || "清空失败");
    }
  }

  if (!loaded) {
    return loadError ? (
      <LoadErrorState
        message={loadError}
        onRetry={() => {
          setLoaded(false);
          setLoadError(null);
          setReloadKey((key) => key + 1);
        }}
      />
    ) : (
      <LoadingState />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-block-mint p-5">
        <div>
          <h2 className="text-base font-medium">分镜</h2>
          <p className="text-sm text-muted-foreground">
            场次拆分为段落与分镜；选择厂商后按该厂商的镜数/时长/参考图规则重新编排。
          </p>
          {!isH3 && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              云端生成仅适配 MiniMax H3；当前厂商「
              {currentVendor?.name ?? vendor}
              」请用「第三方生成」手动回传。
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setVendorDialogOpen(true)}
            disabled={busyGenerate || orchestrating}
            title="查看各厂商能力并切换（会按新厂商重新编排分镜）"
            className="flex items-center gap-2 rounded-full border border-border bg-background py-0.5 pl-2.5 pr-0.5 text-sm transition-colors hover:border-foreground/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                isH3 ? "bg-emerald-500" : "bg-muted-foreground/50",
              )}
            />
            <span className="font-medium">
              厂商：{currentVendor?.name ?? vendor}
            </span>
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {isH3 ? "支持云端" : "仅第三方"}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs">
              切换
            </span>
          </button>

          {hasStoryboard && (
            <Button
              variant="outline"
              onClick={genAllVideos}
              disabled={busyGenerate || orchestrating || cloudRunning || !isH3}
              title={
                isH3
                  ? "为所有未生成视频的段落「顺序生成」（逐段执行，连续段尾帧自动接下一段首帧）"
                  : "云端生成仅适配 MiniMax H3，请先切换厂商"
              }
            >
              {batchBusy !== null || isJobRunning(jobs, "gen-videos") ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CloudUpload className="size-4" />
              )}
              顺序生成视频
            </Button>
          )}

          {hasStoryboard && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" />}
                disabled={busyGenerate || orchestrating}
              >
                更多
                <ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onClick={() => runOrchestrate(vendor)}
                  title="按当前厂商重新打包分镜为段落"
                >
                  {orchestrating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Wand2 className="size-4" />
                  )}
                  重新编排（按当前厂商）
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={clear}
                  className="text-destructive data-highlighted:bg-destructive/10"
                >
                  <Trash2 className="size-4" />
                  清空分镜
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            onClick={generate}
            disabled={busyGenerate || orchestrating || !hasScript || llmMissing}
          >
            {busyGenerate ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {hasStoryboard ? "重新生成" : "生成分镜"}
          </Button>
        </div>
      </div>

      {llmMissing && <LlmKeyNotice />}

      {hasStoryboard && !busyGenerate && (
        <NextStepLink
          href={`/projects/${seriesId}/${id}/compose`}
          label="下一步：合成成片"
        />
      )}

      {!hasScript && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            请先在「剧本」页生成剧本。
          </CardContent>
        </Card>
      )}

      {hasScript && !busyGenerate && (
        <Card>
          <CardHeader>
            <CardTitle>额外要求（可选，下次生成时生效）</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="例如：多用户外自然光；避免快速推拉运镜。"
              className="min-h-[80px] w-full rounded-lg border border-input bg-transparent p-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </CardContent>
        </Card>
      )}

      {busyGenerate && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在调用 LLM 生成分镜，请稍候…（可切换页面，完成后会自动刷新）
            <Elapsed startedAt={runningGenerateJob?.startedAt} />
          </CardContent>
        </Card>
      )}

      {!busyGenerate && hasStoryboard && preview && previewScene && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                预览
                <span className="text-sm font-normal">
                  {previewScene.sceneSlug || `第${previewScene.sceneIndex}场`} ·
                  第{preview.index}段
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {preview.shots.length} 镜 · {(previewTotal / 1000).toFixed(1)}s
                  / 目标
                </span>
                <span
                  className="rounded border border-input px-1 py-0.5 text-center text-xs font-normal"
                  title="段目标时长由编排按厂商从各镜理想时长派生，不可直接编辑。"
                >
                  {(preview.targetMs / 1000).toFixed(1)}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  s（编排派生）
                </span>
                {!previewEntry?.isFirstOfScene && (
                  <span
                    className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                    title="由本段首镜的「延续上一镜」自动决定；如需修改请编辑该镜。"
                  >
                    {preview.hardCut ? "与上一段：硬切" : "与上一段：连续"}
                  </span>
                )}
                {preview.stale && (
                  <span
                    className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300"
                    title="本段视频生成后分镜内容又改过，视频与当前分镜不再对应；建议重新生成视频。"
                  >
                    视频已过期
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <Button
                    size="xs"
                    onClick={cloudGenerateVideo}
                    disabled={videoGen || !isH3 || cloudRunning}
                    title={
                      !isH3
                        ? "云端生成仅适配 MiniMax H3，请先切换厂商"
                        : cloudRunning
                          ? "已有云端任务在运行"
                          : "用自建 ComfyUI（MiniMax H3）云端生成该段视频（提交后后台轮询并回填）"
                    }
                  >
                    {videoGen ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Film className="size-3" />
                    )}
                    云端生成视频
                    {!isH3 && (
                      <span className="text-[10px] font-normal text-muted-foreground">
                        需 H3
                      </span>
                    )}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          size="icon-xs"
                          variant="outline"
                          title="更多本段操作"
                          aria-label="更多本段操作"
                        />
                      }
                    >
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        onClick={cloudGenerate}
                        disabled={cloudGen || !isH3}
                        title={
                          isH3
                            ? "用 Toapi 云端生成该段起始画面（自动上传参考图并回填）"
                            : "云端生成仅适配 MiniMax H3，请先切换厂商"
                        }
                      >
                        <CloudUpload className="size-4" />
                        云端生成起始画面
                        {!isH3 && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            需 H3
                          </span>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDialogOpen(true)}
                        title="复制提示词并上传参考图到第三方平台生成，再回传视频"
                      >
                        <Wand2 className="size-4" />
                        第三方生成
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => void regenerateSegment(preview.id)}
                        disabled={regeneratingId !== null || cloudRunning}
                        title="让 AI 只重写本段分镜；前后段与已回传视频都保留"
                      >
                        {regeneratingId === preview.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Sparkles className="size-4" />
                        )}
                        重新生成本段分镜
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => restoreSegment(preview.id)}
                        title="把本段所有分镜还原为生成时的内容"
                      >
                        <RotateCcw className="size-4" />
                        复原本段分镜
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setEditBlocking(previewScene)}
                        title="编辑本场人物站位与轴线；会进入提示词，但不会自动重算已有分镜"
                      >
                        <Pencil className="size-4" />
                        编辑站位（高级）
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 lg:grid-cols-2">
              {/* 中间：本段对应的信息（站位 + 分镜） */}
              <div className="flex flex-col gap-2">
                {previewScene.blocking && (
                  <div className="rounded-lg border bg-muted/30 p-2.5 text-xs leading-5 text-muted-foreground">
                    <span className="font-medium text-foreground">本场站位：</span>
                    轴线{" "}
                    {previewScene.blocking.nodes.find(
                      (n) => n.id === previewScene.blocking?.axis.from,
                    )?.label ?? previewScene.blocking.axis.from}{" "}
                    ↔{" "}
                    {previewScene.blocking.nodes.find(
                      (n) => n.id === previewScene.blocking?.axis.to,
                    )?.label ?? previewScene.blocking.axis.to}
                    ｜镜头侧
                    {previewScene.blocking.cameraSide === "left" ? "左" : "右"}；
                    {previewScene.blocking.nodes
                      .map(
                        (n) =>
                          `${n.label}(${n.pos.x.toFixed(2)},${n.pos.y.toFixed(2)}) 朝${Math.round(n.facing)}°`,
                      )
                      .join("；")}
                  </div>
                )}
                {preview.shots.map((shot) => (
                  <ShotView
                    key={shot.id}
                    projectId={id}
                    shot={shot}
                    onEdit={() => setEditShot({ shot, nodes: previewNodes })}
                  />
                ))}
              </div>
              {/* 右侧：视频上传 / 预览；没有视频时给占位 */}
              <div className="flex flex-col gap-2">
                {!preview.videoPath && (
                  <div className="flex min-h-48 items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground">
                    该段尚未回传视频
                  </div>
                )}
                <SegmentVideo
                  projectId={id}
                  segmentId={preview.id}
                  segmentLabel={`第${preview.index}段`}
                  nextSegmentId={nextSegmentId}
                  refreshKey={framesVersion}
                  onChanged={refresh}
                />
              </div>
            </CardContent>
          </Card>

          <div className="sticky bottom-0 z-30 -mx-4 border-t bg-background px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 pb-2">
              <span className="text-sm font-medium">
                段落列表（{allSegments.length}）
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    returnedCount === allSegments.length && allSegments.length > 0
                      ? "bg-emerald-500"
                      : "bg-muted-foreground/40",
                  )}
                />
                已回传 {returnedCount}/{allSegments.length}
              </span>
              <span className="text-xs text-muted-foreground">
                点击切换上方预览
              </span>
              {cloudRunning && (
                <span className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  云端生成中…
                </span>
              )}
              {imageRunning && (
                <button
                  type="button"
                  onClick={cancelImages}
                  className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                >
                  取消起始画面出图
                </button>
              )}
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {allSegments.map(({ scene, segment, isFirstOfScene }) => {
                const active = segment.id === preview?.id;
                const total = segment.shots.reduce(
                  (a, s) => a + s.durationMs,
                  0,
                );
                return (
                  <div
                    key={segment.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPreviewId(segment.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setPreviewId(segment.id);
                      }
                    }}
                    className={cn(
                      "flex w-44 shrink-0 cursor-pointer flex-col gap-1.5 rounded-lg border p-2 transition-colors",
                      active
                        ? "border-foreground/40 bg-muted/50"
                        : "hover:bg-muted/30",
                    )}
                  >
                    <div className="relative aspect-video w-full overflow-hidden rounded bg-black">
                      {segment.videoPath ? (
                        <video
                          src={`/api/projects/${id}/segments/${segment.id}/video#t=0.1`}
                          muted
                          playsInline
                          preload="metadata"
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-muted-foreground">
                          <Film className="size-5" />
                        </div>
                      )}
                      {segment.hardCut && !isFirstOfScene && (
                        <span className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                          硬切
                        </span>
                      )}
                      {segment.stale && (
                        <span
                          className="absolute bottom-1 left-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-black"
                          title="分镜改过，已回传的视频已过期"
                        >
                          已过期
                        </span>
                      )}
                      {cloudRunning &&
                        isSegmentGenerating(segment.genStatus) && (
                          <span className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                            <Loader2 className="size-2.5 animate-spin" />
                            生成中
                          </span>
                        )}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void regenerateSegment(segment.id);
                        }}
                        disabled={regeneratingId !== null || cloudRunning}
                        className="absolute right-1 bottom-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white transition-colors hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-50"
                        title="让 AI 只重写本段分镜；前后段与已回传视频都保留"
                      >
                        {regeneratingId === segment.id ? (
                          <Loader2 className="size-2.5 animate-spin" />
                        ) : (
                          <Sparkles className="size-2.5" />
                        )}
                        重新生成
                      </button>
                    </div>
                    <span className="truncate text-sm font-medium">
                      {scene.sceneSlug || `第${scene.sceneIndex}场`} · 第
                      {segment.index}段
                    </span>
                    <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {segment.shots.length} 镜 · {(total / 1000).toFixed(1)}s
                      </span>
                      <span
                        className={cn(
                          "flex items-center gap-1",
                          segment.videoPath &&
                            "text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            segment.videoPath
                              ? "bg-emerald-500"
                              : "bg-muted-foreground/40",
                          )}
                        />
                        {segment.videoPath ? "已回传" : "未回传"}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {dialogOpen && preview && (
        <GenerationDialog
          key={`${preview.id}:${vendor}`}
          projectId={id}
          segmentId={preview.id}
          segmentLabel={`第${preview.index}段`}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onStale={refresh}
          onChanged={refresh}
          defaultPlatform={currentVendor?.platform}
        />
      )}

      <VendorSwitchDialog
        key={`${vendorDialogOpen}:${vendor}`}
        open={vendorDialogOpen}
        onOpenChange={setVendorDialogOpen}
        vendors={vendorOptions}
        current={vendor}
        hasStoryboard={hasStoryboard}
        busy={orchestrating}
        onConfirm={(next) => {
          setVendorDialogOpen(false);
          void changeVendor(next);
        }}
      />

      {editShot && (
        <ShotEditDialog
          projectId={id}
          shot={editShot.shot}
          assets={assets}
          nodeOptions={editShot.nodes}
          onClose={() => setEditShot(null)}
          onSaved={refresh}
        />
      )}

      {editBlocking && (
        <BlockingEditDialog
          projectId={id}
          sceneId={editBlocking.sceneId}
          sceneLabel={editBlocking.sceneSlug || `第${editBlocking.sceneIndex}场`}
          blocking={editBlocking.blocking}
          onClose={() => setEditBlocking(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
