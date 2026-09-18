import fs from "node:fs";
import path from "node:path";
import { getProjectDb, newId } from "@/lib/db";
import { getProjectMediaDir } from "@/lib/paths";
import type {
  AssetDraft,
  AssetType,
  StoredAsset,
  StoredVariant,
  StoredView,
} from "@/lib/schemas/assets";

interface AssetRow {
  id: string;
  type: string;
  name: string;
  base_prompt: string;
  sort_order: number;
}

interface VariantRow {
  id: string;
  asset_id: string;
  label: string;
  prompt: string;
  sort_order: number;
}

interface ViewRow {
  id: string;
  variant_id: string;
  label: string;
  prompt: string;
  image_path: string | null;
  sort_order: number;
}

export function getAssets(projectId: string): StoredAsset[] {
  const db = getProjectDb(projectId);
  const assets = db
    .prepare("SELECT * FROM asset WHERE project_id = ? ORDER BY sort_order ASC")
    .all(projectId) as AssetRow[];
  const result: StoredAsset[] = [];
  for (const asset of assets) {
    const variants = db
      .prepare("SELECT * FROM variant WHERE asset_id = ? ORDER BY sort_order ASC")
      .all(asset.id) as VariantRow[];
    const storedVariants: StoredVariant[] = variants.map((v) => {
      const views = db
        .prepare("SELECT * FROM view WHERE variant_id = ? ORDER BY sort_order ASC")
        .all(v.id) as ViewRow[];
      return {
        id: v.id,
        label: v.label,
        prompt: v.prompt,
        views: views.map(
          (view): StoredView => ({
            id: view.id,
            label: view.label,
            prompt: view.prompt,
            imagePath: view.image_path,
          }),
        ),
      };
    });
    result.push({
      id: asset.id,
      type: asset.type as AssetType,
      name: asset.name,
      basePrompt: asset.base_prompt,
      variants: storedVariants,
    });
  }
  return result;
}

export function saveAssetDrafts(
  projectId: string,
  drafts: AssetDraft[],
): StoredAsset[] {
  const db = getProjectDb(projectId);
  const oldIds = (
    db.prepare("SELECT id FROM asset WHERE project_id = ?").all(projectId) as {
      id: string;
    }[]
  ).map((r) => r.id);

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM asset WHERE project_id = ?").run(projectId);
    const insertAsset = db.prepare(
      `INSERT INTO asset (id, project_id, type, name, base_prompt, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertVariant = db.prepare(
      `INSERT INTO variant (id, asset_id, label, prompt, sort_order) VALUES (?, ?, ?, ?, ?)`,
    );
    const insertView = db.prepare(
      `INSERT INTO view (id, variant_id, label, prompt, image_path, sort_order)
       VALUES (?, ?, ?, ?, NULL, ?)`,
    );
    drafts.forEach((draft, i) => {
      const assetId = newId();
      insertAsset.run(
        assetId,
        projectId,
        draft.type,
        draft.name,
        draft.basePrompt,
        i,
        new Date().toISOString(),
      );
      draft.variants.forEach((variant, vi) => {
        const variantId = newId();
        insertVariant.run(variantId, assetId, variant.label, variant.prompt, vi);
        variant.views.forEach((view, wi) => {
          insertView.run(
            newId(),
            variantId,
            view.label,
            view.prompt,
            wi,
          );
        });
      });
    });
  });
  tx();

  const mediaAssets = path.join(getProjectMediaDir(projectId), "assets");
  for (const oldId of oldIds) {
    const dir = path.join(mediaAssets, oldId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  return getAssets(projectId);
}

export function getViewContext(
  projectId: string,
  viewId: string,
): { assetId: string; variantId: string } | null {
  const db = getProjectDb(projectId);
  const row = db
    .prepare(
      `SELECT v.id as variant_id, v.asset_id as asset_id
       FROM view vw JOIN variant v ON vw.variant_id = v.id
       WHERE vw.id = ?`,
    )
    .get(viewId) as { variant_id: string; asset_id: string } | undefined;
  if (!row) return null;
  return { assetId: row.asset_id, variantId: row.variant_id };
}

export function setViewImage(
  projectId: string,
  viewId: string,
  imagePath: string | null,
): void {
  const db = getProjectDb(projectId);
  db.prepare("UPDATE view SET image_path = ? WHERE id = ?").run(
    imagePath,
    viewId,
  );
}

export function getViewImagePath(
  projectId: string,
  viewId: string,
): string | null {
  const db = getProjectDb(projectId);
  const row = db
    .prepare("SELECT image_path FROM view WHERE id = ?")
    .get(viewId) as { image_path: string | null } | undefined;
  return row?.image_path ?? null;
}
