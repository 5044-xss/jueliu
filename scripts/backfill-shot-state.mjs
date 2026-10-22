/**
 * 回填旧项目的 canonical ShotState（shot.state_json / state_issues_json）。
 *
 * 默认只写 state 字段，不改动旧分镜正文/台词/参考图；加 --apply 时同时写回
 * normalizer 归一后的 action / dialogue / subjectNodeIds / shot_ref。
 *
 * 用法：
 *   node --experimental-strip-types scripts/backfill-shot-state.mjs --project 8c...
 *   node --experimental-strip-types scripts/backfill-shot-state.mjs --all
 *   node --experimental-strip-types scripts/backfill-shot-state.mjs --all --apply
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { normalizeShotState } from "../packages/core/src/server/storyboard/normalize-shot-state.ts";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const workspace = path.resolve(
  arg("workspace", path.join(process.cwd(), "workspace")),
);
const onlyProject = arg("project", "");
const apply = flag("apply");
const all = flag("all");

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function ensureColumns(db) {
  const columns = db.prepare("PRAGMA table_info(shot)").all().map((row) => row.name);
  if (!columns.includes("state_json")) {
    db.exec("ALTER TABLE shot ADD COLUMN state_json TEXT");
  }
  if (!columns.includes("state_issues_json")) {
    db.exec("ALTER TABLE shot ADD COLUMN state_issues_json TEXT");
  }
}

function projectDirs() {
  if (!fs.existsSync(workspace)) return [];
  return fs
    .readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .filter((id) => !onlyProject || id === onlyProject)
    .filter((id) => fs.existsSync(path.join(workspace, id, "project.db")));
}

function loadAssets(db) {
  const assets = db
    .prepare("SELECT id, type, name, base_prompt, interior_exterior FROM asset ORDER BY sort_order")
    .all();
  const variants = db
    .prepare(
      "SELECT id, asset_id, label, prompt FROM variant ORDER BY asset_id, sort_order",
    )
    .all();
  const views = db
    .prepare(
      "SELECT id, variant_id, label, prompt, kind, image_path FROM view ORDER BY variant_id, sort_order",
    )
    .all();
  const viewsByVariant = new Map();
  for (const view of views) {
    const list = viewsByVariant.get(view.variant_id) ?? [];
    list.push({
      id: view.id,
      label: view.label,
      prompt: view.prompt,
      kind: view.kind || "master",
      imagePath: view.image_path,
      originalLabel: null,
      originalPrompt: null,
    });
    viewsByVariant.set(view.variant_id, list);
  }
  const variantsByAsset = new Map();
  for (const variant of variants) {
    const list = variantsByAsset.get(variant.asset_id) ?? [];
    list.push({
      id: variant.id,
      label: variant.label,
      prompt: variant.prompt,
      views: viewsByVariant.get(variant.id) ?? [],
      originalLabel: null,
      originalPrompt: null,
    });
    variantsByAsset.set(variant.asset_id, list);
  }
  return assets.map((asset) => ({
    id: asset.id,
    type: asset.type,
    name: asset.name,
    basePrompt: asset.base_prompt ?? "",
    interiorExterior: asset.interior_exterior ?? "",
    variants: variantsByAsset.get(asset.id) ?? [],
    originalName: null,
    originalBasePrompt: null,
  }));
}

function backfillProject(projectId) {
  const dbPath = path.join(workspace, projectId, "project.db");
  const db = new Database(dbPath);
  ensureColumns(db);
  const assets = loadAssets(db);
  const scenes = db
    .prepare("SELECT id, idx, location, blocking_json FROM scene ORDER BY sort_order")
    .all();
  let shots = 0;
  let withIssues = 0;
  const codeCounts = {};
  const updateState = db.prepare(
    "UPDATE shot SET state_json = ?, state_issues_json = ? WHERE id = ?",
  );
  const updateFull = db.prepare(
    "UPDATE shot SET action = ?, dialogue_json = ?, subject_node_ids_json = ? WHERE id = ?",
  );
  const deleteRefs = db.prepare("DELETE FROM shot_ref WHERE shot_id = ?");
  const insertRef = db.prepare(
    `INSERT INTO shot_ref (id, shot_id, role, asset_id, variant_id, view_id, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const scene of scenes) {
    const blocking = parseJson(scene.blocking_json, null);
    const sceneShots = db
      .prepare(
        `SELECT s.* FROM shot s JOIN segment sg ON s.segment_id = sg.id
         WHERE sg.scene_id = ? ORDER BY sg.idx ASC, s.idx ASC`,
      )
      .all(scene.id);
    let previous = null;
    for (let index = 0; index < sceneShots.length; index += 1) {
      const shot = sceneShots[index];
      const dialogue = parseJson(
        shot.dialogue_json && shot.dialogue_json.trim() !== "[]"
          ? shot.dialogue_json
          : shot.dialogue,
        [],
      );
      const refs = db
        .prepare(
          `SELECT r.role, a.name AS asset_name, v.label AS variant_label,
                  vw.label AS view_label
           FROM shot_ref r
           LEFT JOIN asset a ON r.asset_id = a.id
           LEFT JOIN variant v ON r.variant_id = v.id
           LEFT JOIN view vw ON r.view_id = vw.id
           WHERE r.shot_id = ? ORDER BY r.sort_order ASC`,
        )
        .all(shot.id)
        .filter((ref) => ref.asset_name)
        .map((ref) => ({
          role: ref.role,
          assetName: ref.asset_name,
          variantLabel: ref.variant_label ?? "",
          viewLabel: ref.view_label ?? "",
        }));
      const camera = parseJson(shot.camera_json, {});
      const normalized = normalizeShotState({
        shotId: shot.id,
        sceneId: scene.id,
        sceneIndex: scene.idx,
        sceneLocation: scene.location,
        shotIndex: index,
        blocking,
        assets,
        draft: {
          action: shot.action,
          dialogue,
          subjectNodeIds: parseJson(shot.subject_node_ids_json, []),
          refs,
          camera,
          continuesPrev: Boolean(shot.continues_prev),
          durationMs: shot.duration_ms,
        },
        previous,
        isFirstShotOfScene: index === 0,
      });
      updateState.run(
        JSON.stringify(normalized.state),
        JSON.stringify(normalized.issues),
        shot.id,
      );
      if (apply) {
        updateFull.run(
          normalized.shot.action,
          JSON.stringify(normalized.shot.dialogue),
          JSON.stringify(normalized.shot.subjectNodeIds),
          shot.id,
        );
        deleteRefs.run(shot.id);
        normalized.shot.refs.forEach((ref, refIndex) => {
          if (!ref.assetId) return;
          insertRef.run(
            crypto.randomUUID(),
            shot.id,
            ref.role,
            ref.assetId,
            ref.variantId,
            ref.viewId,
            refIndex,
          );
        });
      }
      shots += 1;
      if (normalized.issues.length > 0) {
        withIssues += 1;
        for (const issue of normalized.issues) {
          codeCounts[issue.code] = (codeCounts[issue.code] ?? 0) + 1;
        }
      }
      previous = {
        presentCast: normalized.presentCast,
        dialogue: normalized.shot.dialogue,
        camera,
      };
    }
  }
  db.close();
  return { projectId, shots, withIssues, codeCounts };
}

const ids = all ? projectDirs() : [onlyProject];
if (ids.filter(Boolean).length === 0) {
  console.error("请指定 --project 或 --all");
  process.exit(1);
}
for (const id of ids.filter(Boolean)) {
  const result = backfillProject(id);
  console.log(
    `${id}: ${result.shots} shots, ${result.withIssues} with issues, ${JSON.stringify(result.codeCounts)}`,
  );
}
