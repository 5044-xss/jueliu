"use client";

// 重新生成是级联破坏性操作：剧本→清空资产+分镜，资产→清空分镜。
// 这里在确认前拉取下游数据量，好在弹窗里说清「将要清空什么」。

export interface CascadeImpact {
  assets: number;
  segments: number;
  segmentsWithVideo: number;
}

export async function fetchCascadeImpact(
  projectId: string,
): Promise<CascadeImpact> {
  const [assetsRes, storyboardRes] = await Promise.all([
    fetch(`/api/projects/${projectId}/assets`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetch(`/api/projects/${projectId}/storyboard`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);

  const assets = (assetsRes?.assets ?? []) as unknown[];
  const scenes = (storyboardRes?.scenes ?? []) as Array<{
    segments?: Array<{ videoPath?: string | null }>;
  }>;

  let segments = 0;
  let segmentsWithVideo = 0;
  for (const scene of scenes) {
    for (const segment of scene.segments ?? []) {
      segments += 1;
      if (segment.videoPath) segmentsWithVideo += 1;
    }
  }

  return { assets: assets.length, segments, segmentsWithVideo };
}

export function describeCascade(
  impact: CascadeImpact,
  scope: { assets: boolean; storyboard: boolean },
): string {
  const parts: string[] = [];
  if (scope.assets && impact.assets > 0) {
    parts.push(`${impact.assets} 个资产（含已回传图片）`);
  }
  if (scope.storyboard && impact.segments > 0) {
    parts.push(
      `${impact.segments} 段分镜${
        impact.segmentsWithVideo > 0
          ? `（含 ${impact.segmentsWithVideo} 段已回传视频）`
          : ""
      }`,
    );
  }
  return parts.join("、");
}
