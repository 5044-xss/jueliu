/**
 * 修复历史分镜数据（幂等，可重复执行）：
 *  1) 动作/台词点名、且本场有站位的角色，补上 character 参考图；
 *  2) 场景引用与本场 location 不一致的，改成“本场场景”的参考图；
 *  3) segment.hard_cut 与首镜 continues_prev 不一致的，按编排口径归一。
 *
 * 用法：node scripts/fix-storyboard-refs.mjs [workspaceDir]
 * 默认读取 ./workspace（可用 WORKSPACE_DIR 覆盖）。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const workspace =
  process.argv[2] ||
  process.env.WORKSPACE_DIR ||
  path.join(process.cwd(), "workspace");

const OFFSCREEN = /电话|画外|旁白|广播|声音|播报|新闻/;

function looseKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s“”"'「」『』（）()·,，。、/\\\-—_]/g, "");
}

function sameName(a, b) {
  const x = looseKey(a);
  const y = looseKey(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function norm(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isOffscreen(name) {
  return OFFSCREEN.test(name);
}

function fixProject(dbPath) {
  const db = new Database(dbPath);
  const stats = { characters: 0, scenes: 0, hardCuts: 0 };

  const assets = db.prepare("SELECT id, type, name FROM asset").all();
  const variants = db.prepare("SELECT id, asset_id, label FROM variant").all();
  const views = db.prepare("SELECT id, variant_id, label FROM view").all();

  const viewsByVariant = new Map();
  for (const w of views) {
    const list = viewsByVariant.get(w.variant_id) ?? [];
    list.push(w);
    viewsByVariant.set(w.variant_id, list);
  }
  const variantsByAsset = new Map();
  for (const v of variants) {
    const list = variantsByAsset.get(v.asset_id) ?? [];
    list.push(v);
    variantsByAsset.set(v.asset_id, list);
  }
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const charAssets = assets.filter((a) => a.type === "character");
  const sceneAssets = assets.filter((a) => a.type === "scene");

  function pickCharacterVariantView(assetId, hint) {
    const list = variantsByAsset.get(assetId) ?? [];
    const variant =
      (hint?.variantId
        ? list.find((v) => v.id === hint.variantId)
        : undefined) ?? list[0];
    if (!variant) return null;
    const vws = viewsByVariant.get(variant.id) ?? [];
    const view =
      (hint?.viewId && vws.find((w) => w.id === hint.viewId)) ||
      vws.find((w) => w.label.includes("视")) ||
      vws[0];
    return view ? { variantId: variant.id, viewId: view.id } : null;
  }

  const insertRef = db.prepare(
    `INSERT INTO shot_ref (id, shot_id, role, asset_id, variant_id, view_id, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateSceneRef = db.prepare(
    "UPDATE shot_ref SET asset_id = ?, variant_id = ?, view_id = ? WHERE id = ?",
  );
  const updateHardCut = db.prepare("UPDATE segment SET hard_cut = ? WHERE id = ?");

  const touchedShots = new Set();
  const scenes = db.prepare("SELECT * FROM scene ORDER BY sort_order").all();
  const tx = db.transaction(() => {
    for (const scene of scenes) {
      const sceneSegs = db
        .prepare("SELECT * FROM segment WHERE scene_id = ? ORDER BY idx")
        .all(scene.id);
      if (sceneSegs.length === 0) continue;

      const blocking = scene.blocking_json ? JSON.parse(scene.blocking_json) : null;
      const charNodeLabels = new Set(
        (blocking?.nodes ?? [])
          .filter((n) => n.type === "character")
          .map((n) => norm(n.label)),
      );

      // 本场镜里出现的场景引用（用于选“本场场景”与造型提示）。
      const sceneRefs = [];
      const variantHints = new Map();
      for (const seg of sceneSegs) {
        const shots = db
          .prepare("SELECT * FROM shot WHERE segment_id = ? ORDER BY idx")
          .all(seg.id);
        for (const shot of shots) {
          const refs = db
            .prepare("SELECT * FROM shot_ref WHERE shot_id = ? ORDER BY sort_order")
            .all(shot.id);
          for (const ref of refs) {
            const asset = assetById.get(ref.asset_id);
            if (!asset) continue;
            if (ref.role === "scene" && ref.view_id) {
              sceneRefs.push({ ...ref, assetName: asset.name });
            }
            if (ref.role === "character" && !variantHints.has(ref.asset_id)) {
              variantHints.set(ref.asset_id, {
                variantId: ref.variant_id,
                viewId: ref.view_id,
              });
            }
          }
        }
      }

      // 本场场景：优先同名场景引用（优先「全景」）；否则按 location 找场景资产。
      let canonicalScene = null;
      const matched = sceneRefs.filter((r) => sameName(r.assetName, scene.location));
      const preferPanorama = (list) =>
        list.find((r) => {
          const view = r.view_id ? views.find((w) => w.id === r.view_id) : null;
          return view?.label.includes("全景");
        }) ?? list[0];
      if (matched.length > 0) {
        const r = preferPanorama(matched);
        canonicalScene = {
          assetId: r.asset_id,
          variantId: r.variant_id,
          viewId: r.view_id,
        };
      } else {
        const asset = sceneAssets.find((a) => sameName(a.name, scene.location));
        if (asset) {
          const variant = (variantsByAsset.get(asset.id) ?? [])[0];
          if (variant) {
            const vws = viewsByVariant.get(variant.id) ?? [];
            const view = vws.find((w) => w.label.includes("全景")) ?? vws[0];
            if (view) {
              canonicalScene = {
                assetId: asset.id,
                variantId: variant.id,
                viewId: view.id,
              };
            }
          }
        }
      }

      for (const seg of sceneSegs) {
        const shots = db
          .prepare("SELECT * FROM shot WHERE segment_id = ? ORDER BY idx")
          .all(seg.id);

        // 硬切归一：场首恒为硬切，其余由首镜 continues_prev 决定。
        if (shots[0]) {
          const hardCut = seg.idx === 1 ? 1 : shots[0].continues_prev ? 0 : 1;
          if (seg.hard_cut !== hardCut) {
            updateHardCut.run(hardCut, seg.id);
            stats.hardCuts += 1;
          }
        }

        for (const shot of shots) {
          const refs = db
            .prepare("SELECT * FROM shot_ref WHERE shot_id = ? ORDER BY sort_order")
            .all(shot.id);

          // 场景引用与本场不一致 → 改成本场场景。
          if (canonicalScene) {
            for (const ref of refs) {
              if (ref.role !== "scene") continue;
              const asset = assetById.get(ref.asset_id);
              if (!asset || sameName(asset.name, scene.location)) continue;
              updateSceneRef.run(
                canonicalScene.assetId,
                canonicalScene.variantId,
                canonicalScene.viewId,
                ref.id,
              );
              touchedShots.add(shot.id);
              stats.scenes += 1;
            }
          }

          const referenced = new Set(
            refs.filter((r) => r.role === "character").map((r) => r.asset_id),
          );
          const dialogue = shot.dialogue_json ? JSON.parse(shot.dialogue_json) : [];
          const subjectIds = shot.subject_node_ids_json
            ? JSON.parse(shot.subject_node_ids_json)
            : [];

          const candidates = new Set();
          for (const line of dialogue) {
            if (line.character && line.character.trim()) {
              candidates.add(line.character.trim());
            }
          }
          for (const id of subjectIds) {
            const node = (blocking?.nodes ?? []).find(
              (n) => n.id === id && n.type === "character",
            );
            if (node) candidates.add(node.label);
          }
          for (const asset of charAssets) {
            if (shot.action.includes(asset.name)) candidates.add(asset.name);
          }

          let sort = refs.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1;
          for (const name of candidates) {
            if (isOffscreen(name)) continue;
            const key = norm(name);
            const asset = charAssets.find((a) => norm(a.name) === key);
            if (!asset) continue;
            if (!charNodeLabels.has(key)) continue;
            if (referenced.has(asset.id)) continue;

            const picked = pickCharacterVariantView(
              asset.id,
              variantHints.get(asset.id),
            );
            if (!picked) continue;

            insertRef.run(
              randomUUID(),
              shot.id,
              "character",
              asset.id,
              picked.variantId,
              picked.viewId,
              sort,
            );
            sort += 1;
            referenced.add(asset.id);
            touchedShots.add(shot.id);
            stats.characters += 1;
          }
        }
      }
    }
  });
  tx();

  // 同步「生成时快照」里的 refs，避免用户点「还原本镜」后又把补好的引用还原掉。
  const readRefs = db.prepare(
    `SELECT r.role, a.name AS asset_name, v.label AS variant_label, vw.label AS view_label
     FROM shot_ref r
     LEFT JOIN asset a ON r.asset_id = a.id
     LEFT JOIN variant v ON r.variant_id = v.id
     LEFT JOIN view vw ON r.view_id = vw.id
     WHERE r.shot_id = ?
     ORDER BY r.sort_order`,
  );
  const allShots = db.prepare("SELECT id, original_json FROM shot").all();
  const saveOriginal = db.prepare("UPDATE shot SET original_json = ? WHERE id = ?");
  for (const row of allShots) {
    if (!row.original_json) continue;
    try {
      const original = JSON.parse(row.original_json);
      const refs = readRefs.all(row.id).map((r) => ({
        role: r.role,
        assetName: r.asset_name ?? "",
        variantLabel: r.variant_label ?? "",
        viewLabel: r.view_label ?? "",
      }));
      if (JSON.stringify(original.refs ?? []) === JSON.stringify(refs)) continue;
      original.refs = refs;
      saveOriginal.run(JSON.stringify(original), row.id);
    } catch {
      // 快照损坏就跳过，不影响主数据。
    }
  }
  void touchedShots;

  db.close();
  return stats;
}

if (!fs.existsSync(workspace)) {
  console.error(`workspace 不存在：${workspace}`);
  process.exit(1);
}

let total = { characters: 0, scenes: 0, hardCuts: 0 };
for (const id of fs.readdirSync(workspace)) {
  const dbPath = path.join(workspace, id, "project.db");
  if (!fs.existsSync(dbPath)) continue;
  try {
    const stats = fixProject(dbPath);
    if (stats.characters || stats.scenes || stats.hardCuts) {
      console.log(
        `${id}: 补角色引用 ${stats.characters}，修场景引用 ${stats.scenes}，修硬切 ${stats.hardCuts}`,
      );
    }
    for (const key of Object.keys(total)) total[key] += stats[key];
  } catch (error) {
    console.error(`${id}: 失败 - ${error.message}`);
  }
}
console.log(
  `完成：补角色引用 ${total.characters}，修场景引用 ${total.scenes}，修硬切 ${total.hardCuts}`,
);
