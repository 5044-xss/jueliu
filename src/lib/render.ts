import { getStoryboard, getContinuityRules } from "@/lib/storyboard";
import { getProject } from "@/lib/projects";
import { getTemplateByPlatform } from "@/lib/library/templates";
import { getProjectDb } from "@/lib/db";
import { DEFAULT_NEGATIVE_TEXT } from "@/lib/templates-defaults";
import type {
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

function buildBlockingText(scene: StoredSceneStoryboard): string {
  const b = scene.blocking;
  if (!b) return "（本场未设置站位信息）";
  const nodes = b.nodes
    .map(
      (n) =>
        `${n.label}位于(${n.pos.x.toFixed(2)}, ${n.pos.y.toFixed(2)})，朝向${Math.round(n.facing)}°`,
    )
    .join("；");
  return [
    nodes ? `人物/元素站位：${nodes}。` : "",
    `镜头始终处于 ${b.axis.from}↔${b.axis.to} 轴线的${b.cameraSide === "left" ? "左" : "右"}侧（不跨越 180° 轴线）。`,
  ]
    .filter(Boolean)
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
  const rules = getContinuityRules(projectId);

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
    .map((m) => `${m.label.split("（")[0]}：全程保持图${m.slot}中的脸型、发型、服装、体型完全一致。`)
    .join("\n");

  const shotList = segment.shots
    .map((shot) => {
      const camera = [
        shot.camera.shotSize,
        shot.camera.focal,
        shot.camera.angle,
        shot.camera.movement,
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
      const lines = [
        `分镜${shot.index + 1}（${(shot.durationMs / 1000).toFixed(1)}秒）：${[shot.lighting, camera].filter(Boolean).join("，")}。${shot.action}`,
      ];
      if (shot.dialogue) lines.push(`台词：「${shot.dialogue}」`);
      if (shot.expression) lines.push(`表情：${shot.expression}`);
      if (refText) lines.push(`参考：${refText}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const anchorText = firstFrameSlot
    ? `本段从图${firstFrameSlot}首帧平滑接续：人物位置、光线方向、色调与首帧保持一致。`
    : "（本段未设置首帧锚定）";

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
    firstFrameNote: firstFrameSlot
      ? `图${firstFrameSlot}（首帧）`
      : "无（手动上传首帧）",
    anchorEnabled: rules.firstFrameAnchor ? "开启" : "关闭",
    items: legendItems,
  };

  const body = renderTemplate(template.bodyTemplate, vars);
  const legend = renderTemplate(template.legendTemplate, vars);
  const params = renderTemplate(template.paramsTemplate, vars);

  return { platform, body, legend, params, manifest };
}
