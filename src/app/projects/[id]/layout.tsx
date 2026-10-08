import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { ProjectTabs } from "@/components/project-tabs";
import { ProjectJobsBar } from "@/components/project-jobs-bar";
import { ProjectStyleSwitcher } from "@/components/project-style-switcher";
import { Badge } from "@/components/ui/badge";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{project.aspectRatio}</Badge>
            <ProjectStyleSwitcher
              projectId={id}
              styleId={project.styleId}
              style={project.style}
            />
            <span>默认段时长 {(project.defaultSegmentMs / 1000).toFixed(1)}s</span>
          </div>
        </div>
      </div>
      {/* 顶部导航已固定，这里让标签与任务条一起吸顶，滚动时不跟着走。 */}
      <div className="sticky top-14 z-40 -mx-4 bg-background px-4 pt-3">
        <ProjectTabs projectId={id} />
        <div className="pt-2">
          <ProjectJobsBar projectId={id} />
        </div>
      </div>
      {children}
    </div>
  );
}
