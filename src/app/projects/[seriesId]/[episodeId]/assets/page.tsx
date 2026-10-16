"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  AddToLibraryButton,
  ImageSourceButton,
} from "@/components/asset-library";
import { PreviewImage } from "@/components/preview-image";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { composeAssetViewPrompt } from "@core/shared/asset-prompt";
import { cn } from "cn";
import { useProjectJobs, isJobRunning } from "@core/client/use-jobs";
import { Elapsed } from "@/components/elapsed";
import type { StoredAsset, StoredView } from "@core/shared/schemas/assets";

const TYPE_LABEL: Record<StoredAsset["type"], string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

const PROMPT_LABEL: Record<StoredAsset["type"], string> = {
  character: "角色提示词（锚点：脸型/发型/体型等不变项）",
  scene: "场景提示词（锚点：空间/陈设/材质/光线）",
  prop: "道具提示词（锚点：材质/颜色/尺寸）",
};

// 变体在三种资产里的叫法不同（角色=妆造；场景=时段/光照；道具=形态）。
const VARIANT_TERM: Record<StoredAsset["type"], string> = {
  character: "妆造",
  scene: "时段 / 光照",
  prop: "变体",
};
const VARIANT_ADD_LABEL: Record<StoredAsset["type"], string> = {
  character: "新增妆造",
  scene: "新增时段",
  prop: "新增变体",
};
const VARIANT_HINT: Record<StoredAsset["type"], string> = {
  character: "妆造会参考基础造型图，只需补充服装/状态变化（例如：酒吧装 / 礼服装）。",
  scene:
    "同一地点的不同时间/天气作为独立变体；每个时段出一组空镜（全景 + 俯瞰，含正反打时再加反打）。",
  prop: "同一道具的不同形态作为变体（通常只用一个「默认」）。",
};
const VARIANT_NAME_PH: Record<StoredAsset["type"], string> = {
  character: "妆造名（如 日常装）",
  scene: "时段名（如 夜晚）",
  prop: "形态名（如 默认）",
};
const VARIANT_PROMPT_PH: Record<StoredAsset["type"], string> = {
  character: "本妆造相对锚点的服装/状态变化",
  scene: "该时段的光线/氛围变化（可留空）",
  prop: "形态描述（可留空）",
};

async function post(url: string, body?: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers:
      body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || "操作失败");
  }
  return res.json().catch(() => null);
}

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

function firstView(asset: StoredAsset, variantId?: string): StoredView | null {
  const variant = variantId
    ? asset.variants.find((v) => v.id === variantId)
    : asset.variants[0];
  return variant?.views[0] ?? null;
}

interface ViewDraft {
  id?: string;
  label: string;
  imagePath: string | null;
}

interface VariantDraft {
  id?: string;
  label: string;
  prompt: string;
  views: ViewDraft[];
}

function AssetEditDialog({
  projectId,
  seriesId,
  asset,
  style,
  onClose,
  onSaved,
}: {
  projectId: string;
  seriesId: string;
  asset: StoredAsset;
  style: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const term = VARIANT_TERM[asset.type];
  // 只有场景/道具需要手动补视角（如场景的「反打」）；角色的妆造不需要。
  const canAddView = asset.type !== "character";
  const [name, setName] = useState(asset.name);
  const [basePrompt, setBasePrompt] = useState(asset.basePrompt);
  const [variants, setVariants] = useState<VariantDraft[]>(() =>
    asset.variants.map((v) => ({
      id: v.id,
      label: v.label,
      prompt: v.prompt,
      views: v.views.map((vw) => ({
        id: vw.id,
        label: vw.label,
        imagePath: vw.imagePath,
      })),
    })),
  );
  const [deletedVariantIds, setDeletedVariantIds] = useState<string[]>([]);
  const [deletedViewIds, setDeletedViewIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [imgVersion, setImgVersion] = useState(0);

  function patchVariant(vi: number, patch: Partial<VariantDraft>) {
    setVariants((prev) =>
      prev.map((v, i) => (i === vi ? { ...v, ...patch } : v)),
    );
  }
  function patchView(vi: number, i: number, patch: Partial<ViewDraft>) {
    setVariants((prev) =>
      prev.map((v, idx) =>
        idx === vi
          ? {
              ...v,
              views: v.views.map((w, j) => (j === i ? { ...w, ...patch } : w)),
            }
          : v,
      ),
    );
  }
  function removeVariant(vi: number) {
    // 副作用放在 updater 外：updater 在 StrictMode/并发下可能被执行多次。
    const target = variants[vi];
    if (target?.id) setDeletedVariantIds((ids) => [...ids, target.id as string]);
    setVariants((prev) => prev.filter((_, i) => i !== vi));
  }
  function removeView(vi: number, i: number) {
    const target = variants[vi]?.views[i];
    if (target?.id) setDeletedViewIds((ids) => [...ids, target.id as string]);
    setVariants((prev) =>
      prev.map((v, idx) =>
        idx === vi
          ? { ...v, views: v.views.filter((_, j) => j !== i) }
          : v,
      ),
    );
  }
  function addVariant() {
    setVariants((prev) => [...prev, { label: "", prompt: "", views: [] }]);
  }
  function addView(vi: number) {
    setVariants((prev) =>
      prev.map((v, idx) =>
        idx === vi
          ? {
              ...v,
              views: [...v.views, { label: "", imagePath: null }],
            }
          : v,
      ),
    );
  }

  async function save() {
    if (!name.trim()) {
      toast.error("请填写资产名");
      return;
    }
    setSaving(true);
    try {
      await post(
        `/api/projects/${projectId}/assets/${asset.id}`,
        { name: name.trim(), basePrompt },
        "PATCH",
      );
      for (const v of variants) {
        const vLabel = v.label.trim() || term;
        if (v.id) {
          await post(
            `/api/projects/${projectId}/assets/variants/${v.id}`,
            { label: vLabel, prompt: v.prompt },
            "PATCH",
          );
          for (const vw of v.views) {
            const body = { label: vw.label.trim() || "视角" };
            if (vw.id) {
              await post(
                `/api/projects/${projectId}/assets/views/${vw.id}`,
                body,
                "PATCH",
              );
            } else {
              await post(
                `/api/projects/${projectId}/assets/variants/${v.id}/views`,
                body,
              );
            }
          }
        } else {
          // 新变体由后端自动补默认视角，保存后可再次编辑其视角。
          await post(`/api/projects/${projectId}/assets/${asset.id}/variants`, {
            label: vLabel,
            prompt: v.prompt,
          });
        }
      }
      for (const vid of deletedViewIds) {
        await post(
          `/api/projects/${projectId}/assets/views/${vid}`,
          undefined,
          "DELETE",
        );
      }
      for (const vid of deletedVariantIds) {
        await post(
          `/api/projects/${projectId}/assets/variants/${vid}`,
          undefined,
          "DELETE",
        );
      }
      toast.success("已保存");
      onSaved();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>编辑资产 · {asset.name}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="asset-name">资产名</Label>
              <Input
                id="asset-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="asset-prompt">{PROMPT_LABEL[asset.type]}</Label>
              <Textarea
                id="asset-prompt"
                value={basePrompt}
                onChange={(e) => setBasePrompt(e.target.value)}
                placeholder="只写不变项，不要写服装/时段等变化项（那些放变体里）。"
                className="min-h-[100px]"
              />
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">{term}</h4>
              <Button size="sm" variant="outline" onClick={addVariant}>
                <Plus className="size-4" />
                {VARIANT_ADD_LABEL[asset.type]}
              </Button>
            </div>

            {variants.length === 0 && (
              <p className="text-sm text-muted-foreground">{VARIANT_HINT[asset.type]}</p>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              {variants.map((v, vi) => (
                <div
                  key={v.id ?? `new-${vi}`}
                  className="flex flex-col gap-2 rounded-lg border p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={v.label}
                      onChange={(e) => patchVariant(vi, { label: e.target.value })}
                      placeholder={VARIANT_NAME_PH[asset.type]}
                      className="h-8"
                    />
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => removeVariant(vi)}
                      title={`删除${term}`}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                  <Textarea
                    value={v.prompt}
                    onChange={(e) => patchVariant(vi, { prompt: e.target.value })}
                    placeholder={VARIANT_PROMPT_PH[asset.type]}
                    rows={2}
                  />

                  {/* 该变体下的全部视角（全景/俯瞰/反打…），半宽两列 + 提示词可折叠 */}
                  <div className="mt-1 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        参考图视角（{v.views.length}）
                      </span>
                      {v.id && canAddView && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => addView(vi)}
                        >
                          <Plus className="size-3" />
                          添加视角
                        </Button>
                      )}
                    </div>

                    {!v.id && (
                      <p className="text-xs text-muted-foreground">
                        保存后会自动生成默认视角（角色：四视图；场景：全景+俯瞰），再进来即可补充。
                      </p>
                    )}

                    <div className="grid gap-2">
                      {v.views.map((vw, i) => (
                        <div
                          key={vw.id ?? `newview-${vi}-${i}`}
                          className="flex flex-col gap-1.5 rounded-md border bg-muted/20 p-2"
                        >
                          <div className="flex items-center gap-1.5">
                            <Input
                              value={vw.label}
                              onChange={(e) =>
                                patchView(vi, i, { label: e.target.value })
                              }
                              placeholder="视角名（全景 / 俯瞰 / 反打 / 三视图）"
                              className="h-7 text-xs"
                            />
                            <CopyButton
                              text={composeAssetViewPrompt({
                                type: asset.type,
                                viewLabel: vw.label,
                                basePrompt,
                                variantPrompt: v.prompt,
                                style,
                              })}
                            />
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => removeView(vi, i)}
                              title="删除视角"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>

                          {vw.id ? (
                            <>
                              <PreviewImage
                                src={`/api/projects/${projectId}/assets/views/${vw.id}/image?v=${imgVersion}`}
                                alt={vw.label || "视角"}
                                className="h-24 w-full rounded object-contain"
                              />
                              <div className="flex items-center gap-1">
                                <ImageSourceButton
                                  projectId={projectId}
                                  seriesId={seriesId}
                                  viewId={vw.id}
                                  onChanged={() => setImgVersion((n) => n + 1)}
                                />
                                <AddToLibraryButton
                                  projectId={projectId}
                                  seriesId={seriesId}
                                  viewId={vw.id}
                                />
                              </div>
                            </>
                          ) : (
                            <div className="flex h-24 items-center justify-center rounded bg-muted text-[11px] text-muted-foreground">
                              保存后可回传图片
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AssetsPage() {
  const { seriesId, episodeId: id } = useParams<{
    seriesId: string;
    episodeId: string;
  }>();
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [hasScript, setHasScript] = useState(false);
  const [style, setStyle] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [extra, setExtra] = useState("");
  const [version, setVersion] = useState(0);
  const [editAsset, setEditAsset] = useState<StoredAsset | null>(null);
  const [activeType, setActiveType] =
    useState<StoredAsset["type"]>("character");

  const load = useCallback(async () => {
    const [assetsRes, scriptRes, projectRes] = await Promise.all([
      fetch(`/api/projects/${id}/assets`).then((r) => r.json()),
      fetch(`/api/projects/${id}/script`).then((r) => r.json()),
      fetch(`/api/projects/${id}`).then((r) => r.json()),
    ]);
    return {
      assets: (assetsRes.assets ?? []) as StoredAsset[],
      hasScript: Boolean(scriptRes.script),
      style: (projectRes.project?.style ?? "") as string,
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
        setStyle(data.style);
        setLoaded(true);
      } catch {
        if (!cancelled) toast.error("读取资产失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const { jobs } = useProjectJobs(id, (job) => {
    // 剧本重生成会清空资产，资产重生成会覆盖资产，两者都要刷新页面数据。
    if (job.status === "running") return;
    if (job.kind !== "script-to-assets" && job.kind !== "story-to-script") return;
    load().then((data) => {
      setAssets(data.assets);
      setStyle(data.style);
      setVersion((v) => v + 1);
    });
  });

  const running = isJobRunning(jobs, "script-to-assets");
  const runningJob =
    jobs.find((j) => j.kind === "script-to-assets" && j.status === "running") ??
    null;
  const busy = generating || running;

  async function generate() {
    if (
      assets.length > 0 &&
      !window.confirm(
        "重新生成将覆盖现有资产（含已回传图片），并清空下游的「分镜」，确定继续？",
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

  async function restoreAll() {
    if (!window.confirm("将所有资产还原为生成时的默认值？已回传的图片不受影响。"))
      return;
    try {
      await post(`/api/projects/${id}/assets/restore`, {});
      await refresh();
      toast.success("已全部还原");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function ensureViews() {
    try {
      const data = await post(`/api/projects/${id}/assets/ensure-views`, {});
      if (data?.assets) setAssets(data.assets);
      setVersion((v) => v + 1);
      toast.success(
        data?.changed > 0
          ? `已补全 ${data.changed} 个视角`
          : "已是最新，无需补全",
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载中…
      </div>
    );
  }

  const hasAnyChange = assets.some(
    (a) =>
      (a.originalName !== null && a.name !== a.originalName) ||
      (a.originalBasePrompt !== null && a.basePrompt !== a.originalBasePrompt) ||
      a.variants.some(
        (v) =>
          (v.originalLabel !== null && v.label !== v.originalLabel) ||
          (v.originalPrompt !== null && v.prompt !== v.originalPrompt) ||
          v.views.some(
            (vw) =>
              (vw.originalLabel !== null && vw.label !== vw.originalLabel) ||
              (vw.originalPrompt !== null && vw.prompt !== vw.originalPrompt),
          ),
      ),
  );

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-block-cream p-5">
        <div>
          <h2 className="text-base font-medium">资产</h2>
          <p className="text-sm text-muted-foreground">
            角色：基础造型 + 妆造，每套造型一张四视图（横版 16:9）；场景：每个时段一组空镜（全景 + 俯瞰，含反打）。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {assets.length > 0 && (
            <Button variant="outline" onClick={ensureViews} disabled={busy}>
              <Plus className="size-4" />
              补全默认视角
            </Button>
          )}
          {assets.length > 0 && hasAnyChange && (
            <Button variant="outline" onClick={restoreAll} disabled={busy}>
              <RotateCcw className="size-4" />
              全部还原
            </Button>
          )}
          <Button onClick={generate} disabled={busy || !hasScript}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {assets.length ? "重新生成" : "生成资产"}
          </Button>
        </div>
      </div>

      {!hasScript && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            请先在「剧本」页生成剧本，再生成资产。
          </CardContent>
        </Card>
      )}

      {hasScript && assets.length === 0 && !busy && (
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

      {busy && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在调用 LLM 提取资产，请稍候…（可切换页面，完成后会自动刷新）
            <Elapsed startedAt={runningJob?.startedAt} />
          </CardContent>
        </Card>
      )}

      {!busy && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1 border-b">
            {(["character", "scene", "prop"] as const).map((type) => {
              const count = assets.filter((a) => a.type === type).length;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setActiveType(type)}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                    activeType === type
                      ? "border-foreground font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {TYPE_LABEL[type]}（{count}）
                </button>
              );
            })}
          </div>

          {assets.filter((a) => a.type === activeType).length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                暂无{TYPE_LABEL[activeType]}资产。
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {assets
                .filter((a) => a.type === activeType)
                .map((asset) => {
                  const baseView = firstView(asset);
                  const extraCount = Math.max(asset.variants.length - 1, 0);
                  // 复制/展示 = 内容(锚点+变化) + 构图(代码) + 风格(代码)，改构图立即生效。
                  const displayPrompt = composeAssetViewPrompt({
                    type: asset.type,
                    viewLabel: baseView?.label ?? "",
                    basePrompt: asset.basePrompt,
                    variantPrompt: asset.variants[0]?.prompt,
                    style,
                  });
                  return (
                    <Card key={asset.id} className="border border-border">
                      <CardContent className="flex flex-col gap-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {asset.name}
                            </span>
                            {extraCount > 0 && (
                              <Badge
                                variant="secondary"
                                className="shrink-0 text-[10px]"
                              >
                                {VARIANT_TERM[asset.type]} {extraCount}
                              </Badge>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <CopyButton text={displayPrompt} />
                            <ImageSourceButton
                              projectId={id}
                              seriesId={seriesId}
                              viewId={baseView?.id ?? null}
                              onChanged={refresh}
                            />
                            <AddToLibraryButton
                              projectId={id}
                              seriesId={seriesId}
                              viewId={baseView?.id ?? null}
                            />
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => setEditAsset(asset)}
                              title="编辑"
                            >
                              <MoreHorizontal className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        <p
                          className="line-clamp-3 text-xs leading-5 text-muted-foreground"
                          title={displayPrompt}
                        >
                          {displayPrompt || "（无提示词）"}
                        </p>

                        {baseView?.imagePath ? (
                          <PreviewImage
                            src={`/api/projects/${id}/assets/views/${baseView.id}/image?v=${version}`}
                            alt={asset.name}
                            className="h-44 w-full rounded-md object-contain"
                          />
                        ) : (
                          <div className="flex h-44 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                            未回传图片
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {editAsset && (
        <AssetEditDialog
          key={editAsset.id}
          projectId={id}
          seriesId={seriesId}
          asset={editAsset}
          style={style}
          onClose={() => setEditAsset(null)}
          onSaved={() => {
            setEditAsset(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
