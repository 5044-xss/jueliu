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

function readRegistry(): ProjectSummary[] {
  const file = getProjectsRegistryPath();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as ProjectSummary[]) : [];
  } catch {
    return [];
  }
}

function writeRegistry(projects: ProjectSummary[]): void {
  ensureWorkspace();
  const file = getProjectsRegistryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(projects, null, 2), "utf8");
}

export function listProjectSummaries(): ProjectSummary[] {
  return readRegistry().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function upsertRegistry(summary: ProjectSummary): void {
  const projects = readRegistry().filter((p) => p.id !== summary.id);
  projects.push(summary);
  writeRegistry(projects);
}

function dropRegistry(id: string): void {
  writeRegistry(readRegistry().filter((p) => p.id !== id));
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
  upsertRegistry({ id, name: input.name.trim() || "未命名项目", createdAt: now });
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
  upsertRegistry({ id, name: next.name, createdAt: current.createdAt });
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
