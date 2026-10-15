import fs from "node:fs";
import path from "node:path";
import { getProjectDb, newId, nowIso } from "@/lib/db";
import { getFramePath } from "@/lib/paths";
import { extractFrame } from "@/lib/ffmpeg";
import { readGlobalSettings } from "@/lib/settings";
import { getProject } from "@/lib/projects";

// first/last = 从本段视频截取的首帧/尾帧；start = 外部上传或生成的「本段起始画面」。
// 起始画面单独一个 kind，避免与视频首帧写入同一行互相覆盖。
export type FrameKind = "first" | "last" | "start";

export interface StoredFrame {
  id: string;
  segmentId: string;
  kind: FrameKind;
  imagePath: string;
  confirmed: boolean;
  createdAt: string;
}

interface FrameRow {
  id: string;
  segment_id: string;
  kind: string;
  image_path: string;
  confirmed: number;
  created_at: string;
}

interface SegmentVideoRow {
  video_path: string | null;
}

function mapFrame(row: FrameRow): StoredFrame {
  return {
    id: row.id,
    segmentId: row.segment_id,
    kind: row.kind as FrameKind,
    imagePath: row.image_path,
    confirmed: Boolean(row.confirmed),
    createdAt: row.created_at,
  };
}

export function getFrames(projectId: string, segmentId: string): StoredFrame[] {
  const db = getProjectDb(projectId);
  const rows = db
    .prepare("SELECT * FROM frame WHERE segment_id = ? ORDER BY kind ASC")
    .all(segmentId) as FrameRow[];
  return rows.map(mapFrame);
}

export function getFrameImagePath(
  projectId: string,
  frameId: string,
): string | null {
  const db = getProjectDb(projectId);
  const row = db
    .prepare(
      `SELECT f.image_path FROM frame f
       JOIN segment s ON f.segment_id = s.id
       WHERE f.id = ? AND s.project_id = ?`,
    )
    .get(frameId, projectId) as { image_path: string } | undefined;
  return row?.image_path ?? null;
}

export function setSegmentVideo(
  projectId: string,
  segmentId: string,
  videoPath: string,
): void {
  const db = getProjectDb(projectId);
  const now = nowIso();
  db.prepare(
    "UPDATE segment SET video_path = ?, status = 'returned', updated_at = ? WHERE id = ?",
  ).run(videoPath, now, segmentId);
  const existing = db
    .prepare("SELECT id FROM video_asset WHERE segment_id = ? LIMIT 1")
    .get(segmentId) as { id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE video_asset SET path = ? WHERE id = ?").run(
      videoPath,
      existing.id,
    );
  } else {
    db.prepare(
      "INSERT INTO video_asset (id, segment_id, path, created_at) VALUES (?, ?, ?, ?)",
    ).run(newId(), segmentId, videoPath, now);
  }
}

export function getSegmentVideoPath(
  projectId: string,
  segmentId: string,
): string | null {
  const db = getProjectDb(projectId);
  const row = db
    .prepare("SELECT video_path FROM segment WHERE id = ?")
    .get(segmentId) as SegmentVideoRow | undefined;
  return row?.video_path ?? null;
}

export function setSegmentFirstFrame(
  projectId: string,
  segmentId: string,
  frameId: string | null,
): void {
  const db = getProjectDb(projectId);
  db.prepare(
    "UPDATE segment SET first_frame_id = ?, updated_at = ? WHERE id = ?",
  ).run(frameId, nowIso(), segmentId);
}

// 写入（或更新）指定段、指定 kind 的 frame 行，供「从视频截帧」与「外部回传图片」共用。
export function upsertFrame(
  projectId: string,
  segmentId: string,
  kind: FrameKind,
  imagePath: string,
): StoredFrame {
  const db = getProjectDb(projectId);
  const now = nowIso();
  const existing = db
    .prepare("SELECT id FROM frame WHERE segment_id = ? AND kind = ?")
    .get(segmentId, kind) as { id: string } | undefined;
  let frameId: string;
  if (existing) {
    db.prepare(
      "UPDATE frame SET image_path = ?, confirmed = 0, created_at = ? WHERE id = ?",
    ).run(imagePath, now, existing.id);
    frameId = existing.id;
  } else {
    frameId = newId();
    db.prepare(
      `INSERT INTO frame (id, segment_id, kind, image_path, confirmed, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    ).run(frameId, segmentId, kind, imagePath, now);
  }
  return mapFrame(
    db.prepare("SELECT * FROM frame WHERE id = ?").get(frameId) as FrameRow,
  );
}

export async function extractAndSaveFrame(
  projectId: string,
  segmentId: string,
  kind: "first" | "last",
): Promise<StoredFrame> {
  const db = getProjectDb(projectId);
  const segment = db
    .prepare("SELECT video_path FROM segment WHERE id = ?")
    .get(segmentId) as SegmentVideoRow | undefined;
  if (!segment?.video_path) {
    throw new Error("该段尚未回传视频，无法截帧。");
  }
  if (!fs.existsSync(segment.video_path)) {
    throw new Error("视频文件不存在，请重新回传。");
  }

  // 媒体按厂商分区存放，避免不同厂商复用同一 segment id 时互相覆盖文件。
  const vendor = getProject(projectId)?.vendor ?? "doubao";
  const output = getFramePath(projectId, vendor, segmentId, kind, "png");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const binPath = readGlobalSettings().ffmpeg.path;
  await extractFrame(binPath, segment.video_path, output, kind);

  // 抽取成功后再解除别段对该帧的采用：抽取失败不应影响既有采用关系。
  releaseFrameAdoption(projectId, segmentId, kind);
  return upsertFrame(projectId, segmentId, kind, output);
}

export function confirmFrame(
  projectId: string,
  frameId: string,
  confirmed: boolean,
): void {
  const db = getProjectDb(projectId);
  db.prepare(
    `UPDATE frame SET confirmed = ?
     WHERE id = ? AND segment_id IN (SELECT id FROM segment WHERE project_id = ?)`,
  ).run(confirmed ? 1 : 0, frameId, projectId);
}

// 删除单张帧图（首帧/尾帧/起始画面）：同时解除别段对它的采用并删除磁盘文件。
export function deleteFrame(projectId: string, frameId: string): boolean {
  const db = getProjectDb(projectId);
  const row = db
    .prepare(
      `SELECT f.image_path FROM frame f
       JOIN segment s ON f.segment_id = s.id
       WHERE f.id = ? AND s.project_id = ?`,
    )
    .get(frameId, projectId) as { image_path: string } | undefined;
  if (!row) return false;
  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE segment SET first_frame_id = NULL, updated_at = ? WHERE first_frame_id = ?",
    ).run(nowIso(), frameId);
    db.prepare("DELETE FROM frame WHERE id = ?").run(frameId);
  });
  tx();
  if (row.image_path && fs.existsSync(row.image_path)) {
    try {
      fs.rmSync(row.image_path, { force: true });
    } catch {
      // 文件删除失败不影响行删除
    }
  }
  return true;
}

// 解除「别段正在采用的画面」与本段某 kind 帧的关联。
// 帧图被覆盖或视频被删除时，若不先解除，采用它的段会静默换成新画面或失效画面。
export function releaseFrameAdoption(
  projectId: string,
  segmentId: string,
  kind: FrameKind,
): void {
  const db = getProjectDb(projectId);
  const rows = db
    .prepare("SELECT id FROM frame WHERE segment_id = ? AND kind = ?")
    .all(segmentId, kind) as { id: string }[];
  const clear = db.prepare(
    "UPDATE segment SET first_frame_id = NULL, updated_at = ? WHERE first_frame_id = ?",
  );
  for (const row of rows) clear.run(nowIso(), row.id);
}

// 解除别段对本段全部帧（首帧/尾帧/起始画面）的采用。删除视频时调用。
export function releaseSegmentFrameAdoptions(
  projectId: string,
  segmentId: string,
): void {
  releaseFrameAdoption(projectId, segmentId, "first");
  releaseFrameAdoption(projectId, segmentId, "last");
  releaseFrameAdoption(projectId, segmentId, "start");
}

// 清理悬空的起始画面指针：帧行已不存在、或帧图文件已丢失的段，其 first_frame_id 置空。
// 编排重建段落后调用，避免残留指向已删帧的引用。返回清理数量。
export function clearDanglingFirstFrames(projectId: string): number {
  const db = getProjectDb(projectId);
  const rows = db
    .prepare(
      `SELECT s.id AS segment_id, f.image_path AS image_path
       FROM segment s
       LEFT JOIN frame f ON s.first_frame_id = f.id
       WHERE s.first_frame_id IS NOT NULL`,
    )
    .all() as { segment_id: string; image_path: string | null }[];
  const clear = db.prepare(
    "UPDATE segment SET first_frame_id = NULL WHERE id = ?",
  );
  let count = 0;
  for (const row of rows) {
    if (!row.image_path || !fs.existsSync(row.image_path)) {
      clear.run(row.segment_id);
      count += 1;
    }
  }
  return count;
}

export interface TailCaptureResult {
  captured: boolean;
  reason?: string;
}

// 回传视频后只截取尾帧作为「候选」，不自动采用。
// 采用与否由用户在第三方生成弹窗里决定。
export async function captureTailCandidate(
  projectId: string,
  segmentId: string,
): Promise<TailCaptureResult> {
  try {
    await extractAndSaveFrame(projectId, segmentId, "last");
    return { captured: true };
  } catch (error) {
    return { captured: false, reason: (error as Error).message };
  }
}
