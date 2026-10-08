import fs from "node:fs";
import path from "node:path";
import { getProjectDb, newId } from "@/lib/db";
import { getProjectMediaDir } from "@/lib/paths";
import { stripStyle } from "@/lib/asset-prompt";
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
  original_name: string | null;
  original_base_prompt: string | null;
  sort_order: number;
}

interface VariantRow {
  id: string;
  asset_id: string;
  label: string;
  prompt: string;
  original_label: string | null;
  original_prompt: string | null;
  sort_order: number;
}

interface ViewRow {
  id: string;
  variant_id: string;
  label: string;
  prompt: string;
  original_label: string | null;
  original_prompt: string | null;
  image_path: string | null;
  sort_order: number;
}

// 每种资产的默认视角：角色四视图、场景一张干净「全景」、道具正面。
// 场景只用一张全景空镜作参考图，不拼贴俯视图/平面图，保证参考图干净稳定。
// 供「手动新增变体」与「LLM 生成资产兜底」共用，保证不会出现「有变体、没视角」。
export function defaultViewLabels(type: AssetType): string[] {
  if (type === "scene") return ["全景"];
  if (type === "prop") return ["正面"];
  return ["四视图"];
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
        originalLabel: v.original_label,
        originalPrompt: v.original_prompt,
        views: views.map(
          (view): StoredView => ({
            id: view.id,
            label: view.label,
            prompt: view.prompt,
            imagePath: view.image_path,
            originalLabel: view.original_label,
            originalPrompt: view.original_prompt,
          }),
        ),
      };
    });
    result.push({
      id: asset.id,
      type: asset.type as AssetType,
      name: asset.name,
      basePrompt: asset.base_prompt,
      originalName: asset.original_name,
      originalBasePrompt: asset.original_base_prompt,
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
      `INSERT INTO asset (id, project_id, type, name, base_prompt, original_name, original_base_prompt, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertVariant = db.prepare(
      `INSERT INTO variant (id, asset_id, label, prompt, original_label, original_prompt, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertView = db.prepare(
      `INSERT INTO view (id, variant_id, label, prompt, original_label, original_prompt, image_path, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    );
    drafts.forEach((draft, i) => {
      const assetId = newId();
      insertAsset.run(
        assetId,
        projectId,
        draft.type,
        draft.name,
        draft.basePrompt,
        draft.name,
        draft.basePrompt,
        i,
        new Date().toISOString(),
      );
      draft.variants.forEach((variant, vi) => {
        const variantId = newId();
        insertVariant.run(
          variantId,
          assetId,
          variant.label,
          variant.prompt,
          variant.label,
          variant.prompt,
          vi,
        );
        // 兜底：LLM 偶尔产出「有变体、没视角」，这里按资产类型补上默认视角，
        // 避免分镜引用时无图可用、也避免资产页出现空变体。
        const views =
          variant.views.length > 0
            ? variant.views
            : defaultViewLabels(draft.type).map((label) => ({
                label,
                prompt: "",
              }));
        views.forEach((view, wi) => {
          insertView.run(
            newId(),
            variantId,
            view.label,
            view.prompt,
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

/* ---------------- 编辑 ---------------- */

export function updateAsset(
  projectId: string,
  assetId: string,
  patch: { name?: string; basePrompt?: string },
): boolean {
  const db = getProjectDb(projectId);
  const row = db
    .prepare("SELECT id FROM asset WHERE id = ? AND project_id = ?")
    .get(assetId, projectId);
  if (!row) return false;
  db.prepare("UPDATE asset SET name = COALESCE(?, name), base_prompt = COALESCE(?, base_prompt) WHERE id = ?").run(
    patch.name ?? null,
    patch.basePrompt ?? null,
    assetId,
  );
  return true;
}

export function updateVariant(
  projectId: string,
  variantId: string,
  patch: { label?: string; prompt?: string },
): boolean {
  const db = getProjectDb(projectId);
  const row = db
    .prepare(
      `SELECT v.id FROM variant v JOIN asset a ON v.asset_id = a.id
       WHERE v.id = ? AND a.project_id = ?`,
    )
    .get(variantId, projectId);
  if (!row) return false;
  db.prepare(
    "UPDATE variant SET label = COALESCE(?, label), prompt = COALESCE(?, prompt) WHERE id = ?",
  ).run(patch.label ?? null, patch.prompt ?? null, variantId);
  return true;
}

export function updateView(
  projectId: string,
  viewId: string,
  patch: { label?: string; prompt?: string },
): boolean {
  const db = getProjectDb(projectId);
  const row = db
    .prepare(
      `SELECT vw.id FROM view vw
       JOIN variant v ON vw.variant_id = v.id
       JOIN asset a ON v.asset_id = a.id
       WHERE vw.id = ? AND a.project_id = ?`,
    )
    .get(viewId, projectId);
  if (!row) return false;
  db.prepare(
    "UPDATE view SET label = COALESCE(?, label), prompt = COALESCE(?, prompt) WHERE id = ?",
  ).run(patch.label ?? null, patch.prompt ?? null, viewId);
  return true;
}

// 失效级联：清空项目全部资产（含已回传图片）。上游剧本重新生成时调用。
export function clearAssets(projectId: string): void {
  const db = getProjectDb(projectId);
  db.prepare("DELETE FROM asset WHERE project_id = ?").run(projectId);
  const dir = path.join(getProjectMediaDir(projectId), "assets");
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// 切换项目风格时，把旧的风格文本从资产提示词里剔除，使其回到「纯内容」。
// 新风格不写回数据库，而是在资产页展示/复制时由 composeAssetPrompt 拼接。
export function stripStyleFromAssetPrompts(
  projectId: string,
  style: string,
): void {
  const target = style.trim();
  if (!target) return;
  const db = getProjectDb(projectId);
  const tx = db.transaction(() => {
    const assets = db
      .prepare(
        "SELECT id, base_prompt, original_base_prompt FROM asset WHERE project_id = ?",
      )
      .all(projectId) as {
      id: string;
      base_prompt: string;
      original_base_prompt: string | null;
    }[];
    const updAsset = db.prepare(
      "UPDATE asset SET base_prompt = ?, original_base_prompt = ? WHERE id = ?",
    );
    for (const a of assets) {
      updAsset.run(
        stripStyle(a.base_prompt, target),
        a.original_base_prompt === null
          ? null
          : stripStyle(a.original_base_prompt, target),
        a.id,
      );
    }

    const variants = db
      .prepare(
        `SELECT v.id, v.prompt, v.original_prompt FROM variant v
         JOIN asset a ON v.asset_id = a.id WHERE a.project_id = ?`,
      )
      .all(projectId) as {
      id: string;
      prompt: string;
      original_prompt: string | null;
    }[];
    const updVariant = db.prepare(
      "UPDATE variant SET prompt = ?, original_prompt = ? WHERE id = ?",
    );
    for (const v of variants) {
      updVariant.run(
        stripStyle(v.prompt, target),
        v.original_prompt === null
          ? null
          : stripStyle(v.original_prompt, target),
        v.id,
      );
    }

    const views = db
      .prepare(
        `SELECT vw.id, vw.prompt, vw.original_prompt FROM view vw
         JOIN variant v ON vw.variant_id = v.id
         JOIN asset a ON v.asset_id = a.id WHERE a.project_id = ?`,
      )
      .all(projectId) as {
      id: string;
      prompt: string;
      original_prompt: string | null;
    }[];
    const updView = db.prepare(
      "UPDATE view SET prompt = ?, original_prompt = ? WHERE id = ?",
    );
    for (const v of views) {
      updView.run(
        stripStyle(v.prompt, target),
        v.original_prompt === null
          ? null
          : stripStyle(v.original_prompt, target),
        v.id,
      );
    }
  });
  tx();
}

export function deleteAsset(projectId: string, assetId: string): boolean {
  const db = getProjectDb(projectId);
  const asset = db
    .prepare("SELECT id FROM asset WHERE id = ? AND project_id = ?")
    .get(assetId, projectId);
  if (!asset) return false;
  // 清理分镜里对已删除资产的悬空引用，避免连续性一直报「引用已失效」。
  db.prepare("DELETE FROM shot_ref WHERE asset_id = ?").run(assetId);
  db.prepare("DELETE FROM asset WHERE id = ?").run(assetId);
  const dir = path.join(getProjectMediaDir(projectId), "assets", assetId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function createVariant(
  projectId: string,
  assetId: string,
  input: { label: string; prompt: string },
): StoredAsset | null {
  const db = getProjectDb(projectId);
  const asset = db
    .prepare("SELECT id, type FROM asset WHERE id = ? AND project_id = ?")
    .get(assetId, projectId) as { id: string; type: string } | undefined;
  if (!asset) return null;
  const max = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) m FROM variant WHERE asset_id = ?")
    .get(assetId) as { m: number };
  const variantId = newId();
  const labels = defaultViewLabels(asset.type as AssetType);
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO variant (id, asset_id, label, prompt, original_label, original_prompt, sort_order)
       VALUES (?, ?, ?, ?, NULL, NULL, ?)`,
    ).run(variantId, assetId, input.label, input.prompt, max.m + 1);
    // 新增变体时自动带上默认视角，避免出现"有变体但没视角"。
    labels.forEach((label, i) => {
      db.prepare(
        `INSERT INTO view (id, variant_id, label, prompt, original_label, original_prompt, image_path, sort_order)
         VALUES (?, ?, ?, '', NULL, NULL, NULL, ?)`,
      ).run(newId(), variantId, label, i);
    });
  });
  tx();
  return getAssets(projectId).find((a) => a.id === assetId) ?? null;
}

export function deleteVariant(projectId: string, variantId: string): boolean {
  const db = getProjectDb(projectId);
  const row = db
    .prepare(
      `SELECT v.id FROM variant v JOIN asset a ON v.asset_id = a.id
       WHERE v.id = ? AND a.project_id = ?`,
    )
    .get(variantId, projectId);
  if (!row) return false;
  const paths = db
    .prepare("SELECT image_path FROM view WHERE variant_id = ?")
    .all(variantId) as { image_path: string | null }[];
  // 变体没了，分镜里对它的引用改为空（保留资产名，交给连续性提示重新选视角）。
  db.prepare(
    "UPDATE shot_ref SET variant_id = NULL, view_id = NULL WHERE variant_id = ?",
  ).run(variantId);
  db.prepare("DELETE FROM variant WHERE id = ?").run(variantId);
  for (const p of paths) {
    if (p.image_path && fs.existsSync(p.image_path)) {
      fs.rmSync(p.image_path, { force: true });
    }
  }
  return true;
}

export function createView(
  projectId: string,
  variantId: string,
  input: { label: string; prompt: string },
): StoredVariant | null {
  const db = getProjectDb(projectId);
  const variant = db
    .prepare(
      `SELECT v.id FROM variant v JOIN asset a ON v.asset_id = a.id
       WHERE v.id = ? AND a.project_id = ?`,
    )
    .get(variantId, projectId);
  if (!variant) return null;
  const max = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) m FROM view WHERE variant_id = ?")
    .get(variantId) as { m: number };
  db.prepare(
    `INSERT INTO view (id, variant_id, label, prompt, original_label, original_prompt, image_path, sort_order)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)`,
  ).run(newId(), variantId, input.label, input.prompt, max.m + 1);
  for (const asset of getAssets(projectId)) {
    const found = asset.variants.find((v) => v.id === variantId);
    if (found) return found;
  }
  return null;
}

export function deleteView(projectId: string, viewId: string): boolean {
  const db = getProjectDb(projectId);
  const row = db
    .prepare(
      `SELECT vw.id, vw.image_path FROM view vw
       JOIN variant v ON vw.variant_id = v.id
       JOIN asset a ON v.asset_id = a.id
       WHERE vw.id = ? AND a.project_id = ?`,
    )
    .get(viewId, projectId) as { id: string; image_path: string | null } | undefined;
  if (!row) return false;
  // 视角没了，分镜里对它的引用清空（保留资产/变体名），交给连续性提示重新选。
  db.prepare("UPDATE shot_ref SET view_id = NULL WHERE view_id = ?").run(viewId);
  db.prepare("DELETE FROM view WHERE id = ?").run(viewId);
  if (row.image_path && fs.existsSync(row.image_path)) {
    fs.rmSync(row.image_path, { force: true });
  }
  return true;
}

/* ---------------- 还原 ---------------- */

export interface RestoreScope {
  assetId?: string;
  variantId?: string;
  viewId?: string;
}

export function restoreAssets(
  projectId: string,
  scope: RestoreScope,
): StoredAsset[] {
  const db = getProjectDb(projectId);

  const restoreView = db.prepare(
    `UPDATE view SET label = COALESCE(original_label, label),
       prompt = COALESCE(original_prompt, prompt) WHERE id = ?`,
  );
  const restoreVariant = db.prepare(
    `UPDATE variant SET label = COALESCE(original_label, label),
       prompt = COALESCE(original_prompt, prompt) WHERE id = ?`,
  );
  const restoreAsset = db.prepare(
    `UPDATE asset SET name = COALESCE(original_name, name),
       base_prompt = COALESCE(original_base_prompt, base_prompt) WHERE id = ?`,
  );

  const tx = db.transaction(() => {
    if (scope.viewId) {
      restoreView.run(scope.viewId);
      return;
    }
    if (scope.variantId) {
      restoreVariant.run(scope.variantId);
      const views = db
        .prepare("SELECT id FROM view WHERE variant_id = ?")
        .all(scope.variantId) as { id: string }[];
      for (const v of views) restoreView.run(v.id);
      return;
    }
    if (scope.assetId) {
      restoreAsset.run(scope.assetId);
      const variants = db
        .prepare("SELECT id FROM variant WHERE asset_id = ?")
        .all(scope.assetId) as { id: string }[];
      for (const v of variants) {
        restoreVariant.run(v.id);
        const views = db
          .prepare("SELECT id FROM view WHERE variant_id = ?")
          .all(v.id) as { id: string }[];
        for (const view of views) restoreView.run(view.id);
      }
      return;
    }
    const assets = db
      .prepare("SELECT id FROM asset WHERE project_id = ?")
      .all(projectId) as { id: string }[];
    for (const a of assets) {
      restoreAsset.run(a.id);
      const variants = db
        .prepare("SELECT id FROM variant WHERE asset_id = ?")
        .all(a.id) as { id: string }[];
      for (const v of variants) {
        restoreVariant.run(v.id);
        const views = db
          .prepare("SELECT id FROM view WHERE variant_id = ?")
          .all(v.id) as { id: string }[];
        for (const view of views) restoreView.run(view.id);
      }
    }
  });
  tx();

  return getAssets(projectId);
}
