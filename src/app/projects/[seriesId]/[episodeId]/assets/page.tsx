"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronUp,
  CloudUpload,
  Copy,
  FileText,
  Library,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  AddToLibraryButton,
  ImageSourceButton,
} from "@/components/asset-library";
import { PreviewImage } from "@/components/preview-image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExtraRequirementsDialog } from "@/components/extra-requirements-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/ui/select";
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
import { LoadErrorState, LoadingState } from "@/components/load-state";
import { LlmKeyNotice, useLlmConfigured } from "@/components/llm-notice";
import { useConfirm } from "@/components/confirm-dialog";
import { describeCascade, fetchCascadeImpact } from "@/lib/impact";
import { readError } from "@/lib/http";
import {
  inferViewKind,
  type AssetSpace,
  type AssetViewKind,
  type StoredAsset,
  type StoredView,
} from "@core/shared/schemas/assets";

const TYPE_LABEL: Record<StoredAsset["type"], string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

const SPACE_LABEL: Record<AssetSpace, string> = {
  "": "未标注内/外景",
  interior: "内景",
  exterior: "外景",
  void: "虚空/特殊空间",
};

const VIEW_KIND_LABEL: Record<AssetViewKind, string> = {
  master: "全景",
  reverse: "反打",
  topdown: "俯瞰",
  detail: "细节",
  sheet: "设定图",
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
// 第一个变体是「基础」槽位：它本身可直接被场次引用，也是其它变体的参考图。
const BASE_LABEL: Record<StoredAsset["type"], string> = {
  character: "基础造型",
  scene: "基础时段",
  prop: "基础形态",
};
const VARIANT_ADD_LABEL: Record<StoredAsset["type"], string> = {
  character: "新增妆造",
  scene: "新增时段",
  prop: "新增变体",
};
const VARIANT_HINT: Record<StoredAsset["type"], string> = {
  character: "妆造会参考基础造型图，只需补充服装/状态变化（例如：酒吧装 / 礼服装）。",
  scene:
    "同一地点的不同时间/天气作为独立变体；每个时段先出「全景」主视角空镜，俯瞰按需补，反打等分镜轴线确定后再补。",
  prop: "同一道具的不同形态作为变体（通常只用一个「默认」）。",
};
const VARIANT_NAME_PH: Record<StoredAsset["type"], string> = {
  character: "妆造名（如 日常装）",
  scene: "时段名（如 夜晚）",
  prop: "形态名（如 默认）",
};
const VARIANT_PROMPT_PH: Record<StoredAsset["type"], string> = {
  character: "本妆造相对基础造型的服装/状态变化",
  scene: "该时段相对基础时段的光线/氛围变化（可留空）",
  prop: "该形态相对基础形态的描述（可留空）",
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

function CopyButton({
  text,
  label = "复制",
  title,
  className,
}: {
  text: string;
  label?: string;
  title?: string;
  className?: string;
}) {
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
    <Button
      size="xs"
      variant="outline"
      onClick={copy}
      disabled={!text}
      title={title}
      className={className}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "已复制" : label}
    </Button>
  );
}

// 每个视角可展开查看「完整提示词」= 内容(锚点+变化) + 构图(按视角名) + 风格。
function ViewPromptPreview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 self-start text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? (
          <ChevronUp className="size-3" />
        ) : (
          <ChevronDown className="size-3" />
        )}
        完整提示词
      </button>
      {open && (
        <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md border bg-background p-2 text-[11px] leading-4 text-muted-foreground">
          {text || "（无内容）"}
        </pre>
      )}
    </div>
  );
}

// 场景资产名和剧本 location 可能有细微差异（「茅草屋内」vs「茅草屋·内景」），
// 用去标点 + 最长公共子串做宽松匹配，避免反打按钮被误禁用。
function looseLocationKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s“”"'「」『』（）()·,，。、/\\\-—_]/g, "");
}

function longestCommonLength(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > best) best = curr[j];
      }
    }
    prev = curr;
  }
  return best;
}

function locationMatches(a: string, b: string): boolean {
  const x = looseLocationKey(a);
  const y = looseLocationKey(b);
  if (!x || !y) return false;
  return (
    x === y ||
    x.includes(y) ||
    y.includes(x) ||
    longestCommonLength(x, y) >= 3
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
  prompt: string;
  kind?: AssetViewKind;
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
  runningViewIds,
  onClose,
  onSaved,
}: {
  projectId: string;
  seriesId: string;
  asset: StoredAsset;
  style: string;
  runningViewIds: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const term = VARIANT_TERM[asset.type];
  // 只有场景/道具需要手动补视角（如场景的「反打」）；角色的妆造不需要。
  const canAddView = asset.type !== "character";
  const [name, setName] = useState(asset.name);
  const [basePrompt, setBasePrompt] = useState(asset.basePrompt);
  const [interiorExterior, setInteriorExterior] = useState<AssetSpace>(
    asset.interiorExterior,
  );
  const [variants, setVariants] = useState<VariantDraft[]>(() =>
    asset.variants.map((v) => ({
      id: v.id,
      label: v.label,
      prompt: v.prompt,
      views: v.views.map((vw) => ({
        id: vw.id,
        label: vw.label,
        prompt: vw.prompt,
        kind: vw.kind,
        imagePath: vw.imagePath,
      })),
    })),
  );
  const [deletedVariantIds, setDeletedVariantIds] = useState<string[]>([]);
  const [deletedViewIds, setDeletedViewIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [imgVersion, setImgVersion] = useState(0);
  const [genBusy, setGenBusy] = useState<string | null>(null);
  // 反打必须等分镜轴线确定后再补：先确认本资产对应场次已经生成分镜。
  const [storyboardReady, setStoryboardReady] = useState<boolean | null>(null);
  const [reverseHint, setReverseHint] = useState("");
  const confirm = useConfirm();

  useEffect(() => {
    if (asset.type !== "scene") return;
    let cancelled = false;
    type BlockingHint = {
      cameraSide?: string;
      axis?: { from?: string; to?: string };
      nodes?: { id?: string; label?: string }[];
    };
    type SceneHint = {
      location?: string;
      segments?: unknown[];
      blocking?: BlockingHint | null;
    };
    fetch(`/api/projects/${projectId}/storyboard`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { scenes?: SceneHint[] } | null) => {
        if (cancelled) return;
        const matched = (data?.scenes ?? []).find(
          (scene) =>
            Boolean(scene.location?.trim()) &&
            locationMatches(asset.name, scene.location as string) &&
            (scene.segments?.length ?? 0) > 0,
        );
        setStoryboardReady(Boolean(matched));
        const axis = matched?.blocking?.axis;
        if (axis?.from && axis?.to) {
          const nodes = matched?.blocking?.nodes ?? [];
          const from =
            nodes.find((n) => n.id === axis.from)?.label ?? axis.from;
          const to = nodes.find((n) => n.id === axis.to)?.label ?? axis.to;
          const side =
            matched?.blocking?.cameraSide === "left"
              ? "左"
              : matched?.blocking?.cameraSide === "right"
                ? "右"
                : "";
          setReverseHint(
            `从「${from}—${to}」轴线的另一侧反打${side ? `（镜头保持在轴线${side}侧）` : ""}；空间结构、陈设、材质、光源方向与主视角完全一致，纯空镜无人物。`,
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStoryboardReady(false);
          setReverseHint("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [asset.type, asset.name, projectId]);

  // 与打开时的快照对比，判断是否有未保存改动，关闭前需确认。
  const [snapshot] = useState(() =>
    JSON.stringify({
      name: asset.name,
      basePrompt: asset.basePrompt,
      interiorExterior: asset.interiorExterior,
      variants: asset.variants.map((v) => ({
        label: v.label,
        prompt: v.prompt,
        views: v.views.map((w) => ({
          label: w.label,
          prompt: w.prompt,
          kind: w.kind,
        })),
      })),
    }),
  );
  const dirty =
    JSON.stringify({
      name,
      basePrompt,
      interiorExterior,
      variants: variants.map((v) => ({
        label: v.label,
        prompt: v.prompt,
        views: v.views.map((w) => ({
          label: w.label,
          prompt: w.prompt,
          kind: w.kind,
        })),
      })),
    }) !== snapshot;

  async function requestClose() {
    if (
      dirty &&
      !(await confirm({
        title: "放弃修改？",
        description: "该资产有未保存的修改，关闭后将丢失。",
        confirmText: "放弃并关闭",
        destructive: true,
      }))
    ) {
      return;
    }
    onClose();
  }

  async function genView(viewId: string) {
    setGenBusy(viewId);
    try {
      await post(
        `/api/projects/${projectId}/assets/views/${viewId}/generate-image`,
        {},
      );
      toast.success("已提交云端出图", {
        description: "后台生成中（受并发限制排队），完成后重开弹窗可见",
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenBusy(null);
    }
  }

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
              views: [
                ...v.views,
                { label: "", prompt: "", kind: "detail", imagePath: null },
              ],
            }
          : v,
      ),
    );
  }
  function addReverseView() {
    setVariants((prev) =>
      prev.map((v, idx) =>
        idx === 0 && !v.views.some((w) => w.kind === "reverse")
          ? {
              ...v,
              views: [
                ...v.views,
                {
                  label: "反打",
                  prompt: reverseHint,
                  kind: "reverse",
                  imagePath: null,
                },
              ],
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
        {
          name: name.trim(),
          basePrompt,
          ...(asset.type === "scene"
            ? { interiorExterior }
            : {}),
        },
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
            const body = {
              label: vw.label.trim() || "视角",
              prompt: vw.prompt,
              ...(vw.kind ? { kind: vw.kind } : {}),
            };
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

  // 第一个变体是「基础」槽位：可直接被场次引用，也是其它变体的参考图。
  const baseVariant = variants[0];
  const baseImageView = baseVariant?.views[0] ?? null;
  const extras = variants.slice(1).map((v, i) => ({ v, vi: i + 1 }));
  const baseFinalPrompt = composeAssetViewPrompt({
    type: asset.type,
    viewLabel: baseVariant?.views[0]?.label ?? "",
    viewKind: baseVariant?.views[0]?.kind,
    viewPrompt: baseVariant?.views[0]?.prompt,
    basePrompt,
    variantPrompt: baseVariant?.prompt,
    style,
  });

  // 某视角的完整提示词：内容(锚点+变化) + 构图(按视角名) + 风格。
  function viewPrompt(v: VariantDraft, vw: ViewDraft) {
    return composeAssetViewPrompt({
      type: asset.type,
      viewLabel: vw.label,
      viewKind: vw.kind,
      viewPrompt: vw.prompt,
      basePrompt,
      variantPrompt: v.prompt,
      style,
    });
  }

  // 基础造型的视角：本身是成品图，同时也是其它造型出图时的参考图。
  function renderViews(vi: number, v: VariantDraft) {
    return (
      <div className="mt-1 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            视角（{v.views.length}）· 出图 / 回传 / 入库
          </span>
          {v.id && canAddView && (
            <div className="flex items-center gap-1">
              {asset.type === "scene" && vi === 0 && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={addReverseView}
                  disabled={
                    storyboardReady !== true ||
                    v.views.some((w) => w.kind === "reverse")
                  }
                  title={
                    v.views.some((w) => w.kind === "reverse")
                      ? "已有反打视角"
                      : storyboardReady === null
                        ? "正在检查本场分镜…"
                        : storyboardReady
                          ? "按已生成分镜的轴线补一个反打空镜"
                          : "先完成本场分镜（确定轴线）后再补反打"
                  }
                >
                  <Plus className="size-3" />
                  补反打
                </Button>
              )}
              <Button size="xs" variant="outline" onClick={() => addView(vi)}>
                <Plus className="size-3" />
                添加视角
              </Button>
            </div>
          )}
        </div>

        {!v.id && (
          <p className="text-xs text-muted-foreground">
            保存后会自动生成默认视角（角色：按所选参考图模式；场景：全景），再进来即可补充。
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
                    patchView(vi, i, {
                      label: e.target.value,
                      kind: inferViewKind(e.target.value),
                    })
                  }
                  placeholder="视角名（全景 / 俯瞰 / 反打 / 单图全身 / 三视图）"
                  className="h-7 text-xs"
                />
                <CopyButton
                  text={viewPrompt(v, vw)}
                  title="复制该视角的完整提示词（锚点 + 变化 + 构图 + 风格）"
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

              <div className="grid grid-cols-[7.5rem_1fr] gap-1.5">
                <SelectField
                  value={vw.kind ?? inferViewKind(vw.label)}
                  onChange={(value) =>
                    patchView(vi, i, { kind: value as AssetViewKind })
                  }
                  options={[
                    { value: "master", label: "主视角（正面 / 全景）" },
                    { value: "reverse", label: "反打" },
                    { value: "topdown", label: "俯瞰" },
                    { value: "detail", label: "细节" },
                    { value: "sheet", label: "设定图" },
                  ]}
                />
                <Input
                  value={vw.prompt}
                  onChange={(e) =>
                    patchView(vi, i, { prompt: e.target.value })
                  }
                  placeholder="视角补充提示（可选，会参与出图）"
                  className="h-7 text-xs"
                />
              </div>

              {vw.id ? (
                <>
                  <PreviewImage
                    src={`/api/projects/${projectId}/assets/views/${vw.id}/image?v=${imgVersion}`}
                    alt={vw.label || "视角"}
                    className="h-24 w-full rounded object-contain"
                  />
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => genView(vw.id as string)}
                      disabled={genBusy === vw.id || runningViewIds.has(vw.id)}
                      title="用 Toapi 云端出图（自动拼提示词 + 参考同资产其它视角）"
                    >
                      {genBusy === vw.id || runningViewIds.has(vw.id) ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <CloudUpload className="size-3" />
                      )}
                      {runningViewIds.has(vw.id) ? "生成中" : "云端出图"}
                    </Button>
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
              <ViewPromptPreview text={viewPrompt(v, vw)} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 妆造 / 其它变体的成品图：紧凑只读网格，只保留出图 / 回传 / 入库。
  function renderVariantViews(vi: number, v: VariantDraft) {
    if (!v.id) {
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 rounded-md border border-dashed bg-muted/10 p-2">
            <div className="flex h-24 items-center justify-center rounded bg-muted/60 px-2 text-center text-[11px] text-muted-foreground">
              保存后自动生成默认视角
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button size="xs" variant="outline" disabled title="保存后可用">
                <CloudUpload className="size-3" />
                云端出图
              </Button>
              <ImageSourceButton
                projectId={projectId}
                seriesId={seriesId}
                viewId={null}
                onChanged={() => setImgVersion((n) => n + 1)}
              />
              <AddToLibraryButton
                projectId={projectId}
                seriesId={seriesId}
                viewId={null}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              先「保存」，再回来即可出图 / 回传 / 入库。
            </p>
          </div>
        </div>
      );
    }
    if (v.views.length === 0) {
      return <p className="text-xs text-muted-foreground">该造型暂无视角。</p>;
    }
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {v.views.map((vw, i) => (
          <div
            key={vw.id ?? `newview-${vi}-${i}`}
            className="flex flex-col gap-1.5 rounded-md border bg-muted/20 p-2"
          >
            <div className="flex items-center gap-1">
              <span className="truncate text-xs font-medium">
                {vw.label || `视角 ${i + 1}`}
              </span>
              <CopyButton
                text={viewPrompt(v, vw)}
                title="复制该视角的完整提示词（锚点 + 变化 + 构图 + 风格）"
                className="ml-auto"
              />
            </div>
            {vw.id ? (
              <>
                <PreviewImage
                  src={`/api/projects/${projectId}/assets/views/${vw.id}/image?v=${imgVersion}`}
                  alt={vw.label || "视角"}
                  className="h-24 w-full rounded object-contain"
                />
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => genView(vw.id as string)}
                    disabled={genBusy === vw.id || runningViewIds.has(vw.id)}
                    title="用 Toapi 云端出图（自动拼提示词 + 参考基础造型图）"
                  >
                    {genBusy === vw.id || runningViewIds.has(vw.id) ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <CloudUpload className="size-3" />
                    )}
                    {runningViewIds.has(vw.id) ? "生成中" : "云端出图"}
                  </Button>
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
            <ViewPromptPreview text={viewPrompt(v, vw)} />
          </div>
        ))}
      </div>
    );
  }

  // 额外造型（妆造 / 其它时段 / 其它变体）卡片。
  function renderVariantCard(v: VariantDraft, vi: number) {
    return (
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
        {renderVariantViews(vi, v)}
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && requestClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>编辑资产 · {asset.name}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid gap-1.5">
            <Label htmlFor="asset-name">资产名</Label>
            <Input
              id="asset-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {asset.type === "scene" && (
            <div className="grid gap-1.5">
              <Label htmlFor="asset-space">空间类型</Label>
              <SelectField
                id="asset-space"
                value={interiorExterior}
                onChange={(value) =>
                  setInteriorExterior(value as AssetSpace)
                }
                options={[
                  { value: "", label: "未标注" },
                  { value: "interior", label: "内景" },
                  { value: "exterior", label: "外景" },
                  { value: "void", label: "虚空/特殊空间" },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                内景/外景必须与实际画面一致；同一地点的内景和外景应拆成两个场景资产。
              </p>
            </div>
          )}

          {/* 基础造型 / 基础时段：可直接被场次引用，也是其它变体的参考图 */}
          <div className="flex flex-col gap-3 rounded-xl border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-sm font-medium">{BASE_LABEL[asset.type]}</h4>
              <span className="text-xs text-muted-foreground">
                可直接被场次引用；也是其它{term}的参考图
              </span>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="asset-prompt">
                {PROMPT_LABEL[asset.type]}｜所有造型共用
              </Label>
              <Textarea
                id="asset-prompt"
                value={basePrompt}
                onChange={(e) => setBasePrompt(e.target.value)}
                placeholder="只写不变项，不要写服装/时段等变化项（那些放变体里）。"
                className="min-h-[90px]"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="base-variant-prompt">
                {BASE_LABEL[asset.type]}的变化项（相对锚点）
              </Label>
              <Textarea
                id="base-variant-prompt"
                value={baseVariant?.prompt ?? ""}
                onChange={(e) => patchVariant(0, { prompt: e.target.value })}
                placeholder={VARIANT_PROMPT_PH[asset.type]}
                rows={2}
                disabled={!baseVariant}
              />
              {!baseVariant && (
                <p className="text-xs text-muted-foreground">
                  该资产还没有造型数据，请在下方「{VARIANT_ADD_LABEL[asset.type]}」添加。
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>最终提示词（实时拼接：锚点 + 变化 + 构图 + 风格）</Label>
                <CopyButton
                  text={baseFinalPrompt}
                  label="复制完整提示词"
                  title="复制出去的就是这段（含构图与风格），与上方文本框不同"
                />
              </div>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-background p-2.5 text-xs leading-5">
                {baseFinalPrompt || "（无内容）"}
              </pre>
              <p className="text-[11px] text-muted-foreground">
                文本框只存「锚点」，风格与构图由系统在展示 / 复制时追加，所以两者不会完全一致。
              </p>
            </div>

            {baseVariant && renderViews(0, baseVariant)}
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-medium">{term}（额外造型）</h4>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {VARIANT_HINT[asset.type]}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={addVariant}>
                <Plus className="size-4" />
                {VARIANT_ADD_LABEL[asset.type]}
              </Button>
            </div>

            {extras.length > 0 && (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-2.5">
                <div className="h-20 w-32 shrink-0 overflow-hidden rounded bg-muted">
                  {baseImageView?.imagePath ? (
                    <PreviewImage
                      src={`/api/projects/${projectId}/assets/views/${baseImageView.id}/image?v=${imgVersion}`}
                      alt={`${BASE_LABEL[asset.type]}参考图`}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                      暂无基础图
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium">
                    参考图 · {BASE_LABEL[asset.type]}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    每个{term}都固定以这张基础图为参考出图
                    {baseImageView?.imagePath
                      ? "。"
                      : "（请先在「基础造型」区出图）。"}
                  </p>
                </div>
              </div>
            )}

            {extras.length === 0 && (
              <p className="text-sm text-muted-foreground">
                暂无额外{term}。需要换装 / 换时段时再新增。
              </p>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              {extras.map(({ v, vi }) => renderVariantCard(v, vi))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={requestClose} disabled={saving}>
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [extra, setExtra] = useState("");
  const [extraOpen, setExtraOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [editAsset, setEditAsset] = useState<StoredAsset | null>(null);
  const [activeType, setActiveType] =
    useState<StoredAsset["type"]>("character");
  const [batchGen, setBatchGen] = useState(false);
  const [cardGenId, setCardGenId] = useState<string | null>(null);
  const [modeBusyId, setModeBusyId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState(id);

  if (sessionId !== id) {
    setSessionId(id);
    setLoaded(false);
    setLoadError(null);
  }

  const load = useCallback(async () => {
    async function get<T>(url: string, what: string): Promise<T> {
      const res = await fetch(url);
      if (!res.ok) throw new Error(await readError(res, `读取${what}失败`));
      return (await res.json()) as T;
    }
    const [assetsRes, scriptRes, projectRes] = await Promise.all([
      get<{ assets?: StoredAsset[] }>(`/api/projects/${id}/assets`, "资产"),
      get<{ script?: unknown }>(`/api/projects/${id}/script`, "剧本"),
      get<{ project?: { style?: string } }>(`/api/projects/${id}`, "项目"),
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
      } catch (error) {
        if (!cancelled) {
          setLoadError((error as Error).message || "读取资产失败");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, reloadKey]);

  const { jobs } = useProjectJobs(id, (job) => {
    // 剧本重生成会清空资产，资产重生成会覆盖资产，两者都要刷新页面数据。
    if (job.status === "running") return;
    if (
      job.kind !== "script-to-assets" &&
      job.kind !== "story-to-script" &&
      job.kind !== "gen-asset-image"
    )
      return;
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
  // 有出图任务在跑时禁用批量入口，避免重复点击把未出完的视角再次提交。
  const imageRunning = isJobRunning(jobs, "gen-asset-image");
  // 正在出图的视角：精确置灰对应资产的「生图 / 云端出图」按钮。
  const runningViewIds = new Set(
    jobs
      .filter(
        (job) =>
          job.kind === "gen-asset-image" &&
          job.status === "running" &&
          job.targetId,
      )
      .map((job) => job.targetId as string),
  );
  const llmMissing = useLlmConfigured() === "missing";
  const confirm = useConfirm();

  async function generate() {
    if (assets.length > 0) {
      const impact = await fetchCascadeImpact(id).catch(() => null);
      const detail = impact
        ? describeCascade(impact, { assets: false, storyboard: true })
        : "";
      if (
        !(await confirm({
          title: "重新生成资产",
          description: `重新生成将覆盖现有资产（含已回传图片）${
            detail ? `，并清空下游：${detail}` : "，并清空下游的「分镜」"
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

  async function setCharacterViewMode(
    assetId: string,
    mode: StoredAsset["characterViewMode"],
  ) {
    setModeBusyId(assetId);
    try {
      await post(
        `/api/projects/${id}/assets/${assetId}`,
        { characterViewMode: mode },
        "PATCH",
      );
      await refresh();
      toast.success(
        mode === "sheet" ? "已切换为四视图" : "已切换为单图全身照",
        { description: "已出的旧图保留，下次出图按新构图生成" },
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setModeBusyId(null);
    }
  }

  async function genCardImage(assetId: string, viewId: string | null) {
    if (!viewId) return;
    setCardGenId(assetId);
    try {
      await post(
        `/api/projects/${id}/assets/views/${viewId}/generate-image`,
        {},
      );
      toast.success("已提交云端出图", {
        description: "后台生成中（受并发限制排队），完成后自动刷新",
      });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setCardGenId(null);
    }
  }

  async function addCardToLibrary(
    viewId: string | null,
    scope: "project" | "global",
  ) {
    if (!viewId) return;
    try {
      const res = await fetch("/api/library/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          seriesId: scope === "project" ? seriesId : undefined,
          projectId: id,
          viewId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "添加失败");
      toast.success(scope === "project" ? "已加入项目资产库" : "已加入全局资产库");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function restoreAll() {
    if (
      !(await confirm({
        title: "全部还原",
        description: "将所有资产还原为生成时的默认值？已回传的图片不受影响。",
        confirmText: "还原",
      }))
    ) {
      return;
    }
    try {
      await post(`/api/projects/${id}/assets/restore`, {});
      await refresh();
      toast.success("已全部还原");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function generateAllImages() {
    setBatchGen(true);
    try {
      const data = await post(`/api/projects/${id}/assets/generate-images`, {
        onlyMissing: true,
      });
      toast.success(`已提交 ${data.enqueued} 个视角出图`, {
        description: `共 ${data.total} 个视角，跳过 ${data.skipped} 个已有图，完成后自动刷新`,
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBatchGen(false);
    }
  }

  async function cancelImages() {
    try {
      const data = await post(`/api/projects/${id}/assets/cancel-images`, {});
      toast.success(
        data?.cancelled ? "已取消出图" : "没有正在进行的出图",
      );
      await refresh();
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
    <div className="flex h-full min-h-0 flex-col gap-4 pb-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl bg-block-cream p-5">
        <div>
          <h2 className="text-base font-medium">资产</h2>
          <p className="text-sm text-muted-foreground">
            角色：基础造型 + 妆造，默认每套造型一张单图全身照（竖版 3:4），可在卡片「参考图」处切换为四视图（横版 16:9）；场景：每个时段先出「全景」主视角空镜，俯瞰按需、反打等分镜轴线确定后再补。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {assets.length > 0 && (
            <Button
              variant="outline"
              onClick={generateAllImages}
              disabled={busy || batchGen || imageRunning}
            >
              {batchGen ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CloudUpload className="size-4" />
              )}
              一键出图
            </Button>
          )}
          {imageRunning && (
            <Button variant="outline" onClick={cancelImages}>
              <XCircle className="size-4" />
              取消出图
            </Button>
          )}
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
          <Button
            variant="outline"
            onClick={() => setExtraOpen(true)}
            disabled={busy || !hasScript}
          >
            <FileText className="size-4" />
            额外要求{extra.trim() ? "（已填写）" : ""}
          </Button>
          <Button onClick={generate} disabled={busy || !hasScript || llmMissing}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {assets.length ? "重新生成" : "生成资产"}
          </Button>
        </div>
      </div>

      {llmMissing && <LlmKeyNotice />}

      {!hasScript && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            请先在「剧本」页生成剧本，再生成资产。
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
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 items-center gap-1 border-b">
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

          <div className="min-h-0 flex-1 overflow-y-auto pb-3 pr-1">
          {assets.filter((a) => a.type === activeType).length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                暂无{TYPE_LABEL[activeType]}资产。
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {assets
                .filter((a) => a.type === activeType)
                .map((asset) => {
                  const baseView = firstView(asset);
                  const assetRunning = asset.variants.some((variant) =>
                    variant.views.some((view) => runningViewIds.has(view.id)),
                  );
                  const extraCount = Math.max(asset.variants.length - 1, 0);
                  const baseKinds = [
                    ...new Set(
                      (asset.variants[0]?.views ?? []).map((w) => w.kind),
                    ),
                  ];
                  // 复制/展示 = 内容(锚点+变化) + 构图(代码) + 风格(代码)，改构图立即生效。
                  const displayPrompt = composeAssetViewPrompt({
                    type: asset.type,
                    viewLabel: baseView?.label ?? "",
                    viewKind: baseView?.kind,
                    viewPrompt: baseView?.prompt,
                    basePrompt: asset.basePrompt,
                    variantPrompt: asset.variants[0]?.prompt,
                    style,
                  });
                  return (
                    <Card key={asset.id} size="sm" className="border border-border">
                      <CardContent className="flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-col gap-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className="truncate text-sm font-medium"
                                title={asset.name}
                              >
                                {asset.name.length > 6
                                  ? `${asset.name.slice(0, 6)}...`
                                  : asset.name}
                              </span>
                              {extraCount > 0 && (
                                <Badge
                                  variant="secondary"
                                  className="shrink-0 text-[10px]"
                                  title={`共 ${asset.variants.length} 套可用造型：基础造型 1 + ${VARIANT_TERM[asset.type]} ${extraCount}`}
                                >
                                  {VARIANT_TERM[asset.type]} {extraCount}
                                </Badge>
                              )}
                            </div>
                            {asset.type === "scene" && (
                              <div className="flex flex-wrap items-center gap-1">
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                  title="场景空间类型：内景/外景/虚空"
                                >
                                  {SPACE_LABEL[asset.interiorExterior]}
                                </Badge>
                                {baseKinds.length === 0 ? (
                                  <Badge
                                    variant="destructive"
                                    className="text-[10px]"
                                  >
                                    无视角
                                  </Badge>
                                ) : (
                                  <>
                                    {baseKinds.map((kind) => (
                                      <Badge
                                        key={kind}
                                        variant={
                                          kind === "master"
                                            ? "secondary"
                                            : "outline"
                                        }
                                        className="text-[10px]"
                                      >
                                        {VIEW_KIND_LABEL[kind]}
                                      </Badge>
                                    ))}
                                    {!baseKinds.includes("master") && (
                                      <Badge
                                        variant="destructive"
                                        className="text-[10px]"
                                        title="没有主视角，分镜将没有可用的场景参考图"
                                      >
                                        缺主视角
                                      </Badge>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                            {asset.type === "character" && (
                              <div className="flex items-center gap-1.5">
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  参考图
                                </span>
                                <SelectField
                                  value={asset.characterViewMode}
                                  onChange={(value) =>
                                    setCharacterViewMode(
                                      asset.id,
                                      value as StoredAsset["characterViewMode"],
                                    )
                                  }
                                  options={[
                                    { value: "single", label: "单图（全身照）" },
                                    { value: "sheet", label: "四视图" },
                                  ]}
                                  disabled={
                                    modeBusyId === asset.id ||
                                    busy ||
                                    imageRunning
                                  }
                                  className="h-7 w-32 text-xs"
                                  aria-label="角色参考图模式"
                                />
                                {modeBusyId === asset.id && (
                                  <Loader2 className="size-3 animate-spin text-muted-foreground" />
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() =>
                                genCardImage(asset.id, baseView?.id ?? null)
                              }
                              disabled={
                                !baseView?.id ||
                                cardGenId === asset.id ||
                                assetRunning
                              }
                              title={
                                assetRunning
                                  ? "该资产正在生成中"
                                  : "云端生成基础图（自动带上参考图）"
                              }
                            >
                              {cardGenId === asset.id || assetRunning ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <CloudUpload className="size-3" />
                              )}
                              {assetRunning ? "生成中" : "生图"}
                            </Button>
                            <ImageSourceButton
                              projectId={id}
                              seriesId={seriesId}
                              viewId={baseView?.id ?? null}
                              onChanged={refresh}
                            />
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    title="更多"
                                    aria-label="更多"
                                  />
                                }
                              >
                                <MoreHorizontal className="size-3.5" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                <DropdownMenuItem
                                  disabled={!baseView?.id}
                                  onClick={() =>
                                    addCardToLibrary(
                                      baseView?.id ?? null,
                                      "project",
                                    )
                                  }
                                >
                                  <Library className="size-4" />
                                  加入项目资产库
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!baseView?.id}
                                  onClick={() =>
                                    addCardToLibrary(baseView?.id ?? null, "global")
                                  }
                                >
                                  <Library className="size-4" />
                                  加入全局资产库
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => setEditAsset(asset)}
                                >
                                  <Pencil className="size-4" />
                                  编辑造型 / 提示词
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>

                        <span className="text-[10px] font-medium tracking-wide text-muted-foreground">
                          完整提示词（含妆造 / 构图 / 风格，复制请点「编辑」）
                        </span>
                        <p
                          className="line-clamp-2 text-xs leading-5 text-muted-foreground"
                          title={displayPrompt}
                        >
                          {displayPrompt || "（无提示词）"}
                        </p>

                        {baseView?.imagePath ? (
                          <PreviewImage
                            src={`/api/projects/${id}/assets/views/${baseView.id}/image?v=${version}`}
                            alt={asset.name}
                            className="h-32 w-full rounded-md object-contain"
                          />
                        ) : (
                          <div className="flex h-32 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
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
        </div>
      )}

      {editAsset && (
        <AssetEditDialog
          key={editAsset.id}
          projectId={id}
          seriesId={seriesId}
          asset={editAsset}
          style={style}
          runningViewIds={runningViewIds}
          onClose={() => setEditAsset(null)}
          onSaved={() => {
            setEditAsset(null);
            refresh();
          }}
        />
      )}

      <ExtraRequirementsDialog
        open={extraOpen}
        onOpenChange={setExtraOpen}
        value={extra}
        onChange={setExtra}
        placeholder="例如：主角固定穿深蓝连帽卫衣；场景统一写实电影质感。"
        description="可选，下一次生成资产时生效。"
      />
    </div>
  );
}
