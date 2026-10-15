import fs from "node:fs";
import path from "node:path";
import {
  ensureWorkspace,
  getProjectDir,
  getProjectDbPath,
  ensureProjectDirs,
  getProjectsRegistryPath,
  isSafeId,
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
import { copyProjectLibrary } from "@/lib/library/assets";

export interface SeriesSummary {
  id: string;
  name: string;
  createdAt: string;
}

export interface EpisodeSummary {
  id: string;
  name: string;
  createdAt: string;
  seriesId: string;
}

export interface Project {
  id: string;
  name: string;
  style: string;
  styleId: string | null;
  aspectRatio: string;
  defaultSegmentMs: number;
  vendor: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEpisodeInput {
  name: string;
  style?: string;
  styleId?: string | null;
  aspectRatio?: string;
  defaultSegmentMs?: number;
  vendor?: string;
}

interface ProjectRow {
  id: string;
  name: string;
  style: string;
  style_id: string | null;
  aspect_ratio: string;
  default_segment_ms: number;
  vendor: string;
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
    vendor: row.vendor ?? "doubao",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ---------------- registry ---------------- */

interface ProjectRegistry {
  series: SeriesSummary[];
  episodes: EpisodeSummary[];
}

interface LegacyProject {
  id: string;
  name: string;
  createdAt: string;
  group?: string;
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSeries(s: Partial<SeriesSummary>): SeriesSummary {
  return {
    id: typeof s.id === "string" ? s.id : "",
    name: normalizeName(s.name),
    createdAt: typeof s.createdAt === "string" ? s.createdAt : "",
  };
}

function normalizeEpisode(e: Partial<EpisodeSummary>): EpisodeSummary {
  return {
    id: typeof e.id === "string" ? e.id : "",
    name: normalizeName(e.name),
    createdAt: typeof e.createdAt === "string" ? e.createdAt : "",
    seriesId: typeof e.seriesId === "string" ? e.seriesId : "",
  };
}

function migrateLegacy(parsed: unknown): ProjectRegistry {
  let legacyProjects: LegacyProject[] = [];
  let legacyGroups: string[] = [];
  if (Array.isArray(parsed)) {
    legacyProjects = parsed as LegacyProject[];
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as {
      projects?: unknown;
      groups?: unknown;
    };
    legacyProjects = Array.isArray(obj.projects)
      ? (obj.projects as LegacyProject[])
      : [];
    legacyGroups = Array.isArray(obj.groups) ? (obj.groups as string[]) : [];
  }

  const now = nowIso();
  const series: SeriesSummary[] = [];
  const seriesByName = new Map<string, string>();
  for (const g of legacyGroups) {
    const name = normalizeName(g);
    if (!name || seriesByName.has(name)) continue;
    const id = newId();
    series.push({ id, name, createdAt: now });
    seriesByName.set(name, id);
  }

  const episodes: EpisodeSummary[] = [];
  for (const p of legacyProjects) {
    const group = normalizeName(p.group);
    let seriesId = seriesByName.get(group);
    if (group && !seriesId) {
      seriesId = newId();
      series.push({ id: seriesId, name: group, createdAt: now });
      seriesByName.set(group, seriesId);
    }
    if (!seriesId) {
      seriesId = newId();
      series.push({
        id: seriesId,
        name: normalizeName(p.name) || "未命名项目",
        createdAt: now,
      });
    }
    episodes.push({
      id: p.id,
      name: normalizeName(p.name) || "未命名项目",
      createdAt: typeof p.createdAt === "string" ? p.createdAt : now,
      seriesId,
    });
  }
  return { series, episodes };
}

function readRegistry(): ProjectRegistry {
  const file = getProjectsRegistryPath();
  if (!fs.existsSync(file)) return { series: [], episodes: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Array.isArray((parsed as { series?: unknown }).series) &&
      Array.isArray((parsed as { episodes?: unknown }).episodes)
    ) {
      const obj = parsed as {
        series: Partial<SeriesSummary>[];
        episodes: Partial<EpisodeSummary>[];
      };
      return {
        series: obj.series.map(normalizeSeries).filter((s) => s.id),
        episodes: obj.episodes.map(normalizeEpisode).filter((e) => e.id),
      };
    }
    const migrated = migrateLegacy(parsed);
    writeRegistry(migrated);
    return migrated;
  } catch {
    // 解析失败：备份坏文件，返回空注册表但不静默覆盖（下次写入前用户仍可恢复）。
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}.bak`);
    } catch {
      // 备份失败不阻断
    }
    return { series: [], episodes: [] };
  }
}

function writeRegistry(registry: ProjectRegistry): void {
  ensureWorkspace();
  const file = getProjectsRegistryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      {
        series: registry.series,
        episodes: registry.episodes,
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.renameSync(tmp, file);
}

export function listSeries(): SeriesSummary[] {
  return readRegistry().series.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export interface SeriesWithCount extends SeriesSummary {
  episodeCount: number;
  episodes: EpisodeSummary[];
}

export function listSeriesWithCounts(): SeriesWithCount[] {
  const registry = readRegistry();
  const episodesBySeries = new Map<string, EpisodeSummary[]>();
  for (const e of registry.episodes) {
    const list = episodesBySeries.get(e.seriesId) ?? [];
    list.push(e);
    episodesBySeries.set(e.seriesId, list);
  }
  return registry.series
    .map((s) => {
      const episodes = (episodesBySeries.get(s.id) ?? []).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      return { ...s, episodeCount: episodes.length, episodes };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSeries(id: string): SeriesSummary | null {
  return readRegistry().series.find((s) => s.id === id) ?? null;
}

export function createSeries(name: string): SeriesSummary {
  const series: SeriesSummary = {
    id: newId(),
    name: name.trim() || "未命名项目",
    createdAt: nowIso(),
  };
  const registry = readRegistry();
  registry.series.push(series);
  writeRegistry(registry);
  return series;
}

export function renameSeries(id: string, name: string): SeriesSummary | null {
  const nextName = name.trim();
  if (!nextName) return null;
  const registry = readRegistry();
  const series = registry.series.find((s) => s.id === id);
  if (!series) return null;
  series.name = nextName;
  writeRegistry(registry);
  return series;
}

export function deleteSeries(id: string): void {
  const registry = readRegistry();
  const episodeIds = registry.episodes
    .filter((e) => e.seriesId === id)
    .map((e) => e.id);
  registry.series = registry.series.filter((s) => s.id !== id);
  registry.episodes = registry.episodes.filter((e) => e.seriesId !== id);
  writeRegistry(registry);
  for (const episodeId of episodeIds) {
    deleteProjectData(episodeId);
  }
}

export function listEpisodes(seriesId: string): EpisodeSummary[] {
  return readRegistry()
    .episodes.filter((e) => e.seriesId === seriesId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// 子集缩略图：取该集第一段已回传的视频（按场次顺序）。没有则返回 null。
export function getEpisodeThumbnail(
  projectId: string,
): { segmentId: string } | null {
  if (!projectExists(projectId)) return null;
  const db = getProjectDb(projectId);
  const row = db
    .prepare(
      `SELECT sg.id AS id FROM segment sg
       JOIN scene sc ON sg.scene_id = sc.id
       WHERE sg.project_id = ? AND sg.video_path IS NOT NULL
       ORDER BY sc.sort_order ASC, sg.idx ASC
       LIMIT 1`,
    )
    .get(projectId) as { id: string } | undefined;
  return row ? { segmentId: row.id } : null;
}

function upsertEpisode(summary: EpisodeSummary): void {
  const registry = readRegistry();
  const episodes = registry.episodes.filter((e) => e.id !== summary.id);
  episodes.push(summary);
  writeRegistry({ series: registry.series, episodes });
}

function dropEpisode(id: string): void {
  const registry = readRegistry();
  writeRegistry({
    series: registry.series,
    episodes: registry.episodes.filter((e) => e.id !== id),
  });
}

export function projectExists(id: string): boolean {
  if (!isSafeId(id)) return false;
  try {
    // 必须是真正的项目目录（含 project.db），避免把 workspace/library 等兄弟目录当成项目删掉。
    return fs.existsSync(getProjectDbPath(id));
  } catch {
    return false;
  }
}

/* ---------------- CRUD ---------------- */

export function createEpisode(seriesId: string, input: CreateEpisodeInput): Project {
  const id = newId();
  const now = nowIso();
  // 新建项目：先建目录，再打开数据库（getProjectDb 不再隐式创建）。
  ensureProjectDirs(id);
  const db = getProjectDb(id);
  const styleText =
    input.style?.trim() || getStylePrompt(input.styleId) || "";
  db.prepare(
    `INSERT INTO project (id, name, style, style_id, aspect_ratio, default_segment_ms, vendor, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name.trim() || "未命名项目",
    styleText,
    input.styleId ?? null,
    input.aspectRatio ?? "9:16",
    input.defaultSegmentMs ?? 10000,
    input.vendor ?? "doubao",
    now,
    now,
  );
  db.prepare(
    `INSERT INTO story (id, project_id, content, updated_at) VALUES (?, ?, '', ?)`,
  ).run(newId(), id, now);
  seedProjectDefaults(db, id);
  upsertEpisode({
    id,
    name: input.name.trim() || "未命名项目",
    createdAt: now,
    seriesId,
  });
  return getProject(id)!;
}

export function getProject(id: string): Project | null {
  if (!projectExists(id)) return null;
  const db = getProjectDb(id);
  const row = db.prepare("SELECT * FROM project WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  return row ? mapProject(row) : null;
}

export function updateProject(
  id: string,
  patch: Partial<CreateEpisodeInput>,
): Project | null {
  const current = getProject(id);
  if (!current) return null;
  const db = getProjectDb(id);
  // 解析 style/styleId：找不到的风格不写入悬空 id，保持原样。
  let nextStyleId = current.styleId;
  let nextStyle = current.style;
  if (patch.style !== undefined) nextStyle = patch.style;
  if (patch.styleId !== undefined) {
    if (patch.styleId === null) {
      nextStyleId = null;
      if (patch.style === undefined) nextStyle = "";
    } else {
      const prompt = getStylePrompt(patch.styleId);
      if (prompt !== null) {
        nextStyleId = patch.styleId;
        if (patch.style === undefined) nextStyle = prompt;
      }
    }
  }
  const next = {
    name: patch.name ?? current.name,
    style: nextStyle,
    styleId: nextStyleId,
    aspectRatio: patch.aspectRatio ?? current.aspectRatio,
    defaultSegmentMs: patch.defaultSegmentMs ?? current.defaultSegmentMs,
    vendor: patch.vendor ?? current.vendor,
  };
  db.prepare(
    `UPDATE project SET name = ?, style = ?, style_id = ?, aspect_ratio = ?, default_segment_ms = ?, vendor = ?, updated_at = ? WHERE id = ?`,
  ).run(
    next.name,
    next.style,
    next.styleId,
    next.aspectRatio,
    next.defaultSegmentMs,
    next.vendor,
    nowIso(),
    id,
  );
  const registry = readRegistry();
  const episode = registry.episodes.find((e) => e.id === id);
  if (episode) {
    episode.name = next.name;
    writeRegistry(registry);
  }
  return getProject(id);
}

export function deleteProject(id: string): void {
  if (!projectExists(id)) return;
  // 只删注册表里登记过的子集，双保险防止误删同名目录。
  if (!readRegistry().episodes.some((e) => e.id === id)) return;
  dropEpisode(id);
  deleteProjectData(id);
}

/* ---------------- copy ---------------- */

const PROJECT_ID_TABLES = [
  "story",
  "script",
  "asset",
  "segment",
  "composition",
  "continuity_rule_set",
  "job",
] as const;

const PROJECT_PATH_COLUMNS = [
  ["view", "image_path"],
  ["frame", "image_path"],
  ["segment", "video_path"],
  ["video_asset", "path"],
  ["composition", "export_path"],
] as const;

// 手写递归复制：避免 Node 的 fs.cpSync 在 Windows 上偶发崩溃（打包脚本同样绕开了它）。
function copyDirSync(src: string, dest: string): void {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyDirSync(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function copyProjectFiles(sourceId: string, targetId: string): void {
  const sourceDir = getProjectDir(sourceId);
  const targetDir = getProjectDir(targetId);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name.startsWith("project.db")) continue;
    // 编排缓存里存的是源项目的绝对路径，复制时应丢弃。
    if (entry.name === "orchestration-cache.json") continue;
    copyDirSync(
      path.join(sourceDir, entry.name),
      path.join(targetDir, entry.name),
    );
  }
}

function remapCopiedProject(
  db: Db,
  sourceId: string,
  targetId: string,
  name: string,
): void {
  const now = nowIso();
  const sourceDir = getProjectDir(sourceId);
  const targetDir = getProjectDir(targetId);
  db.pragma("foreign_keys = OFF");
  try {
    const tx = db.transaction(() => {
      db.prepare(
        "UPDATE project SET id = ?, name = ?, created_at = ?, updated_at = ? WHERE id = ?",
      ).run(targetId, name, now, now, sourceId);
      for (const table of PROJECT_ID_TABLES) {
        db.prepare(
          `UPDATE ${table} SET project_id = ? WHERE project_id = ?`,
        ).run(targetId, sourceId);
      }
      for (const [table, column] of PROJECT_PATH_COLUMNS) {
        const rows = db
          .prepare(
            `SELECT id AS id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`,
          )
          .all() as { id: string; value: string }[];
        const update = db.prepare(
          `UPDATE ${table} SET ${column} = ? WHERE id = ?`,
        );
        for (const row of rows) {
          // 用 path.relative 判断归属，避免前缀相同的兄弟目录被误判。
          const rel = path.relative(sourceDir, row.value);
          if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
          update.run(path.join(targetDir, rel), row.id);
        }
      }
    });
    tx();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export async function copyEpisode(
  sourceId: string,
  target: { seriesId?: string; name?: string } = {},
): Promise<Project> {
  const source = getProject(sourceId);
  if (!source) throw new Error("子集不存在");
  const registry = readRegistry();
  const sourceEpisode = registry.episodes.find((e) => e.id === sourceId);
  const seriesId = target.seriesId ?? sourceEpisode?.seriesId ?? "";
  if (!seriesId || !registry.series.some((s) => s.id === seriesId)) {
    throw new Error("目标项目不存在");
  }
  const name = target.name?.trim() || `${source.name} 副本`;
  const targetId = newId();
  try {
    ensureProjectDirs(targetId);
    await getProjectDb(sourceId).backup(getProjectDbPath(targetId));
    copyProjectFiles(sourceId, targetId);
    remapCopiedProject(getProjectDb(targetId), sourceId, targetId, name);
  } catch (error) {
    // 复制中途失败：清掉半成品目录，避免留下脏项目。
    deleteProjectData(targetId);
    throw error;
  }
  upsertEpisode({
    id: targetId,
    name,
    createdAt: nowIso(),
    seriesId,
  });
  return getProject(targetId)!;
}

export async function copySeries(
  sourceId: string,
  name?: string,
): Promise<SeriesSummary> {
  const source = getSeries(sourceId);
  if (!source) throw new Error("项目不存在");
  const target = createSeries(name?.trim() || `${source.name} 副本`);
  for (const episode of listEpisodes(sourceId)) {
    await copyEpisode(episode.id, {
      seriesId: target.id,
      name: episode.name,
    });
  }
  copyProjectLibrary(sourceId, target.id);
  return target;
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
