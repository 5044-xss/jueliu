import { NextResponse } from "next/server";
import { ensureCore } from "@/lib/bootstrap";
import { recoverInterruptedJobsOnce } from "@/lib/jobs-recovery";
import type { GlobalJob } from "@/lib/jobs";
import { getProjectJobs } from "@core/server/jobs";
import {
  listSeriesWithCounts,
  projectExists,
} from "@core/server/projects";
import type { JobInfo } from "@core/shared/jobs";

export const dynamic = "force-dynamic";

const FINISHED_KEEP_MS = 24 * 60 * 60 * 1000;
const LIMIT = 40;

export async function GET() {
  ensureCore();
  recoverInterruptedJobsOnce();

  const now = Date.now();
  const jobs: GlobalJob[] = [];

  for (const series of listSeriesWithCounts()) {
    for (const episode of series.episodes) {
      if (!projectExists(episode.id)) continue;
      let projectJobs: JobInfo[] = [];
      try {
        projectJobs = getProjectJobs(episode.id, 200);
      } catch {
        continue;
      }
      for (const job of projectJobs) {
        if (job.status !== "running") {
          if (!job.finishedAt) continue;
          const finishedAt = Date.parse(job.finishedAt);
          if (!Number.isFinite(finishedAt) || now - finishedAt > FINISHED_KEEP_MS) {
            continue;
          }
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

  const order: Record<string, number> = {
    running: 0,
    failed: 1,
    succeeded: 2,
  };
  jobs.sort(
    (a, b) =>
      (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
      b.startedAt.localeCompare(a.startedAt),
  );

  return NextResponse.json({ jobs: jobs.slice(0, LIMIT) });
}
