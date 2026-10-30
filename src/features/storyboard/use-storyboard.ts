"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import type { VendorOption } from "@/components/vendor-switch-dialog";
import { readError } from "@/lib/http";
import { useProjectJobs, isJobRunning } from "@core/client/use-jobs";
import type { LibraryStoryboardStrategy } from "@core/shared/library/storyboard-strategies";
import type { PreflightIssue } from "@core/shared/preflight";
import type { SegmentQcRecord } from "@core/shared/qc";
import type { StoredAsset } from "@core/shared/schemas/assets";
import type {
  StoredSceneStoryboard,
  StoredSegment,
} from "@core/shared/schemas/storyboard";

export interface StoryboardSegmentEntry {
  scene: StoredSceneStoryboard;
  segment: StoredSegment;
  index: number;
  isFirstOfScene: boolean;
  flatIndex: number;
  startMs: number;
}

async function getJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await readError(res, `读取${what}失败`));
  return (await res.json()) as T;
}

export function useStoryboard(projectId: string) {
  const confirm = useConfirm();
  const [scenes, setScenes] = useState<StoredSceneStoryboard[]>([]);
  const [preflight, setPreflight] = useState<PreflightIssue[]>([]);
  const [qcList, setQcList] = useState<SegmentQcRecord[]>([]);
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [hasScript, setHasScript] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [vendor, setVendor] = useState("h3");
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  const [strategies, setStrategies] = useState<LibraryStoryboardStrategy[]>([]);
  const [strategyId, setStrategyId] = useState("universal");
  const [extra, setExtra] = useState("");
  const [projectAspectRatio, setProjectAspectRatio] = useState("16:9");
  const [generating, setGenerating] = useState(false);
  const [orchestrating, setOrchestrating] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [framesVersion, setFramesVersion] = useState(0);
  const [promptRevision, setPromptRevision] = useState(0);
  const [sessionId, setSessionId] = useState(projectId);

  if (sessionId !== projectId) {
    setSessionId(projectId);
    setLoaded(false);
    setLoadError(null);
    setPreviewId(null);
  }

  const load = useCallback(async () => {
    const [sb, script, assetsRes, projectRes, vendorsRes, strategiesRes] =
      await Promise.all([
        getJson<{
          scenes?: StoredSceneStoryboard[];
          preflight?: PreflightIssue[];
          qc?: SegmentQcRecord[];
        }>(`/api/projects/${projectId}/storyboard`, "分镜"),
        getJson<{ script?: unknown }>(
          `/api/projects/${projectId}/script`,
          "剧本",
        ),
        getJson<{ assets?: StoredAsset[] }>(
          `/api/projects/${projectId}/assets`,
          "资产",
        ),
        getJson<{
          project?: {
            vendor?: string;
            aspectRatio?: string;
            storyboardStrategyId?: string | null;
          };
        }>(`/api/projects/${projectId}`, "项目"),
        getJson<{ vendors?: VendorOption[] }>("/api/library/vendors", "厂商"),
        getJson<{ strategies?: LibraryStoryboardStrategy[] }>(
          "/api/library/storyboard-strategies",
          "分镜策略包",
        ),
      ]);
    const vendors = (vendorsRes.vendors ?? []) as VendorOption[];
    const strategyList = (strategiesRes.strategies ?? []) as LibraryStoryboardStrategy[];
    return {
      scenes: (sb.scenes ?? []) as StoredSceneStoryboard[],
      preflight: (sb.preflight ?? []) as PreflightIssue[],
      qc: (sb.qc ?? []) as SegmentQcRecord[],
      hasScript: Boolean(script.script),
      assets: (assetsRes.assets ?? []) as StoredAsset[],
      vendor:
        (projectRes.project?.vendor as string) ||
        vendors.find((item) => item.isDefault)?.id ||
        "h3",
      aspectRatio: projectRes.project?.aspectRatio || "16:9",
      vendors,
      strategies: strategyList,
      strategyId:
        (projectRes.project?.storyboardStrategyId as string | undefined) ||
        strategyList.find((item) => item.isDefault)?.id ||
        "universal",
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await load();
        if (cancelled) return;
        setScenes(data.scenes);
        setPreflight(data.preflight);
        setQcList(data.qc);
        setHasScript(data.hasScript);
        setAssets(data.assets);
        setVendor(data.vendor);
        setProjectAspectRatio(data.aspectRatio);
        setVendorOptions(data.vendors);
        setStrategies(data.strategies);
        setStrategyId(data.strategyId);
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
    setAssets(data.assets);
    setProjectAspectRatio(data.aspectRatio);
    setStrategies(data.strategies);
    setStrategyId(data.strategyId);
    setVendorOptions(data.vendors);
    setVendor(data.vendor);
    setFramesVersion((value) => value + 1);
  }, [load]);

  const { jobs } = useProjectJobs(projectId, (job) => {
    if (
      job.kind === "script-to-storyboard" ||
      job.kind === "script-to-assets" ||
      job.kind === "story-to-script" ||
      job.kind === "segment-regenerate" ||
      job.kind === "repair"
    ) {
      void refresh();
    }
  });

  const allSegments = useMemo<StoryboardSegmentEntry[]>(() => {
    let flatIndex = 0;
    let startMs = 0;
    const entries: StoryboardSegmentEntry[] = [];
    for (const scene of scenes) {
      scene.segments.forEach((segment, index) => {
        entries.push({
          scene,
          segment,
          index,
          isFirstOfScene: index === 0,
          flatIndex,
          startMs,
        });
        flatIndex += 1;
        startMs += segment.targetMs;
      });
    }
    return entries;
  }, [scenes]);

  const activeSegmentId =
    previewId && allSegments.some((entry) => entry.segment.id === previewId)
      ? previewId
      : (allSegments[0]?.segment.id ?? null);

  const previewEntry =
    allSegments.find((entry) => entry.segment.id === activeSegmentId) ??
    allSegments[0] ??
    null;

  const currentVendor =
    vendorOptions.find((item) => item.id === vendor) ?? null;
  const hasStoryboard = scenes.some((scene) => scene.segments.length > 0);
  const returnedCount = allSegments.filter(
    (entry) => entry.segment.videoPath && !entry.segment.stale,
  ).length;
  const staleCount = allSegments.filter((entry) => entry.segment.stale).length;
  const totalTargetMs = allSegments.reduce(
    (sum, entry) => sum + entry.segment.targetMs,
    0,
  );
  const runningGenerate = isJobRunning(jobs, "script-to-storyboard");
  const runningGenerateJob =
    jobs.find(
      (job) => job.kind === "script-to-storyboard" && job.status === "running",
    ) ?? null;
  const busyGenerate = generating || runningGenerate;

  const qcBySegment = useMemo(
    () => new Map(qcList.map((item) => [item.segmentId, item])),
    [qcList],
  );

  const preflightBySegment = useMemo(() => {
    const map = new Map<
      string,
      { errors: PreflightIssue[]; warnings: PreflightIssue[] }
    >();
    for (const issue of preflight) {
      const entry = map.get(issue.segmentId) ?? { errors: [], warnings: [] };
      if (issue.level === "error") entry.errors.push(issue);
      else entry.warnings.push(issue);
      map.set(issue.segmentId, entry);
    }
    return map;
  }, [preflight]);

  const previewIssues = previewEntry
    ? (preflightBySegment.get(previewEntry.segment.id) ?? {
        errors: [],
        warnings: [],
      })
    : { errors: [], warnings: [] };
  const previewQc = previewEntry
    ? (qcBySegment.get(previewEntry.segment.id) ?? null)
    : null;

  async function generateStoryboard() {
    if (hasStoryboard) {
      const ok = await confirm({
        title: "重新生成分镜",
        description:
          "将按当前厂商与策略包重新拆镜、编排，并覆盖现有分镜与已回传视频。此操作不可恢复。",
        confirmText: "重新生成",
        destructive: true,
      });
      if (!ok) return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/skills/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId: "script-to-storyboard",
          projectId,
          input: { extraInstructions: extra, strategyId },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "生成失败");
      await refresh();
      const assembly = data?.assembly as
        | { outputShots?: number; totalDurationMs?: number }
        | undefined;
      const strategyName =
        strategies.find((item) => item.id === strategyId)?.name ?? strategyId;
      const duration = assembly?.totalDurationMs
        ? ` · ${Math.round(assembly.totalDurationMs / 1000)}s`
        : "";
      toast.success(
        assembly?.outputShots
          ? `分镜已生成：${strategyName} · ${assembly.outputShots} 镜${duration}`
          : `分镜已生成：${strategyName}`,
      );
      setPreviewId(null);
    } catch (error) {
      toast.error((error as Error).message || "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function runOrchestrate(nextVendor: string): Promise<boolean> {
    setOrchestrating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor: nextVendor }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "编排失败");
      await refresh();
      toast.success(`已按该厂商编排：${data.segments} 段`);
      return true;
    } catch (error) {
      toast.error((error as Error).message || "编排失败");
      return false;
    } finally {
      setOrchestrating(false);
    }
  }

  async function changeVendor(next: string) {
    if (next === vendor) return;
    if (hasStoryboard) {
      const previous = vendor;
      setVendor(next);
      const ok = await runOrchestrate(next);
      if (!ok) setVendor(previous);
      return;
    }
    const previous = vendor;
    setVendor(next);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor: next }),
      });
      if (!res.ok) throw new Error(await readError(res, "切换厂商失败"));
    } catch (error) {
      setVendor(previous);
      toast.error((error as Error).message || "切换厂商失败");
    }
  }

  async function reorchestrate() {
    const ok = await confirm({
      title: "重新编排",
      description:
        "将按当前厂商重新切分段落。已有视频会按段缓存，未变化的部分会尽量保留。",
      confirmText: "重新编排",
    });
    if (!ok) return;
    await runOrchestrate(vendor);
  }

  async function clearStoryboard() {
    const ok = await confirm({
      title: "清空分镜",
      description: "确定清空当前分镜？此操作不可恢复。",
      confirmText: "清空",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/storyboard`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readError(res, "清空失败"));
      await refresh();
      toast.success("已清空");
    } catch (error) {
      toast.error((error as Error).message || "清空失败");
    }
  }

  async function runQc(segmentId: string) {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segmentId}/qc`,
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
    }
  }

  async function compileSegmentPrompt(
    segmentId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const platform = currentVendor?.platform ?? "h3";
    const res = await fetch("/api/skills/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skillId: "storyboard-to-ai-prompt",
        projectId,
        input: { segmentId, platform },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error || "重新编译失败" };
    }
    return { ok: true };
  }

  async function regenerateSegment(segmentId: string) {
    const ok = await confirm({
      title: "重新生成本段分镜",
      description:
        "只重写这一段的分镜（镜头、机位、表演与台词归属），前后段保持不变。已回传视频会标记为过期。",
      confirmText: "重新生成",
    });
    if (!ok) return;
    const toastId = toast.loading("正在重新生成本段分镜…");
    try {
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segmentId}/regenerate`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "重新生成本段失败");
      await refresh();
      setPreviewId(segmentId);
      setPromptRevision((value) => value + 1);
      toast.success("本段分镜已重新生成", { id: toastId });
    } catch (error) {
      toast.error((error as Error).message || "重新生成本段失败", {
        id: toastId,
      });
    }
  }

  async function restoreSegment(segmentId: string) {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segmentId}/restore`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await readError(res, "还原失败"));
      await refresh();
      setPromptRevision((value) => value + 1);
      toast.success("已还原本段");
    } catch (error) {
      toast.error((error as Error).message || "还原失败");
    }
  }

  async function repairSegment(segmentId: string) {
    const toastId = toast.loading("正在修复本段并重新编译提示词…");
    try {
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segmentId}/repair`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "修复失败");
      const compile = await compileSegmentPrompt(segmentId);
      await refresh();
      setPromptRevision((value) => value + 1);
      if (compile.ok) {
        toast.success("本段已修复并重新编译", { id: toastId });
      } else {
        toast.warning(`本段分镜已修复，但提示词编译失败：${compile.error}`, {
          id: toastId,
        });
      }
    } catch (error) {
      toast.error((error as Error).message || "修复失败", { id: toastId });
    }
  }

  async function forceHardCut(segmentId: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}/segments/${segmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hardCut: true }),
      });
      if (!res.ok) throw new Error(await readError(res, "设置硬切失败"));
      await refresh();
      toast.success("已设为硬切");
    } catch (error) {
      toast.error((error as Error).message || "设置硬切失败");
    }
  }

  return {
    scenes,
    preflight,
    qcList,
    assets,
    hasScript,
    loaded,
    loadError,
    reloadKey,
    vendor,
    vendorOptions,
    strategies,
    strategyId,
    setStrategyId,
    extra,
    setExtra,
    projectAspectRatio,
    generating,
    orchestrating,
    setPreviewId,
    previewEntry,
    activeSegmentId,
    framesVersion,
    setFramesVersion,
    promptRevision,
    allSegments,
    currentVendor,
    hasStoryboard,
    returnedCount,
    staleCount,
    totalTargetMs,
    runningGenerateJob,
    busyGenerate,
    qcBySegment,
    previewIssues,
    previewQc,
    refresh,
    reload: () => {
      setLoaded(false);
      setLoadError(null);
      setReloadKey((key) => key + 1);
    },
    generateStoryboard,
    changeVendor,
    reorchestrate,
    clearStoryboard,
    runQc,
    compileSegmentPrompt,
    regenerateSegment,
    restoreSegment,
    repairSegment,
    forceHardCut,
  };
}

export type StoryboardController = ReturnType<typeof useStoryboard>;
