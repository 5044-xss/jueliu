"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { LoadErrorState, LoadingState } from "@/components/load-state";
import { useProjectJobs, isJobRunning } from "@core/client/use-jobs";
import { Elapsed } from "@/components/elapsed";
import { CopyButton } from "@/components/copy-button";
import { LlmKeyNotice, useLlmConfigured } from "@/components/llm-notice";
import { useConfirm } from "@/components/confirm-dialog";
import { describeCascade, fetchCascadeImpact } from "@/lib/impact";
import { readError } from "@/lib/http";
import type { StoredScript } from "@core/shared/script";

function scriptToText(script: StoredScript): string {
  const lines: string[] = [];
  if (script.title) lines.push(script.title, "");
  for (const scene of script.scenes) {
    const meta = [
      scene.location,
      scene.timeOfDay,
      scene.interiorExterior,
    ].filter(Boolean);
    lines.push(
      `${scene.slug || `第${scene.index}场`}${meta.length ? ` ${meta.join(" · ")}` : ""}`,
    );
    if (scene.characters.length > 0) {
      lines.push(`人物：${scene.characters.join("、")}`);
    }
    if (scene.summary) lines.push(scene.summary);
    lines.push("");
    for (const beat of scene.beats) {
      if (beat.type === "dialogue") {
        lines.push(`${beat.character || "旁白"}：「${beat.text}」`);
      } else {
        lines.push(beat.text);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export default function ScriptPage() {
  const { episodeId: id } = useParams<{
    seriesId: string;
    episodeId: string;
  }>();
  const [script, setScript] = useState<StoredScript | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [extra, setExtra] = useState("");
  const [sessionId, setSessionId] = useState(id);

  if (sessionId !== id) {
    setSessionId(id);
    setLoaded(false);
    setLoadError(null);
  }

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}/script`);
    if (!res.ok) throw new Error(await readError(res, "读取剧本失败"));
    const data = await res.json();
    return (data?.script ?? null) as StoredScript | null;
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await load();
        if (cancelled) return;
        setScript(result);
        setLoaded(true);
      } catch (error) {
        if (!cancelled) {
          setLoadError((error as Error).message || "读取剧本失败");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, reloadKey]);

  const { jobs } = useProjectJobs(id, (job) => {
    if (job.kind !== "story-to-script" || job.status === "running") return;
    load().then(setScript);
  });

  const running = isJobRunning(jobs, "story-to-script");
  const runningJob =
    jobs.find((j) => j.kind === "story-to-script" && j.status === "running") ??
    null;
  const busy = generating || running;
  const llmMissing = useLlmConfigured() === "missing";
  const confirm = useConfirm();

  async function generate() {
    if (script) {
      const impact = await fetchCascadeImpact(id).catch(() => null);
      const detail = impact
        ? describeCascade(impact, { assets: true, storyboard: true })
        : "";
      if (
        !(await confirm({
          title: "重新生成剧本",
          description: `重新生成将覆盖当前剧本${
            detail
              ? `，并清空下游：${detail}`
              : "，并清空下游的「资产」和「分镜」"
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
          skillId: "story-to-script",
          projectId: id,
          input: { extraInstructions: extra },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setScript(data.result);
      toast.success("剧本已生成");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function clear() {
    if (
      !(await confirm({
        title: "清空剧本",
        description:
          "确定清空当前剧本？该集已有的资产与分镜也会一并清空，且不可恢复。",
        confirmText: "清空并删除下游",
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/projects/${id}/script`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readError(res, "清空失败"));
      setScript(null);
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
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-block-lime p-5">
        <div>
          <h2 className="text-base font-medium">剧本</h2>
          <p className="text-sm text-muted-foreground">
            由故事生成结构化分场剧本，可反复重新生成。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {script && (
            <CopyButton text={scriptToText(script)} label="复制剧本" />
          )}
          {script && (
            <Button variant="outline" onClick={clear} disabled={busy}>
              <Trash2 className="size-4" />
              清空
            </Button>
          )}
          <Button onClick={generate} disabled={busy || llmMissing}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {script ? "重新生成" : "生成剧本"}
          </Button>
        </div>
      </div>

      {llmMissing && <LlmKeyNotice />}

      {!busy && (
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
            <Textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="例如：控制在 5 场内；加强喜剧节奏；避免血腥描写。"
              className="min-h-[90px]"
            />
          </div>
        </details>
      )}

      {busy && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在调用 LLM 生成剧本，请稍候…（可切换页面，完成后会自动刷新）
            <Elapsed startedAt={runningJob?.startedAt} />
          </CardContent>
        </Card>
      )}

      {script && !busy && (
        <>
          {script.title && (
            <h3 className="text-lg font-semibold">{script.title}</h3>
          )}
          <div className="grid gap-4">
            {script.scenes.map((scene) => (
              <Card key={scene.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <span>{scene.slug || `第${scene.index}场`}</span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {scene.location} · {scene.timeOfDay}
                      {scene.interiorExterior && ` · ${scene.interiorExterior}`}
                    </span>
                  </CardTitle>
                  {scene.characters.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {scene.characters.map((c) => (
                        <Badge key={c} variant="secondary">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {scene.summary && (
                    <p className="text-sm text-muted-foreground">
                      {scene.summary}
                    </p>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {scene.beats.map((beat, i) => (
                      <div key={i} className="text-sm leading-6">
                        {beat.type === "dialogue" ? (
                          <p>
                            <span className="font-medium">
                              {beat.character || "旁白"}：
                            </span>
                            <span>「{beat.text}」</span>
                          </p>
                        ) : (
                          <p className="text-muted-foreground">{beat.text}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
