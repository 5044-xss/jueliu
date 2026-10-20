import { cancelRunningJobs } from "@core/server/jobs";
import { cancelSegmentImages } from "./image";
import { cancelProjectVideos } from "./video";

/**
 * 分镜/剧本/资产即将失效或重建时，先停掉正在跑的出图/出视频任务。
 * 否则后台轮询会在段落被删除后继续回写（孤儿文件、任务假成功），
 * 或把旧内容的产物贴到新分镜上。
 *
 * 只做同步标记；中断 ComfyUI 实例是尽力而为的异步动作，不阻塞请求。
 */
export function cancelProjectGeneration(projectId: string): void {
  cancelSegmentImages(projectId);
  cancelRunningJobs(projectId, "gen-image", "已取消（上游内容已变更）");
  void cancelProjectVideos(projectId).catch(() => undefined);
}
