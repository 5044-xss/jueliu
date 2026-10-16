"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Film,
  Loader2,
  Play,
  Trash2,
  Wand2,
} from "lucide-react";
import { useProjectJobs, isJobRunning } from "@core/client/use-jobs";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_TRANSITION,
  DEFAULT_TRANSITION_MS,
  TRANSITIONS,
  TRANSITION_DURATIONS_MS,
  transitionLabel,
  type ComposableSegment,
  type CompositionInfo,
} from "@core/shared/compose-shared";
import type { StoredShot } from "@core/shared/schemas/storyboard";
import { cn } from "@core/client/utils";

const DURATION_ITEMS = TRANSITION_DURATIONS_MS.map((ms) => ({
  value: ms,
  label: `${(ms / 1000).toFixed(1)} 秒`,
}));

function segmentTitle(segment: ComposableSegment): string {
  return `${segment.sceneSlug || `第${segment.sceneIndex}场`} · 第${segment.index}段`;
}

export default function ComposePage() {
  const { episodeId: id } = useParams<{
    seriesId: string;
    episodeId: string;
  }>();
  const [segments, setSegments] = useState<ComposableSegment[]>([]);
  const [compositions, setCompositions] = useState<CompositionInfo[]>([]);
  const [shotsBySegment, setShotsBySegment] = useState<
    Map<string, StoredShot[]>
  >(new Map());
  const [selected, setSelected] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [transition, setTransition] = useState(DEFAULT_TRANSITION);
  const [transitionMs, setTransitionMs] = useState(DEFAULT_TRANSITION_MS);
  const [loaded, setLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [version, setVersion] = useState(0);
  const initialized = useRef(false);

  const load = useCallback(async () => {
    const [compRes, sbRes] = await Promise.all([
      fetch(`/api/projects/${id}/compositions`),
      fetch(`/api/projects/${id}/storyboard`),
    ]);
    if (!compRes.ok) throw new Error();
    const compData = (await compRes.json()) as {
      segments: ComposableSegment[];
      compositions: CompositionInfo[];
    };
    const sbData = sbRes.ok
      ? ((await sbRes.json()) as {
          scenes?: Array<{
            segments?: Array<{ id: string; shots?: StoredShot[] }>;
          }>;
        })
      : { scenes: [] };
    const shots = new Map<string, StoredShot[]>();
    for (const scene of sbData.scenes ?? []) {
      for (const segment of scene.segments ?? []) {
        shots.set(segment.id, segment.shots ?? []);
      }
    }
    return { ...compData, shots };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await load();
        if (cancelled) return;
        setSegments(data.segments ?? []);
        setCompositions(data.compositions ?? []);
        setShotsBySegment(data.shots);
        if (!initialized.current) {
          const firstWithVideo = (data.segments ?? []).find((s) => s.hasVideo);
          setSelected(
            (data.segments ?? [])
              .filter((s) => s.hasVideo)
              .map((s) => s.segmentId),
          );
          setPreviewId(firstWithVideo?.segmentId ?? null);
          initialized.current = true;
        }
        setLoaded(true);
      } catch {
        if (!cancelled) toast.error("读取合成数据失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    const data = await load();
    setSegments(data.segments ?? []);
    setCompositions(data.compositions ?? []);
    setShotsBySegment(data.shots);
    setSelected((prev) =>
      prev.filter((sid) =>
        (data.segments ?? []).some((s) => s.segmentId === sid && s.hasVideo),
      ),
    );
    setPreviewId((prev) =>
      prev && (data.segments ?? []).some((s) => s.segmentId === prev)
        ? prev
        : ((data.segments ?? []).find((s) => s.hasVideo)?.segmentId ?? null),
    );
  }, [load]);

  const { jobs } = useProjectJobs(id, (job) => {
    // 分镜相关任务会增删段落，合成列表也要跟着刷新。
    if (
      job.kind === "compose" ||
      job.kind === "script-to-storyboard" ||
      job.kind === "script-to-assets" ||
      job.kind === "story-to-script" ||
      job.kind === "anchor" ||
      job.kind === "repair"
    ) {
      refresh();
    }
  });
  const running = isJobRunning(jobs, "compose");
  const busy = exporting || running;

  function toggle(segmentId: string) {
    setSelected((prev) =>
      prev.includes(segmentId)
        ? prev.filter((sid) => sid !== segmentId)
        : [...prev, segmentId],
    );
  }

  function move(segmentId: string, direction: -1 | 1) {
    setSelected((prev) => {
      const from = prev.indexOf(segmentId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  async function compose() {
    if (selected.length === 0) {
      toast.error("请至少选择一个段落");
      return;
    }
    setExporting(true);
    try {
      const res = await fetch(`/api/projects/${id}/compositions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segmentIds: selected, transition, transitionMs }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "合成失败");
      if (data?.compositions) {
        setCompositions(data.compositions as CompositionInfo[]);
      } else {
        await refresh();
      }
      setVersion((v) => v + 1);
      toast.success("合成完成");
    } catch (error) {
      toast.error((error as Error).message);
      await refresh();
    } finally {
      setExporting(false);
    }
  }

  async function removeComposition(compositionId: string) {
    if (!window.confirm("确定删除该成片？文件会一并删除。")) return;
    try {
      const res = await fetch(
        `/api/projects/${id}/compositions/${compositionId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      await refresh();
      toast.success("已删除");
    } catch {
      toast.error("删除失败");
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载中…
      </div>
    );
  }

  const withVideo = segments.filter((s) => s.hasVideo).length;
  const preview = segments.find((s) => s.segmentId === previewId) ?? null;
  const previewOrder = previewId ? selected.indexOf(previewId) : -1;
  const previewShots = previewId ? shotsBySegment.get(previewId) ?? [] : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-block-pink p-5">
        <div>
          <h2 className="text-base font-medium">合成</h2>
          <p className="text-sm text-muted-foreground">
            选择并排序已回传的段落，统一分辨率/帧率后拼接导出成片。
          </p>
        </div>
        <Button onClick={compose} disabled={busy || selected.length === 0}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Wand2 className="size-4" />
          )}
          合成导出
        </Button>
      </div>

      {segments.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            还没有分镜段落，请先在「分镜」页生成并回传视频。
          </CardContent>
        </Card>
      )}

      {segments.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                转场设置
                <span className="text-xs font-normal text-muted-foreground">
                  已选 {selected.length} / 可合成 {withVideo}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">转场方式</span>
                <Select
                  value={transition}
                  onValueChange={(value) => setTransition(value as string)}
                  items={TRANSITIONS}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSITIONS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">转场时长</span>
                <Select
                  value={transitionMs}
                  onValueChange={(value) => setTransitionMs(value as number)}
                  items={DURATION_ITEMS}
                  disabled={transition === "none"}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATION_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <p className="text-xs text-muted-foreground">
                硬切不消耗时长；其余转场会让相邻两段重叠，成片总时长相应缩短。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                预览
                {preview ? (
                  <>
                    <span className="text-sm font-normal">
                      {segmentTitle(preview)}
                    </span>
                    {previewOrder >= 0 && (
                      <Badge variant="secondary">
                        第 {previewOrder + 1} 段
                      </Badge>
                    )}
                  </>
                ) : (
                  <span className="text-sm font-normal text-muted-foreground">
                    点击下方片段预览
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {preview?.hasVideo ? (
                <video
                  key={`${preview.segmentId}-${version}`}
                  controls
                  src={`/api/projects/${id}/segments/${preview.segmentId}/video`}
                  className="max-h-80 w-full rounded-md bg-black"
                />
              ) : (
                <div className="flex min-h-48 items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground">
                  {preview ? "该段尚未回传视频" : "暂无可预览片段"}
                </div>
              )}
              <div className="flex flex-col gap-2 text-sm">
                {preview ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>目标 {(preview.targetMs / 1000).toFixed(1)}s</span>
                      <span>·</span>
                      <span>{previewShots.length} 镜</span>
                      {preview.hardCut && (
                        <Badge variant="secondary" className="text-[10px]">
                          硬切
                        </Badge>
                      )}
                    </div>
                    {previewShots.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        暂无分镜详情。
                      </p>
                    )}
                    {previewShots.map((shot, i) => (
                      <div
                        key={shot.id}
                        className="flex flex-col gap-1 rounded-lg border p-2.5"
                      >
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            镜 {i + 1}
                          </span>
                          <span>{(shot.durationMs / 1000).toFixed(1)}s</span>
                        </div>
                        {shot.action && <p className="leading-6">{shot.action}</p>}
                        {shot.dialogue.length > 0 && (
                          <div className="leading-6">
                            <span className="text-muted-foreground">台词：</span>
                            {shot.dialogue.map((line, li) => (
                              <span key={li} className="block">
                                {line.character ? `${line.character}：` : ""}「
                                {line.text}」
                              </span>
                            ))}
                          </div>
                        )}
                        {shot.expression && (
                          <p className="text-xs text-muted-foreground">
                            表情：{shot.expression}
                          </p>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    从下方列表点选一段，这里会显示该段视频与分镜内容。
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>导出记录（{compositions.length}）</CardTitle>
        </CardHeader>
        <CardContent>
          {compositions.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有导出成片。</p>
          ) : (
            <div className="flex h-80 flex-col gap-3 overflow-y-auto pr-1">
              {compositions.map((composition) => (
                <div key={composition.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge
                      variant={
                        composition.status === "ready"
                          ? "default"
                          : composition.status === "running"
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {composition.status === "ready"
                        ? "已完成"
                        : composition.status === "running"
                          ? "合成中"
                          : "失败"}
                    </Badge>
                    <span>
                      {composition.segmentIds.length} 段 ·{" "}
                      {transitionLabel(composition.transition)} ·{" "}
                      {(composition.transitionMs / 1000).toFixed(1)}s
                    </span>
                    {composition.durationMs != null && (
                      <span className="text-xs text-muted-foreground">
                        成片 {(composition.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(composition.createdAt).toLocaleString()}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => removeComposition(composition.id)}
                      title="删除成片"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                  {composition.status === "failed" && composition.error && (
                    <p className="mt-1.5 text-xs text-destructive">
                      {composition.error}
                    </p>
                  )}
                  {composition.status === "ready" && composition.hasExport && (
                    <div className="mt-2 flex flex-col gap-2">
                      <video
                        key={version}
                        controls
                        src={`/api/projects/${id}/compositions/${composition.id}/video`}
                        className="max-h-64 w-full rounded-md bg-black"
                      />
                      <a
                        href={`/api/projects/${id}/compositions/${composition.id}/video?download=1`}
                        download
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "w-fit",
                        )}
                      >
                        <Download className="size-3.5" />
                        下载成片
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {segments.length > 0 && (
        <div className="sticky bottom-0 z-30 -mx-4 border-t bg-background px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 pb-2">
            <span className="text-sm font-medium">
              段落列表（{segments.length}）
            </span>
            <span className="text-xs text-muted-foreground">点击切换预览</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {segments.map((segment) => {
              const order = selected.indexOf(segment.segmentId);
              const isSelected = order >= 0;
              const active = previewId === segment.segmentId;
              return (
                <div
                  key={segment.segmentId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setPreviewId(segment.segmentId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPreviewId(segment.segmentId);
                    }
                  }}
                  className={cn(
                    "flex w-44 shrink-0 cursor-pointer flex-col gap-1.5 rounded-lg border p-2 transition-colors",
                    active
                      ? "border-foreground/40 bg-muted/50"
                      : "hover:bg-muted/30",
                    !segment.hasVideo && "opacity-60",
                  )}
                >
                  <div className="relative aspect-video w-full overflow-hidden rounded bg-black">
                    {segment.hasVideo ? (
                      <video
                        src={`/api/projects/${id}/segments/${segment.segmentId}/video#t=0.1`}
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
                    {isSelected && (
                      <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                        {order + 1}
                      </span>
                    )}
                    {active && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <Play className="size-6 text-white" />
                      </span>
                    )}
                  </div>
                  <span className="truncate text-sm font-medium">
                    {segmentTitle(segment)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    目标 {(segment.targetMs / 1000).toFixed(1)}s
                    {segment.hardCut && " · 硬切"}
                  </span>
                  <div
                    className="flex items-center justify-between gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="size-4 accent-foreground"
                        checked={isSelected}
                        disabled={!segment.hasVideo}
                        onChange={() => toggle(segment.segmentId)}
                        title="加入合成"
                      />
                      {segment.hasVideo ? "已回传" : "未回传"}
                    </label>
                    {isSelected && (
                      <span className="flex items-center gap-0.5">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          disabled={order === 0}
                          onClick={() => move(segment.segmentId, -1)}
                          title="上移"
                        >
                          <ChevronUp className="size-3" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          disabled={order === selected.length - 1}
                          onClick={() => move(segment.segmentId, 1)}
                          title="下移"
                        >
                          <ChevronDown className="size-3" />
                        </Button>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
