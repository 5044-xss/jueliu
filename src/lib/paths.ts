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

// 只允许项目/系列 id 使用字母数字、下划线、连字符（UUID 满足）。
// 拒绝分隔符、点、`..`，避免拼接出的路径逃出工作区。
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafeId(id: unknown): id is string {
  return typeof id === "string" && SAFE_ID.test(id);
}

export function getProjectDir(projectId: string): string {
  if (!isSafeId(projectId)) {
    throw new Error("非法的项目 id");
  }
  const root = getWorkspaceRoot();
  const dir = path.join(/* turbopackIgnore: true */ root, projectId);
  const resolved = path.resolve(dir);
  const resolvedRoot = path.resolve(root);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error("非法的项目路径");
  }
  return dir;
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
  vendor: string,
  segmentId: string,
  kind: "first" | "last" | "start",
  ext = "png",
): string {
  const v = isSafeId(vendor) ? vendor : "custom";
  return path.join(
    /* turbopackIgnore: true */ getProjectMediaDir(projectId),
    "frames",
    v,
    segmentId,
    `${kind}.${ext}`,
  );
}

export function getSegmentVideoPath(
  projectId: string,
  vendor: string,
  segmentId: string,
  ext = "mp4",
): string {
  const v = isSafeId(vendor) ? vendor : "custom";
  return path.join(
    /* turbopackIgnore: true */ getProjectMediaDir(projectId),
    "videos",
    v,
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
