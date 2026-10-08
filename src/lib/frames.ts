import fs from "node:fs";
import path from "node:path";
import { getProjectDb, newId, nowIso } from "@/lib/db";
import { getFramePath } from "@/lib/paths";
import { extractFrame } from "@/lib/ffmpeg";
import { readGlobalSettings } from "@/lib/settings";
import { getStoryboard } from "@/lib/storyboard";

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

export interface AnchorNextResult {
  anchored: boolean;
  reason?: string;
  frameId?: string;
}

// 回传某段视频后，自动把它的尾帧设为「同场下一段（连续段）」的首帧。
// 硬切段、场次最后一段不做锚定。
export async function anchorNextSegment(
  projectId: string,
  segmentId: string,
): Promise<AnchorNextResult> {
  const scenes = getStoryboard(projectId);
  for (const scene of scenes) {
    const index = scene.segments.findIndex((s) => s.id === segmentId);
    if (index < 0) continue;
    const next = scene.segments[index + 1];
    if (!next) return { anchored: false, reason: "本段是场次最后一段" };
    if (next.hardCut) return { anchored: false, reason: "下一段为硬切，无需首帧" };
    try {
      const frame = await extractAndSaveFrame(projectId, segmentId, "last");
      setSegmentFirstFrame(projectId, next.id, frame.id);
      return { anchored: true, frameId: frame.id };
    } catch (error) {
      return { anchored: false, reason: (error as Error).message };
    }
  }
  return { anchored: false, reason: "段不存在" };
}

export interface AutoAnchorResult {
  anchored: number;
  skipped: number;
  errors: string[];
}

// 逐场把「上一段尾帧」自动设为「下一段首帧」；不跨场（场次切换是硬切）
export async function autoAnchorSegments(
  projectId: string,
): Promise<AutoAnchorResult> {
  const scenes = getStoryboard(projectId);
  const result: AutoAnchorResult = { anchored: 0, skipped: 0, errors: [] };

  for (const scene of scenes) {
    const segments = scene.segments;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const current = segments[i];
      const next = segments[i + 1];
      if (next.hardCut) {
        result.skipped += 1;
        continue;
      }
      if (!current.videoPath) {
        result.skipped += 1;
        continue;
      }
      try {
        const frame = await extractAndSaveFrame(projectId, current.id, "last");
        setSegmentFirstFrame(projectId, next.id, frame.id);
        result.anchored += 1;
      } catch (error) {
        result.errors.push(
          `第${scene.sceneIndex}场 第${current.index}段：${(error as Error).message}`,
        );
      }
    }
  }

  return result;
}
