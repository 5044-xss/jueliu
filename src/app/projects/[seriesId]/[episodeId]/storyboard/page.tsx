"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  Film,
  Loader2,
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

interface VendorOption {
  id: string;
  name: string;
  platform: string;
  note: string;
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
  const [hasScript, setHasScript] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [extra, setExtra] = useState("");
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [vendor, setVendor] = useState<string>("doubao");
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  const [orchestrating, setOrchestrating] = useState(false);
  const [editShot, setEditShot] = useState<{
    shot: StoredShot;
    nodes: { id: string; label: string }[];
  } | null>(null);
  const [editBlocking, setEditBlocking] =
    useState<StoredSceneStoryboard | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [framesVersion, setFramesVersion] = useState(0);

  const load = useCallback(async () => {
    const [sb, script, assetsRes, projectRes, vendorsRes] = await Promise.all([
      fetch(`/api/projects/${id}/storyboard`).then((r) => r.json()),
      fetch(`/api/projects/${id}/script`).then((r) => r.json()),
      fetch(`/api/projects/${id}/assets`).then((r) => r.json()),
      fetch(`/api/projects/${id}`).then((r) => r.json()),
      fetch(`/api/library/vendors`).then((r) => r.json()),
    ]);
    return {
      scenes: (sb.scenes ?? []) as StoredSceneStoryboard[],
      hasScript: Boolean(script.script),
      assets: (assetsRes.assets ?? []) as StoredAsset[],
      vendor: (projectRes.project?.vendor as string) || "doubao",
      vendors: (vendorsRes.vendors ?? []) as VendorOption[],
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
    setAssets(data.assets);
    setFramesVersion((v) => v + 1);
  }

  const { jobs } = useProjectJobs(id, (job) => {
    // 上游（剧本/资产）重新生成会清空分镜，必须一起刷新，
    // 否则页面会残留已被删除的旧分镜，点「第三方生成」就会报「段落不存在」。
    if (
      job.kind === "script-to-storyboard" ||
      job.kind === "script-to-assets" ||
      job.kind === "story-to-script"
    ) {
      refresh();
    }
  });

  const runningGenerate = isJobRunning(jobs, "script-to-storyboard");
  const runningGenerateJob =
    jobs.find(
      (j) => j.kind === "script-to-storyboard" && j.status === "running",
    ) ?? null;
  const busyGenerate = generating || runningGenerate;
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
      const ok = window.confirm(
        `切换到「${next}」会按该厂商重新编排分镜。各段已回传的视频/截帧会按厂商分别缓存，切回原厂商时可自动恢复。确定继续？`,
      );
      if (!ok) return;
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
        if (!res.ok) throw new Error();
      } catch {
        setVendor(prev);
        toast.error("切换厂商失败");
      }
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
    if (!window.confirm("确定清空分镜？")) return;
    try {
      const res = await fetch(`/api/projects/${id}/storyboard`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      await refresh();
      toast.success("已清空");
    } catch {
      toast.error("清空失败");
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
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-block-mint p-5">
        <div>
          <h2 className="text-base font-medium">分镜</h2>
          <p className="text-sm text-muted-foreground">
            场次拆分为段落与分镜；选择厂商后按该厂商的镜数/时长/参考图规则重新编排。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            厂商
            <select
              value={vendor}
              onChange={(e) => changeVendor(e.target.value)}
              disabled={busyGenerate || orchestrating}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {vendorOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          {hasStoryboard && (
            <Button
              variant="outline"
              onClick={() => runOrchestrate(vendor)}
              disabled={busyGenerate || orchestrating}
              title="按当前厂商重新打包分镜为段落"
            >
              {orchestrating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )}
              重新编排
            </Button>
          )}
          {hasStoryboard && (
            <Button
              variant="outline"
              onClick={clear}
              disabled={busyGenerate || orchestrating}
            >
              <Trash2 className="size-4" />
              清空
            </Button>
          )}
          <Button
            onClick={generate}
            disabled={busyGenerate || orchestrating || !hasScript}
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
          defaultPlatform={
            vendorOptions.find((v) => v.id === vendor)?.platform
          }
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
