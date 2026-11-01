import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { zipSync } from "fflate";
import type { LibraryAssetItem } from "@core/shared/library/assets";
import type { EpisodeSummary, SeriesSummary } from "@core/shared/projects";
import type { SegmentQcRecord } from "@core/shared/qc";
import type { RefOverrideItem } from "@core/shared/render-types";
import type { Script } from "@core/shared/schemas/script";
import type { StoredShot } from "@core/shared/schemas/storyboard";
import type { StoredFrame } from "@core/shared/frames";
import type {
  MediaKind,
  ProjectDoc,
  ProjectRecord,
} from "../src/spa/storage/types";
import {
  getProject,
  getStory,
} from "@core/server/projects";
import { getStoredScript } from "@core/server/script";
import { getAssets } from "@core/server/assets";
import { getStoryboard } from "@core/server/storyboard";
import { getFrames } from "@core/server/frames";
import { getLatestQcByProject } from "@core/server/qc";
import {
  getCompositionExportPath,
  listCompositions,
} from "@core/server/compose";
import { listSegmentRefUploads } from "@core/server/ref-uploads";
import { getProjectDbPath } from "@core/server/paths";

interface Registry {
  series: SeriesSummary[];
  episodes: EpisodeSummary[];
}

interface ArchiveMediaMeta {
  id: string;
  projectId: string;
  kind: MediaKind;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  fileName: string;
}

interface ExportPayload {
  format: "jueman-local";
  version: 2;
  exportedAt: string;
  mode: "full";
  series: SeriesSummary;
  episodes: EpisodeSummary[];
  projects: ProjectRecord[];
  media: ArchiveMediaMeta[];
  library: LibraryAssetItem[];
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function mimeOf(filePath: string): { mime: string; kind: MediaKind } {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return { mime: "image/png", kind: "image" };
  if (ext === ".jpg" || ext === ".jpeg") return { mime: "image/jpeg", kind: "image" };
  if (ext === ".webp") return { mime: "image/webp", kind: "image" };
  if (ext === ".gif") return { mime: "image/gif", kind: "image" };
  if (ext === ".mp4") return { mime: "video/mp4", kind: "video" };
  if (ext === ".webm") return { mime: "video/webm", kind: "video" };
  if (ext === ".mov") return { mime: "video/quicktime", kind: "video" };
  return { mime: "application/octet-stream", kind: "file" };
}

const workspace = path.resolve(
  arg("workspace") ?? process.env.WORKSPACE_DIR ?? path.join(process.cwd(), "workspace"),
);
process.env.WORKSPACE_DIR = workspace;
const registry = JSON.parse(
  fs.readFileSync(path.join(workspace, "projects.json"), "utf8"),
) as Registry;
const wanted = arg("series") ?? "大明逆子";
const series =
  registry.series.find((item) => item.id === wanted) ??
  registry.series.find((item) => item.name.includes(wanted)) ??
  null;
if (!series) throw new Error(`找不到项目：${wanted}`);
const sourceEpisodes = registry.episodes.filter(
  (episode) => episode.seriesId === series.id,
);
if (sourceEpisodes.length === 0) throw new Error(`项目「${series.name}」没有子集`);

const files: Record<string, Uint8Array> = {};
const media: ArchiveMediaMeta[] = [];
const pathToMedia = new Map<string, string>();

function addMedia(
  sourcePath: string | null | undefined,
  projectId: string,
  createdAt?: string,
): string | null {
  if (!sourcePath) return null;
  const absolute = path.resolve(sourcePath);
  const existing = pathToMedia.get(absolute);
  if (existing) return existing;
  if (!fs.existsSync(absolute)) {
    console.warn(`  跳过缺失媒体：${absolute}`);
    return null;
  }
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) return null;
  const id = crypto.randomUUID();
  const { mime, kind } = mimeOf(absolute);
  const ext = path.extname(absolute) || ".bin";
  const fileName = `media/${id}${ext}`;
  files[fileName] = new Uint8Array(fs.readFileSync(absolute));
  media.push({
    id,
    projectId,
    kind,
    name: path.basename(absolute),
    mime,
    size: stat.size,
    createdAt: createdAt ?? stat.mtime.toISOString(),
    fileName,
  });
  pathToMedia.set(absolute, id);
  return id;
}

function mapShotOriginal(value: string | null): StoredShot | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as StoredShot;
  } catch {
    return null;
  }
}

const projects: ProjectRecord[] = [];
for (const episode of sourceEpisodes) {
  const project = getProject(episode.id);
  if (!project) throw new Error(`读取子集失败：${episode.id}`);
  console.log(`迁移子集：${project.name} (${episode.id})`);

  const assets = getAssets(episode.id);
  for (const asset of assets) {
    for (const variant of asset.variants) {
      for (const view of variant.views) {
        view.imagePath = addMedia(view.imagePath, episode.id);
      }
    }
  }

  const storyboard = getStoryboard(episode.id, { readOnly: true });
  const videoBindings: Record<string, string> = {};
  const firstFrameIds: Record<string, string | null> = {};
  const mediaSigs: Record<string, string | null> = {};
  const refs: Record<string, RefOverrideItem[] | null> = {};
  const refUploads: Record<string, string> = {};
  const frames: StoredFrame[] = [];

  for (const scene of storyboard) {
    for (const segment of scene.segments) {
      firstFrameIds[segment.id] = segment.firstFrameId;
      mediaSigs[segment.id] = segment.mediaSig;
      if (segment.refOverride) {
        refs[segment.id] = segment.refOverride;
      }
      if (segment.videoPath) {
        const mediaId = addMedia(segment.videoPath, episode.id);
        if (mediaId) {
          videoBindings[segment.id] = mediaId;
          segment.videoPath = mediaId;
        }
      }
      for (const shot of segment.shots) {
        for (const ref of shot.refs) {
          if (ref.imagePath && fs.existsSync(ref.imagePath)) {
            const mediaId = addMedia(ref.imagePath, episode.id);
            if (mediaId) ref.imagePath = mediaId;
          }
        }
      }
      for (const frame of getFrames(episode.id, segment.id)) {
        const mediaId = addMedia(frame.imagePath, episode.id, frame.createdAt);
        if (mediaId) {
          frames.push({ ...frame, imagePath: mediaId });
        }
      }
      for (const upload of listSegmentRefUploads(episode.id, segment.id)) {
        const mediaId = addMedia(upload.imagePath, episode.id, upload.createdAt);
        if (mediaId) refUploads[upload.id] = mediaId;
      }
    }
  }

  const db = new Database(getProjectDbPath(episode.id), { readonly: true });
  const aiPrompts: Record<string, string> = {};
  const shotOriginals: Record<string, StoredShot> = {};
  try {
    const promptRows = db
      .prepare("SELECT id, ai_prompt FROM segment WHERE ai_prompt IS NOT NULL")
      .all() as { id: string; ai_prompt: string }[];
    for (const row of promptRows) aiPrompts[row.id] = row.ai_prompt;
    const originalRows = db
      .prepare("SELECT id, original_json FROM shot WHERE original_json IS NOT NULL")
      .all() as { id: string; original_json: string }[];
    for (const row of originalRows) {
      const original = mapShotOriginal(row.original_json);
      if (original) shotOriginals[row.id] = original;
    }
  } finally {
    db.close();
  }

  const qc: Record<string, SegmentQcRecord> = {};
  for (const record of getLatestQcByProject(episode.id)) {
    qc[record.segmentId] = {
      ...record,
      videoPath: record.videoPath
        ? (pathToMedia.get(path.resolve(record.videoPath)) ?? null)
        : null,
    };
  }

  const compositions = listCompositions(episode.id).map((composition) => {
    const exportPath = getCompositionExportPath(episode.id, composition.id);
    return {
      ...composition,
      mediaId: addMedia(exportPath, episode.id, composition.createdAt),
    };
  });

  const stored = getStoredScript(episode.id);
  const script: Script | null = stored
    ? {
        title: stored.title,
        scenes: stored.scenes.map((scene) => ({
          index: scene.index,
          slug: scene.slug,
          location: scene.location,
          timeOfDay: scene.timeOfDay,
          interiorExterior: scene.interiorExterior,
          summary: scene.summary,
          characters: scene.characters,
          beats: scene.beats,
        })),
      }
    : null;

  const doc: ProjectDoc = {
    schemaVersion: 1,
    project,
    story: getStory(episode.id).content,
    script,
    assets,
    storyboard,
    videoBindings,
    aiPrompts,
    frames,
    firstFrameIds,
    qc,
    refs,
    refUploads,
    mediaSigs,
    compositions,
    shotOriginals,
    updatedAt: project.updatedAt,
  };

  projects.push({
    id: episode.id,
    seriesId: series.id,
    name: project.name,
    updatedAt: project.updatedAt,
    doc,
  });
}

const payload: ExportPayload = {
  format: "jueman-local",
  version: 2,
  exportedAt: new Date().toISOString(),
  mode: "full",
  series,
  episodes: sourceEpisodes,
  projects,
  media,
  library: [],
};

files["project.json"] = new TextEncoder().encode(JSON.stringify(payload));
const out = path.resolve(arg("out") ?? path.join(workspace, `${series.name}-迁移.zip`));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zipSync(files, { level: 6 }));
console.log(`\n已生成迁移包：${out}`);
console.log(`媒体文件：${media.length}，子集：${projects.length}`);
