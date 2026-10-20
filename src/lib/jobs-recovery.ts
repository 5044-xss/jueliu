import { getProjectDb } from "@core/server/db";
import { listSeriesWithCounts, projectExists } from "@core/server/projects";

const globalForRecovery = globalThis as unknown as {
  __juemanJobsProcessStartedAt?: string;
  __juemanJobsRecovered?: boolean;
};

const processStartedAt =
  globalForRecovery.__juemanJobsProcessStartedAt ??
  (globalForRecovery.__juemanJobsProcessStartedAt = new Date().toISOString());

export function recoverInterruptedJobsOnce(): void {
  if (globalForRecovery.__juemanJobsRecovered) return;
  globalForRecovery.__juemanJobsRecovered = true;

  const finishedAt = new Date().toISOString();
  for (const series of listSeriesWithCounts()) {
    for (const episode of series.episodes) {
      if (!projectExists(episode.id)) continue;
      try {
        const db = getProjectDb(episode.id);
        db.prepare(
          `UPDATE job SET status = 'failed', message = ?, finished_at = ?
           WHERE project_id = ? AND status = 'running' AND started_at < ?`,
        ).run(
          "任务已中断（应用或服务已重启），请重试",
          finishedAt,
          episode.id,
          processStartedAt,
        );
        // job 已结束，但段落的生成状态可能还停在 queued/running/retrying，
        // 会让 UI 一直显示「生成中」。只清理本次进程启动前留下的状态。
        db.prepare(
          `UPDATE segment SET gen_status = 'failed', updated_at = ?
           WHERE project_id = ? AND gen_status IN ('queued','running','retrying')
             AND updated_at < ?`,
        ).run(finishedAt, episode.id, processStartedAt);
      } catch {
        continue;
      }
    }
  }
}
