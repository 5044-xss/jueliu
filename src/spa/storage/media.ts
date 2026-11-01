import { db } from "./db";
import type { MediaKind, MediaRecord } from "./types";

function desktopMedia() {
  if (typeof window === "undefined") return undefined;
  return window.desktopAPI?.media;
}

function kindOf(file: File): MediaKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "file";
}

export interface MediaImportResult {
  id: string;
  relativePath: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

export const mediaRepository = {
  async put(
    projectId: string,
    file: File,
    kind: MediaKind = kindOf(file),
  ): Promise<MediaRecord> {
    const api = desktopMedia();
    if (api) {
      const payload = {
        projectId,
        name: file.name || "未命名文件",
        mime: file.type || "application/octet-stream",
        kind,
      };
      try {
        const sourcePath = api.getPathForFile(file);
        if (sourcePath) {
          const imported = await api.importFile({
            ...payload,
            sourcePath,
          });
          const record: MediaRecord = {
            ...imported,
            projectId,
            kind,
            storage: "file",
          };
          await db.media.add(record);
          return record;
        }
      } catch {
        // 回退到 ArrayBuffer 传输
      }
      const imported = await api.importBuffer({
        ...payload,
        buffer: await file.arrayBuffer(),
      });
      const record: MediaRecord = {
        ...imported,
        projectId,
        kind,
        storage: "file",
      };
      await db.media.add(record);
      return record;
    }

    const record: MediaRecord = {
      id: crypto.randomUUID(),
      projectId,
      kind,
      name: file.name || "未命名文件",
      mime: file.type || "application/octet-stream",
      size: file.size,
      createdAt: new Date().toISOString(),
      storage: "indexeddb",
      blob: file,
    };
    await db.media.add(record);
    return record;
  },

  async registerFile(record: MediaRecord): Promise<void> {
    await db.media.add(record);
  },

  // 桌面端合成需要真实文件路径；导入的项目包或早期网页模式上传的素材
  // 可能只有 IndexedDB blob，这里按需落盘并回写路径。失败时保持原记录。
  async ensureDesktopFile(record: MediaRecord): Promise<MediaRecord> {
    if (record.storage === "file" && record.relativePath) return record;
    const api = desktopMedia();
    if (!api || !record.blob) return record;
    try {
      const imported = await api.importBuffer({
        projectId: record.projectId,
        name: record.name,
        mime: record.mime,
        kind: record.kind,
        buffer: await record.blob.arrayBuffer(),
      });
      const next: MediaRecord = {
        ...record,
        storage: "file",
        relativePath: imported.relativePath,
        size: imported.size,
        mime: imported.mime || record.mime,
      };
      delete next.blob;
      await db.media.put(next);
      return next;
    } catch {
      return record;
    }
  },

  async get(id: string): Promise<MediaRecord | null> {
    return (await db.media.get(id)) ?? null;
  },

  async list(projectId: string): Promise<MediaRecord[]> {
    return db.media.where("projectId").equals(projectId).sortBy("createdAt");
  },

  async remove(id: string): Promise<void> {
    const record = await db.media.get(id);
    if (record?.storage === "file" && record.relativePath) {
      await desktopMedia()?.remove(record.relativePath).catch(() => undefined);
    }
    await db.media.delete(id);
  },

  async removeProject(projectId: string): Promise<void> {
    const records = await db.media.where("projectId").equals(projectId).toArray();
    for (const record of records) {
      if (record.storage === "file" && record.relativePath) {
        await desktopMedia()
          ?.remove(record.relativePath)
          .catch(() => undefined);
      }
    }
    await db.media.where("projectId").equals(projectId).delete();
  },

  async url(id: string): Promise<string | null> {
    const record = await db.media.get(id);
    if (!record) return null;
    if (record.storage === "file" && record.relativePath) {
      return (await desktopMedia()?.url(record.relativePath)) ?? null;
    }
    if (record.blob) return URL.createObjectURL(record.blob);
    return null;
  },

  async usageBytes(projectId?: string): Promise<number> {
    const rows = projectId
      ? await db.media.where("projectId").equals(projectId).toArray()
      : await db.media.toArray();
    return rows.reduce((sum, row) => sum + row.size, 0);
  },

  async storageEstimate(): Promise<{ usage: number; quota: number } | null> {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
      return null;
    }
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  },

  async persist(): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) {
      return false;
    }
    return navigator.storage.persist();
  },
};
