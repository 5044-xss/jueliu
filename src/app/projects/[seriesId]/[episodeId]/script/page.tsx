"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useProjectJobs, isJobRunning } from "@/lib/use-jobs";
import { Elapsed } from "@/components/elapsed";
import { CopyButton } from "@/components/copy-button";
import type { StoredScript } from "@/lib/script";

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
  const [generating, setGenerating] = useState(false);
  const [extra, setExtra] = useState("");

  const load = useCallback(async () => {
    const data = await fetch(`/api/projects/${id}/script`)
      .then((r) => r.json())
      .catch(() => null);
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
      } catch {
        if (!cancelled) toast.error("读取剧本失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const { jobs } = useProjectJobs(id, (job) => {
    if (job.kind !== "story-to-script" || job.status === "running") return;
    load().then(setScript);
  });

  const running = isJobRunning(jobs, "story-to-script");
  const runningJob =
    jobs.find((j) => j.kind === "story-to-script" && j.status === "running") ??
    null;
  const busy = generating || running;

  async function generate() {
    if (
      script &&
      !window.confirm(
        "重新生成将覆盖当前剧本，并清空下游的「资产」和「分镜」，确定继续？",
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
    if (!window.confirm("确定清空剧本？")) return;
    await fetch(`/api/projects/${id}/script`, { method: "DELETE" });
    setScript(null);
    toast.success("已清空");
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载中…
      </div>
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
          <Button onClick={generate} disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {script ? "重新生成" : "生成剧本"}
          </Button>
        </div>
      </div>

      {!script && (
        <Card>
          <CardHeader>
            <CardTitle>额外要求（可选）</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="例如：控制在 5 场内；加强喜剧节奏；避免血腥描写。"
              className="min-h-[90px]"
            />
          </CardContent>
        </Card>
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
