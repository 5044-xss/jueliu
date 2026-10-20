import { captureTailCandidate, getFrames, setSegmentFirstFrame } from "@core/server/frames";
import { getStoryboard } from "@core/server/storyboard";

export interface TailChainResult {
  captured: boolean;
  /** 被采用为「起始画面」的下一段 id。 */
  adoptedSegmentId?: string;
  reason?: string;
}

/**
 * 找到同场中紧随其后、且与本段连续的下一段。
 * 场首无上一段；硬切（hardCut）表示与上一段不连续，则返回 null。
 */
function findContinuousNext(
  projectId: string,
  segmentId: string,
): {
  id: string;
  firstFrameOrigin: "manual" | "auto" | null;
  hasVideo: boolean;
} | null {
  for (const scene of getStoryboard(projectId)) {
    const index = scene.segments.findIndex((s) => s.id === segmentId);
    if (index < 0) continue;
    const next = scene.segments[index + 1];
    if (!next || next.hardCut) return null;
    return {
      id: next.id,
      firstFrameOrigin: next.firstFrameOrigin,
      hasVideo: Boolean(next.videoPath),
    };
  }
  return null;
}

/**
 * 出片/回传后：若本段的下一段是连续段，则截本段尾帧并自动设为下一段的起始画面。
 * 非连续段（硬切/场尾）不截尾帧，直接跳过。
 * 下一段若已有**人工指定**的起始画面、或已经生成过视频，不覆盖
 * （自动来源只填补空位/覆盖旧的自动来源）。
 */
export async function captureAndAdoptTail(
  projectId: string,
  segmentId: string,
): Promise<TailChainResult> {
  const next = findContinuousNext(projectId, segmentId);
  if (!next) {
    return { captured: false, reason: "下一段为硬切/场尾或不存在，不截尾帧" };
  }
  if (next.firstFrameOrigin === "manual") {
    return {
      captured: false,
      reason: "下一段起始画面为人工指定，不自动覆盖",
    };
  }
  if (next.hasVideo) {
    return {
      captured: false,
      reason: "下一段已生成视频，不再改其起始画面",
    };
  }
  const tail = await captureTailCandidate(projectId, segmentId);
  if (!tail.captured) return { captured: false, reason: tail.reason };

  const last = getFrames(projectId, segmentId).find((f) => f.kind === "last");
  if (!last) return { captured: false, reason: "已截取尾帧但未找到记录" };

  setSegmentFirstFrame(projectId, next.id, last.id, "auto");
  return { captured: true, adoptedSegmentId: next.id };
}
