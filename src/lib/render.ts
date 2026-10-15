import fs from "node:fs";
import { getStoryboard, getContinuityRules } from "@/lib/storyboard";
import { getProject } from "@/lib/projects";
import { getTemplateByPlatform } from "@/lib/library/templates";
import { getProjectDb } from "@/lib/db";
import { DEFAULT_NEGATIVE_TEXT } from "@/lib/templates-defaults";
import type {
  DialogueLine,
  StoredSceneStoryboard,
  StoredSegment,
} from "@/lib/schemas/storyboard";
import type { ManifestItem, RenderedPrompt } from "@/lib/render-types";

export type { ManifestItem, RenderedPrompt };

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) =>
    key in vars ? vars[key] : `{{${key}}}`,
  );
}

function findSegment(
  scenes: StoredSceneStoryboard[],
  segmentId: string,
): { scene: StoredSceneStoryboard; segment: StoredSegment } | null {
  for (const scene of scenes) {
    const segment = scene.segments.find((s) => s.id === segmentId);
    if (segment) return { scene, segment };
  }
  return null;
}

function getFramePath(projectId: string, frameId: string): string | null {
  const db = getProjectDb(projectId);
  const row = db
    .prepare("SELECT image_path FROM frame WHERE id = ?")
    .get(frameId) as { image_path: string } | undefined;
  return row?.image_path ?? null;
}

function refLabel(ref: {
  assetName: string;
  variantLabel: string;
  viewLabel: string;
}): string {
  const detail = [ref.variantLabel, ref.viewLabel].filter(Boolean).join("·");
  return detail ? `${ref.assetName}（${detail}）` : ref.assetName;
}

export function buildManifest(
  projectId: string,
  segmentId: string,
): { manifest: ManifestItem[]; segment: StoredSegment; scene: StoredSceneStoryboard } | null {
  const scenes = getStoryboard(projectId);
  const found = findSegment(scenes, segmentId);
  if (!found) return null;
  const { scene, segment } = found;

  const manifest: ManifestItem[] = [];
  const byViewId = new Map<string, number>();
  let slot = 1;

  if (segment.firstFrameId) {
    const framePath = getFramePath(projectId, segment.firstFrameId);
    // 帧行可能已随段落/视频被删除：只有图片真实存在时才作为「本段起始画面」。
    if (framePath && fs.existsSync(/* turbopackIgnore: true */ framePath)) {
      manifest.push({
        slot,
        role: "start",
        label: "本段起始画面",
        imagePath: framePath,
        viewId: null,
        frameId: segment.firstFrameId,
        viewUrl: `/api/projects/${projectId}/frames/${segment.firstFrameId}/image`,
      });
      slot += 1;
    }
  }

  const groups: Array<"scene" | "character" | "prop"> = [
    "scene",
    "character",
    "prop",
  ];
  for (const role of groups) {
    for (const shot of segment.shots) {
      for (const ref of shot.refs) {
        if (ref.role !== role || !ref.viewId) continue;
        if (byViewId.has(ref.viewId)) continue;
        byViewId.set(ref.viewId, slot);
        manifest.push({
          slot,
          role,
          label: refLabel(ref),
          imagePath: ref.imagePath,
          viewId: ref.viewId,
          frameId: null,
          viewUrl: `/api/projects/${projectId}/assets/views/${ref.viewId}/image`,
        });
        slot += 1;
      }
    }
  }

  return { manifest, segment, scene };
}

// 把俯视坐标/角度翻译成模型能读懂的自然语言方位。
// pos.x 越小越靠画面左，pos.y 越小越靠后景（远），越大越靠前景（近）。
function positionWord(pos: { x: number; y: number }): string {
  const horiz = pos.x < 0.34 ? "画面左侧" : pos.x < 0.67 ? "画面中部" : "画面右侧";
  const depth = pos.y < 0.34 ? "后景" : pos.y < 0.67 ? "中景" : "前景";
  return `${horiz}${depth}`;
}

// facing：0=画面右方，顺时针增大（90=朝镜头/画面下方，270=背对镜头/画面上方）。
function facingWord(facing: number): string {
  const deg = ((facing % 360) + 360) % 360;
  if (deg < 22.5 || deg >= 337.5) return "面向画面右侧";
  if (deg < 67.5) return "面向画面右下方（朝镜头偏右）";
  if (deg < 112.5) return "面向镜头";
  if (deg < 157.5) return "面向画面左下方（朝镜头偏左）";
  if (deg < 202.5) return "面向画面左侧";
  if (deg < 247.5) return "面向画面左上方（背对镜头偏左）";
  if (deg < 292.5) return "背对镜头";
  return "面向画面右上方（背对镜头偏右）";
}

export function buildBlockingText(
  scene: StoredSceneStoryboard,
  types?: string[],
): string {
  const b = scene.blocking;
  if (!b) return "（本场未设置站位信息）";
  const nodes = b.nodes
    .filter((n) => !types || types.includes(n.type))
    .map((n) => `${n.label}在${positionWord(n.pos)}、${facingWord(n.facing)}`)
    .join("；");
  const axisFrom = b.nodes.find((n) => n.id === b.axis.from)?.label ?? b.axis.from;
  const axisTo = b.nodes.find((n) => n.id === b.axis.to)?.label ?? b.axis.to;
  return [
    nodes ? `人物/元素站位（俯视）：${nodes}。` : "",
    `以 ${axisFrom} 与 ${axisTo} 的连线为轴线，镜头始终处于轴线${b.cameraSide === "left" ? "左" : "右"}侧，不跨越 180° 轴线。`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDialogue(lines: DialogueLine[]): string {
  return lines
    .filter((line) => line.text.trim())
    .map((line) =>
      line.character.trim()
        ? `${line.character}：「${line.text}」`
        : `「${line.text}」`,
    )
    .join("\n");
}

export function renderSegment(
  projectId: string,
  segmentId: string,
  platform: string,
): RenderedPrompt | null {
  const built = buildManifest(projectId, segmentId);
  if (!built) return null;
  const { manifest, segment, scene } = built;
  const project = getProject(projectId);
  if (!project) return null;
  const template = getTemplateByPlatform(platform);
  const rules = getContinuityRules();

  const slotByViewId = new Map<string, number>();
  for (const item of manifest) {
    if (item.viewId) slotByViewId.set(item.viewId, item.slot);
  }
  const firstFrameSlot = manifest.find((m) => m.role === "start")?.slot;

  const legendItems = manifest
    .map((m) => `图${m.slot}=${m.label}`)
    .join("\n");

  const characterLockLines = manifest
    .filter((m) => m.role === "character")
    .map(
      (m) =>
        `${m.label.split("（")[0]}：全程保持图${m.slot}中的脸型、发型、发色、服装、体型、配饰、妆容一致。`,
    );
  // 参考图只用于保持身份与场景，不能把设定表/多视图/拼图本身画进视频。
  if (manifest.length > 0) {
    characterLockLines.push(
      "参考图仅用于保持人物与场景一致，不要把参考图本身（设定表、多视图、拼图、边框）画进画面。",
    );
  }
  const characterLocks = characterLockLines.join("\n");

  const nodeLabelById = new Map(
    (scene.blocking?.nodes ?? []).map((n) => [n.id, n.label]),
  );

  const isFirstOfScene = scene.segments[0]?.id === segment.id;

  const shotList = segment.shots
    .map((shot) => {
      const sideText = shot.camera.side
        ? `机位在轴线${shot.camera.side === "left" ? "左" : "右"}侧`
        : "";
      const camera = [
        shot.camera.shotSize,
        shot.camera.focal,
        shot.camera.angle,
        shot.camera.movement,
        sideText,
      ]
        .filter(Boolean)
        .join("，");
      const refSlots = new Set<number>();
      // 起始画面（图N）只在段首镜引用；其余镜用各自的内容参考图。
      if (firstFrameSlot && shot.id === segment.shots[0]?.id) {
        refSlots.add(firstFrameSlot);
      }
      for (const ref of shot.refs) {
        if (ref.viewId) {
          const s = slotByViewId.get(ref.viewId);
          if (s) refSlots.add(s);
        }
      }
      const refText = [...refSlots]
        .sort((a, b) => a - b)
        .map((s) => `@图${s}`)
        .join(" ");
      const subjects = shot.subjectNodeIds
        .map((nid) => nodeLabelById.get(nid) ?? nid)
        .filter(Boolean);
      const lines = [
        `分镜${shot.index + 1}（${(shot.durationMs / 1000).toFixed(1)}秒）：${[shot.lighting, camera].filter(Boolean).join("，")}。${shot.action}`,
      ];
      if (subjects.length) lines.push(`画面内：${subjects.join("、")}`);
      const dialogueText = formatDialogue(shot.dialogue);
      if (dialogueText) lines.push(`台词：\n${dialogueText}`);
      if (shot.expression) lines.push(`表情：${shot.expression}`);
      if (refText) lines.push(`参考：${refText}`);
      return lines.join("\n");
    })
    .join("\n\n");

  // 连续段额外用文字交代上一段的结尾状态，文字承接作为图像起始画面之外的补充。
  const segmentIndex = scene.segments.findIndex((s) => s.id === segment.id);
  const prevSegment = segmentIndex > 0 ? scene.segments[segmentIndex - 1] : null;
  const prevTailText =
    prevSegment && !segment.hardCut && !isFirstOfScene
      ? (() => {
          const last = prevSegment.shots[prevSegment.shots.length - 1];
          if (!last) return "";
          const subjects = last.subjectNodeIds
            .map((nid) => nodeLabelById.get(nid) ?? nid)
            .filter(Boolean);
          const dialogue = formatDialogue(last.dialogue).replace(/\n/g, " ");
          return `上一段结尾状态：${last.action}${last.expression ? `（${last.expression}）` : ""}${subjects.length ? `；画面内：${subjects.join("、")}` : ""}${dialogue ? `；末句台词：${dialogue}` : ""}${last.lighting ? `；光线：${last.lighting}` : ""}。本段必须从该状态自然接续，不得跳变。`;
        })()
      : "";

  const anchorText = [
    firstFrameSlot
      ? `本段从图${firstFrameSlot}（起始画面）开始：人物位置、光线方向、色调与之保持一致。`
      : segment.hardCut || isFirstOfScene
        ? "本段与上一段为硬切（非连续镜头）；人物站位、光线方向、色调仍需与本场保持一致。"
        : "",
    prevTailText,
  ]
    .filter(Boolean)
    .join("\n");

  const transitionText = [
    "同一段内：延续上一镜的镜头，动作与视线自然接续、不跳帧；换机位的镜头允许切换景别与角度，但人物的外观、服装、发型与场景陈设保持一致。",
    "光线方向与色温在段内保持一致，避免无故跳变。",
    rules.axis180 ? "全段不跨越 180° 轴线。" : "",
  ]
    .filter(Boolean)
    .join("\n");

  const sceneSlot = manifest.find((m) => m.role === "scene")?.slot;

  const vars: Record<string, string> = {
    style: project.style ? `${project.style}风格。` : "",
    aspectRatio: project.aspectRatio,
    projectName: project.name,
    sceneHeader: `场景：${scene.location || scene.sceneSlug}（参考图${sceneSlot ?? "—"}），${[scene.timeOfDay, scene.interiorExterior ? `${scene.interiorExterior}景` : ""].filter(Boolean).join("，")}。`,
    manifestLegend: legendItems,
    characterLocks,
    blockingText: buildBlockingText(scene),
    anchorText,
    shotList,
    transitionText,
    negativeText: DEFAULT_NEGATIVE_TEXT,
    generationMode:
      segment.generationMode === "multi-shot"
        ? "多镜（段内连续生成）"
        : "单镜",
    targetSeconds: (segment.targetMs / 1000).toFixed(1),
    items: legendItems,
  };

  const body = renderTemplate(template.bodyTemplate, vars);
  const legend = renderTemplate(template.legendTemplate, vars);
  const params = renderTemplate(template.paramsTemplate, vars);

  return { platform, body, legend, params, manifest, shotCount: segment.shots.length };
}
