import type { JobInfo } from "@core/shared/jobs";

export interface GlobalJob extends JobInfo {
  projectId: string;
  episodeName: string;
  seriesId: string;
  seriesName: string;
}

export const JOB_LABELS: Record<string, string> = {
  "story-to-script": "生成剧本",
  "script-to-assets": "生成资产",
  "script-to-storyboard": "生成分镜",
  anchor: "批量锚定",
  repair: "AI 修复",
  "segment-regenerate": "重新生成本段",
  compose: "视频合成",
};

export const CANCEL_ENDPOINT: Record<string, string> = {};

export function jobLabel(kind: string): string {
  return JOB_LABELS[kind] ?? kind;
}

export function canCancelJob(kind: string): boolean {
  return Boolean(CANCEL_ENDPOINT[kind]);
}

export function isCancelledMessage(message: string): boolean {
  return /已取消|被新的同类任务取代/.test(message);
}

export function jobKey(job: Pick<GlobalJob, "id" | "projectId">): string {
  return `${job.projectId}:${job.id}`;
}

export function jobHref(
  job: Pick<GlobalJob, "kind" | "seriesId" | "projectId">,
): string {
  const base = `/projects/${job.seriesId}/${job.projectId}`;
  switch (job.kind) {
    case "story-to-script":
      return `${base}/script`;
    case "script-to-assets":
      return `${base}/assets`;
    case "compose":
      return `${base}/compose`;
    default:
      return `${base}/storyboard`;
  }
}
