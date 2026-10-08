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
    manifest.push({
      slot,
      role: "first_frame",
      label: "首帧（上一段尾帧）",
      imagePath: framePath,
      viewId: null,
      frameId: segment.firstFrameId,
      viewUrl: framePath
        ? `/api/projects/${projectId}/frames/${segment.firstFrameId}/image`
        : null,
    });
    slot += 1;
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

function buildBlockingText(scene: StoredSceneStoryboard): string {
  const b = scene.blocking;
  if (!b) return "（本场未设置站位信息）";
  const nodes = b.nodes
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
  const firstFrameSlot = manifest.find((m) => m.role === "first_frame")?.slot;

  const legendItems = manifest
    .map((m) => `图${m.slot}=${m.label}`)
    .join("\n");

  const characterLocks = manifest
    .filter((m) => m.role === "character")
    .map(
      (m) =>
        `${m.label.split("（")[0]}：全程保持图${m.slot}中的脸型、发型、发色、服装、体型、配饰、妆容完全一致。`,
    )
    .join("\n");

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
      for (const ref of shot.refs) {
        if (ref.role === "first_frame" && firstFrameSlot) {
          refSlots.add(firstFrameSlot);
        } else if (ref.viewId) {
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

  const anchorRequired =
    rules.firstFrameAnchor && !segment.hardCut && !isFirstOfScene;

  // 连续段额外用文字交代上一段的结尾状态，图像锚定 + 文字承接双保险。
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
      ? `本段从图${firstFrameSlot}首帧平滑接续：人物位置、光线方向、色调与首帧保持一致。`
      : segment.hardCut || isFirstOfScene
        ? "本段与上一段为硬切（非连续镜头），无需接续首帧；但人物站位、光线方向、色调仍需与本场保持一致。"
        : "（本段未设置首帧锚定）",
    prevTailText,
  ]
    .filter(Boolean)
    .join("\n");

  const firstFrameNote = firstFrameSlot
    ? `图${firstFrameSlot}=上一段尾帧（本段与上一段为连续镜头）`
    : segment.hardCut || isFirstOfScene
      ? "无需首帧（本段与上一段为硬切/场次首段，是独立镜头）"
      : anchorRequired
        ? "本段与上一段是连续镜头：请先截取上一段尾帧并「设为下一段首帧」（当前未锚定）"
        : "无需首帧";

  const transitionText = [
    "镜间动作连续、不跳帧；视线匹配；光线方向、色温、焦段变化连续，禁止突变。",
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
    generationMode: segment.generationMode,
    targetSeconds: (segment.targetMs / 1000).toFixed(1),
    firstFrameNote,
    anchorEnabled: rules.firstFrameAnchor ? "开启" : "关闭",
    items: legendItems,
  };

  const body = renderTemplate(template.bodyTemplate, vars);
  const legend = renderTemplate(template.legendTemplate, vars);
  const params = renderTemplate(template.paramsTemplate, vars);

  return { platform, body, legend, params, manifest };
}
