"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Elapsed } from "@/components/elapsed";
import { useGlobalJobs } from "@/components/global-jobs-provider";
import { readError } from "@/lib/http";
import { cn } from "@core/client/utils";
import {
  CANCEL_ENDPOINT,
  JOB_LABELS,
  canCancelJob,
  isCancelledMessage,
  jobHref,
  jobKey,
  jobLabel,
  type GlobalJob,
} from "@/lib/jobs";

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "running", label: "进行中" },
  { value: "failed", label: "失败" },
  { value: "canceled", label: "已取消" },
  { value: "succeeded", label: "已完成" },
];

const KIND_OPTIONS = [
  { value: "all", label: "全部类型" },
  ...Object.entries(JOB_LABELS).map(([value, label]) => ({ value, label })),
];

function formatDateTime(value: string | null): string {
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

function statusOf(job: GlobalJob): {
  label: string;
  className: string;
  icon: typeof Loader2;
} {
  if (job.status === "running") {
    return {
      label: "进行中",
      className: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      icon: Loader2,
    };
  }
  if (job.status === "succeeded") {
    return {
      label: "已完成",
      className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      icon: CheckCircle2,
    };
  }
  if (isCancelledMessage(job.message)) {
    return {
      label: "已取消",
      className: "bg-muted text-muted-foreground",
      icon: XCircle,
    };
  }
  return {
    label: "失败",
    className: "bg-destructive/10 text-destructive",
    icon: AlertTriangle,
  };
}

function TaskTableRow({
  job,
  cancelling,
  dismissing,
  onOpen,
  onCancel,
  onDismiss,
}: {
  job: GlobalJob;
  cancelling?: boolean;
  dismissing?: boolean;
  onOpen: (job: GlobalJob) => void;
  onCancel?: (job: GlobalJob) => void;
  onDismiss?: (job: GlobalJob) => void;
}) {
  const running = job.status === "running";
  const failed = job.status === "failed";
  const status = statusOf(job);
  const StatusIcon = status.icon;
  const hasProgress = typeof job.progress === "number";

  return (
    <tr
      className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40"
      onClick={() => onOpen(job)}
    >
      <td className="px-5 py-4">
        <div className="flex items-start gap-2.5">
          <StatusIcon
            className={cn(
              "mt-0.5 size-4 shrink-0",
              running && "animate-spin text-muted-foreground",
              job.status === "succeeded" && "text-emerald-500",
              failed && !isCancelledMessage(job.message) && "text-destructive",
            )}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {jobLabel(job.kind)}
            </div>
            {job.message && (
              <div
                className={cn(
                  "mt-1 truncate text-xs",
                  failed && !isCancelledMessage(job.message)
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
                title={job.message}
              >
                {job.message}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-5 py-4">
        <div className="truncate text-xs text-muted-foreground">
          {job.seriesName}
        </div>
        <div className="mt-1 truncate text-xs">{job.episodeName}</div>
      </td>
      <td className="px-5 py-4">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            status.className,
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {status.label}
        </span>
      </td>
      <td className="px-5 py-4 text-xs text-muted-foreground">
        {running ? (
          <Elapsed startedAt={job.startedAt} />
        ) : (
          <span title={job.finishedAt ?? undefined}>
            {formatDateTime(job.finishedAt)}
          </span>
        )}
      </td>
      <td className="px-5 py-4">
        {running ? (
          <div className="flex items-center gap-2.5">
            <div className="relative h-2 w-full max-w-40 overflow-hidden rounded-full bg-muted">
              {hasProgress ? (
                <>
                  {typeof job.progressCurrent === "number" && (
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-primary/35"
                      style={{ width: `${job.progressCurrent}%` }}
                    />
                  )}
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-primary"
                    style={{ width: `${job.progress}%` }}
                  />
                </>
              ) : (
                <span className="block h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {hasProgress ? `${job.progress}%` : "处理中"}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td
        className="px-5 py-4 text-right"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-end gap-1">
          {running && onCancel && canCancelJob(job.kind) && (
            <Button
              size="xs"
              variant="outline"
              disabled={cancelling}
              onClick={() => onCancel(job)}
            >
              {cancelling ? "取消中…" : "取消"}
            </Button>
          )}
          {failed && onDismiss && (
            <Button
              size="icon-xs"
              variant="ghost"
              className="text-muted-foreground"
              disabled={dismissing}
              onClick={() => onDismiss(job)}
              title="清除这条记录"
              aria-label="清除这条记录"
            >
              <X className="size-3.5" />
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => onOpen(job)}
            title="打开所在分集"
            aria-label="打开所在分集"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

interface HistoryResponse {
  jobs: GlobalJob[];
  nextCursor: string | null;
}

export default function TasksPage() {
  const router = useRouter();
  const { jobs, runningCount, revision, refresh } = useGlobalJobs();
  const [status, setStatus] = useState("all");
  const [seriesId, setSeriesId] = useState("all");
  const [kind, setKind] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [seriesOptions, setSeriesOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [history, setHistory] = useState<GlobalJob[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const data = await res.json();
        const list = (data.series ?? []) as { id: string; name: string }[];
        if (!cancelled) {
          setSeriesOptions(
            list.map((item) => ({ value: item.id, label: item.name })),
          );
        }
      } catch {
        if (!cancelled) setSeriesOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchHistory = useCallback(
    async (before: string | null): Promise<HistoryResponse> => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (status !== "all") params.set("status", status);
      if (seriesId !== "all") params.set("seriesId", seriesId);
      if (kind !== "all") params.set("kind", kind);
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (before) params.set("before", before);
      const res = await fetch(`/api/jobs/history?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await readError(res, "读取任务记录失败"));
      return (await res.json()) as HistoryResponse;
    },
    [status, seriesId, kind, debouncedQuery],
  );

  const loadFirst = useCallback(async () => {
    const seq = ++requestRef.current;
    if (status === "running") {
      setHistory([]);
      setNextCursor(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory(null);
      if (seq !== requestRef.current) return;
      setHistory(data.jobs);
      setNextCursor(data.nextCursor);
    } catch (err) {
      if (seq !== requestRef.current) return;
      setError((err as Error).message || "读取任务记录失败");
      setHistory([]);
      setNextCursor(null);
    } finally {
      if (seq === requestRef.current) setLoading(false);
    }
  }, [fetchHistory, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFirst(), 0);
    return () => window.clearTimeout(timer);
  }, [loadFirst, revision]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const seq = requestRef.current;
    setLoadingMore(true);
    try {
      const data = await fetchHistory(nextCursor);
      if (seq !== requestRef.current) return;
      setHistory((current) => [...current, ...data.jobs]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      toast.error((err as Error).message || "读取任务记录失败");
    } finally {
      setLoadingMore(false);
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
      await refresh();
      await loadFirst();
    } catch (err) {
      toast.error((err as Error).message || "取消失败");
    } finally {
      setCancelling(null);
    }
  }

  async function dismiss(job: GlobalJob) {
    setDismissing(jobKey(job));
    try {
      const res = await fetch(
        `/api/projects/${job.projectId}/jobs/${job.id}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "清除失败");
      setHistory((current) =>
        current.filter((item) => jobKey(item) !== jobKey(job)),
      );
      void refresh();
      toast.success("已清除该任务记录");
    } catch (err) {
      toast.error((err as Error).message || "清除失败");
    } finally {
      setDismissing(null);
    }
  }

  function go(job: GlobalJob) {
    router.push(jobHref(job));
  }

  const normalizedQuery = debouncedQuery.toLowerCase();
  const runningJobs = useMemo(() => {
    const matches = (job: GlobalJob) =>
      !normalizedQuery ||
      [
        jobLabel(job.kind),
        job.kind,
        job.message,
        job.seriesName,
        job.episodeName,
      ]
        .join("\n")
        .toLowerCase()
        .includes(normalizedQuery);
    return jobs
      .filter((job) => job.status === "running" && matches(job))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [jobs, normalizedQuery]);

  const showRunning = status === "all" || status === "running";
  const rows = showRunning ? [...runningJobs, ...history] : history;
  const filtering =
    status !== "all" ||
    seriesId !== "all" ||
    kind !== "all" ||
    debouncedQuery !== "";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 pb-4">
      <PageHeader
        eyebrow="Tasks"
        accent="cream"
        title="任务"
        description="最近 7 天的生成任务。点任意一行跳到对应分集。"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refresh();
              void loadFirst();
            }}
            disabled={loading}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            刷新
          </Button>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索任务、项目、分集或消息"
            className="h-8 pl-8 text-sm"
            aria-label="搜索任务"
          />
        </div>
        <SelectField
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
          className="w-28"
          aria-label="任务状态"
        />
        <SelectField
          value={seriesId}
          onChange={setSeriesId}
          options={[{ value: "all", label: "全部项目" }, ...seriesOptions]}
          className="w-36"
          aria-label="项目"
        />
        <SelectField
          value={kind}
          onChange={setKind}
          options={KIND_OPTIONS}
          className="w-40"
          aria-label="任务类型"
        />
        <span className="ml-auto text-xs text-muted-foreground">
          进行中 {runningCount} · 最近 7 天
        </span>
      </div>

      {error && (
        <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
          {error}
          <button
            type="button"
            onClick={() => void loadFirst()}
            className="ml-auto text-xs underline underline-offset-4"
          >
            重试
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[1000px] table-fixed text-sm">
            <thead className="sticky top-0 z-20 border-b bg-muted text-left text-xs text-muted-foreground shadow-sm">
              <tr>
                <th className="w-[32%] px-5 py-3 font-medium">任务</th>
                <th className="w-[18%] px-5 py-3 font-medium">项目 / 分集</th>
                <th className="w-[10%] px-5 py-3 font-medium">状态</th>
                <th className="w-[13%] px-5 py-3 font-medium">时间</th>
                <th className="w-[17%] px-5 py-3 font-medium">进度</th>
                <th className="w-[10%] px-5 py-3 text-right font-medium">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-16 text-center text-sm text-muted-foreground"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" /> 加载中…
                    </span>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-16 text-center text-sm text-muted-foreground"
                  >
                    {filtering
                      ? "没有匹配的任务记录，换个搜索词或筛选条件试试。"
                      : "最近 7 天没有任务记录。"}
                  </td>
                </tr>
              ) : (
                rows.map((job) => (
                  <TaskTableRow
                    key={jobKey(job)}
                    job={job}
                    cancelling={cancelling === jobKey(job)}
                    dismissing={dismissing === jobKey(job)}
                    onOpen={go}
                    onCancel={cancel}
                    onDismiss={dismiss}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        {nextCursor && !loading && status !== "running" && (
          <div className="flex shrink-0 justify-center border-t px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ChevronRight className="size-3.5 rotate-90" />
              )}
              加载更多
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
