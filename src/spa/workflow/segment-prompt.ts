import type {
  StoredAsset,
  StoredView,
  StoredVariant,
} from "@core/shared/schemas/assets";
import type {
  StoredRef,
  StoredSceneStoryboard,
  StoredSegment,
} from "@core/shared/schemas/storyboard";
import type { Project } from "@core/shared/projects";
import { buildAxisText, buildShotBlockingLines } from "@core/shared/blocking-text";
import { formatDialogue } from "@core/shared/dialogue-format";
import { resolveVideoStyle } from "@core/shared/style-video";
import { DEFAULT_NEGATIVE_TEXT } from "@core/shared/templates-defaults";

interface RefSlot {
  key: string;
  label: string;
  role: string;
  assetName: string;
  variantLabel: string;
  viewLabel: string;
  imagePath: string | null;
}

const INTENT_LABEL: Record<string, string> = {
  establish: "交代环境",
  relation: "关系/双人",
  dialogue: "对话",
  action: "动作",
  reaction: "反应",
  insert: "特写/插入",
};

function findVariant(
  asset: StoredAsset | undefined,
  label: string,
): StoredVariant | undefined {
  if (!asset) return undefined;
  return asset.variants.find((variant) => variant.label === label) ??
    asset.variants[0];
}

function findView(
  variant: StoredVariant | undefined,
  label: string,
): StoredView | undefined {
  if (!variant) return undefined;
  return variant.views.find((view) => view.label === label) ?? variant.views[0];
}

function refKey(ref: {
  role: string;
  assetName: string;
  variantLabel: string;
  viewLabel: string;
}): string {
  return [
    ref.role,
    ref.assetName.trim(),
    ref.variantLabel.trim(),
    ref.viewLabel.trim(),
  ].join("|");
}

function refLabel(ref: {
  role: string;
  assetName: string;
  variantLabel: string;
  viewLabel: string;
}): string {
  const role =
    ref.role === "character" ? "角色" : ref.role === "scene" ? "场景" : "道具";
  const detail = [ref.variantLabel, ref.viewLabel].filter(Boolean).join("·");
  return `${role} ${ref.assetName}${detail ? `（${detail}）` : ""}`;
}

function resolveImage(
  assets: StoredAsset[],
  ref: { role: string; assetName: string; variantLabel: string; viewLabel: string },
): string | null {
  const asset = assets.find((item) => item.name === ref.assetName);
  const variant = findVariant(asset, ref.variantLabel);
  const view = findView(variant, ref.viewLabel);
  return view?.imagePath ?? null;
}

function collectRefs(
  scene: StoredSceneStoryboard,
  segment: StoredSegment,
  assets: StoredAsset[],
): { slots: RefSlot[]; byKey: Map<string, RefSlot> } {
  const slots: RefSlot[] = [];
  const byKey = new Map<string, RefSlot>();

  const add = (ref: {
    role: string;
    assetName: string;
    variantLabel: string;
    viewLabel: string;
  }) => {
    if (!ref.assetName.trim()) return;
    const key = refKey(ref);
    if (byKey.has(key)) return;
    const slot: RefSlot = {
      key,
      label: refLabel(ref),
      role: ref.role,
      assetName: ref.assetName,
      variantLabel: ref.variantLabel,
      viewLabel: ref.viewLabel,
      imagePath: resolveImage(assets, ref),
    };
    byKey.set(key, slot);
    slots.push(slot);
  };

  for (const shot of segment.shots) {
    for (const ref of shot.refs) add(ref);
  }

  if (!slots.some((slot) => slot.role === "scene") && scene.location) {
    const sceneAsset = assets.find(
      (asset) => asset.type === "scene" && asset.name === scene.location,
    );
    const variant = sceneAsset?.variants[0];
    const view = variant?.views.find((item) => item.label === "全景") ?? variant?.views[0];
    add({
      role: "scene",
      assetName: scene.location,
      variantLabel: variant?.label ?? "",
      viewLabel: view?.label ?? "",
    });
  }

  return { slots, byKey };
}

function shotRefs(shotRefsList: StoredRef[], byKey: Map<string, RefSlot>): string[] {
  const result: string[] = [];
  for (const ref of shotRefsList) {
    const slot = byKey.get(refKey(ref));
    if (!slot) continue;
    const index = [...byKey.values()].indexOf(slot) + 1;
    result.push(`图${index}`);
  }
  return [...new Set(result)];
}

export function buildSegmentPrompt(input: {
  project: Project;
  scene: StoredSceneStoryboard;
  segment: StoredSegment;
  assets: StoredAsset[];
}): string {
  const { project, scene, segment, assets } = input;
  const style = resolveVideoStyle(project);
  const { slots, byKey } = collectRefs(scene, segment, assets);
  const targetSeconds = (segment.targetMs / 1000).toFixed(1);

  const refLines = slots.length
    ? slots.map((slot, index) => {
        const image = slot.imagePath ? "已有参考图" : "参考图待上传";
        return `图${index + 1}：${slot.label}（${image}）`;
      })
    : ["（本段没有引用资产，可只上传起始画面）"];

  const shotLines = segment.shots.map((shot) => {
    const camera = [
      shot.camera.shotSize,
      shot.camera.focal,
      shot.camera.angle,
      shot.camera.movement,
    ]
      .filter(Boolean)
      .join(" / ");
    const blocking = buildShotBlockingLines(
      scene.blocking,
      shot.subjectNodeIds,
      shot.action,
      undefined,
      shot.expression,
    );
    const refs = shotRefs(shot.refs, byKey);
    return [
      `镜${shot.index}｜${(shot.durationMs / 1000).toFixed(1)}s｜${INTENT_LABEL[shot.intent ?? "action"] ?? shot.intent ?? "动作"}`,
      camera ? `机位：${camera}` : "",
      blocking.length ? `站位：${blocking.join("；")}` : "",
      shot.action ? `动作：${shot.action}` : "",
      shot.expression ? `表情/情绪：${shot.expression}` : "",
      shot.lighting ? `光线：${shot.lighting}` : "",
      shot.dialogue.length ? `台词：\n${formatDialogue(shot.dialogue)}` : "",
      refs.length ? `参考：${refs.join("、")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    "【基础设定】",
    `风格：${style || "未指定"}`,
    `画面比例：${project.aspectRatio}`,
    `段时长：约 ${targetSeconds} 秒`,
    `场次：${scene.sceneIndex} ${scene.sceneSlug}｜${scene.location}｜${scene.timeOfDay}｜${scene.interiorExterior}`,
    "",
    "【参考图清单】",
    ...refLines,
    "",
    "【空间与轴线】",
    buildAxisText(scene.blocking) || "保持同一空间结构、陈设、光线方向与色调一致。",
    "",
    `【分镜序列】本段 ${segment.shots.length} 镜，按顺序连续生成`,
    ...shotLines,
    "",
    "【衔接约束】",
    segment.hardCut
      ? "本段为硬切起段：不承接上一段动作，只保持场景、服装、光线一致。"
      : "本段接上一段画面：保持人物外观、服装、站位与光线连续。",
    "",
    "【负面约束】",
    DEFAULT_NEGATIVE_TEXT,
  ]
    .join("\n")
    .trim();
}
