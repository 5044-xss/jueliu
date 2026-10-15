"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export default function StoryPage() {
  const { episodeId: id } = useParams<{
    seriesId: string;
    episodeId: string;
  }>();
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${id}/story`)
      .then((r) => r.json())
      .then((data) => {
        setContent(data.content ?? "");
        setLoaded(true);
      })
      .catch(() => toast.error("读取故事失败"));
  }, [id]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${id}/story`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error();
      setDirty(false);
      toast.success("故事已保存");
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(false);
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
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-block-lilac p-5">
        <div>
          <h2 className="text-base font-medium">故事</h2>
          <p className="text-sm text-muted-foreground">
            写下原始故事，下一步将据此生成结构化剧本。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {content.length} 字{dirty ? " · 未保存" : ""}
          </span>
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            保存
          </Button>
        </div>
      </div>
      <Card>
        <CardContent>
          <Textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            placeholder="例如：城市广场的巨型屏幕突然亮起，沈清和当众宣布……"
            className="min-h-[420px] resize-y text-sm leading-7"
          />
        </CardContent>
      </Card>
    </div>
  );
}
