import { NextResponse } from "next/server";
import { ensureCore } from "@/lib/bootstrap";
import { recoverInterruptedJobsOnce } from "@/lib/jobs-recovery";
import { isCancelledMessage, jobLabel, type GlobalJob } from "@/lib/jobs";
import { getProjectJobs } from "@core/server/jobs";
import {
  listSeriesWithCounts,
  projectExists,
} from "@core/server/projects";
import type { JobInfo } from "@core/shared/jobs";

export const dynamic = "force-dynamic";

const HISTORY_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const STATUSES = ["all", "failed", "canceled", "succeeded"];

export async function GET(request: Request) {
  ensureCore();
  recoverInterruptedJobsOnce();

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "all";
  const seriesId = url.searchParams.get("seriesId");
  const kind = url.searchParams.get("kind");
  const before = url.searchParams.get("before");
  const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  if (!STATUSES.includes(status)) {
    return NextResponse.json({ error: "状态参数不合法" }, { status: 400 });
  }
  const beforeTime = before ? Date.parse(before) : null;
  if (before && !Number.isFinite(beforeTime)) {
    return NextResponse.json({ error: "分页参数不合法" }, { status: 400 });
  }

  const cutoff = Date.now() - HISTORY_KEEP_MS;
  const jobs: GlobalJob[] = [];

  for (const series of listSeriesWithCounts()) {
    if (seriesId && series.id !== seriesId) continue;
    for (const episode of series.episodes) {
      if (!projectExists(episode.id)) continue;
      let projectJobs: JobInfo[] = [];
      try {
        projectJobs = getProjectJobs(episode.id, 300);
      } catch {
        continue;
      }
      for (const job of projectJobs) {
        if (job.status === "running") continue;
        if (!job.finishedAt) continue;
        const finishedAt = Date.parse(job.finishedAt);
        if (!Number.isFinite(finishedAt) || finishedAt < cutoff) continue;
        if (beforeTime !== null && Date.parse(job.startedAt) >= beforeTime) {
          continue;
        }

        const canceled =
          job.status === "failed" && isCancelledMessage(job.message);
        if (status === "failed" && (job.status !== "failed" || canceled)) {
          continue;
        }
        if (status === "canceled" && !canceled) continue;
        if (status === "succeeded" && job.status !== "succeeded") continue;
        if (kind && job.kind !== kind) continue;
        if (query) {
          const haystack = [
            job.kind,
            jobLabel(job.kind),
            job.message,
            episode.name,
            series.name,
          ]
            .join("\n")
            .toLowerCase();
          if (!haystack.includes(query)) continue;
        }

        jobs.push({
          ...job,
          projectId: episode.id,
          episodeName: episode.name,
          seriesId: series.id,
          seriesName: series.name,
        });
      }
    }
  }

  jobs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const page = jobs.slice(0, limit);
  const nextCursor =
    jobs.length > limit && page.length > 0
      ? page[page.length - 1].startedAt
      : null;

  return NextResponse.json({ jobs: page, nextCursor });
}
