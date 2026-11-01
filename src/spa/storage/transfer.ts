import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";
import type { EpisodeSummary, SeriesSummary } from "@core/shared/projects";
import type { LibraryAssetItem } from "@core/shared/library/assets";
import { db } from "./db";
import type { MediaRecord, ProjectDoc, ProjectRecord } from "./types";
import { mediaBlob } from "../api/media";
import { libraryRepository } from "./library";

export type ArchiveMode = "slim" | "full";

interface ArchiveMediaMeta {
  id: string;
  projectId: string;
  kind: MediaRecord["kind"];
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
  mode: ArchiveMode;
  series: SeriesSummary;
  episodes: EpisodeSummary[];
  projects: ProjectRecord[];
  media: ArchiveMediaMeta[];
  library: (LibraryAssetItem & { mediaId?: string | null })[];
}

function newId(): string {
  return crypto.randomUUID();
}

function extensionOf(media: MediaRecord): string {
  const name = media.name || "";
  const dot = name.lastIndexOf(".");
  if (dot >= 0 && dot < name.length - 1) {
    const ext = name.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{1,8}$/.test(ext)) return `.${ext}`;
  }
  if (media.mime.startsWith("image/png")) return ".png";
  if (media.mime.startsWith("image/jpeg")) return ".jpg";
  if (media.mime.startsWith("image/webp")) return ".webp";
  if (media.mime.startsWith("video/webm")) return ".webm";
  if (media.mime.startsWith("video/quicktime")) return ".mov";
  if (media.mime.startsWith("video/")) return ".mp4";
  return "";
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function buildSeriesArchive(
  seriesId: string,
  mode: ArchiveMode = "slim",
): Promise<{
  blob: Blob;
  fileName: string;
}> {
  const series = await db.series.get(seriesId);
  if (!series) throw new Error("项目不存在");
  const episodes = await db.episodes.where("seriesId").equals(seriesId).toArray();
  const projects = await db.projects.where("seriesId").equals(seriesId).toArray();

  const media: ArchiveMediaMeta[] = [];
  const files: Record<string, Uint8Array> = {};
  files["project.json"] = strToU8("");
  const library = await libraryRepository.listAssets("project", seriesId);
  const included = new Set<string>();

  if (mode === "full") {
    for (const episode of episodes) {
      const records = await db.media
        .where("projectId")
        .equals(episode.id)
        .toArray();
      for (const record of records) {
        if (included.has(record.id)) continue;
        const blob = await mediaBlob(record);
        if (!blob) continue;
        const ext = extensionOf(record);
        const fileName = `media/${record.id}${ext}`;
        files[fileName] = new Uint8Array(await blob.arrayBuffer());
        included.add(record.id);
        media.push({
          id: record.id,
          projectId: record.projectId,
          kind: record.kind,
          name: record.name,
          mime: record.mime || blob.type || "application/octet-stream",
          size: record.size || blob.size,
          createdAt: record.createdAt,
          fileName,
        });
      }
    }
    for (const item of library) {
      if (!item.mediaId || included.has(item.mediaId)) continue;
      const record = await db.media.get(item.mediaId);
      if (!record) continue;
      const blob = await mediaBlob(record);
      if (!blob) continue;
      const ext = extensionOf(record);
      const fileName = `library/${item.id}${ext}`;
      files[fileName] = new Uint8Array(await blob.arrayBuffer());
      included.add(item.mediaId);
      media.push({
        id: record.id,
        projectId: record.projectId,
        kind: record.kind,
        name: record.name,
        mime: record.mime || blob.type || "application/octet-stream",
        size: record.size || blob.size,
        createdAt: record.createdAt,
        fileName,
      });
    }
  }

  const payload: ExportPayload = {
    format: "jueman-local",
    version: 2,
    exportedAt: new Date().toISOString(),
    mode,
    series,
    episodes,
    projects,
    media,
    library,
  };
  files["project.json"] = strToU8(JSON.stringify(payload, null, 2));
  const bytes = zipSync(files, { level: 6 });
  const fileName = `${series.name.replace(/[\\/:*?"<>|]/g, " ").trim() || "项目"}.zip`;
  return {
    blob: new Blob([bytes], { type: "application/zip" }),
    fileName,
  };
}

export async function importSeriesArchive(file: File): Promise<SeriesSummary> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(bytes);
  const raw = entries["project.json"];
  if (!raw) {
    if (entries["manifest.json"]) {
      throw new Error(
        "该压缩包是 Next 版（sqlite）项目包，当前纯前端版本暂不支持导入",
      );
    }
    throw new Error("项目包缺少 project.json");
  }
  const payload = JSON.parse(strFromU8(raw)) as ExportPayload;
  if (payload.format !== "jueman-local" || !payload.series) {
    throw new Error("不是本应用导出的项目包");
  }

  const timestamp = new Date().toISOString();
  const seriesId = newId();
  const episodeIdMap = new Map<string, string>();
  const series: SeriesSummary = {
    ...payload.series,
    id: seriesId,
    createdAt: timestamp,
  };
  const episodes: EpisodeSummary[] = [];
  const projects: ProjectRecord[] = [];
  const mediaRecords: MediaRecord[] = [];

  for (const episode of payload.episodes ?? []) {
    const source = payload.projects?.find(
      (project) => project.id === episode.id,
    );
    if (!source) continue;
    const nextId = newId();
    episodeIdMap.set(episode.id, nextId);
    const doc: ProjectDoc = JSON.parse(JSON.stringify(source.doc));
    doc.project = {
      ...doc.project,
      id: nextId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    doc.updatedAt = timestamp;
    episodes.push({
      ...episode,
      id: nextId,
      seriesId,
      createdAt: timestamp,
    });
    projects.push({
      ...source,
      id: nextId,
      seriesId,
      updatedAt: timestamp,
      doc,
    });
  }

  for (const meta of payload.media ?? []) {
    const data = entries[meta.fileName];
    if (!data) continue;
    const projectId = episodeIdMap.get(meta.projectId) ?? meta.projectId;
    const existing = await db.media.get(meta.id);
    if (existing) continue;
    mediaRecords.push({
      id: meta.id,
      projectId,
      kind: meta.kind,
      name: meta.name,
      mime: meta.mime,
      size: meta.size || data.byteLength,
      createdAt: meta.createdAt,
      storage: "indexeddb",
      blob: new Blob([data], { type: meta.mime }),
    });
  }

  await db.transaction(
    "rw",
    db.series,
    db.episodes,
    db.projects,
    db.media,
    async () => {
      await db.series.add(series);
      if (episodes.length) await db.episodes.bulkAdd(episodes);
      if (projects.length) await db.projects.bulkAdd(projects);
      if (mediaRecords.length) await db.media.bulkAdd(mediaRecords);
    },
  );

  const libraryItems = (payload.library ?? [])
    .filter((item) => item.mediaId)
    .map((item) => ({
      ...item,
      id: `asset_${newId().replace(/-/g, "").slice(0, 12)}`,
      seriesId,
      createdAt: timestamp,
    }));
  if (libraryItems.length > 0) {
    await libraryRepository
      .saveAssets("project", seriesId, libraryItems as never)
      .catch(() => undefined);
  }
  return series;
}
