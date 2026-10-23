import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  getProject,
  getSeries,
  listEpisodes,
  listSeries,
} from "@core/server/projects";
import { getAssets } from "@core/server/assets";
import { countSegmentVideos } from "@core/server/storyboard";
import { EpisodeSwitcher } from "@/components/episode-switcher";
import { SeriesSwitcher } from "@/components/series-switcher";
import { GuardedLink } from "@/components/guarded-link";
import { ProjectTabs } from "@/components/project-tabs";
import { ProjectJobsBar } from "@/components/project-jobs-bar";
import { ProjectAspectSwitcher } from "@/components/project-aspect-switcher";
import { ProjectStyleSwitcher } from "@/components/project-style-switcher";
import { OpenProjectFolderButton } from "@/components/workspace-actions";

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
  const seriesList = listSeries();
  const episodes = listEpisodes(seriesId);
  // 一旦按剧本生成了资产，风格即锁定，避免素材与提示词风格串味。
  const assets = getAssets(episodeId);
  const styleLocked = assets.length > 0;
  const videoCount = countSegmentVideos(episodeId);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <GuardedLink
            href="/projects"
            className="flex items-center gap-1 hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            项目
          </GuardedLink>
          {series && (
            <>
              <span className="text-muted-foreground/50">/</span>
              <SeriesSwitcher currentId={seriesId} series={seriesList} />
            </>
          )}
          <span className="text-muted-foreground/50">/</span>
          <EpisodeSwitcher
            seriesId={seriesId}
            currentId={episodeId}
            episodes={episodes}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProjectAspectSwitcher
            projectId={episodeId}
            aspectRatio={project.aspectRatio}
            videoCount={videoCount}
          />
          <ProjectStyleSwitcher
            projectId={episodeId}
            styleId={project.styleId}
            style={project.style}
            locked={styleLocked}
          />
          <span className="text-sm text-muted-foreground">
            默认段时长 {(project.defaultSegmentMs / 1000).toFixed(1)}s
          </span>
          <OpenProjectFolderButton projectId={episodeId} size="xs" />
        </div>
      </div>
      {/* 顶部导航已固定，这里让标签与任务条一起吸顶，滚动时不跟着走。 */}
      <div className="shrink-0 sticky top-0 z-40 -mx-4 bg-background px-4 pt-2 lg:-mx-6 lg:px-6 2xl:-mx-8 2xl:px-8">
        <ProjectTabs seriesId={seriesId} episodeId={episodeId} />
        <div className="pt-2">
          <ProjectJobsBar projectId={episodeId} />
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
