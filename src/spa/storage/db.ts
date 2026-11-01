import Dexie, { type Table } from "dexie";
import type {
  EpisodeRecord,
  JobRecord,
  MediaRecord,
  ProjectRecord,
  SeriesRecord,
} from "./types";

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

class LocalDatabase extends Dexie {
  series!: Table<SeriesRecord, string>;
  episodes!: Table<EpisodeRecord, string>;
  projects!: Table<ProjectRecord, string>;
  media!: Table<MediaRecord, string>;
  settings!: Table<SettingRecord, string>;
  jobs!: Table<JobRecord, string>;

  constructor() {
    super("jueliu-local");
    this.version(1).stores({
      series: "id, name, createdAt",
      episodes: "id, seriesId, name, createdAt",
      projects: "id, seriesId, updatedAt",
      media: "id, projectId, kind, createdAt",
      settings: "key",
    });
    this.version(2).stores({
      jobs: "id, projectId, kind, status, startedAt",
    });
  }
}

export const db = new LocalDatabase();
