import type { StoredAsset } from "@core/shared/schemas/assets";
import type { Script } from "@core/shared/schemas/script";
import type { StoredSceneStoryboard } from "@core/shared/schemas/storyboard";
import type {
  EpisodeSummary,
  Project,
  SeriesSummary,
} from "@core/shared/projects";
import type { StoredFrame } from "@core/shared/frames";
import type { StoredShot } from "@core/shared/schemas/storyboard";
import type { SegmentQcRecord } from "@core/shared/qc";
import type { CompositionInfo } from "@core/shared/compose-shared";
import type { RefOverrideItem } from "@core/shared/render-types";
import type { JobInfo } from "@core/shared/jobs";

export interface ProjectDoc {
  schemaVersion: 1;
  project: Project;
  story: string;
  script: Script | null;
  assets: StoredAsset[];
  storyboard: StoredSceneStoryboard[];
  videoBindings?: Record<string, string>;
  aiPrompts?: Record<string, string>;
  frames?: StoredFrame[];
  firstFrameIds?: Record<string, string | null>;
  qc?: Record<string, SegmentQcRecord>;
  refs?: Record<string, RefOverrideItem[] | null>;
  refUploads?: Record<string, string>;
  mediaSigs?: Record<string, string | null>;
  compositions?: LocalComposition[];
  shotOriginals?: Record<string, StoredShot>;
  updatedAt: string;
}

export type LocalComposition = CompositionInfo & {
  mediaId?: string | null;
};

export type SeriesRecord = SeriesSummary;

export type EpisodeRecord = EpisodeSummary;

export interface ProjectRecord {
  id: string;
  seriesId: string;
  name: string;
  updatedAt: string;
  doc: ProjectDoc;
}

export interface JobRecord extends JobInfo {
  projectId: string;
  heartbeatAt: string | null;
  ownerTabId: string;
  ownerRunId: string;
}

export type MediaKind = "image" | "video" | "file";

export type MediaStorage = "indexeddb" | "file";

export interface MediaRecord {
  id: string;
  projectId: string;
  kind: MediaKind;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  storage: MediaStorage;
  blob?: Blob;
  relativePath?: string;
  libraryScope?: "global" | "project" | null;
  librarySeriesId?: string | null;
}
