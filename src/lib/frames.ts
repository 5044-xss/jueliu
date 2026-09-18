import fs from "node:fs";
import path from "node:path";
import { getProjectDb, newId, nowIso } from "@/lib/db";
import { getFramePath } from "@/lib/paths";
import { extractFrame } from "@/lib/ffmpeg";
import { readGlobalSettings } from "@/lib/settings";

export interface StoredFrame {
  id: string;
  segmentId: string;
  kind: "first" | "last";
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
    kind: row.kind as "first" | "last",
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
    .prepare("SELECT image_path FROM frame WHERE id = ?")
    .get(frameId) as { image_path: string } | undefined;
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

  const output = getFramePath(projectId, segmentId, kind, "png");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const binPath = readGlobalSettings().ffmpeg.path;
  await extractFrame(binPath, segment.video_path, output, kind);

  const now = nowIso();
  const existing = db
    .prepare("SELECT id FROM frame WHERE segment_id = ? AND kind = ?")
    .get(segmentId, kind) as { id: string } | undefined;
  let frameId: string;
  if (existing) {
    db.prepare(
      "UPDATE frame SET image_path = ?, confirmed = 0, created_at = ? WHERE id = ?",
    ).run(output, now, existing.id);
    frameId = existing.id;
  } else {
    frameId = newId();
    db.prepare(
      `INSERT INTO frame (id, segment_id, kind, image_path, confirmed, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    ).run(frameId, segmentId, kind, output, now);
  }
  return mapFrame(
    db.prepare("SELECT * FROM frame WHERE id = ?").get(frameId) as FrameRow,
  );
}

export function confirmFrame(
  projectId: string,
  frameId: string,
  confirmed: boolean,
): void {
  const db = getProjectDb(projectId);
  db.prepare("UPDATE frame SET confirmed = ? WHERE id = ?").run(
    confirmed ? 1 : 0,
    frameId,
  );
}
