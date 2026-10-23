"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { LoadErrorState, LoadingState } from "@/components/load-state";
import { setUnsavedGuard } from "@/lib/unsaved-guard";
import { readError } from "@/lib/http";

export default function StoryPage() {
  const { episodeId: id } = useParams<{
    seriesId: string;
    episodeId: string;
  }>();
  const [content, setContent] = useState("");
  const contentRef = useRef("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const queuedRef = useRef(false);
  const [sessionId, setSessionId] = useState(id);

  // 复用同一页面实例切换子集时，先清空上一集的状态，避免旧内容被自动保存到新子集。
  if (sessionId !== id) {
    setSessionId(id);
    setLoaded(false);
    setLoadError(null);
    setDirty(false);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${id}/story`);
        if (!res.ok) throw new Error(await readError(res, "读取故事失败"));
        const data = await res.json();
        if (cancelled) return;
        const next = (data.content ?? "") as string;
        setContent(next);
        contentRef.current = next;
        setDirty(false);
        setLoaded(true);
      } catch (error) {
        if (!cancelled) {
          setLoadError((error as Error).message || "读取故事失败");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  // 有未保存改动时：离开前弹窗确认（标签页/面包屑/顶栏/下一步/切集），并拦截关闭/刷新页面。
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    setUnsavedGuard(() => dirtyRef.current);
    return () => setUnsavedGuard(null);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  async function flush(showToast: boolean) {
    if (savingRef.current) {
      queuedRef.current = true;
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const payload = contentRef.current;
    try {
      const res = await fetch(`/api/projects/${id}/story`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: payload }),
      });
      if (!res.ok) throw new Error(await readError(res, "保存失败"));
      if (contentRef.current === payload) {
        setDirty(false);
      }
      if (showToast) toast.success("故事已保存");
    } catch (error) {
      toast.error((error as Error).message || "保存失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (queuedRef.current) {
        queuedRef.current = false;
        if (contentRef.current !== payload) {
          void flush(false);
        }
      }
    }
  }

  // 停手 1.2 秒后自动保存，避免长时间编辑后忘记点保存。
  useEffect(() => {
    if (!loaded || !dirty) return;
    const timer = window.setTimeout(() => {
      void flush(false);
    }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, dirty, loaded, id]);

  function retry() {
    setLoaded(false);
    setLoadError(null);
    setReloadKey((key) => key + 1);
  }

  if (!loaded) {
    return loadError ? (
      <LoadErrorState message={loadError} onRetry={retry} />
    ) : (
      <LoadingState />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 pb-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl bg-block-lilac p-5">
        <div>
          <h2 className="text-base font-medium">故事</h2>
          <p className="text-sm text-muted-foreground">
            写下原始故事，下一步将据此生成结构化剧本。停手后会自动保存。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {content.length} 字
            {saving
              ? " · 保存中…"
              : dirty
                ? " · 未保存"
                : content
                  ? " · 已保存"
                  : ""}
          </span>
          <Button
            onClick={() => void flush(true)}
            disabled={saving || !dirty}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            保存
          </Button>
        </div>
      </div>

      <Card className="min-h-0 flex-1 border border-border">
        <CardContent className="flex min-h-0 flex-1 flex-col">
          <Textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              contentRef.current = e.target.value;
              setDirty(true);
            }}
            onBlur={() => {
              if (dirtyRef.current) void flush(false);
            }}
            placeholder="例如：城市广场的巨型屏幕突然亮起，沈清和当众宣布……"
            className="h-full min-h-0 resize-none [field-sizing:fixed] text-sm leading-7"
          />
        </CardContent>
      </Card>
    </div>
  );
}
