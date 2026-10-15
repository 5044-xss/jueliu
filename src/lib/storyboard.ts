import fs from "node:fs";
import path from "node:path";
import { getProjectDb, newId, nowIso } from "@/lib/db";
import { clearOrchestrationCache } from "@/lib/orchestration/cache";
import type {
  Blocking,
  Camera,
  DialogueLine,
  RefRole,
  StoredRef,
  StoredSceneStoryboard,
  StoredSegment,
  StoredShot,
  StoryboardDraft,
} from "@/lib/schemas/storyboard";
import type { StoredAsset } from "@/lib/schemas/assets";

interface SceneRow {
  id: string;
  idx: string;
  slug: string;
  location: string;
  time_of_day: string;
  interior_exterior: string;
  blocking_json: string | null;
  sort_order: number;
}

interface SegmentRow {
  id: string;
  scene_id: string;
  idx: number;
  generation_mode: string;
  target_ms: number;
  first_frame_id: string | null;
  hard_cut: number;
  status: string;
  video_path: string | null;
}

interface ShotRow {
  id: string;
  segment_id: string;
  idx: number;
  duration_ms: number;
  ideal_ms: number | null;
  continues_prev: number;
  camera_json: string;
  lighting: string;
  action: string;
  dialogue: string;
  dialogue_json: string | null;
  expression: string;
  subject_node_ids_json: string;
  original_json: string | null;
}

interface RefRow {
  id: string;
  role: string;
  asset_id: string | null;
  variant_id: string | null;
  view_id: string | null;
  asset_name: string | null;
  variant_label: string | null;
  view_label: string | null;
  image_path: string | null;
}

function parse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseCamera(value: string | null): Camera {
  const raw = parse<Partial<Camera>>(value, {});
  return {
    focal: raw.focal ?? "",
    shotSize: raw.shotSize ?? "",
    angle: raw.angle ?? "",
    movement: raw.movement ?? "",
    side: raw.side === "left" || raw.side === "right" ? raw.side : "",
  };
}

// 兼容三种形态：结构化数组、JSON 字符串、旧的纯文本台词。
export function toDialogue(value: unknown): DialogueLine[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return { character: "", text: item };
        const obj = (item ?? {}) as { character?: unknown; text?: unknown };
        return {
          character: typeof obj.character === "string" ? obj.character : "",
          text: typeof obj.text === "string" ? obj.text : "",
        };
      })
      .filter((line) => line.text.trim().length > 0 || line.character.trim().length > 0);
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return toDialogue(parsed);
    } catch {
      // 非 JSON，按纯文本处理
    }
    return [{ character: "", text: value }];
  }
  return [];
}

// 把结构化台词压成一行纯文本，供旧逻辑（如衔接摘要）复用。
export function dialogueToText(lines: DialogueLine[]): string {
  return lines
    .map((line) => (line.character ? `${line.character}：${line.text}` : line.text))
    .filter(Boolean)
    .join("\n");
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function pickExact<T extends { label: string }>(
  items: T[],
  label: string,
): T | null {
  const target = normalize(label);
  if (target) {
    const exact = items.find((i) => normalize(i.label) === target);
    if (exact) return exact;
  }
  // 回退：只有一个候选时直接用它。这样角色只有一个变体/一个视角（四视图）时，
  // 即使模型给的标签略有出入也能解析成功，避免大量"未匹配视角"误报。
  return items.length === 1 ? items[0] : null;
}

export interface RefLabelInput {
  role: RefRole;
  assetName: string;
  variantLabel: string;
  viewLabel: string;
}

// 精确匹配：找不到就置空，交给连续性校验报警，绝不静默替换成第一个变体/视角
export function resolveRefLabels(
  assets: StoredAsset[],
  ref: RefLabelInput,
): { assetId: string | null; variantId: string | null; viewId: string | null } {
  const asset = assets.find((a) => normalize(a.name) === normalize(ref.assetName));
  if (!asset) return { assetId: null, variantId: null, viewId: null };
  const variant = pickExact(asset.variants, ref.variantLabel);
  if (!variant) return { assetId: asset.id, variantId: null, viewId: null };
  const view = pickExact(variant.views, ref.viewLabel);
  return {
    assetId: asset.id,
    variantId: variant.id,
    viewId: view?.id ?? null,
  };
}

export function getStoryboard(projectId: string): StoredSceneStoryboard[] {
  const db = getProjectDb(projectId);
  const scenes = db
    .prepare(
      "SELECT * FROM scene ORDER BY sort_order ASC",
    )
    .all() as SceneRow[];

  return scenes.map((scene) => {
    const segments = db
      .prepare("SELECT * FROM segment WHERE scene_id = ? ORDER BY idx ASC")
      .all(scene.id) as SegmentRow[];
    const storedSegments: StoredSegment[] = segments.map((seg) => {
      const shots = db
        .prepare("SELECT * FROM shot WHERE segment_id = ? ORDER BY idx ASC")
        .all(seg.id) as ShotRow[];
      const storedShots: StoredShot[] = shots.map((shot) => {
        const refs = db
          .prepare(
            `SELECT r.*, a.name AS asset_name, v.label AS variant_label,
                    vw.label AS view_label, vw.image_path AS image_path
             FROM shot_ref r
             LEFT JOIN asset a ON r.asset_id = a.id
             LEFT JOIN variant v ON r.variant_id = v.id
             LEFT JOIN view vw ON r.view_id = vw.id
             WHERE r.shot_id = ?
             ORDER BY r.sort_order ASC`,
          )
          .all(shot.id) as RefRow[];
        return {
          id: shot.id,
          index: shot.idx,
          durationMs: shot.duration_ms,
          idealMs: shot.ideal_ms ?? shot.duration_ms,
          continuesPrev: Boolean(shot.continues_prev),
          camera: parseCamera(shot.camera_json),
          lighting: shot.lighting,
          action: shot.action,
          dialogue: toDialogue(
            shot.dialogue_json &&
              shot.dialogue_json.trim() &&
              shot.dialogue_json.trim() !== "[]"
              ? shot.dialogue_json
              : shot.dialogue,
          ),
          expression: shot.expression,
          subjectNodeIds: parse<string[]>(shot.subject_node_ids_json, []),
          refs: refs.map(
            (r): StoredRef => ({
              id: r.id,
              role: r.role as RefRole,
              assetId: r.asset_id,
              variantId: r.variant_id,
              viewId: r.view_id,
              assetName: r.asset_name ?? "",
              variantLabel: r.variant_label ?? "",
              viewLabel: r.view_label ?? "",
              imagePath: r.image_path,
            }),
          ),
          hasOriginal: Boolean(shot.original_json),
        };
      });
      return {
        id: seg.id,
        sceneId: seg.scene_id,
        index: seg.idx,
        generationMode: seg.generation_mode as StoredSegment["generationMode"],
        targetMs: seg.target_ms,
        firstFrameId: seg.first_frame_id,
        hardCut: Boolean(seg.hard_cut),
        status: seg.status as StoredSegment["status"],
        videoPath: seg.video_path,
        shots: storedShots,
      };
    });

    return {
      sceneId: scene.id,
      sceneIndex: scene.idx,
      sceneSlug: scene.slug,
      location: scene.location,
      timeOfDay: scene.time_of_day,
      interiorExterior: scene.interior_exterior,
      blocking: parse<Blocking | null>(scene.blocking_json, null),
      segments: storedSegments,
    };
  });
}

// 收集项目当前的媒体文件（视频/帧图路径），用于删除段落后清理磁盘残留。
function collectProjectMediaFiles(
  db: ReturnType<typeof getProjectDb>,
  projectId: string,
): string[] {
  const frames = db
    .prepare(
      `SELECT f.image_path AS p FROM frame f
       JOIN segment s ON f.segment_id = s.id WHERE s.project_id = ?`,
    )
    .all(projectId) as { p: string }[];
  const videos = db
    .prepare(
      "SELECT video_path AS p FROM segment WHERE project_id = ? AND video_path IS NOT NULL",
    )
    .all(projectId) as { p: string }[];
  return [...frames.map((r) => r.p), ...videos.map((r) => r.p)];
}

// 删除媒体文件并清理其所在段目录（目录内只含该段的文件）。
function removeMediaFiles(paths: string[]): void {
  const dirs = new Set<string>();
  for (const p of paths) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    } catch {
      // 文件被占用等，忽略
    }
    dirs.add(path.dirname(p));
  }
  for (const dir of dirs) {
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略
    }
  }
}

export function saveStoryboard(
  projectId: string,
  draft: StoryboardDraft,
  assets: StoredAsset[],
): StoredSceneStoryboard[] {
  const db = getProjectDb(projectId);
  const sceneRows = db
    .prepare("SELECT id, idx FROM scene ORDER BY sort_order ASC")
    .all() as { id: string; idx: string }[];
  const sceneIdByIndex = new Map(sceneRows.map((s) => [s.idx, s.id]));

  // 场次编号对不上会导致分镜静默不落库（任务却显示成功）。这里提前报错，
  // 既不误删已有分镜，也能让用户看到明确原因。
  const unmatched = draft.scenes
    .map((s) => s.sceneIndex)
    .filter((idx) => !sceneIdByIndex.has(idx));
  if (unmatched.length > 0) {
    throw new Error(
      `分镜场次编号与剧本不匹配（${[...new Set(unmatched)].join("、")}），请重新生成分镜。`,
    );
  }

  // 删除旧段前先记录其媒体文件，重建后清理，避免磁盘残留无限增长。
  const staleMedia = collectProjectMediaFiles(db, projectId);

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM segment WHERE project_id = ?").run(projectId);

    const updateBlocking = db.prepare(
      "UPDATE scene SET blocking_json = ? WHERE id = ?",
    );
    // 以镜为主：先写一个「暂存段」持有本场镜序列，随后由编排层按厂商重打包。
    const insertSegment = db.prepare(
      `INSERT INTO segment
       (id, project_id, scene_id, idx, generation_mode, target_ms, first_frame_id, hard_cut, status, video_path, created_at, updated_at)
       VALUES (?, ?, ?, 1, 'multi-shot', ?, NULL, 0, 'draft', NULL, ?, ?)`,
    );
    const insertShot = db.prepare(
      `INSERT INTO shot
       (id, segment_id, idx, duration_ms, ideal_ms, continues_prev, camera_json, lighting, action, dialogue, dialogue_json, expression, subject_node_ids_json, original_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
    );
    const insertRef = db.prepare(
      `INSERT INTO shot_ref (id, shot_id, role, asset_id, variant_id, view_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const now = nowIso();
    for (const sceneDraft of draft.scenes) {
      const sceneId = sceneIdByIndex.get(sceneDraft.sceneIndex);
      if (!sceneId) continue;
      updateBlocking.run(JSON.stringify(sceneDraft.blocking), sceneId);

      const shots = sceneDraft.shots ?? [];
      if (shots.length === 0) continue;

      const segmentId = newId();
      const totalMs = shots.reduce((a, s) => a + (s.durationMs || 0), 0);
      insertSegment.run(
        segmentId,
        projectId,
        sceneId,
        totalMs || 10000,
        now,
        now,
      );

      shots.forEach((shot, shotIndex) => {
        const dialogue = toDialogue(shot.dialogue);
        const idealMs = shot.durationMs || 0;
        const continuesPrev = Boolean(shot.continuesPrev);
        const shotId = newId();
        insertShot.run(
          shotId,
          segmentId,
          shotIndex,
          idealMs,
          idealMs,
          continuesPrev ? 1 : 0,
          JSON.stringify(shot.camera),
          shot.lighting,
          shot.action,
          JSON.stringify(dialogue),
          shot.expression,
          JSON.stringify(shot.subjectNodeIds ?? []),
          JSON.stringify({
            durationMs: idealMs,
            idealMs,
            continuesPrev,
            camera: shot.camera,
            lighting: shot.lighting,
            action: shot.action,
            dialogue,
            expression: shot.expression,
            subjectNodeIds: shot.subjectNodeIds ?? [],
            refs: shot.refs,
          }),
        );
        // 只写内容引用（角色/场景/道具）；起始画面由 segment.first_frame_id 单独管理。
        shot.refs
          .filter((r) => r.assetName.trim().length > 0)
          .forEach((ref, refIndex) => {
            const resolved = resolveRefLabels(assets, ref);
            // 引用了不存在的资产（如没建资产的一次性道具）→ 丢弃，避免存下悬空引用。
            if (!resolved.assetId) return;
            insertRef.run(
              newId(),
              shotId,
              ref.role,
              resolved.assetId,
              resolved.variantId,
              resolved.viewId,
              refIndex,
            );
          });
      });
    }
  });
  tx();

  // 分镜整体重建：旧的镜 id 已作废，清空按厂商的编排缓存，避免残留脏数据。
  clearOrchestrationCache(projectId);
  removeMediaFiles(staleMedia);

  // 同一地点可能有多个场次（分场推进），必须共用一套站位，
  // 否则同一张场景图下人物每场换座，观感上「场景一致但座位乱」。
  normalizeBlockingByLocation(projectId);

  return getStoryboard(projectId);
}

// 地点归一用的宽松 key：去掉空白与标点后比较，避免「谜酒吧角落卡座」与
// 「谜酒吧角落卡座（夜）」被当成两个地点。
function locationKey(location: string): string {
  return location
    .trim()
    .toLowerCase()
    .replace(/[\s“”"'「」『』（）()·,，。、/\\\-—_]/g, "");
}

// 把同一地点的多场 blocking 归一：以首次出现的场次为基准，按角色 label 对齐坐标/朝向。
// 只改位置与朝向，轴线与镜头侧保持各场自身设定。返回被改写的场次数。
export function normalizeBlockingByLocation(projectId: string): number {
  const db = getProjectDb(projectId);
  const scenes = db
    .prepare(
      "SELECT id, location, blocking_json FROM scene ORDER BY sort_order ASC",
    )
    .all() as {
    id: string;
    location: string;
    blocking_json: string | null;
  }[];

  const canonical = new Map<
    string,
    Map<string, { pos: { x: number; y: number }; facing: number }>
  >();
  const updates: { id: string; blocking: Blocking }[] = [];

  for (const scene of scenes) {
    const key = locationKey(scene.location);
    if (!key) continue;
    const blocking = parse<Blocking | null>(scene.blocking_json, null);
    if (!blocking || blocking.nodes.length === 0) continue;

    const map = canonical.get(key) ?? new Map();
    let sceneChanged = false;
    const nodes = blocking.nodes.map((node) => {
      const labelKey = normalize(node.label);
      const existing = labelKey ? map.get(labelKey) : undefined;
      if (existing) {
        if (
          existing.pos.x !== node.pos.x ||
          existing.pos.y !== node.pos.y ||
          existing.facing !== node.facing
        ) {
          sceneChanged = true;
        }
        return { ...node, pos: { ...existing.pos }, facing: existing.facing };
      }
      if (labelKey) {
        map.set(labelKey, { pos: { ...node.pos }, facing: node.facing });
      }
      return node;
    });
    canonical.set(key, map);
    if (sceneChanged) updates.push({ id: scene.id, blocking: { ...blocking, nodes } });
  }

  if (updates.length > 0) {
    const stmt = db.prepare("UPDATE scene SET blocking_json = ? WHERE id = ?");
    for (const update of updates) {
      stmt.run(JSON.stringify(update.blocking), update.id);
    }
  }
  return updates.length;
}

export function clearStoryboard(projectId: string): void {
  const db = getProjectDb(projectId);
  const staleMedia = collectProjectMediaFiles(db, projectId);
  db.prepare("DELETE FROM segment WHERE project_id = ?").run(projectId);
  db.prepare("UPDATE scene SET blocking_json = NULL").run();
  clearOrchestrationCache(projectId);
  removeMediaFiles(staleMedia);
}

export function saveSceneBlocking(
  projectId: string,
  sceneId: string,
  blocking: Blocking,
): boolean {
  const db = getProjectDb(projectId);
  const row = db
    .prepare(
      `SELECT sc.id FROM scene sc JOIN script s ON sc.script_id = s.id
       WHERE sc.id = ? AND s.project_id = ?`,
    )
    .get(sceneId, projectId);
  if (!row) return false;
  db.prepare("UPDATE scene SET blocking_json = ? WHERE id = ?").run(
    JSON.stringify(blocking),
    sceneId,
  );
  return true;
}

export function setSegmentHardCut(
  projectId: string,
  segmentId: string,
  hardCut: boolean,
): boolean {
  const db = getProjectDb(projectId);
  const row = db
    .prepare("SELECT id FROM segment WHERE id = ? AND project_id = ?")
    .get(segmentId, projectId);
  if (!row) return false;
  db.prepare(
    "UPDATE segment SET hard_cut = ?, updated_at = ? WHERE id = ?",
  ).run(hardCut ? 1 : 0, nowIso(), segmentId);
  return true;
}

export function setSegmentTargetMs(
  projectId: string,
  segmentId: string,
  targetMs: number,
): boolean {
  const db = getProjectDb(projectId);
  const row = db
    .prepare("SELECT id FROM segment WHERE id = ? AND project_id = ?")
    .get(segmentId, projectId);
  if (!row) return false;
  db.prepare(
    "UPDATE segment SET target_ms = ?, updated_at = ? WHERE id = ?",
  ).run(Math.max(0, Math.round(targetMs)), nowIso(), segmentId);
  return true;
}

export interface ShotPatch {
  durationMs?: number;
  camera?: Camera;
  lighting?: string;
  action?: string;
  dialogue?: DialogueLine[];
  expression?: string;
  subjectNodeIds?: string[];
  continuesPrev?: boolean;
  refs?: RefLabelInput[];
}

function replaceShotRefs(
  db: ReturnType<typeof getProjectDb>,
  shotId: string,
  refs: RefLabelInput[],
  assets: StoredAsset[],
): void {
  db.prepare("DELETE FROM shot_ref WHERE shot_id = ?").run(shotId);
  const insertRef = db.prepare(
    `INSERT INTO shot_ref (id, shot_id, role, asset_id, variant_id, view_id, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  refs.forEach((ref, i) => {
    const r = resolveRefLabels(assets, ref);
    insertRef.run(newId(), shotId, ref.role, r.assetId, r.variantId, r.viewId, i);
  });
}

export function updateShot(
  projectId: string,
  shotId: string,
  patch: ShotPatch,
  assets: StoredAsset[],
): boolean {
  const db = getProjectDb(projectId);
  const row = db
    .prepare(
      `SELECT s.id FROM shot s JOIN segment sg ON s.segment_id = sg.id
       WHERE s.id = ? AND sg.project_id = ?`,
    )
    .get(shotId, projectId);
  if (!row) return false;
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE shot SET
         duration_ms = COALESCE(?, duration_ms),
         ideal_ms = COALESCE(?, ideal_ms),
         continues_prev = COALESCE(?, continues_prev),
         camera_json = COALESCE(?, camera_json),
         lighting = COALESCE(?, lighting),
         action = COALESCE(?, action),
         dialogue_json = COALESCE(?, dialogue_json),
         expression = COALESCE(?, expression),
         subject_node_ids_json = COALESCE(?, subject_node_ids_json)
       WHERE id = ?`,
    ).run(
      patch.durationMs ?? null,
      patch.durationMs ?? null,
      patch.continuesPrev === undefined ? null : patch.continuesPrev ? 1 : 0,
      patch.camera ? JSON.stringify(patch.camera) : null,
      patch.lighting ?? null,
      patch.action ?? null,
      patch.dialogue ? JSON.stringify(patch.dialogue) : null,
      patch.expression ?? null,
      patch.subjectNodeIds ? JSON.stringify(patch.subjectNodeIds) : null,
      shotId,
    );
    if (patch.refs) replaceShotRefs(db, shotId, patch.refs, assets);
  });
  tx();
  return true;
}

interface OriginalShot {
  durationMs: number;
  idealMs?: number;
  continuesPrev?: boolean;
  camera: Camera;
  lighting: string;
  action: string;
  dialogue: DialogueLine[] | string;
  expression: string;
  subjectNodeIds?: string[];
  refs: RefLabelInput[];
}

export function restoreShot(
  projectId: string,
  shotId: string,
  assets: StoredAsset[],
): boolean {
  const db = getProjectDb(projectId);
  const row = db
    .prepare(
      `SELECT s.original_json FROM shot s JOIN segment sg ON s.segment_id = sg.id
       WHERE s.id = ? AND sg.project_id = ?`,
    )
    .get(shotId, projectId) as { original_json: string | null } | undefined;
  if (!row?.original_json) return false;
  let original: OriginalShot;
  try {
    original = JSON.parse(row.original_json) as OriginalShot;
  } catch {
    return false;
  }
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE shot SET duration_ms = ?, ideal_ms = ?, continues_prev = ?,
         camera_json = ?, lighting = ?,
         action = ?, dialogue_json = ?, expression = ?, subject_node_ids_json = ?
       WHERE id = ?`,
    ).run(
      original.durationMs,
      original.idealMs ?? original.durationMs,
      original.continuesPrev ? 1 : 0,
      JSON.stringify(original.camera),
      original.lighting,
      original.action,
      JSON.stringify(toDialogue(original.dialogue)),
      original.expression,
      JSON.stringify(original.subjectNodeIds ?? []),
      shotId,
    );
    replaceShotRefs(db, shotId, original.refs ?? [], assets);
  });
  tx();
  return true;
}

export function restoreSegment(
  projectId: string,
  segmentId: string,
  assets: StoredAsset[],
): number {
  const db = getProjectDb(projectId);
  const shots = db
    .prepare("SELECT id FROM shot WHERE segment_id = ?")
    .all(segmentId) as { id: string }[];
  let count = 0;
  for (const shot of shots) {
    if (restoreShot(projectId, shot.id, assets)) count += 1;
  }
  return count;
}

// 连续性规则是「内部固定全开」的：不暴露给用户，避免误关关键规则导致生成质量下降。
// 这里返回的规则同时用于分镜生成提示、连续性校验与提示词渲染。
export const CONTINUITY_RULES: Record<string, boolean> = {
  axis180: true,
  eyelineMatch: true,
  lightingContinuity: true,
  focalLogic: true,
  wardrobeProp: true,
  blockingLock: true,
  actionMatch: true,
  firstFrameAnchor: true,
};

export function getContinuityRules(): Record<string, boolean> {
  return { ...CONTINUITY_RULES };
}
