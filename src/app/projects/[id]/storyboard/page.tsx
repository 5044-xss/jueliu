"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { GenerationDialog } from "@/components/generation-dialog";
import { SegmentVideo } from "@/components/segment-video";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type {
  StoredSceneStoryboard,
  StoredSegment,
  StoredShot,
} from "@/lib/schemas/storyboard";
import type { ContinuityWarning } from "@/lib/continuity";

const RULE_LABELS: Record<string, string> = {
  axis180: "不跨轴线 (180°)",
  eyelineMatch: "视线匹配",
  lightingContinuity: "光线连续",
  focalLogic: "焦段逻辑",
  wardrobeProp: "服装/道具连续",
  blockingLock: "站位锁定",
  actionMatch: "动作衔接",
  firstFrameAnchor: "跨段首尾帧接续",
};

function ShotView({
  projectId,
  shot,
}: {
  projectId: string;
  shot: StoredShot;
}) {
  const camera = shot.camera;
  const cameraText = [
    camera.shotSize,
    camera.focal,
    camera.angle,
    camera.movement,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">镜{shot.index + 1}</span>
        <span className="text-xs text-muted-foreground">
          {(shot.durationMs / 1000).toFixed(1)}s{cameraText && ` · ${cameraText}`}
        </span>
      </div>
      {shot.lighting && (
        <p className="text-xs text-muted-foreground">光线：{shot.lighting}</p>
      )}
      {shot.action && <p className="leading-6">{shot.action}</p>}
      {shot.dialogue && (
        <p className="leading-6">
          <span className="text-muted-foreground">台词：</span>
          「{shot.dialogue}」
        </p>
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

function SegmentCard({
  projectId,
  segment,
  nextSegmentId,
}: {
  projectId: string;
  segment: StoredSegment;
  nextSegmentId?: string | null;
}) {
  const [open, setOpen] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const total = segment.shots.reduce((a, s) => a + s.durationMs, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </Button>
          <span>段 {segment.index}</span>
          <Badge variant="secondary">{segment.shots.length} 镜</Badge>
          <span className="text-xs font-normal text-muted-foreground">
            {(total / 1000).toFixed(1)}s / 目标 {(segment.targetMs / 1000).toFixed(1)}s
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Button size="xs" onClick={() => setDialogOpen(true)}>
              <Wand2 className="size-3" />
              第三方生成
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="grid gap-2">
          {segment.shots.map((shot) => (
            <ShotView key={shot.id} projectId={projectId} shot={shot} />
          ))}
          <SegmentVideo
            projectId={projectId}
            segmentId={segment.id}
            nextSegmentId={nextSegmentId}
          />
        </CardContent>
      )}
      <GenerationDialog
        projectId={projectId}
        segmentId={segment.id}
        segmentLabel={`第${segment.index}段`}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </Card>
  );
}

export default function StoryboardPage() {
  const { id } = useParams<{ id: string }>();
  const [scenes, setScenes] = useState<StoredSceneStoryboard[]>([]);
  const [warnings, setWarnings] = useState<ContinuityWarning[]>([]);
  const [rules, setRules] = useState<Record<string, boolean>>({});
  const [hasScript, setHasScript] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [extra, setExtra] = useState("");

  const load = useCallback(async () => {
    const [sb, cont, script] = await Promise.all([
      fetch(`/api/projects/${id}/storyboard`).then((r) => r.json()),
      fetch(`/api/projects/${id}/continuity`).then((r) => r.json()),
      fetch(`/api/projects/${id}/script`).then((r) => r.json()),
    ]);
    return {
      scenes: (sb.scenes ?? []) as StoredSceneStoryboard[],
      warnings: (sb.warnings ?? []) as ContinuityWarning[],
      rules: (cont.rules ?? {}) as Record<string, boolean>,
      hasScript: Boolean(script.script),
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
        setRules(data.rules);
        setHasScript(data.hasScript);
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
    setRules(data.rules);
  }

  async function generate() {
    if (
      scenes.length > 0 &&
      !window.confirm("重新生成将覆盖现有分镜，确定继续？")
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

  async function toggleRule(key: string) {
    const next = { ...rules, [key]: !rules[key] };
    setRules(next);
    try {
      const res = await fetch(`/api/projects/${id}/continuity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: next }),
      });
      const data = await res.json();
      setWarnings(data.warnings ?? []);
    } catch {
      toast.error("保存规则失败");
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载中…
      </div>
    );
  }

  const orderedIds = scenes.flatMap((s) => s.segments.map((seg) => seg.id));
  const nextById = new Map<string, string | null>();
  orderedIds.forEach((sid, i) =>
    nextById.set(sid, orderedIds[i + 1] ?? null),
  );

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
          {scenes.length > 0 && (
            <Button variant="outline" onClick={clear} disabled={generating}>
              <Trash2 className="size-4" />
              清空
            </Button>
          )}
          <Button onClick={generate} disabled={generating || !hasScript}>
            {generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {scenes.length ? "重新生成" : "生成分镜"}
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

      {hasScript && scenes.length === 0 && !generating && (
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

      <Card>
        <CardHeader>
          <CardTitle>连续性规则</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.keys(RULE_LABELS).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleRule(key)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                rules[key]
                  ? "border-foreground/30 bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {RULE_LABELS[key]}
            </button>
          ))}
        </CardContent>
      </Card>

      {generating && (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在调用 LLM 生成分镜，请稍候…
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
                    第{ w.sceneIndex }场
                    {w.segmentIndex !== undefined ? `·第${w.segmentIndex}段` : ""}
                    ：
                  </span>
                  {w.message}
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {!generating &&
        scenes
          .filter((s) => s.segments.length > 0)
          .map((scene) => (
            <section key={scene.sceneId} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">
                  {scene.sceneSlug || `第${scene.sceneIndex}场`}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {scene.location}
                </span>
              </div>
              {scene.blocking && (
                <div className="rounded-lg border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                  <p>
                    轴线：{scene.blocking.axis.from} ↔ {scene.blocking.axis.to}
                    ｜镜头侧：{scene.blocking.cameraSide === "left" ? "左" : "右"}
                  </p>
                  <p>
                    站位：
                    {scene.blocking.nodes
                      .map(
                        (n) =>
                          `${n.label}(${n.pos.x.toFixed(2)},${n.pos.y.toFixed(2)}) 朝${Math.round(n.facing)}°`,
                      )
                      .join("；") || "无"}
                  </p>
                </div>
              )}
              <div className="grid gap-3">
                {scene.segments.map((segment) => (
                  <SegmentCard
                    key={segment.id}
                    projectId={id}
                    segment={segment}
                    nextSegmentId={nextById.get(segment.id) ?? null}
                  />
                ))}
              </div>
              <Separator />
            </section>
          ))}
    </div>
  );
}
