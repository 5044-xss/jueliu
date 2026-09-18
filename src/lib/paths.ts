import fs from "node:fs";
import path from "node:path";

export function getWorkspaceRoot(): string {
  const configured = process.env.WORKSPACE_DIR;
  if (configured && configured.trim()) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), "workspace");
}

export function getGlobalSettingsPath(): string {
  return path.join(getWorkspaceRoot(), "settings.json");
}

export function getProjectsRegistryPath(): string {
  return path.join(getWorkspaceRoot(), "projects.json");
}

export function getProjectDir(projectId: string): string {
  return path.join(/* turbopackIgnore: true */ getWorkspaceRoot(), projectId);
}

export function getProjectDbPath(projectId: string): string {
  return path.join(/* turbopackIgnore: true */ getProjectDir(projectId), "project.db");
}

export function getProjectMediaDir(projectId: string): string {
  return path.join(/* turbopackIgnore: true */ getProjectDir(projectId), "media");
}

export function getProjectTemplatesDir(projectId: string): string {
  return path.join(/* turbopackIgnore: true */ getProjectDir(projectId), "templates");
}

export function getProjectRulesPath(projectId: string): string {
  return path.join(
    /* turbopackIgnore: true */ getProjectDir(projectId),
    "rules",
    "continuity.json",
  );
}

export function getAssetViewPath(
  projectId: string,
  assetId: string,
  variantId: string,
  viewId: string,
  ext = "png",
): string {
  return path.join(
    /* turbopackIgnore: true */ getProjectMediaDir(projectId),
    "assets",
    assetId,
    variantId,
    `${viewId}.${ext}`,
  );
}

export function getFramePath(
  projectId: string,
  segmentId: string,
  kind: "first" | "last",
  ext = "png",
): string {
  return path.join(
    /* turbopackIgnore: true */ getProjectMediaDir(projectId),
    "frames",
    segmentId,
    `${kind}.${ext}`,
  );
}

export function getSegmentVideoPath(
  projectId: string,
  segmentId: string,
  ext = "mp4",
): string {
  return path.join(
    /* turbopackIgnore: true */ getProjectMediaDir(projectId),
    "videos",
    segmentId,
    `output.${ext}`,
  );
}

export function getExportPath(
  projectId: string,
  compositionId: string,
  ext = "mp4",
): string {
  return path.join(
    /* turbopackIgnore: true */ getProjectMediaDir(projectId),
    "exports",
    `${compositionId}.${ext}`,
  );
}

export function ensureWorkspace(): void {
  fs.mkdirSync(getWorkspaceRoot(), { recursive: true });
}

export function ensureProjectDirs(projectId: string): void {
  const media = getProjectMediaDir(projectId);
  const dirs = [
    getProjectDir(projectId),
    media,
    path.join(media, "assets"),
    path.join(media, "frames"),
    path.join(media, "videos"),
    path.join(media, "exports"),
    getProjectTemplatesDir(projectId),
    path.join(getProjectDir(projectId), "rules"),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
