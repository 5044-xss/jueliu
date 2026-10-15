import { getProjectDb, newId, nowIso } from "@/lib/db";

export type JobStatus = "running" | "succeeded" | "failed";

export interface JobInfo {
  id: string;
  kind: string;
  status: JobStatus;
  message: string;
  startedAt: string;
  finishedAt: string | null;
}

interface JobRow {
  id: string;
  kind: string;
  status: string;
  message: string;
  started_at: string;
  finished_at: string | null;
}

// 生成类任务（剧本/资产/分镜）最长允许 40 分钟；这里留 5 分钟余量，
// 让 LLM 客户端的 40 分钟超时先生效并给出明确错误，而不是被判定为「任务中断」。
const STALE_MS = 45 * 60 * 1000;

function mapJob(row: JobRow): JobInfo {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status as JobStatus,
    message: row.message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function startJob(projectId: string, kind: string): string {
  const db = getProjectDb(projectId);
  const now = nowIso();
  db.prepare(
    `UPDATE job SET status = 'failed', message = '被新的同类任务取代', finished_at = ?
     WHERE project_id = ? AND kind = ? AND status = 'running'`,
  ).run(now, projectId, kind);
  const id = newId();
  db.prepare(
    `INSERT INTO job (id, project_id, kind, status, message, started_at, finished_at)
     VALUES (?, ?, ?, 'running', '', ?, NULL)`,
  ).run(id, projectId, kind, now);
  return id;
}

export function finishJob(
  projectId: string,
  jobId: string,
  status: Exclude<JobStatus, "running">,
  message = "",
): void {
  const db = getProjectDb(projectId);
  db.prepare(
    "UPDATE job SET status = ?, message = ?, finished_at = ? WHERE id = ?",
  ).run(status, message, nowIso(), jobId);
}

export function getProjectJobs(projectId: string, limit = 30): JobInfo[] {
  const db = getProjectDb(projectId);
  // 只在存在 running 任务时才做超时扫描，避免每次轮询都写库。
  const running = db
    .prepare(
      "SELECT 1 FROM job WHERE project_id = ? AND status = 'running' LIMIT 1",
    )
    .get(projectId);
  if (running) {
    const cutoff = new Date(Date.now() - STALE_MS).toISOString();
    db.prepare(
      `UPDATE job SET status = 'failed', message = '任务中断或超时（服务可能已重启或长时间无响应，请重试）', finished_at = ?
       WHERE project_id = ? AND status = 'running' AND started_at < ?`,
    ).run(nowIso(), projectId, cutoff);
  }
  const rows = db
    .prepare(
      `SELECT id, kind, status, message, started_at, finished_at
       FROM job WHERE project_id = ? ORDER BY started_at DESC LIMIT ?`,
    )
    .all(projectId, limit) as JobRow[];
  return rows.map(mapJob);
}
