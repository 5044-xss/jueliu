import fs from "node:fs";
import path from "node:path";
import {
  libraryPath,
  newLibraryId,
  readLibrary,
  writeLibrary,
} from "@/lib/library/store";
import { getProjectDb } from "@/lib/db";
import { getViewContext, getViewImagePath } from "@/lib/assets";

export type AssetLibraryScope = "global" | "project";

export interface LibraryAssetItem {
  id: string;
  scope: AssetLibraryScope;
  seriesId: string | null;
  type: string;
  name: string;
  variantLabel: string | null;
  prompt: string;
  fileName: string;
  createdAt: string;
}

function metaFile(scope: AssetLibraryScope, seriesId: string | null): string {
  return scope === "global"
    ? "asset-library-global.json"
    : `asset-library-${seriesId}.json`;
}

function imageDir(scope: AssetLibraryScope, seriesId: string | null): string {
  return path.join(
    libraryPath("asset-images"),
    scope === "global" ? "global" : `project-${seriesId}`,
  );
}

export function listLibraryAssets(
  scope: AssetLibraryScope,
  seriesId: string | null,
): LibraryAssetItem[] {
  if (scope === "project" && !seriesId) return [];
  return readLibrary<LibraryAssetItem>(metaFile(scope, seriesId), []);
}

export function getLibraryAssetImagePath(item: LibraryAssetItem): string {
  return path.join(imageDir(item.scope, item.seriesId), item.fileName);
}

export function findLibraryAsset(
  scope: AssetLibraryScope,
  seriesId: string | null,
  id: string,
): LibraryAssetItem | null {
  return listLibraryAssets(scope, seriesId).find((i) => i.id === id) ?? null;
}

export function addLibraryAsset(input: {
  scope: AssetLibraryScope;
  seriesId: string | null;
  type: string;
  name: string;
  variantLabel: string | null;
  prompt: string;
  sourceImagePath: string;
}): LibraryAssetItem {
  const ext = path.extname(input.sourceImagePath).toLowerCase() || ".png";
  const id = newLibraryId("asset");
  const fileName = `${id}${ext}`;
  const dir = imageDir(input.scope, input.seriesId);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(input.sourceImagePath, path.join(dir, fileName));
  const item: LibraryAssetItem = {
    id,
    scope: input.scope,
    seriesId: input.seriesId,
    type: input.type,
    name: input.name,
    variantLabel: input.variantLabel,
    prompt: input.prompt,
    fileName,
    createdAt: new Date().toISOString(),
  };
  writeLibrary(
    metaFile(input.scope, input.seriesId),
    [...listLibraryAssets(input.scope, input.seriesId), item],
  );
  return item;
}

export function deleteLibraryAsset(
  scope: AssetLibraryScope,
  seriesId: string | null,
  id: string,
): boolean {
  const items = listLibraryAssets(scope, seriesId);
  const item = items.find((i) => i.id === id);
  if (!item) return false;
  const p = getLibraryAssetImagePath(item);
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  writeLibrary(
    metaFile(scope, seriesId),
    items.filter((i) => i.id !== id),
  );
  return true;
}

export function copyProjectLibrary(
  sourceSeriesId: string,
  targetSeriesId: string,
): void {
  const items = listLibraryAssets("project", sourceSeriesId);
  if (items.length === 0) return;
  const srcDir = imageDir("project", sourceSeriesId);
  const dstDir = imageDir("project", targetSeriesId);
  fs.mkdirSync(dstDir, { recursive: true });
  const now = new Date().toISOString();
  const cloned = items.map((item) => {
    const src = path.join(srcDir, item.fileName);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dstDir, item.fileName));
    }
    return {
      ...item,
      id: newLibraryId("asset"),
      seriesId: targetSeriesId,
      createdAt: now,
    };
  });
  writeLibrary(metaFile("project", targetSeriesId), cloned);
}

export interface LibrarySource {
  type: string;
  name: string;
  variantLabel: string | null;
  prompt: string;
  imagePath: string | null;
}

export function resolveViewSource(
  projectId: string,
  viewId: string,
): LibrarySource | null {
  const ctx = getViewContext(projectId, viewId);
  if (!ctx) return null;
  const db = getProjectDb(projectId);
  const row = db
    .prepare(
      `SELECT a.type AS type, a.name AS name, a.base_prompt AS base_prompt,
              v.label AS variant_label, v.prompt AS variant_prompt, v.sort_order AS sort_order
       FROM view vw
       JOIN variant v ON vw.variant_id = v.id
       JOIN asset a ON v.asset_id = a.id
       WHERE vw.id = ? AND a.project_id = ?`,
    )
    .get(viewId, projectId) as
    | {
        type: string;
        name: string;
        base_prompt: string;
        variant_label: string;
        variant_prompt: string;
        sort_order: number;
      }
    | undefined;
  if (!row) return null;
  const imagePath = getViewImagePath(projectId, viewId);
  const isBase = row.sort_order === 0;
  return {
    type: row.type,
    name: row.name,
    variantLabel: isBase ? null : row.variant_label,
    prompt: isBase ? row.base_prompt : row.variant_prompt || row.base_prompt,
    imagePath,
  };
}
