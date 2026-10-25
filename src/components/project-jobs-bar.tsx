"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Elapsed } from "@/components/elapsed";
import { CANCEL_ENDPOINT, jobLabel } from "@/lib/jobs";
import { useProjectJobs } from "@core/client/use-jobs";

export function ProjectJobsBar({ projectId }: { projectId: string }) {
  const { jobs } = useProjectJobs(projectId);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const running = jobs.filter((j) => j.status === "running");
  const latest = jobs[0];
  const failed =
    running.length === 0 &&
    latest &&
    latest.status === "failed" &&
    latest.id !== dismissed
      ? latest
      : null;
  // 手动停止不是故障：用中性样式显示「已取消」，不要报成红色失败。
  const cancelled = failed ? /已取消/.test(failed.message) : false;

  if (running.length === 0 && !failed) return null;

  async function cancelJob(kind: string) {
    const path = CANCEL_ENDPOINT[kind];
    if (!path) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/${path}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "取消失败");
      toast.success("已取消");
    } catch (error) {
      toast.error((error as Error).message || "取消失败");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
      {running.map((job) => (
        <span key={job.id} className="flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" />
          {jobLabel(job.kind)}中…
          <Elapsed startedAt={job.startedAt} />
          {typeof job.progress === "number" && (
            <span className="text-muted-foreground">
              {job.progress}%
              {typeof job.progressCurrent === "number"
                ? ` · 当前 ${job.progressCurrent}%`
                : ""}
            </span>
          )}
          {CANCEL_ENDPOINT[job.kind] ? (
            <button
              type="button"
              onClick={() => cancelJob(job.kind)}
              disabled={cancelling}
              className="ml-1 rounded border px-1.5 py-0.5 hover:bg-destructive/10 disabled:opacity-50"
            >
              {cancelling ? "取消中…" : "取消"}
            </button>
          ) : (
            <span>（可切换页面，完成后会自动刷新）</span>
          )}
        </span>
      ))}
      {failed && (
        <span
          className={`flex items-center gap-1.5 ${
            cancelled ? "text-muted-foreground" : "text-destructive"
          }`}
        >
          {cancelled ? (
            <XCircle className="size-3.5" />
          ) : (
            <AlertTriangle className="size-3.5" />
          )}
          {cancelled
            ? `${jobLabel(failed.kind)}已取消`
            : `${jobLabel(failed.kind)}失败：${failed.message || "未知错误"}`}
          <button
            type="button"
            onClick={() => setDismissed(failed.id)}
            className="ml-1 rounded p-0.5 hover:bg-destructive/10"
            aria-label="忽略"
          >
            <X className="size-3" />
          </button>
        </span>
      )}
    </div>
  );
}
