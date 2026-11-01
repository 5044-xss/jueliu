import type { JobStatus } from "@core/shared/jobs";
import { db } from "./db";
import type { JobRecord } from "./types";

const HEARTBEAT_STALE_MS = 2 * 60 * 1000;
const FINISHED_KEEP_MS = 24 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function readSessionValue(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionValue(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // 隐私模式等场景下 sessionStorage 不可用，退化为当前运行时内存值。
  }
}

let cachedTabId: string | null = null;
const runId = newId();

function tabId(): string {
  if (cachedTabId) return cachedTabId;
  const stored = readSessionValue("jueliu-job-tab-id");
  if (stored) {
    cachedTabId = stored;
    return stored;
  }
  const next = newId();
  cachedTabId = next;
  writeSessionValue("jueliu-job-tab-id", next);
  return next;
}

function isStale(record: JobRecord, now: number): boolean {
  if (record.status !== "running") return false;
  const heartbeat = Date.parse(record.heartbeatAt ?? record.startedAt);
  return Number.isFinite(heartbeat) && now - heartbeat > HEARTBEAT_STALE_MS;
}

function isOrphanedByReload(record: JobRecord): boolean {
  return (
    record.status === "running" &&
    record.ownerTabId === tabId() &&
    record.ownerRunId !== runId
  );
}

async function failJob(
  jobId: string,
  message: string,
  finishedAt: string,
): Promise<void> {
  await db.jobs.update(jobId, {
    status: "failed" satisfies JobStatus,
    message,
    finishedAt,
  });
}

async function recoverInterruptedJobs(): Promise<void> {
  const running = await db.jobs.where("status").equals("running").toArray();
  if (running.length === 0) return;
  const now = Date.now();
  const finishedAt = new Date(now).toISOString();
  for (const record of running) {
    if (isOrphanedByReload(record)) {
      await failJob(
        record.id,
        "任务已中断（页面已刷新），请重新生成",
        finishedAt,
      );
    } else if (isStale(record, now)) {
      await failJob(
        record.id,
        "任务已中断（长时间无响应或应用已重启），请重试",
        finishedAt,
      );
    }
  }
}

async function pruneJobs(): Promise<void> {
  const cutoff = Date.now() - FINISHED_KEEP_MS;
  const jobs = await db.jobs.toArray();
  const expired = jobs.filter((job) => {
    if (job.status === "running") return false;
    const finishedAt = job.finishedAt ? Date.parse(job.finishedAt) : NaN;
    return Number.isFinite(finishedAt) && finishedAt < cutoff;
  });
  if (expired.length > 0) {
    await db.jobs.bulkDelete(expired.map((job) => job.id));
  }
}

export function toJobInfo(record: JobRecord) {
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    message: record.message,
    targetId: record.targetId,
    params: record.params,
    progress: record.progress ?? null,
    progressCurrent: record.progressCurrent ?? null,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  };
}

export interface StartJobOptions {
  message?: string;
  targetId?: string | null;
  params?: unknown;
  replaceRunning?: boolean;
}

export const jobRepository = {
  async startJob(
    projectId: string,
    kind: string,
    options: StartJobOptions = {},
  ): Promise<string> {
    const timestamp = nowIso();
    if (options.replaceRunning !== false) {
      const running = await db.jobs
        .where("projectId")
        .equals(projectId)
        .toArray();
      const replaced = running.filter(
        (job) => job.kind === kind && job.status === "running",
      );
      if (replaced.length > 0) {
        await db.jobs.bulkPut(
          replaced.map((job) => ({
            ...job,
            status: "failed" as const,
            message: "被新的同类任务取代",
            finishedAt: timestamp,
          })),
        );
      }
    }
    const record: JobRecord = {
      id: newId(),
      projectId,
      kind,
      status: "running",
      message: options.message ?? "",
      targetId: options.targetId ?? null,
      params: options.params,
      progress: null,
      progressCurrent: null,
      startedAt: timestamp,
      finishedAt: null,
      heartbeatAt: timestamp,
      ownerTabId: tabId(),
      ownerRunId: runId,
    };
    await db.jobs.add(record);
    return record.id;
  },

  async finishJob(
    jobId: string,
    status: Exclude<JobStatus, "running">,
    message = "",
  ): Promise<void> {
    const current = await db.jobs.get(jobId);
    if (!current || current.status !== "running") return;
    await db.jobs.update(jobId, {
      status,
      message,
      finishedAt: nowIso(),
      ...(status === "succeeded"
        ? { progress: 100, progressCurrent: 100 }
        : {}),
    });
  },

  async isActive(jobId: string): Promise<boolean> {
    const current = await db.jobs.get(jobId);
    return current?.status === "running";
  },

  async updateProgress(
    jobId: string,
    progress: number | null,
    progressCurrent: number | null = null,
  ): Promise<void> {
    const clamp = (value: number | null): number | null =>
      value === null || !Number.isFinite(value)
        ? null
        : Math.max(0, Math.min(100, Math.round(value)));
    await db.jobs.update(jobId, {
      progress: clamp(progress),
      progressCurrent: clamp(progressCurrent),
    });
  },

  async updateMessage(jobId: string, message: string): Promise<void> {
    await db.jobs.update(jobId, { message });
  },

  async updateTarget(jobId: string, targetId: string | null): Promise<void> {
    await db.jobs.update(jobId, { targetId });
  },

  async heartbeat(jobId: string): Promise<void> {
    await db.jobs.update(jobId, { heartbeatAt: nowIso() });
  },

  startHeartbeat(jobId: string, intervalMs = 10_000): () => void {
    const tick = () => {
      void jobRepository.heartbeat(jobId).catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  },

  async listProjectJobs(projectId: string, limit = 30) {
    await recoverInterruptedJobs();
    const records = await db.jobs
      .where("projectId")
      .equals(projectId)
      .toArray();
    records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return records.slice(0, limit).map(toJobInfo);
  },

  async listRecentJobs() {
    await recoverInterruptedJobs();
    await pruneJobs();
    const records = await db.jobs.toArray();
    records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return records;
  },

  async removeProjectJobs(projectId: string): Promise<void> {
    await db.jobs.where("projectId").equals(projectId).delete();
  },
};
