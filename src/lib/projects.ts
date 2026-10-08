import fs from "node:fs";
import path from "node:path";
import {
  ensureWorkspace,
  getProjectDir,
  getProjectsRegistryPath,
} from "@/lib/paths";
import {
  getProjectDb,
  newId,
  nowIso,
  deleteProjectData,
  type Db,
} from "@/lib/db";
import { seedProjectDefaults } from "@/lib/db/seed";
import { getStylePrompt } from "@/lib/library/styles";

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  group?: string;
}

export interface Project {
  id: string;
  name: string;
  style: string;
  styleId: string | null;
  aspectRatio: string;
  defaultSegmentMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  style?: string;
  styleId?: string | null;
  aspectRatio?: string;
  defaultSegmentMs?: number;
  group?: string;
}

interface ProjectRow {
  id: string;
  name: string;
  style: string;
  style_id: string | null;
  aspect_ratio: string;
  default_segment_ms: number;
  created_at: string;
  updated_at: string;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    style: row.style,
    styleId: row.style_id ?? null,
    aspectRatio: row.aspect_ratio,
    defaultSegmentMs: row.default_segment_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ---------------- registry ---------------- */

interface ProjectRegistry {
  groups: string[];
  projects: ProjectSummary[];
}

function normalizeGroup(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRegistry(): ProjectRegistry {
  const file = getProjectsRegistryPath();
  if (!fs.existsSync(file)) return { groups: [], projects: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    // 兼容旧格式：顶层直接是项目数组，没有分组信息。
    if (Array.isArray(parsed)) {
      return {
        groups: [],
        projects: (parsed as ProjectSummary[]).map((p) => ({
          ...p,
          group: normalizeGroup(p.group),
        })),
      };
    }
    if (parsed && typeof parsed === "object") {
      const projects = Array.isArray(parsed.projects)
        ? (parsed.projects as ProjectSummary[])
        : [];
      const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
      return {
        groups: groups.map(normalizeGroup).filter(Boolean),
        projects: projects.map((p) => ({
          ...p,
          group: normalizeGroup(p.group),
        })),
      };
    }
    return { groups: [], projects: [] };
  } catch {
    return { groups: [], projects: [] };
  }
}

function writeRegistry(registry: ProjectRegistry): void {
  ensureWorkspace();
  const file = getProjectsRegistryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const groups = [
    ...new Set(registry.groups.map(normalizeGroup).filter(Boolean)),
  ];
  fs.writeFileSync(
    file,
    JSON.stringify({ groups, projects: registry.projects }, null, 2),
    "utf8",
  );
}

export function listProjectSummaries(): ProjectSummary[] {
  return readRegistry().projects.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function listProjectGroups(): string[] {
  const registry = readRegistry();
  const referenced = registry.projects
    .map((p) => normalizeGroup(p.group))
    .filter(Boolean);
  return [...new Set([...registry.groups, ...referenced])];
}

export function createProjectGroup(name: string): string[] {
  const group = normalizeGroup(name);
  if (!group) return listProjectGroups();
  const registry = readRegistry();
  if (!registry.groups.includes(group)) registry.groups.push(group);
  writeRegistry(registry);
  return listProjectGroups();
}

export function renameProjectGroup(name: string, nextName: string): string[] {
  const from = normalizeGroup(name);
  const to = normalizeGroup(nextName);
  if (!from || !to || from === to) return listProjectGroups();
  const registry = readRegistry();
  registry.groups = registry.groups.map((g) => (g === from ? to : g));
  registry.projects = registry.projects.map((p) =>
    normalizeGroup(p.group) === from ? { ...p, group: to } : p,
  );
  writeRegistry(registry);
  return listProjectGroups();
}

export function deleteProjectGroup(name: string): string[] {
  const group = normalizeGroup(name);
  if (!group) return listProjectGroups();
  const registry = readRegistry();
  registry.groups = registry.groups.filter((g) => g !== group);
  registry.projects = registry.projects.map((p) =>
    normalizeGroup(p.group) === group ? { ...p, group: "" } : p,
  );
  writeRegistry(registry);
  return listProjectGroups();
}

function upsertRegistry(summary: ProjectSummary): void {
  const registry = readRegistry();
  const group = normalizeGroup(summary.group);
  const projects = registry.projects.filter((p) => p.id !== summary.id);
  projects.push({ ...summary, group });
  const groups =
    group && !registry.groups.includes(group)
      ? [...registry.groups, group]
      : registry.groups;
  writeRegistry({ groups, projects });
}

function dropRegistry(id: string): void {
  const registry = readRegistry();
  writeRegistry({
    ...registry,
    projects: registry.projects.filter((p) => p.id !== id),
  });
}

export function projectExists(id: string): boolean {
  return fs.existsSync(getProjectDir(id));
}

/* ---------------- CRUD ---------------- */

export function createProject(input: CreateProjectInput): Project {
  const id = newId();
  const now = nowIso();
  const db = getProjectDb(id);
  const styleText =
    input.style?.trim() || getStylePrompt(input.styleId) || "";
  db.prepare(
    `INSERT INTO project (id, name, style, style_id, aspect_ratio, default_segment_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name.trim() || "未命名项目",
    styleText,
    input.styleId ?? null,
    input.aspectRatio ?? "9:16",
    input.defaultSegmentMs ?? 10000,
    now,
    now,
  );
  db.prepare(
    `INSERT INTO story (id, project_id, content, updated_at) VALUES (?, ?, '', ?)`,
  ).run(newId(), id, now);
  seedProjectDefaults(db, id);
  upsertRegistry({
    id,
    name: input.name.trim() || "未命名项目",
    createdAt: now,
    group: normalizeGroup(input.group),
  });
  return getProject(id)!;
}

export function getProject(id: string): Project | null {
  const db = getProjectDb(id);
  const row = db.prepare("SELECT * FROM project WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  return row ? mapProject(row) : null;
}

export function updateProject(
  id: string,
  patch: Partial<CreateProjectInput>,
): Project | null {
  const current = getProject(id);
  if (!current) return null;
  const db = getProjectDb(id);
  const nextStyleId =
    patch.styleId !== undefined ? patch.styleId : current.styleId;
  const nextStyle =
    patch.style !== undefined
      ? patch.style
      : patch.styleId !== undefined
        ? (getStylePrompt(patch.styleId) ?? "")
        : current.style;
  const next = {
    name: patch.name ?? current.name,
    style: nextStyle,
    styleId: nextStyleId,
    aspectRatio: patch.aspectRatio ?? current.aspectRatio,
    defaultSegmentMs: patch.defaultSegmentMs ?? current.defaultSegmentMs,
  };
  db.prepare(
    `UPDATE project SET name = ?, style = ?, style_id = ?, aspect_ratio = ?, default_segment_ms = ?, updated_at = ? WHERE id = ?`,
  ).run(
    next.name,
    next.style,
    next.styleId,
    next.aspectRatio,
    next.defaultSegmentMs,
    nowIso(),
    id,
  );
  const currentSummary = readRegistry().projects.find((p) => p.id === id);
  const nextGroup =
    patch.group !== undefined
      ? normalizeGroup(patch.group)
      : normalizeGroup(currentSummary?.group);
  upsertRegistry({
    id,
    name: next.name,
    createdAt: current.createdAt,
    group: nextGroup,
  });
  return getProject(id);
}

export function deleteProject(id: string): void {
  dropRegistry(id);
  deleteProjectData(id);
}

/* ---------------- story ---------------- */

export function getStory(projectId: string): { content: string } {
  const db = getProjectDb(projectId);
  const row = db
    .prepare("SELECT content FROM story WHERE project_id = ? LIMIT 1")
    .get(projectId) as { content: string } | undefined;
  return { content: row?.content ?? "" };
}

export function saveStory(projectId: string, content: string): void {
  const db = getProjectDb(projectId);
  const existing = db
    .prepare("SELECT id FROM story WHERE project_id = ? LIMIT 1")
    .get(projectId) as { id: string } | undefined;
  const now = nowIso();
  if (existing) {
    db.prepare("UPDATE story SET content = ?, updated_at = ? WHERE id = ?").run(
      content,
      now,
      existing.id,
    );
  } else {
    db.prepare(
      "INSERT INTO story (id, project_id, content, updated_at) VALUES (?, ?, ?, ?)",
    ).run(newId(), projectId, content, now);
  }
}

export type { Db };
