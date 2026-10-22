"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  ListChecks,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Elapsed } from "@/components/elapsed";
import { cn } from "@core/client/utils";
import {
  CANCEL_ENDPOINT,
  canCancelJob,
  jobHref,
  jobKey,
  jobLabel,
  type GlobalJob,
} from "@/lib/jobs";

function isCancelled(message: string): boolean {
  return /已取消|被新的同类任务取代/.test(message);
}

function notifyFinished(job: GlobalJob): void {
  const label = jobLabel(job.kind);
  const where = `${job.seriesName} · ${job.episodeName}`;

  if (job.status === "failed" && isCancelled(job.message)) {
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

function formatFinishedAt(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return date.getFullYear() === now.getFullYear()
    ? `${monthDay} ${time}`
    : `${date.getFullYear()}年${monthDay} ${time}`;
}

function JobSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function JobRow({
  job,
  cancelling,
  onOpen,
  onCancel,
}: {
  job: GlobalJob;
  cancelling?: boolean;
  onOpen: (job: GlobalJob) => void;
  onCancel?: (job: GlobalJob) => void;
}) {
  const running = job.status === "running";
  const failed = job.status === "failed";
  const cancelled = failed && isCancelled(job.message);
  const succeeded = job.status === "succeeded";

  return (
    <div className="flex items-start gap-2 rounded-xl px-2 py-2 hover:bg-muted/60">
      <button
        type="button"
        onClick={() => onOpen(job)}
        className="flex min-w-0 flex-1 items-start gap-2 text-left"
        title="前往该分集"
      >
        <span className="mt-0.5 shrink-0">
          {running ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : cancelled ? (
            <XCircle className="size-4 text-muted-foreground" />
          ) : failed ? (
            <AlertTriangle className="size-4 text-destructive" />
          ) : succeeded ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : (
            <Circle className="size-4 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium">{jobLabel(job.kind)}</span>
            {running ? (
              <Elapsed
                startedAt={job.startedAt}
                className="text-[11px] font-normal text-muted-foreground"
              />
            ) : (
              <span className="text-[11px] font-normal text-muted-foreground">
                {formatFinishedAt(job.finishedAt)}
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {job.seriesName} · {job.episodeName}
          </span>
          {job.message && (
            <span
              className={cn(
                "mt-0.5 block truncate text-xs",
                failed && !cancelled
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {job.message}
            </span>
          )}
        </span>
        <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/60" />
      </button>

      {running && onCancel && canCancelJob(job.kind) && (
        <Button
          size="xs"
          variant="outline"
          className="mt-0.5 shrink-0"
          disabled={cancelling}
          onClick={() => onCancel(job)}
        >
          {cancelling ? "取消中…" : "取消"}
        </Button>
      )}
    </div>
  );
}

export function GlobalJobsButton() {
  const router = useRouter();
  const [jobs, setJobs] = useState<GlobalJob[]>([]);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
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
    for (const key of runningRef.current) {
      if (running.has(key)) continue;
      const finished = byKey.get(key);
      if (finished) notifyFinished(finished);
    }
    runningRef.current = running;
  }, []);

  const runningCount = jobs.filter((job) => job.status === "running").length;

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 3000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [load]);

  useEffect(() => {
    if (!loadedOnce) return;
    void window.licenseAPI?.setActiveJobs?.(runningCount);
  }, [loadedOnce, runningCount]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function cancel(job: GlobalJob) {
    const path = CANCEL_ENDPOINT[job.kind];
    if (!path) return;
    setCancelling(jobKey(job));
    try {
      const res = await fetch(`/api/projects/${job.projectId}/${path}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "取消失败");
      toast.success("已取消");
      await load();
    } catch (error) {
      toast.error((error as Error).message || "取消失败");
    } finally {
      setCancelling(null);
    }
  }

  function go(job: GlobalJob) {
    setOpen(false);
    router.push(jobHref(job));
  }

  const runningJobs = jobs.filter((job) => job.status === "running");
  const failedJobs = jobs
    .filter((job) => job.status === "failed")
    .slice(0, 5);
  const succeededJobs = jobs
    .filter((job) => job.status === "succeeded")
    .slice(0, 3);
  const hasFailure = failedJobs.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="sm"
        className={cn("relative gap-1.5", open && "bg-muted")}
        onClick={() => setOpen((value) => !value)}
        title="任务中心"
      >
        {runningCount > 0 ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ListChecks className="size-4" />
        )}
        <span className="hidden sm:inline">任务</span>
        {runningCount > 0 && (
          <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
            {runningCount}
          </span>
        )}
        {runningCount === 0 && hasFailure && (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive" />
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 flex max-h-[min(70vh,34rem)] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-[0_24px_56px_-30px_rgba(0,0,0,0.45)]">
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
            <span className="text-sm font-medium">任务中心</span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {runningCount > 0 && <span>{runningCount} 个进行中</span>}
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => void refresh()}
                disabled={refreshing}
                title="刷新"
                aria-label="刷新"
              >
                <RefreshCw
                  className={cn("size-3.5", refreshing && "animate-spin")}
                />
              </Button>
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            {jobs.length === 0 ? (
              <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                暂无任务
              </div>
            ) : (
              <>
                {runningJobs.length > 0 && (
                  <JobSection title="进行中">
                    {runningJobs.map((job) => (
                      <JobRow
                        key={jobKey(job)}
                        job={job}
                        cancelling={cancelling === jobKey(job)}
                        onOpen={go}
                        onCancel={cancel}
                      />
                    ))}
                  </JobSection>
                )}
                {failedJobs.length > 0 && (
                  <JobSection title="最近失败">
                    {failedJobs.map((job) => (
                      <JobRow key={jobKey(job)} job={job} onOpen={go} />
                    ))}
                  </JobSection>
                )}
                {succeededJobs.length > 0 && (
                  <JobSection title="最近完成">
                    {succeededJobs.map((job) => (
                      <JobRow key={jobKey(job)} job={job} onOpen={go} />
                    ))}
                  </JobSection>
                )}
              </>
            )}
          </div>

          <div className="shrink-0 border-t px-4 py-2 text-[11px] text-muted-foreground">
            关闭窗口前会提示未完成任务
          </div>
        </div>
      )}
    </div>
  );
}
