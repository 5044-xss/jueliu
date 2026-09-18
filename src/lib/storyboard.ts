import { getProjectDb, newId, nowIso } from "@/lib/db";
import type {
  Blocking,
  Camera,
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
  status: string;
  video_path: string | null;
}

interface ShotRow {
  id: string;
  segment_id: string;
  idx: number;
  duration_ms: number;
  camera_json: string;
  lighting: string;
  action: string;
  dialogue: string;
  expression: string;
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

function normalize(value: string): string {
  return value.trim().toLowerCase();
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
          camera: parse<Camera>(shot.camera_json, {
            focal: "",
            shotSize: "",
            angle: "",
            movement: "",
          }),
          lighting: shot.lighting,
          action: shot.action,
          dialogue: shot.dialogue,
          expression: shot.expression,
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
        };
      });
      return {
        id: seg.id,
        sceneId: seg.scene_id,
        index: seg.idx,
        generationMode: seg.generation_mode as StoredSegment["generationMode"],
        targetMs: seg.target_ms,
        firstFrameId: seg.first_frame_id,
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

  const assetByName = new Map(
    assets.map((a) => [normalize(a.name), a]),
  );

  function resolveRef(ref: {
    role: RefRole;
    assetName: string;
    variantLabel: string;
    viewLabel: string;
  }): { assetId: string | null; variantId: string | null; viewId: string | null } {
    const asset = assetByName.get(normalize(ref.assetName));
    if (!asset) return { assetId: null, variantId: null, viewId: null };
    const variant =
      asset.variants.find((v) => normalize(v.label) === normalize(ref.variantLabel)) ??
      asset.variants[0];
    if (!variant) return { assetId: asset.id, variantId: null, viewId: null };
    const view =
      variant.views.find((v) => normalize(v.label) === normalize(ref.viewLabel)) ??
      variant.views[0];
    return {
      assetId: asset.id,
      variantId: variant.id,
      viewId: view?.id ?? null,
    };
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM segment WHERE project_id = ?").run(projectId);

    const updateBlocking = db.prepare(
      "UPDATE scene SET blocking_json = ? WHERE id = ?",
    );
    const insertSegment = db.prepare(
      `INSERT INTO segment
       (id, project_id, scene_id, idx, generation_mode, target_ms, first_frame_id, status, video_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'draft', NULL, ?, ?)`,
    );
    const insertShot = db.prepare(
      `INSERT INTO shot
       (id, segment_id, idx, duration_ms, camera_json, lighting, action, dialogue, expression)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

      sceneDraft.segments.forEach((segment) => {
        const segmentId = newId();
        insertSegment.run(
          segmentId,
          projectId,
          sceneId,
          segment.index,
          segment.generationMode,
          segment.targetMs,
          now,
          now,
        );
        segment.shots.forEach((shot, shotIndex) => {
          const shotId = newId();
          insertShot.run(
            shotId,
            segmentId,
            shotIndex,
            shot.durationMs,
            JSON.stringify(shot.camera),
            shot.lighting,
            shot.action,
            shot.dialogue,
            shot.expression,
          );
          shot.refs.forEach((ref, refIndex) => {
            const resolved = resolveRef(ref);
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
      });
    }
  });
  tx();

  return getStoryboard(projectId);
}

export function clearStoryboard(projectId: string): void {
  const db = getProjectDb(projectId);
  db.prepare("DELETE FROM segment WHERE project_id = ?").run(projectId);
  db.prepare("UPDATE scene SET blocking_json = NULL").run();
}

export function getContinuityRules(projectId: string): Record<string, boolean> {
  const db = getProjectDb(projectId);
  const row = db
    .prepare("SELECT rules_json FROM continuity_rule_set WHERE project_id = ? LIMIT 1")
    .get(projectId) as { rules_json: string } | undefined;
  return parse<Record<string, boolean>>(row?.rules_json ?? null, {});
}

export function saveContinuityRules(
  projectId: string,
  rules: Record<string, boolean>,
): void {
  const db = getProjectDb(projectId);
  const existing = db
    .prepare("SELECT id FROM continuity_rule_set WHERE project_id = ? LIMIT 1")
    .get(projectId) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE continuity_rule_set SET rules_json = ?, updated_at = ? WHERE id = ?",
    ).run(JSON.stringify(rules), nowIso(), existing.id);
  } else {
    db.prepare(
      "INSERT INTO continuity_rule_set (id, project_id, rules_json, updated_at) VALUES (?, ?, ?, ?)",
    ).run(newId(), projectId, JSON.stringify(rules), nowIso());
  }
}
