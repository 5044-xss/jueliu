import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getProject, getSeries } from "@/lib/projects";
import { getAssets } from "@/lib/assets";
import { ProjectTabs } from "@/components/project-tabs";
import { ProjectJobsBar } from "@/components/project-jobs-bar";
import { ProjectStyleSwitcher } from "@/components/project-style-switcher";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";

export default async function EpisodeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ seriesId: string; episodeId: string }>;
}) {
  const { seriesId, episodeId } = await params;
  const project = getProject(episodeId);
  if (!project) notFound();
  const series = getSeries(seriesId);
  // 一旦按剧本生成了资产，风格即锁定，避免素材与提示词风格串味。
  const styleLocked = getAssets(episodeId).length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/projects"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          项目
        </Link>
        {series && (
          <>
            <span className="text-muted-foreground/50">/</span>
            <Link
              href={`/projects/${seriesId}`}
              className="truncate hover:text-foreground"
            >
              {series.name}
            </Link>
          </>
        )}
        <span className="text-muted-foreground/50">/</span>
        <span className="truncate text-foreground">{project.name}</span>
      </div>
      <PageHeader
        eyebrow="Episode"
        accent="coral"
        title={project.name}
        description={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{project.aspectRatio}</Badge>
            <ProjectStyleSwitcher
              projectId={episodeId}
              styleId={project.styleId}
              style={project.style}
              locked={styleLocked}
            />
            <span>默认段时长 {(project.defaultSegmentMs / 1000).toFixed(1)}s</span>
          </div>
        }
      />
      {/* 顶部导航已固定，这里让标签与任务条一起吸顶，滚动时不跟着走。 */}
      <div className="sticky top-14 z-40 -mx-4 bg-background px-4 pt-3">
        <ProjectTabs seriesId={seriesId} episodeId={episodeId} />
        <div className="pt-2">
          <ProjectJobsBar projectId={episodeId} />
        </div>
      </div>
      {children}
    </div>
  );
}
