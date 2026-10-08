"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Film,
  Info,
  Link2,
  Loader2,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
  Wrench,
} from "lucide-react";
import { GenerationDialog } from "@/components/generation-dialog";
import { SegmentVideo } from "@/components/segment-video";
import { ShotEditDialog } from "@/components/shot-edit-dialog";
import { BlockingEditDialog } from "@/components/blocking-edit-dialog";
import { Elapsed } from "@/components/elapsed";
import { useProjectJobs, isJobRunning } from "@/lib/use-jobs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  StoredSceneStoryboard,
  StoredShot,
} from "@/lib/schemas/storyboard";
import type { StoredAsset } from "@/lib/schemas/assets";
import type { ContinuityWarning } from "@/lib/continuity";

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
                {ref.role === "first_frame"
                  ? "首帧"
                  : `${ref.assetName}${ref.variantLabel ? `·${ref.variantLabel}` : ""}${ref.viewLabel ? `·${ref.viewLabel}` : ""}`}
                {!ref.viewId && ref.role !== "first_frame" && " ⚠"}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StoryboardPage() {
  const { id } = useParams<{ id: string }>();
  const [scenes, setScenes] = useState<StoredSceneStoryboard[]>([]);
  const [warnings, setWarnings] = useState<ContinuityWarning[]>([]);
  const [hasScript, setHasScript] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [anchoring, setAnchoring] = useState(false);
  const [extra, setExtra] = useState("");
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editShot, setEditShot] = useState<{
    shot: StoredShot;
    nodes: { id: string; label: string }[];
  } | null>(null);
  const [editBlocking, setEditBlocking] =
    useState<StoredSceneStoryboard | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    const [sb, script, assetsRes] = await Promise.all([
      fetch(`/api/projects/${id}/storyboard`).then((r) => r.json()),
      fetch(`/api/projects/${id}/script`).then((r) => r.json()),
      fetch(`/api/projects/${id}/assets`).then((r) => r.json()),
    ]);
    return {
      scenes: (sb.scenes ?? []) as StoredSceneStoryboard[],
      warnings: (sb.warnings ?? []) as ContinuityWarning[],
      hasScript: Boolean(script.script),
      assets: (assetsRes.assets ?? []) as StoredAsset[],
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await load();
        if (cancelled) return;
        setScenes(data.scenes);
        setWarnings(data.warnings);
        setHasScript(data.hasScript);
        setAssets(data.assets);
        setLoaded(true);
      } catch {
        if (!cancelled) toast.error("读取分镜失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function refresh() {
    const data = await load();
    setScenes(data.scenes);
    setWarnings(data.warnings);
    setAssets(data.assets);
  }

  const { jobs } = useProjectJobs(id, (job) => {
    // 上游（剧本/资产）重新生成会清空分镜，必须一起刷新，
    // 否则页面会残留已被删除的旧分镜，点「第三方生成」就会报「段落不存在」。
    if (
      job.kind === "script-to-storyboard" ||
      job.kind === "script-to-assets" ||
      job.kind === "story-to-script" ||
      job.kind === "anchor" ||
      job.kind === "repair"
    ) {
      refresh();
    }
  });

  const runningGenerate = isJobRunning(jobs, "script-to-storyboard");
  const runningGenerateJob =
    jobs.find(
      (j) => j.kind === "script-to-storyboard" && j.status === "running",
    ) ?? null;
  const runningAnchor = isJobRunning(jobs, "anchor");
  const busyGenerate = generating || runningGenerate;
  const busyAnchor = anchoring || runningAnchor;
  const repairing = isJobRunning(jobs, "repair");
  const hasStoryboard = scenes.some((s) => s.segments.length > 0);

  const allSegments = scenes.flatMap((scene) =>
    scene.segments.map((segment, index) => ({
      scene,
      segment,
      index,
      isFirstOfScene: index === 0,
    })),
  );
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

  async function repairSegment(segmentId: string) {
    try {
      const res = await fetch(
        `/api/projects/${id}/segments/${segmentId}/repair`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "修复失败");
      if (data?.scenes) setScenes(data.scenes as StoredSceneStoryboard[]);
      setWarnings((data?.warnings ?? []) as ContinuityWarning[]);
      toast.success(
        data?.attempts
          ? `已修复（第 ${data.attempts} 次尝试）`
          : data?.message || "本段无需修复",
      );
    } catch (error) {
      toast.error((error as Error).message);
      await refresh();
    }
  }

  async function restoreSegment(segmentId: string) {
    try {
      const res = await fetch(
        `/api/projects/${id}/segments/${segmentId}/restore`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error();
      await refresh();
      toast.success("已还原本段");
    } catch {
      toast.error("还原失败");
    }
  }

  async function generate() {
    if (
      hasStoryboard &&
      !window.confirm(
        "重新生成将覆盖现有分镜（含已回传视频与截帧），确定继续？",
      )
    ) {
      return;
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
      await refresh();
      toast.success("分镜已生成");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function clear() {
    if (!window.confirm("确定清空分镜？")) return;
    await fetch(`/api/projects/${id}/storyboard`, { method: "DELETE" });
    await refresh();
    toast.success("已清空");
  }

  async function autoAnchor() {
    if (
      !window.confirm(
        "将逐场截取每段尾帧并设为下一段首帧（不跨场），确定继续？",
      )
    ) {
      return;
    }
    setAnchoring(true);
    try {
      const res = await fetch(`/api/projects/${id}/storyboard`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "批量锚定失败");
      setScenes((data.scenes ?? []) as StoredSceneStoryboard[]);
      setWarnings((data.warnings ?? []) as ContinuityWarning[]);
      const errors: string[] = data.errors ?? [];
      if (errors.length) {
        toast.warning(
          `已锚定 ${data.anchored} 段，${errors.length} 段失败：${errors[0]}`,
        );
      } else {
        toast.success(
          `已锚定 ${data.anchored} 段${
            data.skipped ? `，跳过 ${data.skipped} 段（未回传视频）` : ""
          }`,
        );
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setAnchoring(false);
    }
  }

  async function setTargetMs(segmentId: string, targetMs: number) {
    try {
      const res = await fetch(`/api/projects/${id}/segments/${segmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMs }),
      });
      if (!res.ok) throw new Error();
      await refresh();
    } catch {
      toast.error("保存段时长失败");
    }
  }

  async function toggleHardCut(segmentId: string, hardCut: boolean) {
    try {
      const res = await fetch(`/api/projects/${id}/segments/${segmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hardCut }),
      });
      if (!res.ok) throw new Error();
      await refresh();
    } catch {
      toast.error("保存接续方式失败");
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">分镜</h2>
          <p className="text-sm text-muted-foreground">
            场次拆分为段落与分镜，并锁定站位、轴线与参考图。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasStoryboard && (
            <Button
              variant="outline"
              onClick={autoAnchor}
              disabled={busyAnchor || busyGenerate}
            >
              {busyAnchor ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              批量锚定
            </Button>
          )}
          {hasStoryboard && (
            <Button variant="outline" onClick={clear} disabled={busyGenerate}>
              <Trash2 className="size-4" />
              清空
            </Button>
          )}
          <Button onClick={generate} disabled={busyGenerate || !hasScript}>
            {busyGenerate ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {hasStoryboard ? "重新生成" : "生成分镜"}
          </Button>
        </div>
      </div>

      {!hasScript && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            请先在「剧本」页生成剧本。
          </CardContent>
        </Card>
      )}

      {hasScript && !hasStoryboard && !busyGenerate && (
        <Card>
          <CardHeader>
            <CardTitle>额外要求（可选）</CardTitle>
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

      {warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              连续性校验（{warnings.length}）
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            {warnings.map((w, i) => (
              <p key={i} className="flex items-start gap-2">
                {w.level === "warning" ? (
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                ) : (
                  <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span>
                  <span className="text-muted-foreground">
                    {w.sceneIndex === "全剧"
                      ? "全剧"
                      : `第${w.sceneIndex}场${
                          w.segmentIndex !== undefined
                            ? `·第${w.segmentIndex}段`
                            : ""
                        }`}
                    ：
                  </span>
                  {w.message}
                </span>
              </p>
            ))}
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
                <input
                  key={preview.targetMs}
                  defaultValue={(preview.targetMs / 1000).toFixed(1)}
                  onBlur={(e) => {
                    const sec = Number(e.target.value);
                    if (!Number.isFinite(sec) || sec <= 0) {
                      e.target.value = (preview.targetMs / 1000).toFixed(1);
                      return;
                    }
                    const ms = Math.round(sec * 1000);
                    if (ms !== preview.targetMs) setTargetMs(preview.id, ms);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="w-14 rounded border border-input bg-transparent px-1 py-0.5 text-center text-xs font-normal"
                />
                <span className="text-xs font-normal text-muted-foreground">s</span>
                {!previewEntry?.isFirstOfScene && (
                  <button
                    type="button"
                    onClick={() =>
                      toggleHardCut(preview.id, !preview.hardCut)
                    }
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                      preview.hardCut
                        ? "border-foreground/30 bg-foreground text-background"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                    title="标记本段与上一段的关系：连续镜头需用上一段尾帧做首帧；硬切则不需要。"
                  >
                    {preview.hardCut
                      ? "与上一段：硬切（无需首帧）"
                      : "与上一段：连续（用尾帧接续）"}
                  </button>
                )}
                <span className="ml-auto flex items-center gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setEditBlocking(previewScene)}
                    title="编辑本场的人物站位与轴线"
                  >
                    <Pencil className="size-3" />
                    编辑站位
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => repairSegment(preview.id)}
                    disabled={repairing}
                    title="调用大模型自动修复本段的连续性问题"
                  >
                    {repairing ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Wrench className="size-3" />
                    )}
                    AI 修复
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => restoreSegment(preview.id)}
                    title="把本段所有分镜还原为生成时的内容"
                  >
                    <RotateCcw className="size-3" />
                    复原本段
                  </Button>
                  <Button size="xs" onClick={() => setDialogOpen(true)}>
                    <Wand2 className="size-3" />
                    第三方生成
                  </Button>
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
                  nextSegmentId={nextSegmentId}
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
              <span className="text-xs text-muted-foreground">
                点击切换上方预览
              </span>
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
                    </div>
                    <span className="truncate text-sm font-medium">
                      {scene.sceneSlug || `第${scene.sceneIndex}场`} · 第
                      {segment.index}段
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {segment.shots.length} 镜 · {(total / 1000).toFixed(1)}s
                      {segment.videoPath ? " · 已回传" : " · 未回传"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {preview && (
        <GenerationDialog
          projectId={id}
          segmentId={preview.id}
          segmentLabel={`第${preview.index}段`}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onStale={refresh}
        />
      )}

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
