import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getProjectDb, newId, nowIso } from "@/lib/db";
import { getProjectDir } from "@/lib/paths";
import type { Db } from "@/lib/db";

// 按厂商缓存编排结果：切厂商会按新规则重打包段落并清空受影响段的视频/帧图，
// 这里把每个厂商的分段布局与其视频/帧图/起始画面存下来，切回原厂商时还原，避免丢工作量。
// 以「段内镜 id 序列 + 内容签名」为键：镜 id 稳定但内容可能被编辑，签名变化则不还原。

export interface CachedFrame {
  kind: string;
  imagePath: string;
  confirmed: boolean;
}

export interface CachedSegment {
  shotIds: string[];
  // 段内容签名（镜字段 + 引用 + 目标时长的哈希）：内容变了就不还原旧媒体。
  sig: string;
  videoPath: string | null;
  firstFrameImagePath: string | null;
  frames: CachedFrame[];
}

export type OrchestrationCache = Record<string, CachedSegment[]>;

interface SegmentStateRow {
  id: string;
  target_ms: number;
  video_path: string | null;
  first_frame_id: string | null;
}

interface FrameRow {
  kind: string;
  image_path: string;
  confirmed: number;
}

// 计算一段的内容签名：任一镜的字段、引用或目标时长变化都会得到不同的签名。
function segmentSignature(db: Db, segId: string, targetMs: number): string {
  const shots = db
    .prepare(
      `SELECT id, duration_ms, COALESCE(ideal_ms, -1) AS ideal_ms, continues_prev,
              camera_json, lighting, action, dialogue_json, expression,
              subject_node_ids_json
       FROM shot WHERE segment_id = ? ORDER BY idx ASC`,
    )
    .all(segId);
  const refs = db
    .prepare(
      `SELECT r.shot_id, r.role, COALESCE(r.asset_id,'') AS asset_id,
              COALESCE(r.variant_id,'') AS variant_id, COALESCE(r.view_id,'') AS view_id,
              r.sort_order
       FROM shot_ref r JOIN shot s ON r.shot_id = s.id
       WHERE s.segment_id = ? ORDER BY r.shot_id, r.sort_order`,
    )
    .all(segId);
  return createHash("sha256")
    .update(JSON.stringify({ targetMs, shots, refs }))
    .digest("hex");
}

function cacheFile(projectId: string): string {
  return path.join(getProjectDir(projectId), "orchestration-cache.json");
}

export function readOrchestrationCache(projectId: string): OrchestrationCache {
  const file = cacheFile(projectId);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object"
      ? (parsed as OrchestrationCache)
      : {};
  } catch {
    return {};
  }
}

function writeOrchestrationCache(
  projectId: string,
  cache: OrchestrationCache,
): void {
  fs.mkdirSync(getProjectDir(projectId), { recursive: true });
  const file = cacheFile(projectId);
  // 先写临时文件再原子替换，避免并发/中断写出半个 JSON。
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

/** 清空整个编排缓存（重新生成分镜时调用，避免旧镜 id 残留）。 */
export function clearOrchestrationCache(projectId: string): void {
  const file = cacheFile(projectId);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}

/** 记录某厂商当前的分段编排结果（视频/帧图/起始画面）。切换厂商前调用。 */
export function captureOrchestrationState(
  projectId: string,
  vendorId: string,
): void {
  const db = getProjectDb(projectId);
  const segments = db
    .prepare(
      "SELECT id, target_ms, video_path, first_frame_id FROM segment WHERE project_id = ?",
    )
    .all(projectId) as SegmentStateRow[];
  const shotStmt = db.prepare(
    "SELECT id FROM shot WHERE segment_id = ? ORDER BY idx ASC",
  );
  const frameStmt = db.prepare(
    "SELECT kind, image_path, confirmed FROM frame WHERE segment_id = ?",
  );
  const frameById = db.prepare("SELECT image_path FROM frame WHERE id = ?");

  const snapshots: CachedSegment[] = segments.map((seg) => {
    const shotIds = (shotStmt.all(seg.id) as { id: string }[]).map((r) => r.id);
    const frames = (frameStmt.all(seg.id) as FrameRow[]).map((f) => ({
      kind: f.kind,
      imagePath: f.image_path,
      confirmed: Boolean(f.confirmed),
    }));
    let firstFrameImagePath: string | null = null;
    if (seg.first_frame_id) {
      const row = frameById.get(seg.first_frame_id) as
        | { image_path: string }
        | undefined;
      firstFrameImagePath = row?.image_path ?? null;
    }
    return {
      shotIds,
      sig: segmentSignature(db, seg.id, seg.target_ms),
      videoPath: seg.video_path ?? null,
      firstFrameImagePath,
      frames,
    };
  });

  const cache = readOrchestrationCache(projectId);
  cache[vendorId] = snapshots;
  writeOrchestrationCache(projectId, cache);
}

/** 把某厂商缓存的编排结果写回当前分段。返回恢复出视频的段数。 */
export function restoreOrchestrationState(
  projectId: string,
  vendorId: string,
): number {
  const cache = readOrchestrationCache(projectId);
  const snapshots = cache[vendorId];
  if (!snapshots || snapshots.length === 0) return 0;

  const db = getProjectDb(projectId);
  const byKey = new Map<string, CachedSegment>();
  for (const snap of snapshots) byKey.set(snap.shotIds.join("|"), snap);

  const segments = db
    .prepare("SELECT id, target_ms FROM segment WHERE project_id = ?")
    .all(projectId) as { id: string; target_ms: number }[];
  const shotStmt = db.prepare(
    "SELECT id FROM shot WHERE segment_id = ? ORDER BY idx ASC",
  );
  const matches: { segId: string; snap: CachedSegment }[] = [];
  for (const seg of segments) {
    const key = (shotStmt.all(seg.id) as { id: string }[])
      .map((r) => r.id)
      .join("|");
    const snap = byKey.get(key);
    if (!snap) continue;
    // 内容签名不一致（镜被编辑过）就不还原，避免把旧媒体贴到新内容上。
    if (snap.sig !== segmentSignature(db, seg.id, seg.target_ms)) continue;
    matches.push({ segId: seg.id, snap });
  }
  if (matches.length === 0) return 0;

  const deleteFrames = db.prepare("DELETE FROM frame WHERE segment_id = ?");
  const insertFrame = db.prepare(
    "INSERT INTO frame (id, segment_id, kind, image_path, confirmed, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const deleteVideoAsset = db.prepare(
    "DELETE FROM video_asset WHERE segment_id = ?",
  );
  const insertVideoAsset = db.prepare(
    "INSERT INTO video_asset (id, segment_id, path, created_at) VALUES (?, ?, ?, ?)",
  );
  const resetSegment = db.prepare(
    "UPDATE segment SET video_path = NULL, first_frame_id = NULL, status = 'draft', updated_at = ? WHERE id = ?",
  );
  const setVideo = db.prepare(
    "UPDATE segment SET video_path = ?, status = 'returned', updated_at = ? WHERE id = ?",
  );
  const setFirst = db.prepare(
    "UPDATE segment SET first_frame_id = ? WHERE id = ?",
  );

  const imageToFrame = new Map<string, string>();
  let restored = 0;

  const tx = db.transaction(() => {
    const now = nowIso();
    for (const { segId, snap } of matches) {
      // 先清空该段残留的视频/起始画面，避免继承上一个厂商或留下悬空指针。
      resetSegment.run(now, segId);
      deleteFrames.run(segId);
      deleteVideoAsset.run(segId);
      for (const frame of snap.frames) {
        if (!frame.imagePath || !fs.existsSync(frame.imagePath)) continue;
        const frameId = newId();
        insertFrame.run(
          frameId,
          segId,
          frame.kind,
          frame.imagePath,
          frame.confirmed ? 1 : 0,
          now,
        );
        if (!imageToFrame.has(frame.imagePath)) {
          imageToFrame.set(frame.imagePath, frameId);
        }
      }
      if (snap.videoPath && fs.existsSync(snap.videoPath)) {
        setVideo.run(snap.videoPath, now, segId);
        insertVideoAsset.run(newId(), segId, snap.videoPath, now);
        restored += 1;
      }
    }
    // 第二遍：起始画面可能引用别段的帧图，等所有帧重建后再回填指针。
    for (const { segId, snap } of matches) {
      if (!snap.firstFrameImagePath) continue;
      const frameId = imageToFrame.get(snap.firstFrameImagePath);
      if (frameId) setFirst.run(frameId, segId);
    }
  });
  tx();
  return restored;
}
