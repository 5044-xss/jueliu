"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Elapsed } from "@/components/elapsed";
import { useProjectJobs } from "@/lib/use-jobs";

const JOB_LABELS: Record<string, string> = {
  "story-to-script": "生成剧本",
  "script-to-assets": "生成资产",
  "script-to-storyboard": "生成分镜",
  anchor: "批量锚定",
  repair: "AI 修复",
  compose: "视频合成",
};

function jobLabel(kind: string): string {
  return JOB_LABELS[kind] ?? kind;
}

export function ProjectJobsBar({ projectId }: { projectId: string }) {
  const { jobs } = useProjectJobs(projectId);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const running = jobs.filter((j) => j.status === "running");
  const latest = jobs[0];
  const failed =
    running.length === 0 &&
    latest &&
    latest.status === "failed" &&
    latest.id !== dismissed
      ? latest
      : null;

  if (running.length === 0 && !failed) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
      {running.map((job) => (
        <span key={job.id} className="flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" />
          {jobLabel(job.kind)}中…
          <Elapsed startedAt={job.startedAt} />
          （可切换页面，完成后会自动刷新）
        </span>
      ))}
      {failed && (
        <span className="flex items-center gap-1.5 text-destructive">
          <AlertTriangle className="size-3.5" />
          {jobLabel(failed.kind)}失败：{failed.message || "未知错误"}
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
