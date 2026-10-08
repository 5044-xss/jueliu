"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Copy,
  ImagePlus,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PromptEditDialog } from "@/components/prompt-edit-dialog";
import { composeAssetPrompt } from "@/lib/asset-prompt";
import { cn } from "cn";
import { useProjectJobs, isJobRunning } from "@/lib/use-jobs";
import { Elapsed } from "@/components/elapsed";
import type {
  StoredAsset,
  StoredVariant,
  StoredView,
} from "@/lib/schemas/assets";

const TYPE_LABEL: Record<StoredAsset["type"], string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

type EditTarget =
  | {
      kind: "asset";
      assetId: string;
      assetType: StoredAsset["type"];
      name: string;
      basePrompt: string;
      changed: boolean;
    }
  | {
      kind: "variant";
      variantId: string;
      label: string;
      prompt: string;
      changed: boolean;
      assetName: string;
    }
  | {
      kind: "view";
      viewId: string;
      label: string;
      prompt: string;
      changed: boolean;
      variantLabel: string;
    }
  | {
      kind: "newVariant";
      assetId: string;
      assetName: string;
      label: string;
      prompt: string;
      changed: false;
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
  style,
  onChanged,
  onEdit,
}: {
  projectId: string;
  view: StoredView;
  version: number;
  style: string;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const displayPrompt = composeAssetPrompt(view.prompt, style);

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

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline">{view.label}</Badge>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={onEdit}>
            <Pencil className="size-3" />
          </Button>
          <CopyButton text={displayPrompt} />
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
        </div>
      </div>
      <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
        {displayPrompt || "（无提示词）"}
      </p>
      {view.imagePath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/projects/${projectId}/assets/views/${view.id}/image?v=${version}`}
          alt={view.label}
          className="max-h-64 w-full rounded-md object-contain"
        />
      ) : (
        <div className="flex h-24 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
          未回传图片
        </div>
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

function ViewsGrid({
  projectId,
  variant,
  version,
  style,
  onChanged,
  onEditView,
}: {
  projectId: string;
  variant: StoredVariant;
  version: number;
  style: string;
  onChanged: () => void;
  onEditView: (view: StoredView) => void;
}) {
  return (
    <>
      {variant.views.length === 0 && (
        <p className="text-xs text-muted-foreground">该变体还没有参考图。</p>
      )}
      <div className="grid gap-2">
        {variant.views.map((view) => (
          <ViewCard
            key={view.id}
            projectId={projectId}
            view={view}
            version={version}
            style={style}
            onChanged={onChanged}
            onEdit={() => onEditView(view)}
          />
        ))}
      </div>
    </>
  );
}

function VariantBlock({
  projectId,
  variant,
  isBase,
  assetType,
  version,
  style,
  onChanged,
  onEditVariant,
  onAddView,
  onEditView,
}: {
  projectId: string;
  variant: StoredVariant;
  isBase: boolean;
  assetType: StoredAsset["type"];
  version: number;
  style: string;
  onChanged: () => void;
  onEditVariant: () => void;
  onAddView: () => void;
  onEditView: (view: StoredView) => void;
}) {
  const variantChanged =
    (variant.originalLabel !== null && variant.label !== variant.originalLabel) ||
    (variant.originalPrompt !== null && variant.prompt !== variant.originalPrompt);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {variant.label}
          {isBase && (
            <Badge variant="secondary" className="text-[10px]">
              {assetType === "character" ? "基础造型" : "基础"}
            </Badge>
          )}
          {variantChanged && (
            <Badge variant="secondary" className="text-[10px]">
              已修改
            </Badge>
          )}
        </span>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={onEditVariant}>
            <Pencil className="size-3" />
            编辑
          </Button>
          <Button size="xs" variant="outline" onClick={onAddView}>
            <Plus className="size-3" />
            新增视角
          </Button>
        </div>
      </div>
      <Separator />
      <ViewsGrid
        projectId={projectId}
        variant={variant}
        version={version}
        style={style}
        onChanged={onChanged}
        onEditView={onEditView}
      />
    </div>
  );
}

export default function AssetsPage() {
  const { id } = useParams<{ id: string }>();
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [hasScript, setHasScript] = useState(false);
  const [style, setStyle] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [extra, setExtra] = useState("");
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [variantDialogId, setVariantDialogId] = useState<string | null>(null);
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

  function openAssetEdit(asset: StoredAsset) {
    setEditing({
      kind: "asset",
      assetId: asset.id,
      assetType: asset.type,
      name: asset.name,
      basePrompt: asset.basePrompt,
      changed:
        (asset.originalName !== null && asset.name !== asset.originalName) ||
        (asset.originalBasePrompt !== null &&
          asset.basePrompt !== asset.originalBasePrompt),
    });
  }

  function openVariantEdit(asset: StoredAsset, variant: StoredVariant) {
    setEditing({
      kind: "variant",
      variantId: variant.id,
      label: variant.label,
      prompt: variant.prompt,
      changed:
        (variant.originalLabel !== null &&
          variant.label !== variant.originalLabel) ||
        (variant.originalPrompt !== null &&
          variant.prompt !== variant.originalPrompt),
      assetName: asset.name,
    });
  }

  function openViewEdit(variant: StoredVariant, view: StoredView) {
    setEditing({
      kind: "view",
      viewId: view.id,
      label: view.label,
      prompt: view.prompt,
      changed:
        (view.originalLabel !== null && view.label !== view.originalLabel) ||
        (view.originalPrompt !== null && view.prompt !== view.originalPrompt),
      variantLabel: variant.label,
    });
  }

  function saveEdit(values: Record<string, string>) {
    if (!editing) return Promise.resolve();
    if (editing.kind === "newVariant") {
      return post(`/api/projects/${id}/assets/${editing.assetId}/variants`, {
        label: values.label || "新变体",
        prompt: values.prompt ?? "",
      })
        .then(async () => {
          toast.success("已新增变体");
          setEditing(null);
          await refresh();
        })
        .catch((e: Error) => {
          toast.error(e.message);
        });
    }
    let url = "";
    let body: unknown = {};
    if (editing.kind === "asset") {
      url = `/api/projects/${id}/assets/${editing.assetId}`;
      body = { name: values.name, basePrompt: values.basePrompt };
    } else if (editing.kind === "variant") {
      url = `/api/projects/${id}/assets/variants/${editing.variantId}`;
      body = { label: values.label, prompt: values.prompt };
    } else {
      url = `/api/projects/${id}/assets/views/${editing.viewId}`;
      body = { label: values.label, prompt: values.prompt };
    }
    return post(url, body, "PATCH")
      .then(async () => {
        toast.success("已保存");
        setEditing(null);
        await refresh();
      })
      .catch((e: Error) => {
        toast.error(e.message);
      });
  }

  function deleteEdit() {
    if (!editing || editing.kind === "newVariant") return Promise.resolve();
    let url = "";
    if (editing.kind === "asset") {
      url = `/api/projects/${id}/assets/${editing.assetId}`;
    } else if (editing.kind === "variant") {
      url = `/api/projects/${id}/assets/variants/${editing.variantId}`;
    } else {
      url = `/api/projects/${id}/assets/views/${editing.viewId}`;
    }
    return post(url, undefined, "DELETE")
      .then(async () => {
        toast.success("已删除");
        setEditing(null);
        await refresh();
      })
      .catch((e: Error) => {
        toast.error(e.message);
      });
  }

  function restoreEdit() {
    if (!editing || editing.kind === "newVariant") return Promise.resolve();
    const body =
      editing.kind === "asset"
        ? { assetId: editing.assetId }
        : editing.kind === "variant"
          ? { variantId: editing.variantId }
          : { viewId: editing.viewId };
    return post(`/api/projects/${id}/assets/restore`, body)
      .then(async () => {
        toast.success("已还原为生成时的默认值");
        setEditing(null);
        await refresh();
      })
      .catch((e: Error) => {
        toast.error(e.message);
      });
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

  async function addView(variant: StoredVariant) {
    try {
      await post(`/api/projects/${id}/assets/variants/${variant.id}/views`, {
        label: "新视角",
        prompt: "",
      });
      await refresh();
      toast.success("已新增视角");
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

  const variantDialogAsset = assets.find((a) => a.id === variantDialogId) ?? null;

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
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">资产</h2>
          <p className="text-sm text-muted-foreground">
            角色：基础造型 + 变体造型，每个造型一张四视图；场景：每个变体一张干净全景空镜。
          </p>
        </div>
        <div className="flex items-center gap-2">
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
                  const base = asset.variants[0];
                  const extraCount = Math.max(asset.variants.length - 1, 0);
                  return (
                    <Card key={asset.id}>
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 truncate">
                            {asset.name}
                            <Badge variant="secondary" className="text-[10px]">
                              {asset.type === "character" ? "基础造型" : "基础"}
                            </Badge>
                          </span>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => openAssetEdit(asset)}
                          >
                            <Pencil className="size-3" />
                            编辑
                          </Button>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3">
                        {base && (
                          <div className="flex flex-col gap-2">
                            <ViewsGrid
                              projectId={id}
                              variant={base}
                              version={version}
                              style={style}
                              onChanged={refresh}
                              onEditView={(view) => openViewEdit(base, view)}
                            />
                            <div className="flex items-center gap-2">
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => openVariantEdit(asset, base)}
                              >
                                <Pencil className="size-3" />
                                编辑造型
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => addView(base)}
                              >
                                <Plus className="size-3" />
                                新增视角
                              </Button>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center justify-between border-t pt-2">
                          <span className="text-xs text-muted-foreground">
                            变体 {extraCount}
                          </span>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setVariantDialogId(asset.id)}
                          >
                            <Layers className="size-3" />
                            变体
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {variantDialogAsset && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) setVariantDialogId(null);
          }}
        >
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                造型 / 变体 · {variantDialogAsset.name}（基础造型在卡片上）
              </DialogTitle>
            </DialogHeader>
            <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
              {variantDialogAsset.variants.length <= 1 && (
                <p className="text-sm text-muted-foreground">
                  还没有变体。点下方「新增变体」添加（例如：酒吧装 / 礼服装）。
                </p>
              )}
              {variantDialogAsset.variants.slice(1).map((variant) => (
                <VariantBlock
                  key={variant.id}
                  projectId={id}
                  variant={variant}
                  isBase={false}
                  assetType={variantDialogAsset.type}
                  version={version}
                  style={style}
                  onChanged={refresh}
                  onEditVariant={() =>
                    openVariantEdit(variantDialogAsset, variant)
                  }
                  onAddView={() => addView(variant)}
                  onEditView={(view) => openViewEdit(variant, view)}
                />
              ))}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button
                variant="outline"
                onClick={() =>
                  setEditing({
                    kind: "newVariant",
                    assetId: variantDialogAsset.id,
                    assetName: variantDialogAsset.name,
                    label: "",
                    prompt: "",
                    changed: false,
                  })
                }
              >
                <Plus className="size-4" />
                新增变体
              </Button>
              <Button onClick={() => setVariantDialogId(null)}>关闭</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {editing && (
        <PromptEditDialog
          title={
            editing.kind === "asset"
              ? `编辑资产 · ${editing.name}`
              : editing.kind === "variant"
                ? `编辑变体 · ${editing.assetName}`
                : editing.kind === "view"
                  ? `编辑参考图 · ${editing.variantLabel}`
                  : `新增变体 · ${editing.assetName}`
          }
          hint={
            editing.kind === "view"
              ? "提示词只存画面内容；项目风格会在展示与复制时自动附加在末尾，无需手写风格词。"
              : undefined
          }
          fields={
            editing.kind === "asset"
              ? [
                  { key: "name", label: "资产名", value: editing.name },
                  {
                    key: "basePrompt",
                    label:
                      editing.assetType === "character"
                        ? "角色锚点（不变项，不写服装）"
                        : editing.assetType === "scene"
                          ? "场景锚点（空间/陈设/光线）"
                          : "道具锚点（材质/颜色/特征）",
                    value: editing.basePrompt,
                    multiline: true,
                  },
                ]
              : editing.kind === "newVariant"
                ? [
                    {
                      key: "label",
                      label: "变体名称",
                      value: editing.label,
                      placeholder: "如：日常装 / 酒吧装 / 礼服装",
                    },
                    {
                      key: "prompt",
                      label: "变体提示词（可留空，之后在参考图里编辑）",
                      value: editing.prompt,
                      multiline: true,
                    },
                  ]
                : [
                    { key: "label", label: "名称", value: editing.label },
                    {
                      key: "prompt",
                      label: "提示词",
                      value: editing.prompt,
                      multiline: true,
                    },
                  ]
          }
          onClose={() => setEditing(null)}
          onSave={saveEdit}
          onDelete={editing.kind === "newVariant" ? undefined : deleteEdit}
          onRestore={editing.changed ? restoreEdit : undefined}
        />
      )}
    </div>
  );
}
