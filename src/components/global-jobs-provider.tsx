"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  isCancelledMessage,
  jobKey,
  jobLabel,
  type GlobalJob,
} from "@/lib/jobs";

interface GlobalJobsContextValue {
  jobs: GlobalJob[];
  runningCount: number;
  hasFailure: boolean;
  loadedOnce: boolean;
  /** 每当有任务从进行中变为结束时递增，供任务页刷新历史。 */
  revision: number;
  refresh: () => Promise<void>;
}

const GlobalJobsContext = createContext<GlobalJobsContextValue | null>(null);

function notifyFinished(job: GlobalJob): void {
  const label = jobLabel(job.kind);
  const where = `${job.seriesName} · ${job.episodeName}`;

  if (job.status === "failed" && isCancelledMessage(job.message)) {
    toast.message(`${label}已取消`, { description: where });
    return;
  }

  const succeeded = job.status === "succeeded";
  const title = `${label}${succeeded ? "完成" : "失败"}`;
  const detail = succeeded
    ? `${where}${job.message ? ` · ${job.message}` : ""}`
    : job.message || where;

  if (succeeded) toast.success(title, { description: detail });
  else toast.error(title, { description: detail });

  if (!document.hasFocus()) {
    void window.licenseAPI?.flashFrame?.();
    void window.licenseAPI?.notifyJob?.({ title, body: detail });
  }
}

export function GlobalJobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<GlobalJob[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [revision, setRevision] = useState(0);
  const runningRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await fetch("/api/jobs", { cache: "no-store" }).catch(
      () => null,
    );
    if (!res?.ok) return;
    const data = await res.json().catch(() => null);
    const list = (data?.jobs ?? []) as GlobalJob[];
    setJobs(list);
    setLoadedOnce(true);

    const byKey = new Map(list.map((job) => [jobKey(job), job]));
    const running = new Set(
      list.filter((job) => job.status === "running").map(jobKey),
    );
    let finished = false;
    for (const key of runningRef.current) {
      if (running.has(key)) continue;
      const job = byKey.get(key);
      if (!job) continue;
      notifyFinished(job);
      finished = true;
    }
    runningRef.current = running;
    if (finished) setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 3000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [load]);

  const runningCount = jobs.filter((job) => job.status === "running").length;
  const hasFailure = jobs.some(
    (job) => job.status === "failed" && !isCancelledMessage(job.message),
  );

  useEffect(() => {
    if (!loadedOnce) return;
    void window.licenseAPI?.setActiveJobs?.(runningCount);
  }, [loadedOnce, runningCount]);

  return (
    <GlobalJobsContext.Provider
      value={{
        jobs,
        runningCount,
        hasFailure,
        loadedOnce,
        revision,
        refresh: load,
      }}
    >
      {children}
    </GlobalJobsContext.Provider>
  );
}

export function useGlobalJobs(): GlobalJobsContextValue {
  const value = useContext(GlobalJobsContext);
  if (!value) {
    throw new Error("useGlobalJobs must be used within GlobalJobsProvider");
  }
  return value;
}
