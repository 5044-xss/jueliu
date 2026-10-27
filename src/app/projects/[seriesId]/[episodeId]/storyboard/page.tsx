"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { FileText, Loader2, Sparkles, Stethoscope } from "lucide-react";
import { BlockingEditDialog } from "@/components/blocking-edit-dialog";
import { Elapsed } from "@/components/elapsed";
import { EmptyState } from "@/components/empty-state";
import { LoadErrorState, LoadingState } from "@/components/load-state";
import { LlmKeyNotice, useLlmConfigured } from "@/components/llm-notice";
import { SegmentComposer } from "@/components/segment-composer";
import { ShotEditDialog } from "@/components/shot-edit-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@core/client/utils";
import type { PreflightIssue } from "@core/shared/preflight";
import type {
  StoredSceneStoryboard,
  StoredShot,
} from "@core/shared/schemas/storyboard";
import { StoryboardHeader } from "@/features/storyboard/storyboard-header";
import { StoryboardSegmentStrip } from "@/features/storyboard/storyboard-segment-strip";
import { StoryboardSettingsDialog } from "@/features/storyboard/storyboard-settings-dialog";
import { StoryboardShotPanel } from "@/features/storyboard/storyboard-shot-panel";
import { StoryboardVideoPanel } from "@/features/storyboard/storyboard-video-panel";
import { useStoryboard, segmentGenPhase } from "@/features/storyboard/use-storyboard";

function formatStoryboardText(scenes: StoredSceneStoryboard[]): string {
  if (scenes.length === 0) return "（暂无分镜）";
  const lines: string[] = [];
  for (const scene of scenes) {
    lines.push(`【第${scene.sceneIndex}场 · ${scene.sceneSlug || "未命名"}】`);
    lines.push(
      `地点：${scene.location || "未标注"}｜时间：${scene.timeOfDay || "未标注"}｜${scene.interiorExterior || "未标注"}`,
    );
    for (const segment of scene.segments) {
      const total = segment.shots.reduce(
        (sum, shot) => sum + shot.durationMs,
        0,
      );
      lines.push(
        `— 第${segment.index}段（${segment.shots.length}镜 · ${(total / 1000).toFixed(1)}s）`,
      );
      for (const shot of segment.shots) {
        lines.push(
          `  镜${shot.index + 1}（${(shot.durationMs / 1000).toFixed(1)}s）${shot.action}`,
        );
        if (shot.dialogue.length > 0) {
          lines.push(
            `    台词：${shot.dialogue
              .map(
                (line) =>
                  `${line.character ? `${line.character}：` : ""}「${line.text}」`,
              )
              .join("；")}`,
          );
        }
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
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

export default function StoryboardPage() {
  const { seriesId, episodeId: id } = useParams<{
    seriesId: string;
    episodeId: string;
  }>();
  const sb = useStoryboard(id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [composerReloadKey, setComposerReloadKey] = useState(0);
  const [qcBusy, setQcBusy] = useState(false);
  const [recompileBusy, setRecompileBusy] = useState(false);
  const [editShot, setEditShot] = useState<{
    shot: StoredShot;
    nodes: { id: string; label: string }[];
  } | null>(null);
  const [editBlocking, setEditBlocking] =
    useState<StoredSceneStoryboard | null>(null);
  const llmMissing = useLlmConfigured() === "missing";

  const previewEntry = sb.previewEntry;
  const preview = previewEntry?.segment ?? null;
  const previewScene = previewEntry?.scene ?? null;
  const previewPhase =
    sb.videoRunning && preview ? segmentGenPhase(preview.genStatus) : null;
  const previewNodes = (previewScene?.blocking?.nodes ?? []).map((node) => ({
    id: node.id,
    label: node.label,
  }));
  const nextSegmentId = previewEntry
    ? (previewEntry.scene.segments[previewEntry.index + 1]?.id ?? null)
    : null;

  function openShot(shot: StoredShot) {
    setEditShot({ shot, nodes: previewNodes });
  }

  function openIssueShot(issue?: PreflightIssue) {
    if (!preview) return;
    const shot =
      typeof issue?.shotIndex === "number"
        ? preview.shots[issue.shotIndex]
        : preview.shots[0];
    if (shot) openShot(shot);
  }

  async function runQc(segmentId: string) {
    if (qcBusy) return;
    setQcBusy(true);
    try {
      await sb.runQc(segmentId);
    } finally {
      setQcBusy(false);
    }
  }

  async function recompilePrompt() {
    if (!preview || recompileBusy) return;
    setRecompileBusy(true);
    try {
      const result = await sb.compileSegmentPrompt(preview.id);
      if (!result.ok) throw new Error(result.error);
      toast.success("提示词已重新编译");
      setComposerReloadKey((key) => key + 1);
      await sb.refresh();
    } catch (error) {
      toast.error((error as Error).message || "重新编译失败");
    } finally {
      setRecompileBusy(false);
    }
  }

  async function cloudGenerateStartFrame() {
    if (!preview) return;
    try {
      const res = await fetch(
        `/api/projects/${id}/segments/${preview.id}/generate-image`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "提交失败");
      toast.success("已提交云端生成起始画面", {
        description: `任务 ${data.taskId} · 参考图 ${data.refCount} 张`,
      });
    } catch (error) {
      toast.error((error as Error).message || "提交失败");
    }
  }

  async function cloudGenerateVideo() {
    if (!preview) return;
    try {
      const res = await fetch(
        `/api/projects/${id}/segments/${preview.id}/generate-video`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "提交失败");
      toast.success("已提交生成视频", {
        description: `${data.mode} · 图片 ${data.refCount} 张`,
      });
      await sb.refresh();
    } catch (error) {
      toast.error((error as Error).message || "提交失败");
    }
  }

  async function fixIssue(issue: PreflightIssue) {
    if (!preview) return;
    if (
      issue.fixAction === "edit-storyboard" ||
      issue.fixAction === "edit-target"
    ) {
      openIssueShot(issue);
      return;
    }
    if (issue.fixAction === "set-hard-cut") {
      await sb.forceHardCut(preview.id);
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

  if (!sb.loaded) {
    return sb.loadError ? (
      <LoadErrorState message={sb.loadError} onRetry={sb.reload} />
    ) : (
      <LoadingState />
    );
  }

  const previewIssues = sb.previewIssues;
  const issueCount =
    previewIssues.errors.length + previewIssues.warnings.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 pb-4">
      <StoryboardHeader
        hasStoryboard={sb.hasStoryboard}
        hasScript={sb.hasScript}
        storyboardCount={sb.allSegments.length}
        returnedCount={sb.returnedCount}
        totalTargetMs={sb.totalTargetMs}
        staleCount={sb.staleCount}
        pendingVideoCount={sb.pendingVideoCount}
        missingStartFrames={
          sb.autoStartFrames ? sb.missingHardCutFrames : 0
        }
        vendorName={sb.currentVendor?.name ?? sb.vendor}
        strategyName={
          sb.strategies.find((item) => item.id === sb.strategyId)?.name ??
          sb.strategyId
        }
        isH3={sb.isH3}
        busyGenerate={sb.busyGenerate}
        cloudRunning={sb.cloudRunning}
        batchBusy={sb.batchBusy}
        generatingSegmentLabel={sb.generatingSegmentLabel}
        generatingProgress={sb.generatingProgress}
        generatingProgressCurrent={sb.generatingProgressCurrent}
        onGenerateStoryboard={() => void sb.generateStoryboard()}
        onGenerateVideos={() => void sb.generateAllVideos()}
        onCancelVideos={() => void sb.cancelVideos()}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSource={() => setSourceOpen(true)}
      />

      {llmMissing && <LlmKeyNotice />}

      {sb.busyGenerate && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-5 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在调用 LLM 生成分镜，请稍候…（可切换页面，完成后会自动刷新）
          <Elapsed startedAt={sb.runningGenerateJob?.startedAt} />
        </div>
      )}

      {!sb.busyGenerate && !sb.hasScript && (
        <EmptyState
          icon={FileText}
          tone="mint"
          title="还没有剧本"
          description="分镜根据剧本生成，请先在「剧本」页生成剧本。"
          action={
            <Button
              nativeButton={false}
              render={<Link href={`/projects/${seriesId}/${id}/script`} />}
            >
              <FileText className="size-4" />
              去生成剧本
            </Button>
          }
        />
      )}

      {!sb.busyGenerate && sb.hasScript && !sb.hasStoryboard && (
        <EmptyState
          icon={Sparkles}
          tone="lilac"
          title="还没有分镜"
          description="厂商与策略包已按默认值准备好，点击「生成分镜」即可。"
          action={
            <Button onClick={() => void sb.generateStoryboard()}>
              <Sparkles className="size-4" />
              生成分镜
            </Button>
          }
        />
      )}

      {!sb.busyGenerate && sb.hasStoryboard && previewEntry && previewScene && preview && (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:overflow-hidden">
            <StoryboardVideoPanel
              projectId={id}
              entry={previewEntry}
              nextSegmentId={nextSegmentId}
              qc={sb.previewQc}
              framesVersion={sb.framesVersion}
              phase={previewPhase}
              progress={sb.videoProgress}
              progressCurrent={sb.videoProgressCurrent}
              busy={qcBusy}
              onRefresh={sb.refresh}
              onRunQc={(segmentId) => void runQc(segmentId)}
              onCancelSegment={(segmentId) =>
                void sb.cancelSegmentVideo(segmentId)
              }
              onOpenPreflight={() => setPreflightOpen(true)}
            />

            <section className="flex min-h-0 flex-col rounded-2xl border bg-card p-4">
              <Tabs defaultValue="prompt" className="min-h-0 flex-1">
                <div className="flex items-center justify-between gap-2 pb-2">
                  <TabsList variant="line" className="h-8">
                    <TabsTrigger value="prompt">提示词</TabsTrigger>
                    <TabsTrigger value="storyboard">分镜</TabsTrigger>
                  </TabsList>
                  {issueCount > 0 && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setPreflightOpen(true)}
                      className="text-amber-700 dark:text-amber-400"
                    >
                      <Stethoscope className="size-3.5" />
                      {issueCount} 个体检提示
                    </Button>
                  )}
                </div>
                <TabsContent
                  value="storyboard"
                  className="min-h-0 overflow-y-auto pr-1"
                >
                  <StoryboardShotPanel
                    projectId={id}
                    scene={previewScene}
                    shots={preview.shots}
                    onEditShot={openShot}
                    onEditBlocking={() => setEditBlocking(previewScene)}
                  />
                </TabsContent>
                <TabsContent value="prompt" className="min-h-0 overflow-hidden">
                  <SegmentComposer
                    key={`${preview.id}:${sb.currentVendor?.platform ?? "h3"}:${composerReloadKey + sb.promptRevision}`}
                    projectId={id}
                    segment={preview}
                    scene={previewScene}
                    assets={sb.assets}
                    platform={sb.currentVendor?.platform ?? "h3"}
                    aspectRatio={sb.projectAspectRatio}
                    vendorName={sb.currentVendor?.name ?? sb.vendor}
                    isH3={sb.isH3}
                    maxRefs={sb.currentVendor?.maxRefImages ?? 9}
                    minDurationSec={Math.max(
                      1,
                      Math.round((sb.currentVendor?.minSegmentMs ?? 4000) / 1000),
                    )}
                    maxDurationSec={Math.max(
                      1,
                      Math.round((sb.currentVendor?.maxSegmentMs ?? 15000) / 1000),
                    )}
                    durationStepSec={Math.max(
                      1,
                      Math.round((sb.currentVendor?.durationStepMs ?? 1000) / 1000),
                    )}
                    timeRange={`${String(Math.floor(previewEntry.startMs / 60000)).padStart(2, "0")}:${String(Math.floor((previewEntry.startMs % 60000) / 1000)).padStart(2, "0")}–${String(Math.floor((previewEntry.startMs + preview.targetMs) / 60000)).padStart(2, "0")}:${String(Math.floor(((previewEntry.startMs + preview.targetMs) % 60000) / 1000)).padStart(2, "0")}`}
                    reloadToken={composerReloadKey + sb.promptRevision}
                    segmentGenerating={previewPhase !== null}
                    onRefresh={sb.refresh}
                    onCloudStart={() => void cloudGenerateStartFrame()}
                    onCancelSegment={(segmentId) =>
                      void sb.cancelSegmentVideo(segmentId)
                    }
                    onRegenerateSegment={(segmentId) =>
                      void sb.regenerateSegment(segmentId)
                    }
                    onRestoreSegment={(segmentId) =>
                      void sb.restoreSegment(segmentId)
                    }
                    onEditBlocking={(scene) => setEditBlocking(scene)}
                    onOpenPreflight={() => setPreflightOpen(true)}
                  />
                </TabsContent>
              </Tabs>
            </section>
          </div>

          <StoryboardSegmentStrip
            projectId={id}
            entries={sb.allSegments}
            activeId={preview.id}
            totalTargetMs={sb.totalTargetMs}
            videoRunning={sb.videoRunning}
            qcBySegment={sb.qcBySegment}
            onSelect={sb.setPreviewId}
          />
        </div>
      )}

      <StoryboardSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        vendors={sb.vendorOptions}
        vendor={sb.vendor}
        strategies={sb.strategies}
        strategyId={sb.strategyId}
        extra={sb.extra}
        autoStartFrames={sb.autoStartFrames}
        hasStoryboard={sb.hasStoryboard}
        orchestrating={sb.orchestrating}
        missingStartFrames={sb.missingHardCutFrames}
        onVendorChange={(vendor) => void sb.changeVendor(vendor)}
        onStrategyChange={sb.setStrategyId}
        onExtraChange={sb.setExtra}
        onAutoStartFramesChange={sb.setAutoStartFrames}
        onReorchestrate={() => void sb.reorchestrate()}
        onGenerateStartFrames={() => void sb.generateStartFrames()}
        onClear={() => void sb.clearStoryboard()}
      />

      <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>分镜原文</DialogTitle>
            <DialogDescription>
              按当前分镜内容只读展示；如需修改，请在分镜或提示词里逐镜调整。
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[62vh] overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-xs leading-6">
            {formatStoryboardText(sb.scenes)}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSourceOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={preflightOpen} onOpenChange={setPreflightOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>本段体检与修复</DialogTitle>
            <DialogDescription>
              生成视频前会自动处理可安全修复的问题；成片完成后会自动质检。
            </DialogDescription>
          </DialogHeader>
          {preview && issueCount > 0 ? (
            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
              <ul className="flex flex-col gap-1.5 text-xs">
                {[...previewIssues.errors, ...previewIssues.warnings].map(
                  (issue, index) => (
                    <li
                      key={`${issue.code}:${issue.shotId ?? ""}:${index}`}
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
                        onClick={() => void fixIssue(issue)}
                        disabled={recompileBusy}
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
                  onClick={() => preview && void sb.repairSegment(preview.id)}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] transition-colors hover:border-foreground/25"
                >
                  AI 修复并重编译
                </button>
                <button
                  type="button"
                  onClick={() => openIssueShot(issueCount > 0 ? previewIssues.errors[0] ?? previewIssues.warnings[0] : undefined)}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] transition-colors hover:border-foreground/25"
                >
                  逐镜修正
                </button>
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

      {editShot && (
        <ShotEditDialog
          projectId={id}
          shot={editShot.shot}
          assets={sb.assets}
          nodeOptions={editShot.nodes}
          onClose={() => setEditShot(null)}
          onSaved={sb.refresh}
        />
      )}

      {editBlocking && (
        <BlockingEditDialog
          projectId={id}
          sceneId={editBlocking.sceneId}
          sceneLabel={editBlocking.sceneSlug || `第${editBlocking.sceneIndex}场`}
          blocking={editBlocking.blocking}
          onClose={() => setEditBlocking(null)}
          onSaved={sb.refresh}
        />
      )}

    </div>
  );
}
