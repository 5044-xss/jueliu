import { notFound } from "next/navigation";
import { getProject } from "@/lib/projects";
import { ProjectTabs } from "@/components/project-tabs";
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
            {project.style && <span>{project.style}</span>}
            <span>默认段时长 {(project.defaultSegmentMs / 1000).toFixed(1)}s</span>
          </div>
        </div>
      </div>
      <ProjectTabs projectId={id} />
      {children}
    </div>
  );
}
