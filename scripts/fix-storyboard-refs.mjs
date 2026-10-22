/**
 * 修复历史分镜数据（幂等，可重复执行）：
 *  1) 动作/台词点名、且本场有站位的角色，补上 character 参考图；
 *  2) 场景引用与本场 location 不一致的，改成“本场场景”的参考图；
 *  3) segment.hard_cut 与首镜 continues_prev / 主体连续性 / 景别焦段不一致的，按编排口径归一。
 *
 *  4) 已挂角色引用但漏在 subjectNodeIds 里的，补进 subjectNodeIds。
 *
 * 用法：node scripts/fix-storyboard-refs.mjs [workspaceDir] [projectId]
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
const onlyProject = process.argv[3] || null;

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

const SHOT_SIZE_ORDER = [
  "大远景",
  "远景",
  "全景",
  "中全景",
  "中景",
  "中近景",
  "近景",
  "特写",
  "大特写",
];

function parseCamera(row) {
  try {
    return JSON.parse(row?.camera_json || "{}");
  } catch {
    return {};
  }
}

function focalNumber(focal) {
  const match = String(focal || "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function shotSizeRank(shotSize) {
  const value = String(shotSize || "").trim();
  if (!value) return -1;
  const exact = SHOT_SIZE_ORDER.indexOf(value);
  if (exact >= 0) return exact;
  const hit = [...SHOT_SIZE_ORDER]
    .sort((a, b) => b.length - a.length)
    .find((size) => value.includes(size));
  return hit ? SHOT_SIZE_ORDER.indexOf(hit) : -1;
}

function sharedSubjects(prevShot, nextShot) {
  const parseIds = (shot) => {
    try {
      const ids = JSON.parse(shot?.subject_node_ids_json || "[]");
      return Array.isArray(ids) ? ids.filter(Boolean) : [];
    } catch {
      return [];
    }
  };
  const prev = parseIds(prevShot);
  const next = parseIds(nextShot);
  if (prev.length === 0 && next.length === 0) return true;
  return prev.some((id) => next.includes(id));
}

function cameraContinuous(prevShot, nextShot) {
  const prev = parseCamera(prevShot);
  const next = parseCamera(nextShot);
  const prevRank = shotSizeRank(prev.shotSize);
  const nextRank = shotSizeRank(next.shotSize);
  const rankDiff =
    prevRank >= 0 && nextRank >= 0 ? Math.abs(nextRank - prevRank) : 0;
  if (rankDiff >= 2) return false;
  const prevFocal = focalNumber(prev.focal);
  const nextFocal = focalNumber(next.focal);
  const focalRatio =
    prevFocal && nextFocal
      ? Math.max(prevFocal, nextFocal) / Math.min(prevFocal, nextFocal)
      : 1;
  return focalRatio <= 3;
}

function isOffscreen(name) {
  return OFFSCREEN.test(name);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isOffscreenMention(action, name) {
  if (!String(name ?? "").trim()) return false;
  return new RegExp(`画外的?\\s*${escapeRegExp(String(name).trim())}`).test(
    String(action ?? ""),
  );
}

function normalizeActionForCast(action, subjectLabels) {
  let out = String(action ?? "");
  for (const label of subjectLabels) {
    const name = String(label ?? "").trim();
    if (!name) continue;
    out = out.replaceAll(`画外的${name}`, name).replaceAll(`画外${name}`, name);
  }
  return out;
}

function fixProject(dbPath) {
  const db = new Database(dbPath);
  const stats = { characters: 0, scenes: 0, hardCuts: 0, subjects: 0, actions: 0 };

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
  const updateShotSubjects = db.prepare(
    "UPDATE shot SET subject_node_ids_json = ? WHERE id = ?",
  );
  const updateShotAction = db.prepare(
    "UPDATE shot SET action = ? WHERE id = ?",
  );
  const readCharacterRefNames = db.prepare(
    `SELECT a.name AS asset_name
     FROM shot_ref r
     JOIN asset a ON r.asset_id = a.id
     WHERE r.shot_id = ? AND r.role = 'character'`,
  );

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

      let prevSegLastShot = null;
      for (const seg of sceneSegs) {
        const shots = db
          .prepare("SELECT * FROM shot WHERE segment_id = ? ORDER BY idx")
          .all(seg.id);

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
          const subjectLabels = subjectIds
            .map((id) =>
              (blocking?.nodes ?? []).find((n) => n.id === id)?.label,
            )
            .filter(Boolean);
          let action = shot.action;
          const normalizedAction = normalizeActionForCast(action, subjectLabels);
          if (normalizedAction !== action) {
            action = normalizedAction;
            updateShotAction.run(action, shot.id);
            stats.actions += 1;
            touchedShots.add(shot.id);
          }

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
            if (
              action.includes(asset.name) &&
              !isOffscreenMention(action, asset.name)
            ) {
              candidates.add(asset.name);
            }
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

          const nodeIdByLabel = new Map(
            (blocking?.nodes ?? [])
              .filter((n) => n.type === "character")
              .map((n) => [norm(n.label), n.id]),
          );
          let subjectChanged = false;
          for (const ref of readCharacterRefNames.all(shot.id)) {
            const nodeId = nodeIdByLabel.get(norm(ref.asset_name));
            if (nodeId && !subjectIds.includes(nodeId)) {
              subjectIds.push(nodeId);
              subjectChanged = true;
            }
          }
          if (subjectChanged) {
            updateShotSubjects.run(JSON.stringify(subjectIds), shot.id);
            touchedShots.add(shot.id);
            stats.subjects += 1;
          }
        }

        const firstShot = db
          .prepare("SELECT * FROM shot WHERE segment_id = ? ORDER BY idx LIMIT 1")
          .get(seg.id);
        const lastShot = db
          .prepare("SELECT * FROM shot WHERE segment_id = ? ORDER BY idx DESC LIMIT 1")
          .get(seg.id);
        const hardCut =
          seg.idx === 1 ||
          !firstShot ||
          !firstShot.continues_prev ||
          !sharedSubjects(prevSegLastShot, firstShot) ||
          !cameraContinuous(prevSegLastShot, firstShot)
            ? 1
            : 0;
        if (seg.hard_cut !== hardCut) {
          updateHardCut.run(hardCut, seg.id);
          stats.hardCuts += 1;
        }
        prevSegLastShot = lastShot ?? null;
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
  const readSubjects = db.prepare(
    "SELECT subject_node_ids_json FROM shot WHERE id = ?",
  );
  const allShots = db.prepare("SELECT id, original_json, action FROM shot").all();
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
      const subjectRow = readSubjects.get(row.id);
      const subjectNodeIds = subjectRow?.subject_node_ids_json
        ? JSON.parse(subjectRow.subject_node_ids_json)
        : [];
      const refsChanged =
        JSON.stringify(original.refs ?? []) !== JSON.stringify(refs);
      const subjectsChanged =
        JSON.stringify(original.subjectNodeIds ?? []) !==
        JSON.stringify(subjectNodeIds);
      const actionChanged = String(original.action ?? "") !== row.action;
      if (!refsChanged && !subjectsChanged && !actionChanged) continue;
      original.refs = refs;
      original.subjectNodeIds = subjectNodeIds;
      original.action = row.action;
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

let total = { characters: 0, scenes: 0, hardCuts: 0, subjects: 0, actions: 0 };
for (const id of fs.readdirSync(workspace)) {
  if (onlyProject && id !== onlyProject) continue;
  const dbPath = path.join(workspace, id, "project.db");
  if (!fs.existsSync(dbPath)) continue;
  try {
    const stats = fixProject(dbPath);
    if (
      stats.characters ||
      stats.scenes ||
      stats.hardCuts ||
      stats.subjects ||
      stats.actions
    ) {
      console.log(
        `${id}: 补角色引用 ${stats.characters}，补主体节点 ${stats.subjects}，修动作画外 ${stats.actions}，修场景引用 ${stats.scenes}，修硬切 ${stats.hardCuts}`,
      );
    }
    for (const key of Object.keys(total)) total[key] += stats[key];
  } catch (error) {
    console.error(`${id}: 失败 - ${error.message}`);
  }
}
console.log(
  `完成：补角色引用 ${total.characters}，补主体节点 ${total.subjects}，修动作画外 ${total.actions}，修场景引用 ${total.scenes}，修硬切 ${total.hardCuts}`,
);
