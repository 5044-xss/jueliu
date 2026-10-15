import fs from "node:fs";
import path from "node:path";
import { getProject } from "@/lib/projects";
import { buildManifest, buildBlockingText } from "@/lib/render";
import { getFramePath } from "@/lib/paths";
import { getProjectDb } from "@/lib/db";
import { getStoryboard } from "@/lib/storyboard";
import {
  getFrames,
  upsertFrame,
  setSegmentFirstFrame,
  releaseFrameAdoption,
  type StoredFrame,
} from "@/lib/frames";

export interface KeyframeRef {
  slot: number; // 图1 图2 …（按上传顺序，从 1 起）
  role: "scene" | "character" | "prop";
  label: string;
  viewId: string | null;
  viewUrl: string | null;
}

export interface KeyframePrompt {
  prompt: string;
  refs: KeyframeRef[];
  aspect: string;
  segmentLabel: string;
}

export function buildKeyframePrompt(
  projectId: string,
  segmentId: string,
): KeyframePrompt | null {
  const built = buildManifest(projectId, segmentId);
  if (!built) return null;
  const { manifest, segment, scene } = built;
  const project = getProject(projectId);
  if (!project) return null;

  const firstShot = segment.shots[0];
  if (!firstShot) return null;

  // 参考图只取 scene/character/prop，不包含起始画面（起始画面是产物不是输入），并按上传顺序重排为图1..图N。
  const refs: KeyframeRef[] = manifest
    .filter((m) => m.role !== "start")
    .map((m, i) => ({
      slot: i + 1,
      role: m.role as KeyframeRef["role"],
      label: m.label,
      viewId: m.viewId,
      viewUrl: m.viewUrl,
    }));

  const nodeById = new Map(
    (scene.blocking?.nodes ?? []).map((n) => [n.id, n]),
  );

  const sideText = firstShot.camera.side
    ? `机位在轴线${firstShot.camera.side === "left" ? "左" : "右"}侧`
    : "";
  const camera = [
    firstShot.camera.shotSize,
    firstShot.camera.focal,
    firstShot.camera.angle,
    firstShot.camera.movement,
    sideText,
  ]
    .filter(Boolean)
    .join("，");

  const charFromRefs = refs
    .filter((r) => r.role === "character")
    .map((r) => r.label.split("（")[0]);
  // 只取人物节点：站位里还有道具/屏幕/地标节点，不能算进「画面中的人物」。
  const charFromNodes: string[] = [];
  for (const shot of segment.shots) {
    for (const nid of shot.subjectNodeIds) {
      const node = nodeById.get(nid);
      if (node && node.type === "character") charFromNodes.push(node.label);
    }
  }
  const characters = [...new Set([...charFromRefs, ...charFromNodes])];

  const io = scene.interiorExterior ? `${scene.interiorExterior}景` : "";
  const sceneText = [scene.location, scene.timeOfDay, io]
    .filter(Boolean)
    .join("，");

  const lines: string[] = [];
  if (project.style.trim()) lines.push(`${project.style.trim()}。`);
  lines.push(
    "生成本段视频的【起始画面】：一张真实的电影画面定格，是剧情里真实的一刻；不是参考图、不是角色设定表、不是多视图、不是拼图或多格画面。",
  );
  lines.push(
    camera
      ? `镜头：${camera}${firstShot.action ? `：${firstShot.action}` : ""}。`
      : `镜头：${firstShot.action}。`,
  );
  lines.push(`人物站位：${buildBlockingText(scene, ["character"])}`);
  lines.push(`场景：${sceneText || "（未设置场景）"}。`);
  if (characters.length) {
    lines.push(
      `画面中的人物（必须全部出现）：${characters.join("、")}；每个人只出现一个，不要分身/克隆/倒影/多余的人。`,
    );
  }
  if (firstShot.lighting) lines.push(`光线：${firstShot.lighting}。`);
  if (refs.length) {
    const refOrder = refs.map((r) => `图${r.slot}=${r.label}`).join("；");
    lines.push(`参考图按此顺序上传：${refOrder}。`);
    lines.push(
      "只用参考图保持人物与场景一致，不要把参考图本身（设定表/拼图/多格/边框）画进画面。",
    );
  }
  lines.push(`${project.aspectRatio} 构图，自然透视，主体清晰。`);
  lines.push(
    "不要出现文字、水印、logo、字幕、分屏、拼图、设定表、边框、箭头或标签。",
  );

  return {
    prompt: lines.join("\n"),
    refs,
    aspect: project.aspectRatio,
    segmentLabel: `${scene.sceneSlug || `第${scene.sceneIndex}场`} · 第${segment.index}段`,
  };
}

// 把外部图片存为「该段起始画面（kind='start'）」，并设为 segment.first_frame_id。
// 用独立的 start kind，避免与「截首帧」写出的 kind='first' 互相覆盖。
export function saveFirstFrameImage(
  projectId: string,
  segmentId: string,
  data: Buffer,
  ext = "png",
): StoredFrame {
  const vendor = getProject(projectId)?.vendor ?? "doubao";
  const target = getFramePath(projectId, vendor, segmentId, "start", ext);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  // 覆盖起始画面前先解除别段对它的采用，避免采用它的段静默换图。
  releaseFrameAdoption(projectId, segmentId, "start");

  const db = getProjectDb(projectId);
  const existing = db
    .prepare("SELECT image_path FROM frame WHERE segment_id = ? AND kind = 'start'")
    .get(segmentId) as { image_path: string } | undefined;
  if (
    existing?.image_path &&
    existing.image_path !== target &&
    fs.existsSync(existing.image_path)
  ) {
    fs.rmSync(existing.image_path, { force: true });
  }

  fs.writeFileSync(target, data);
  const frame = upsertFrame(projectId, segmentId, "start", target);
  setSegmentFirstFrame(projectId, segmentId, frame.id);
  return frame;
}

export interface StartFrameState {
  // 当前采用的起始画面（即图1），没有则为 null。
  adopted: { id: string; imageUrl: string } | null;
  // 可采用的候选：上一段的结尾画面。不适用时为 null，并给出原因。
  candidate: { id: string; imageUrl: string } | null;
  reason: string | null;
}

export function getStartFrameState(
  projectId: string,
  segmentId: string,
): StartFrameState | null {
  const scenes = getStoryboard(projectId);
  let found: { scene: (typeof scenes)[number]; index: number } | null = null;
  for (const scene of scenes) {
    const index = scene.segments.findIndex((s) => s.id === segmentId);
    if (index >= 0) {
      found = { scene, index };
      break;
    }
  }
  if (!found) return null;
  const { scene, index } = found;
  const segment = scene.segments[index];
  const imageUrl = (frameId: string) =>
    `/api/projects/${projectId}/frames/${frameId}/image`;

  const frames = getFrames(projectId, segmentId);
  const adoptedFrame = segment.firstFrameId
    ? frames.find((f) => f.id === segment.firstFrameId)
    : undefined;

  let candidate: StartFrameState["candidate"] = null;
  let reason: string | null = null;
  if (index === 0) {
    reason = "本段是场次开头，独立成镜，不需要承接上一段画面。";
  } else if (segment.hardCut) {
    reason = "本段与上一段为硬切，不需要承接上一段画面。";
  } else {
    const prev = scene.segments[index - 1];
    const prevLast = getFrames(projectId, prev.id).find((f) => f.kind === "last");
    if (prevLast) {
      candidate = { id: prevLast.id, imageUrl: imageUrl(prevLast.id) };
    } else {
      reason = "上一段还没有回传视频，暂无结尾画面可用。";
    }
  }

  return {
    adopted: adoptedFrame
      ? { id: adoptedFrame.id, imageUrl: imageUrl(adoptedFrame.id) }
      : null,
    candidate,
    reason,
  };
}
