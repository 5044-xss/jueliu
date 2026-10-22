"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  CloudUpload,
  Film,
  Loader2,
  Pencil,
  Sparkles,
  Stethoscope,
  Trash2,
  Wand2,
} from "lucide-react";
import { SegmentVideo } from "@/components/segment-video";
import { SegmentComposer } from "@/components/segment-composer";
import { ShotEditDialog } from "@/components/shot-edit-dialog";
import { BlockingEditDialog } from "@/components/blocking-edit-dialog";
import { Elapsed } from "@/components/elapsed";
import { LoadErrorState, LoadingState } from "@/components/load-state";
import { LlmKeyNotice, useLlmConfigured } from "@/components/llm-notice";
import { useConfirm } from "@/components/confirm-dialog";
import {
  VendorSwitchDialog,
  type VendorOption,
} from "@/components/vendor-switch-dialog";
import { describeCascade, fetchCascadeImpact } from "@/lib/impact";
import { readError } from "@/lib/http";
import { suggestQcRetry } from "@/lib/generation/retry";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { PreflightIssue } from "@core/shared/preflight";
import type { SegmentQcRecord, QcSummary } from "@core/shared/qc";
import type { StoredAsset } from "@core/shared/schemas/assets";

const TERMINAL_GEN_STATUS = new Set([
  "completed",
  "failed",
  "cancelled",
  "qc_failed",
]);
function isSegmentGenerating(status: string | null): boolean {
  return !!status && !TERMINAL_GEN_STATUS.has(status);
}

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
  const { episodeId: id } = useParams<{
    seriesId: string;
    episodeId: string;
  }>();
  const [scenes, setScenes] = useState<StoredSceneStoryboard[]>([]);
  const [preflight, setPreflight] = useState<PreflightIssue[]>([]);
  const [qcList, setQcList] = useState<SegmentQcRecord[]>([]);
  const [qcSummary, setQcSummary] = useState<QcSummary | null>(null);
  const [qcBusy, setQcBusy] = useState(false);
  const [recompileBusy, setRecompileBusy] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [hardCutBusy, setHardCutBusy] = useState(false);
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
  const [viewTab, setViewTab] = useState<"generate" | "preview">("generate");
  const [composerReloadKey, setComposerReloadKey] = useState(0);
  const [projectAspectRatio, setProjectAspectRatio] = useState("16:9");
  const [editShot, setEditShot] = useState<{
    shot: StoredShot;
    nodes: { id: string; label: string }[];
  } | null>(null);
  const [editBlocking, setEditBlocking] =
    useState<StoredSceneStoryboard | null>(null);
  const [framesVersion, setFramesVersion] = useState(0);
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
      get<{
        scenes?: StoredSceneStoryboard[];
        preflight?: PreflightIssue[];
        qc?: SegmentQcRecord[];
        qcSummary?: QcSummary;
      }>(
        `/api/projects/${id}/storyboard`,
        "分镜",
      ),
      get<{ script?: unknown }>(`/api/projects/${id}/script`, "剧本"),
      get<{ assets?: StoredAsset[] }>(`/api/projects/${id}/assets`, "资产"),
      get<{ project?: { vendor?: string; aspectRatio?: string } }>(
        `/api/projects/${id}`,
        "项目",
      ),
      get<{ vendors?: VendorOption[] }>(`/api/library/vendors`, "厂商"),
    ]);
    const vendors = (vendorsRes.vendors ?? []) as VendorOption[];
    return {
      scenes: (sb.scenes ?? []) as StoredSceneStoryboard[],
      preflight: (sb.preflight ?? []) as PreflightIssue[],
      qc: (sb.qc ?? []) as SegmentQcRecord[],
      qcSummary: (sb.qcSummary ?? null) as QcSummary | null,
      hasScript: Boolean(script.script),
      assets: (assetsRes.assets ?? []) as StoredAsset[],
      vendor:
        (projectRes.project?.vendor as string) ||
        vendors.find((v) => v.isDefault)?.id ||
        "h3",
      aspectRatio: projectRes.project?.aspectRatio || "16:9",
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
        setPreflight(data.preflight);
        setQcList(data.qc);
        setQcSummary(data.qcSummary);
        setHasScript(data.hasScript);
        setAssets(data.assets);
        setVendor(data.vendor);
        setProjectAspectRatio(data.aspectRatio);
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
    setPreflight(data.preflight);
    setQcList(data.qc);
    setQcSummary(data.qcSummary);
    setAssets(data.assets);
    setProjectAspectRatio(data.aspectRatio);
    setFramesVersion((v) => v + 1);
  }, [load]);

  // 生成期间只轮询分镜本身，用于刷新每段的「生成中」状态，避免整页数据重复加载。
  const refreshStoryboard = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}/storyboard`);
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    if (data?.scenes) setScenes(data.scenes as StoredSceneStoryboard[]);
    if (data?.preflight) setPreflight(data.preflight as PreflightIssue[]);
    if (data?.qc) setQcList(data.qc as SegmentQcRecord[]);
    if (data?.qcSummary) setQcSummary(data.qcSummary as QcSummary);
    // 让预览里的 SegmentVideo 也重读视频/帧，边出边显示。
    setFramesVersion((v) => v + 1);
  }, [id]);

  async function runQc() {
    if (!preview || qcBusy) return;
    setQcBusy(true);
    try {
      const res = await fetch(
        `/api/projects/${id}/segments/${preview.id}/qc`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "QC 失败");
      const record = data.qc as SegmentQcRecord;
      setQcList((list) => [
        record,
        ...list.filter((item) => item.segmentId !== record.segmentId),
      ]);
      toast.success(
        record.hardFail
          ? `QC 未通过（${record.score ?? 0} 分）`
          : `QC ${record.status === "passed" ? "通过" : "待复核"}（${record.score ?? 0} 分）`,
      );
    } catch (error) {
      toast.error((error as Error).message || "QC 失败");
    } finally {
      setQcBusy(false);
    }
  }

  async function compileSegmentPrompt(
    segmentId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const platform =
      vendorOptions.find((item) => item.id === vendor)?.platform ?? "h3";
    const res = await fetch("/api/skills/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skillId: "storyboard-to-ai-prompt",
        projectId: id,
        input: { segmentId, platform },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data?.error || "重新编译失败",
      };
    }
    return { ok: true };
  }

  async function recompilePrompt() {
    if (!preview || recompileBusy) return;
    setRecompileBusy(true);
    try {
      const result = await compileSegmentPrompt(preview.id);
      if (!result.ok) throw new Error(result.error);
      toast.success("提示词已重新编译");
      setComposerReloadKey((key) => key + 1);
      await refresh();
    } catch (error) {
      toast.error((error as Error).message || "重新编译失败");
    } finally {
      setRecompileBusy(false);
    }
  }

  const { jobs } = useProjectJobs(id, (job) => {    // 上游（剧本/资产）重新生成会清空分镜，必须一起刷新，
    // 否则页面会残留已被删除的旧分镜，点「第三方生成」就会报「段落不存在」。
    if (
      job.kind === "script-to-storyboard" ||
      job.kind === "script-to-assets" ||
      job.kind === "story-to-script" ||
      job.kind === "segment-regenerate" ||
      job.kind === "repair" ||
      job.kind === "gen-image" ||
      job.kind === "gen-video" ||
      job.kind === "gen-videos"
    ) {
      refresh();
    }
  });

  // 生成前静默体检：只自动处理可安全修复的硬错误（目前是连续段的硬切冲突），
  // 软提醒不打扰用户，其余问题交给成片后的自动 QC。
  async function silentPreflightFix(
    segmentIds: string[],
  ): Promise<PreflightIssue[]> {
    try {
      const res = await fetch(`/api/projects/${id}/storyboard`);
      if (!res.ok) return [];
      const data = (await res.json().catch(() => null)) as {
        preflight?: PreflightIssue[];
      } | null;
      const targets = new Set(segmentIds);
      const scoped = (data?.preflight ?? []).filter((issue) =>
        targets.has(issue.segmentId),
      );
      const autoHardCut = [
        ...new Set(
          scoped
            .filter(
              (issue) =>
                issue.level === "error" && issue.fixAction === "set-hard-cut",
            )
            .map((issue) => issue.segmentId),
        ),
      ];
      await Promise.all(
        autoHardCut.map((segmentId) =>
          fetch(`/api/projects/${id}/segments/${segmentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hardCut: true }),
          }).catch(() => null),
        ),
      );
      if (autoHardCut.length > 0) await refresh();
      return scoped.filter(
        (issue) =>
          issue.level === "error" &&
          !(
            issue.fixAction === "set-hard-cut" &&
            autoHardCut.includes(issue.segmentId)
          ),
      );
    } catch {
      return [];
    }
  }

  // 云端生成该段「起始画面」（Toapi）。提交后由后台轮询回填，进度看任务条。
  async function cloudGenerate() {
    if (!preview) return;
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
    }
  }

  // 云端生成该段视频（自建 ComfyUI · MiniMax H3）。提交后后台轮询，进度看任务条。
  async function cloudGenerateVideo() {
    if (!preview) return;
    setVideoGen(true);
    try {
      const remaining = await silentPreflightFix([preview.id]);
      if (remaining.length > 0) {
        toast.warning(`本段还有 ${remaining.length} 个体检问题未自动修复`, {
          description: "已继续生成，成片完成后会自动质检。",
        });
      }
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
      const targetIds = allSegments
        .filter((entry) => !entry.segment.videoPath)
        .map((entry) => entry.segment.id);
      const remaining = await silentPreflightFix(targetIds);
      if (remaining.length > 0) {
        toast.warning(`还有 ${remaining.length} 个体检问题未自动修复`, {
          description: "已继续生成，成片完成后会自动质检。",
        });
      }
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
      setComposerReloadKey((key) => key + 1);
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
  const previewFlatIndex = preview
    ? allSegments.findIndex((entry) => entry.segment.id === preview.id)
    : -1;
  const previewStartMs =
    previewFlatIndex > 0
      ? allSegments
          .slice(0, previewFlatIndex)
          .reduce((sum, entry) => sum + entry.segment.targetMs, 0)
      : 0;
  const previewTimeRange = preview
    ? `${clock(previewStartMs)}–${clock(previewStartMs + preview.targetMs)}`
    : "00:00–00:00";

  function openShotForIssue(issue?: PreflightIssue) {
    if (!preview) return;
    const shot =
      typeof issue?.shotIndex === "number"
        ? preview.shots[issue.shotIndex]
        : preview.shots[0];
    if (shot) setEditShot({ shot, nodes: previewNodes });
  }

  function editIssueShot() {
    openShotForIssue(
      [...previewIssues.errors, ...previewIssues.warnings].find(
        (item) => typeof item.shotIndex === "number",
      ),
    );
  }

  async function repairSegment(segmentId: string) {
    if (repairBusy) return;
    setRepairBusy(true);
    const toastId = toast.loading("正在修复本段并重新编译提示词…");
    try {
      const res = await fetch(
        `/api/projects/${id}/segments/${segmentId}/repair`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "修复失败");
      if (Array.isArray(data?.scenes)) {
        setScenes(data.scenes as StoredSceneStoryboard[]);
        setFramesVersion((v) => v + 1);
      }
      const repaired = !data?.message;
      const compile = await compileSegmentPrompt(segmentId);
      await refresh();
      setComposerReloadKey((key) => key + 1);
      if (compile.ok) {
        if (repaired) {
          toast.success(
            data?.attempts
              ? `本段已修复并重新编译（尝试 ${data.attempts} 次）`
              : "本段已修复并重新编译",
            { id: toastId },
          );
        } else {
          toast.info("本段无需修复，提示词已重新编译", { id: toastId });
        }
      } else if (repaired) {
        toast.warning(`本段分镜已修复，但提示词编译失败：${compile.error}`, {
          id: toastId,
        });
      } else {
        toast.warning(`本段无需修复；提示词编译失败：${compile.error}`, {
          id: toastId,
        });
      }
    } catch (error) {
      toast.error((error as Error).message || "修复失败", { id: toastId });
    } finally {
      setRepairBusy(false);
    }
  }

  async function forceHardCut(segmentId: string) {
    if (hardCutBusy) return;
    setHardCutBusy(true);
    try {
      const res = await fetch(`/api/projects/${id}/segments/${segmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hardCut: true }),
      });
      if (!res.ok) throw new Error(await readError(res, "设置硬切失败"));
      toast.success("已设为硬切");
      await refresh();
    } catch (error) {
      toast.error((error as Error).message || "设置硬切失败");
    } finally {
      setHardCutBusy(false);
    }
  }

  async function fixIssue(issue: PreflightIssue) {
    if (!preview) return;
    if (issue.fixAction === "edit-storyboard" || issue.fixAction === "edit-target") {
      openShotForIssue(issue);
      return;
    }
    if (issue.fixAction === "set-hard-cut") {
      await forceHardCut(preview.id);
      return;
    }
    if (issue.fixAction === "recompile-prompt") {
      await recompilePrompt();
      return;
    }
    if (issue.fixAction === "regenerate-video") {
      await cloudGenerateVideo();
    }
  }

  function fixActionLabel(action: PreflightIssue["fixAction"]): string {
    switch (action) {
      case "edit-storyboard":
        return "修此镜";
      case "edit-target":
        return "改台词对象";
      case "set-hard-cut":
        return "设为硬切";
      case "recompile-prompt":
        return "重新编译";
      case "regenerate-video":
        return "重生成视频";
      default:
        return "修复";
    }
  }
  const preflightBySegment = new Map<
    string,
    { errors: PreflightIssue[]; warnings: PreflightIssue[] }
  >();
  for (const issue of preflight) {
    const entry = preflightBySegment.get(issue.segmentId) ?? {
      errors: [],
      warnings: [],
    };
    if (issue.level === "error") entry.errors.push(issue);
    else entry.warnings.push(issue);
    preflightBySegment.set(issue.segmentId, entry);
  }
  const previewIssues = preview
    ? (preflightBySegment.get(preview.id) ?? { errors: [], warnings: [] })
    : { errors: [], warnings: [] };
  const qcBySegment = new Map(qcList.map((item) => [item.segmentId, item]));
  const previewQc = preview ? (qcBySegment.get(preview.id) ?? null) : null;
  const retrySuggestions = previewQc ? suggestQcRetry(previewQc.issues) : [];
  const needsSeedRetry = retrySuggestions.some((item) => item.seedChange);

  async function restoreSegment(segmentId: string) {
    try {
      const res = await fetch(
        `/api/projects/${id}/segments/${segmentId}/restore`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await readError(res, "还原失败"));
      await refresh();
      setComposerReloadKey((key) => key + 1);
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
          {qcSummary && qcSummary.checkedSegments > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              QC 已检 {qcSummary.checkedSegments}/{qcSummary.totalSegments} ·
              首次硬失败 {qcSummary.firstAttemptHardFail}（
              {(qcSummary.firstPassHardFailRate * 100).toFixed(0)}%）· 重试成功{" "}
              {qcSummary.retrySucceeded}/{qcSummary.retriedSegments}
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
              <DropdownMenuContent className="max-h-72 overflow-y-auto">
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
                <DropdownMenuItem
                  onClick={() => setPreflightOpen(true)}
                  title="查看本段的体检问题并手动修复"
                >
                  <Stethoscope className="size-4" />
                  本段体检与修复
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

      {!hasScript && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            请先在「剧本」页生成剧本。
          </CardContent>
        </Card>
      )}

      {hasScript && !busyGenerate && (
        <details className="group rounded-lg border border-border bg-muted/20 px-3 py-2">
          <summary className="flex cursor-pointer list-none select-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
            额外要求（可选，下次生成时生效）
            <span className="flex items-center gap-2">
              {extra.trim() && (
                <span className="text-xs font-normal text-muted-foreground">
                  已填写
                </span>
              )}
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="mt-3">
            <textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="例如：多用户外自然光；避免快速推拉运镜。"
              className="min-h-[80px] w-full rounded-lg border border-input bg-transparent p-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </div>
        </details>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1 rounded-full bg-muted p-1">
              <button
                type="button"
                onClick={() => setViewTab("generate")}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  viewTab === "generate"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Sparkles className="size-3.5" />
                生成
              </button>
              <button
                type="button"
                onClick={() => setViewTab("preview")}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  viewTab === "preview"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Film className="size-3.5" />
                预览
              </button>
            </div>
            <span className="text-xs text-muted-foreground">
              {viewTab === "generate"
                ? "提交内容以输入框内的提示词为准 · 高级操作收在「更多」里"
                : "只读查看本段分镜 · 底部段落列表始终保留"}
            </span>
          </div>

          {viewTab === "generate" ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    生成结果
                    <span className="text-sm font-normal">
                      {previewScene.sceneSlug || `第${previewScene.sceneIndex}场`} ·
                      第{preview.index}段
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {preview.shots.length} 镜 · {(previewTotal / 1000).toFixed(1)}s
                    </span>
                    {!previewEntry?.isFirstOfScene && (
                      <span
                        className="rounded-full border border-border px-2 py-0.5 text-[11px] font-normal text-muted-foreground"
                        title="由本段首镜的「延续上一镜」自动决定；如需修改请编辑该镜。"
                      >
                        {preview.hardCut ? "与上一段：硬切" : "与上一段：连续"}
                      </span>
                    )}
                    {preview.stale && (
                      <span
                        className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[11px] font-normal text-amber-700 dark:text-amber-300"
                        title="本段视频生成后分镜、参考图或参数又改过，视频与当前内容不再对应。"
                      >
                        视频已过期
                      </span>
                    )}
                    <span className="ml-auto flex flex-wrap items-center gap-1.5">
                      {preview.videoPath ? (
                        <>
                          {previewQc ? (
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-normal",
                                previewQc.status === "failed"
                                  ? "bg-destructive/10 text-destructive"
                                  : previewQc.status === "passed"
                                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                              )}
                            >
                              QC{" "}
                              {previewQc.status === "failed"
                                ? "未通过"
                                : previewQc.status === "passed"
                                  ? "通过"
                                  : "待复核"}{" "}
                              · {previewQc.score ?? 0} 分
                            </span>
                          ) : (
                            <span className="text-xs font-normal text-muted-foreground">
                              待质检
                            </span>
                          )}
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={runQc}
                            disabled={qcBusy}
                            title="重新质检本段视频"
                          >
                            {qcBusy ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : null}
                            重新质检
                          </Button>
                        </>
                      ) : null}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <SegmentVideo
                    projectId={id}
                    segmentId={preview.id}
                    segmentLabel={`第${preview.index}段`}
                    nextSegmentId={nextSegmentId}
                    refreshKey={framesVersion}
                    onChanged={refresh}
                  />

                  {((previewQc?.issues.length ?? 0) > 0 ||
                    retrySuggestions.length > 0) && (
                    <div className="rounded-lg border p-2.5 text-xs leading-5">
                      <div className="font-medium">QC 建议</div>
                      {retrySuggestions.length > 0 && (
                        <p className="mt-1 text-muted-foreground">
                          {retrySuggestions.map((item) => item.reason).join(" ")}
                          {needsSeedRetry ? " 建议换种子后重新生成。" : ""}
                        </p>
                      )}
                      {previewQc && previewQc.issues.length > 0 && (
                        <ul className="mt-1 flex flex-col gap-1">
                          {previewQc.issues.map((issue, i) => (
                            <li
                              key={`${issue.code}:${i}`}
                              className={cn(
                                issue.level === "hard"
                                  ? "text-destructive"
                                  : "text-muted-foreground",
                              )}
                            >
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                </CardContent>
              </Card>

              <SegmentComposer
                key={`${preview.id}:${currentVendor?.platform ?? "h3"}:${composerReloadKey}`}
                projectId={id}
                segment={preview}
                scene={previewScene}
                assets={assets}
                platform={currentVendor?.platform ?? "h3"}
                aspectRatio={projectAspectRatio}
                vendorName={currentVendor?.name ?? vendor}
                isH3={isH3}
                maxRefs={currentVendor?.maxRefImages ?? 14}
                minDurationSec={Math.max(
                  1,
                  Math.round((currentVendor?.minSegmentMs ?? 4000) / 1000),
                )}
                maxDurationSec={Math.max(
                  1,
                  Math.round((currentVendor?.maxSegmentMs ?? 15000) / 1000),
                )}
                durationStepSec={Math.max(
                  1,
                  Math.round((currentVendor?.durationStepMs ?? 1000) / 1000),
                )}
                timeRange={previewTimeRange}
                reloadToken={composerReloadKey}
                cloudRunning={cloudRunning}
                onRefresh={refresh}
                onCloudStart={() => void cloudGenerate()}
                onRegenerateSegment={(segmentId) =>
                  void regenerateSegment(segmentId)
                }
                onRestoreSegment={(segmentId) => void restoreSegment(segmentId)}
                onEditBlocking={(scene) => setEditBlocking(scene)}
                onOpenPreflight={() => setPreflightOpen(true)}
              />
            </>
          ) : (
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
                  </span>
                  {!previewEntry?.isFirstOfScene && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                      {preview.hardCut ? "与上一段：硬切" : "与上一段：连续"}
                    </span>
                  )}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    只读展示 · 逐镜修正可点卡片右上角
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
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
              </CardContent>
            </Card>
          )}

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
                点击切换段落
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
                    </div>
                    <span className="truncate text-sm font-medium">
                      {scene.sceneSlug || `第${scene.sceneIndex}场`} · 第
                      {segment.index}段
                    </span>
                    <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                      <span>
                        {segment.shots.length} 镜 · {(total / 1000).toFixed(1)}s
                      </span>
                      {qcBySegment.get(segment.id) && (
                        <span
                          className={cn(
                            "rounded px-1 py-0.5 text-[10px] font-medium",
                            qcBySegment.get(segment.id)?.status === "failed"
                              ? "bg-destructive/10 text-destructive"
                              : qcBySegment.get(segment.id)?.status === "passed"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                          )}
                          title={qcBySegment
                            .get(segment.id)
                            ?.issues.map((issue) => issue.message)
                            .join("\n")}
                        >
                          QC
                          {qcBySegment.get(segment.id)?.status === "failed"
                            ? "未过"
                            : qcBySegment.get(segment.id)?.status === "passed"
                              ? "过"
                              : "复核"}
                        </span>
                      )}
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

      <Dialog open={preflightOpen} onOpenChange={setPreflightOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>本段体检与修复</DialogTitle>
            <DialogDescription>
              只在主动查看时展开。生成视频前不再提示；成片完成后会自动质检。
            </DialogDescription>
          </DialogHeader>
          {preview &&
          previewIssues.errors.length + previewIssues.warnings.length > 0 ? (
            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
              <ul className="flex flex-col gap-1.5 text-xs">
                {[...previewIssues.errors, ...previewIssues.warnings].map(
                  (issue, i) => (
                    <li
                      key={`${issue.code}:${issue.shotId ?? ""}:${i}`}
                      className="flex items-start justify-between gap-2"
                    >
                      <span
                        className={cn(
                          issue.level === "error"
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {typeof issue.shotIndex === "number"
                          ? `镜${issue.shotIndex + 1}：`
                          : ""}
                        {issue.message}
                      </span>
                      <button
                        type="button"
                        onClick={() => fixIssue(issue)}
                        disabled={
                          hardCutBusy ||
                          recompileBusy ||
                          (issue.fixAction === "regenerate-video" &&
                            (videoGen || !isH3 || cloudRunning))
                        }
                        className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] transition-colors hover:border-foreground/25 disabled:opacity-50"
                      >
                        {fixActionLabel(issue.fixAction)}
                      </button>
                    </li>
                  ),
                )}
              </ul>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => preview && repairSegment(preview.id)}
                  disabled={repairBusy}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] transition-colors hover:border-foreground/25 disabled:opacity-50"
                >
                  {repairBusy ? "修复并编译中…" : "AI 修复并重编译"}
                </button>
                <button
                  type="button"
                  onClick={editIssueShot}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] transition-colors hover:border-foreground/25"
                >
                  逐镜修正
                </button>
                {[...previewIssues.errors, ...previewIssues.warnings].some(
                  (issue) => issue.fixAction === "recompile-prompt",
                ) && (
                  <button
                    type="button"
                    onClick={recompilePrompt}
                    disabled={recompileBusy}
                    className="rounded-full border border-border px-2 py-0.5 text-[11px] transition-colors hover:border-foreground/25 disabled:opacity-50"
                  >
                    {recompileBusy ? "编译中…" : "重新编译"}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              本段暂无需要处理的问题。
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreflightOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
