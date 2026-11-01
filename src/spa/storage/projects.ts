import type {
  CreateSeriesInput,
  CreateEpisodeInput,
  Project,
  SeriesWithCount,
} from "@core/shared/projects";
import { DEFAULT_VENDOR } from "@core/shared/orchestration/vendors";
import { db } from "./db";
import type { EpisodeRecord, ProjectDoc, ProjectRecord, SeriesRecord } from "./types";

const DEFAULT_ASPECT_RATIO = "9:16";
const DEFAULT_SEGMENT_MS = 10_000;

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function defaultProject(
  id: string,
  name: string,
  input: Partial<CreateEpisodeInput> = {},
): Project {
  const timestamp = now();
  return {
    id,
    name,
    style: input.style?.trim() || "",
    videoStyle: input.videoStyle?.trim() || "",
    styleId: input.styleId ?? null,
    aspectRatio: input.aspectRatio?.trim() || DEFAULT_ASPECT_RATIO,
    defaultSegmentMs: DEFAULT_SEGMENT_MS,
    vendor: input.vendor?.trim() || DEFAULT_VENDOR,
    storyboardStrategyId: "universal",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createProjectDoc(project: Project, story = ""): ProjectDoc {
  return {
    schemaVersion: 1,
    project,
    story,
    script: null,
    assets: [],
    storyboard: [],
    videoBindings: {},
    aiPrompts: {},
    updatedAt: project.updatedAt,
  };
}

export const projectRepository = {
  async listSeries(): Promise<SeriesWithCount[]> {
    const [series, episodes] = await Promise.all([
      db.series.orderBy("createdAt").reverse().toArray(),
      db.episodes.toArray(),
    ]);
    return series.map((item) => {
      const own = episodes
        .filter((episode) => episode.seriesId === item.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { ...item, episodeCount: own.length, episodes: own };
    });
  },

  async getSeries(id: string): Promise<SeriesRecord | null> {
    return (await db.series.get(id)) ?? null;
  },

  async createSeries(input: CreateSeriesInput): Promise<SeriesRecord> {
    const name = input.name.trim();
    if (!name) throw new Error("项目名称不能为空");
    const record: SeriesRecord = {
      id: newId(),
      name,
      createdAt: now(),
      style: input.style?.trim() || "",
      videoStyle: input.videoStyle?.trim() || "",
      styleId: input.styleId ?? null,
      aspectRatio: input.aspectRatio?.trim() || DEFAULT_ASPECT_RATIO,
    };
    await db.series.add(record);
    return record;
  },

  async renameSeries(id: string, name: string): Promise<void> {
    const next = name.trim();
    if (!next) throw new Error("项目名称不能为空");
    await db.series.update(id, { name: next });
  },

  async deleteSeries(id: string): Promise<void> {
    const episodes = await db.episodes.where("seriesId").equals(id).toArray();
    await db.transaction(
      "rw",
      db.series,
      db.episodes,
      db.projects,
      db.media,
      db.jobs,
      async () => {
        await db.series.delete(id);
        await db.episodes.where("seriesId").equals(id).delete();
        for (const episode of episodes) {
          await db.projects.delete(episode.id);
          await db.media.where("projectId").equals(episode.id).delete();
          await db.jobs.where("projectId").equals(episode.id).delete();
        }
      },
    );
  },

  async listEpisodes(seriesId: string): Promise<EpisodeRecord[]> {
    return db.episodes.where("seriesId").equals(seriesId).sortBy("createdAt");
  },

  async createEpisode(
    seriesId: string,
    input: CreateEpisodeInput,
  ): Promise<ProjectRecord> {
    const series = await db.series.get(seriesId);
    if (!series) throw new Error("项目不存在");
    const name = input.name.trim();
    if (!name) throw new Error("剧集名称不能为空");

    const project = defaultProject(newId(), name, {
      ...input,
      style: input.style ?? series.style,
      videoStyle: input.videoStyle ?? series.videoStyle,
      styleId: input.styleId ?? series.styleId,
      aspectRatio: input.aspectRatio ?? series.aspectRatio,
    });
    const episode: EpisodeRecord = {
      id: project.id,
      name,
      createdAt: project.createdAt,
      seriesId,
    };
    const doc = createProjectDoc(project);
    const record: ProjectRecord = {
      id: project.id,
      seriesId,
      name,
      updatedAt: project.updatedAt,
      doc,
    };

    await db.transaction("rw", db.episodes, db.projects, async () => {
      await db.episodes.add(episode);
      await db.projects.add(record);
    });
    return record;
  },

  async getProject(id: string): Promise<ProjectRecord | null> {
    return (await db.projects.get(id)) ?? null;
  },

  async loadProject(id: string): Promise<ProjectDoc | null> {
    const record = await db.projects.get(id);
    return record?.doc ?? null;
  },

  async saveProject(doc: ProjectDoc): Promise<void> {
    const project = { ...doc.project, updatedAt: now() };
    const next: ProjectDoc = { ...doc, project, updatedAt: project.updatedAt };
    await db.transaction("rw", db.projects, db.episodes, async () => {
      const existing = await db.projects.get(doc.project.id);
      if (!existing) throw new Error("项目不存在");
      await db.projects.put({
        ...existing,
        name: project.name,
        updatedAt: project.updatedAt,
        doc: next,
      });
      await db.episodes.update(project.id, { name: project.name });
    });
  },

  async deleteProject(id: string): Promise<void> {
    await db.transaction(
      "rw",
      db.episodes,
      db.projects,
      db.media,
      db.jobs,
      async () => {
        await db.episodes.delete(id);
        await db.projects.delete(id);
        await db.media.where("projectId").equals(id).delete();
        await db.jobs.where("projectId").equals(id).delete();
      },
    );
  },

  async copyProject(id: string, name: string): Promise<ProjectRecord> {
    const source = await db.projects.get(id);
    if (!source) throw new Error("项目不存在");
    const nextId = newId();
    const timestamp = now();
    const doc: ProjectDoc = JSON.parse(JSON.stringify(source.doc));
    doc.project = {
      ...doc.project,
      id: nextId,
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    doc.updatedAt = timestamp;
    doc.videoBindings = {};
    doc.aiPrompts = {};
    const record: ProjectRecord = {
      ...source,
      id: nextId,
      name,
      updatedAt: timestamp,
      doc,
    };
    const episode: EpisodeRecord = {
      id: nextId,
      name,
      createdAt: timestamp,
      seriesId: source.seriesId,
    };
    await db.transaction("rw", db.episodes, db.projects, async () => {
      await db.episodes.add(episode);
      await db.projects.add(record);
    });
    return record;
  },

  async copySeries(id: string, name: string): Promise<SeriesRecord> {
    const source = await db.series.get(id);
    if (!source) throw new Error("项目不存在");
    const episodes = await db.episodes.where("seriesId").equals(id).toArray();
    const projects = await db.projects.where("seriesId").equals(id).toArray();
    const nextSeriesId = newId();
    const timestamp = now();
    const series: SeriesRecord = {
      ...source,
      id: nextSeriesId,
      name,
      createdAt: timestamp,
    };
    const nextEpisodes: EpisodeRecord[] = [];
    const nextProjects: ProjectRecord[] = [];
    for (const episode of episodes) {
      const project = projects.find((item) => item.id === episode.id);
      if (!project) continue;
      const nextId = newId();
      const doc: ProjectDoc = JSON.parse(JSON.stringify(project.doc));
      doc.project = {
        ...doc.project,
        id: nextId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      doc.updatedAt = timestamp;
      doc.videoBindings = {};
      doc.aiPrompts = {};
      nextEpisodes.push({
        ...episode,
        id: nextId,
        seriesId: nextSeriesId,
        createdAt: timestamp,
      });
      nextProjects.push({
        ...project,
        id: nextId,
        seriesId: nextSeriesId,
        updatedAt: timestamp,
        doc,
      });
    }
    await db.transaction(
      "rw",
      db.series,
      db.episodes,
      db.projects,
      async () => {
        await db.series.add(series);
        if (nextEpisodes.length) await db.episodes.bulkAdd(nextEpisodes);
        if (nextProjects.length) await db.projects.bulkAdd(nextProjects);
      },
    );
    return series;
  },

  async countProjects(): Promise<number> {
    return db.projects.count();
  },
};
