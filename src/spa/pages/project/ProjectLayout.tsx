import { Link, Outlet, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, Loader2 } from "lucide-react";
import { EpisodeSwitcher } from "@/components/episode-switcher";
import { SeriesSwitcher } from "@/components/series-switcher";
import { ProjectTabs } from "@/components/project-tabs";
import { ProjectJobsBar } from "@/components/project-jobs-bar";
import { ProjectAspectSwitcher } from "@/components/project-aspect-switcher";
import { ProjectStyleSwitcher } from "@/components/project-style-switcher";
import { OpenProjectFolderButton } from "@/components/workspace-actions";
import { projectRepository } from "../../storage/projects";
import { capabilities } from "../../platform/capabilities";

export interface ProjectOutletContext {
  projectId: string;
}

export function useProjectContext(): ProjectOutletContext {
  return { projectId: useParams<{ episodeId: string }>().episodeId ?? "" };
}

export function ProjectLayout() {
  const { seriesId, episodeId } = useParams<{
    seriesId: string;
    episodeId: string;
  }>();
  const record = useLiveQuery(
    () =>
      episodeId
        ? projectRepository.getProject(episodeId)
        : Promise.resolve(null),
    [episodeId],
  );
  const episodes = useLiveQuery(
    () =>
      seriesId
        ? projectRepository.listEpisodes(seriesId)
        : Promise.resolve([]),
    [seriesId],
  );
  const seriesList = useLiveQuery(() => projectRepository.listSeries(), []);

  if (!episodeId || !seriesId) {
    return <p className="text-sm text-muted-foreground">项目不存在。</p>;
  }

  if (record === undefined) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在读取项目…
      </div>
    );
  }

  if (!record) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="font-medium">项目不存在</p>
        <Link to="/projects" className="mt-4 inline-flex text-sm underline">
          返回项目列表
        </Link>
      </div>
    );
  }

  const series = (seriesList ?? []).find((item) => item.id === seriesId);
  const styleLocked = record.doc.assets.length > 0;
  const videoCount = Object.keys(record.doc.videoBindings ?? {}).filter(
    (segmentId) =>
      record.doc.storyboard.some((scene) =>
        scene.segments.some((segment) => segment.id === segmentId),
      ),
  ).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <Link
            to="/projects"
            className="flex items-center gap-1 hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            项目
          </Link>
          {series && (
            <>
              <span className="text-muted-foreground/50">/</span>
              <SeriesSwitcher
                currentId={seriesId}
                series={seriesList ?? []}
              />
            </>
          )}
          <span className="text-muted-foreground/50">/</span>
          <EpisodeSwitcher
            seriesId={seriesId}
            currentId={episodeId}
            episodes={episodes ?? []}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProjectAspectSwitcher
            projectId={episodeId}
            aspectRatio={record.doc.project.aspectRatio}
            videoCount={videoCount}
          />
          <ProjectStyleSwitcher
            projectId={episodeId}
            styleId={record.doc.project.styleId}
            style={record.doc.project.style}
            locked={styleLocked}
          />
          <OpenProjectFolderButton projectId={episodeId} size="xs" />
        </div>
      </div>
      <div className="sticky top-0 z-40 -mx-4 shrink-0 bg-background px-4 pt-2 lg:-mx-6 lg:px-6 2xl:-mx-8 2xl:px-8">
        <ProjectTabs
          seriesId={seriesId}
          episodeId={episodeId}
          hideCompose={!capabilities.compose}
        />
        <div className="pt-2">
          <ProjectJobsBar projectId={episodeId} />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
