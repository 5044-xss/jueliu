"use client";

import { useEffect, useRef, useState } from "react";

export interface JobInfo {
  id: string;
  kind: string;
  status: "running" | "succeeded" | "failed";
  message: string;
  startedAt: string;
  finishedAt: string | null;
}

function sameJobs(a: JobInfo[], b: JobInfo[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].id !== b[i].id ||
      a[i].status !== b[i].status ||
      a[i].message !== b[i].message ||
      a[i].finishedAt !== b[i].finishedAt
    ) {
      return false;
    }
  }
  return true;
}

export function useProjectJobs(
  projectId: string,
  onFinished?: (job: JobInfo) => void,
): { jobs: JobInfo[]; running: JobInfo[] } {
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    let cancelled = false;
    const prevRunning = new Set<string>();

    async function poll() {
      const data = await fetch(`/api/projects/${projectId}/jobs`)
        .then((r) => r.json())
        .catch(() => null);
      if (cancelled || !data) return;
      const list = (data.jobs ?? []) as JobInfo[];
      const running = new Set(
        list.filter((j) => j.status === "running").map((j) => j.id),
      );
      for (const job of list) {
        if (prevRunning.has(job.id) && job.status !== "running") {
          onFinishedRef.current?.(job);
        }
      }
      prevRunning.clear();
      running.forEach((id) => prevRunning.add(id));
      setJobs((prev) => (sameJobs(prev, list) ? prev : list));
    }

    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId]);

  return { jobs, running: jobs.filter((j) => j.status === "running") };
}

export function isJobRunning(jobs: JobInfo[], kind: string): boolean {
  return jobs.some((j) => j.kind === kind && j.status === "running");
}
