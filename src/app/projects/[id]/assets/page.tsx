"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Copy,
  ImagePlus,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import type { StoredAsset, StoredView } from "@/lib/schemas/assets";

const TYPE_LABEL: Record<StoredAsset["type"], string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("复制失败");
    }
  }
  return (
    <Button size="xs" variant="outline" onClick={copy} disabled={!text}>
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "已复制" : "复制"}
    </Button>
  );
}

function ViewCard({
  projectId,
  view,
  version,
  onChanged,
}: {
  projectId: string;
  view: StoredView;
  version: number;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/projects/${projectId}/assets/views/${view.id}/image`,
        { method: "POST", body: form },
      );
      if (!res.ok) throw new Error();
      toast.success("图片已回传");
      onChanged();
    } catch {
      toast.error("上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeImage() {
    await fetch(`/api/projects/${projectId}/assets/views/${view.id}/image`, {
      method: "DELETE",
    });
    toast.success("已移除图片");
    onChanged();
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline">{view.label}</Badge>
        <div className="flex items-center gap-1">
          <CopyButton text={view.prompt} />
          <Button
            size="xs"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ImagePlus className="size-3" />
            )}
            回传
          </Button>
          {view.imagePath && (
            <Button size="xs" variant="ghost" onClick={removeImage}>
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      </div>
      <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
        {view.prompt || "（无提示词）"}
      </p>
      {view.imagePath && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/projects/${projectId}/assets/views/${view.id}/image?v=${version}`}
          alt={view.label}
          className="max-h-64 w-full rounded-md object-contain"
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
        }}
      />
    </div>
  );
}

export default function AssetsPage() {
  const { id } = useParams<{ id: string }>();
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [hasScript, setHasScript] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [extra, setExtra] = useState("");
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    const [assetsRes, scriptRes] = await Promise.all([
      fetch(`/api/projects/${id}/assets`).then((r) => r.json()),
      fetch(`/api/projects/${id}/script`).then((r) => r.json()),
    ]);
    return {
      assets: (assetsRes.assets ?? []) as StoredAsset[],
      hasScript: Boolean(scriptRes.script),
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await load();
        if (cancelled) return;
        setAssets(data.assets);
        setHasScript(data.hasScript);
        setLoaded(true);
      } catch {
        if (!cancelled) toast.error("读取资产失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function generate() {
    if (
      assets.length > 0 &&
      !window.confirm("重新生成将覆盖现有资产（含已回传图片），确定继续？")
    ) {
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/skills/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId: "script-to-assets",
          projectId: id,
          input: { extraInstructions: extra },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setAssets(data.result);
      setVersion((v) => v + 1);
      toast.success("资产已生成");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function refresh() {
    const data = await load();
    setAssets(data.assets);
    setVersion((v) => v + 1);
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载中…
      </div>
    );
  }

  const grouped = (["character", "scene", "prop"] as const).map((type) => ({
    type,
    items: assets.filter((a) => a.type === type),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">资产</h2>
          <p className="text-sm text-muted-foreground">
            由剧本提取角色 / 场景 / 道具，复制提示词到外部生成图片后回传。
          </p>
        </div>
        <Button onClick={generate} disabled={generating || !hasScript}>
          {generating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {assets.length ? "重新生成" : "生成资产"}
        </Button>
      </div>

      {!hasScript && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            请先在「剧本」页生成剧本，再生成资产。
          </CardContent>
        </Card>
      )}

      {hasScript && assets.length === 0 && !generating && (
        <Card>
          <CardHeader>
            <CardTitle>额外要求（可选）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="例如：主角固定穿深蓝连帽卫衣；场景统一写实电影质感。"
              className="min-h-[80px]"
            />
          </CardContent>
        </Card>
      )}

      {generating && (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在调用 LLM 提取资产，请稍候…
          </CardContent>
        </Card>
      )}

      {!generating &&
        grouped.map(
          (group) =>
            group.items.length > 0 && (
              <section key={group.type} className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {TYPE_LABEL[group.type]}（{group.items.length}）
                </h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  {group.items.map((asset) => (
                    <Card key={asset.id}>
                      <CardHeader>
                        <CardTitle>{asset.name}</CardTitle>
                        <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                          {asset.basePrompt}
                        </p>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-4">
                        {asset.variants.map((variant) => (
                          <div key={variant.id} className="flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">
                                {variant.label}
                              </span>
                              <CopyButton text={variant.prompt} />
                            </div>
                            <Separator />
                            <div className="grid gap-2 sm:grid-cols-2">
                              {variant.views.map((view) => (
                                <ViewCard
                                  key={view.id}
                                  projectId={id}
                                  view={view}
                                  version={version}
                                  onChanged={refresh}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            ),
        )}
    </div>
  );
}
