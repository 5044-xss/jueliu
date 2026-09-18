"use client";

import { useEffect, useState } from "react";
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
import type { StoredScript } from "@/lib/script";

export default function ScriptPage() {
  const { id } = useParams<{ id: string }>();
  const [script, setScript] = useState<StoredScript | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [extra, setExtra] = useState("");

  useEffect(() => {
    fetch(`/api/projects/${id}/script`)
      .then((r) => r.json())
      .then((data) => {
        setScript(data.script ?? null);
        setLoaded(true);
      })
      .catch(() => toast.error("读取剧本失败"));
  }, [id]);

  async function generate() {
    if (
      script &&
      !window.confirm("重新生成将覆盖当前剧本及其下游内容，确定继续？")
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
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">剧本</h2>
          <p className="text-sm text-muted-foreground">
            由故事生成结构化分场剧本，可反复重新生成。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {script && (
            <Button variant="outline" onClick={clear} disabled={generating}>
              <Trash2 className="size-4" />
              清空
            </Button>
          )}
          <Button onClick={generate} disabled={generating}>
            {generating ? (
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

      {generating && (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在调用 LLM 生成剧本，请稍候…
          </CardContent>
        </Card>
      )}

      {script && !generating && (
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
