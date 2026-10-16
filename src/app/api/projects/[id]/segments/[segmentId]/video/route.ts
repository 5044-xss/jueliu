import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import {
  captureTailCandidate,
  getSegmentVideoPath,
  releaseSegmentFrameAdoptions,
  setSegmentVideo,
} from "@core/server/frames";
import { getProjectDb } from "@core/server/db";
import { getSegmentVideoPath as getPath } from "@core/server/paths";
import { getProject, projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function segmentExists(projectId: string, segmentId: string): boolean {
  const db = getProjectDb(projectId);
  const row = db
    .prepare("SELECT id FROM segment WHERE id = ?")
    .get(segmentId);
  return Boolean(row);
}

function mimeFor(ext: string): string {
  return ext === "webm"
    ? "video/webm"
    : ext === "mov"
      ? "video/quicktime"
      : "video/mp4";
}

export async function GET(request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const videoPath = getSegmentVideoPath(id, segmentId);
  if (!videoPath || !fs.existsSync(videoPath)) {
    return NextResponse.json({ error: "视频不存在" }, { status: 404 });
  }
  const ext = path.extname(videoPath).slice(1).toLowerCase();
  const mime = mimeFor(ext);
  const stat = fs.statSync(videoPath);

  // 解析 Range：非法/越界一律回退为整段 200，避免发出错误的 Content-Range。
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const range = request.headers.get("range");
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const s = match[1] ? Number(match[1]) : 0;
      const e = match[2] ? Number(match[2]) : stat.size - 1;
      if (
        Number.isFinite(s) &&
        Number.isFinite(e) &&
        s >= 0 &&
        s < stat.size &&
        e >= s
      ) {
        start = s;
        end = Math.min(e, stat.size - 1);
        status = 206;
      }
    }
  }

  const stream = Readable.toWeb(
    fs.createReadStream(videoPath, { start, end }),
  ) as ReadableStream;
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
  };
  if (status === 206) {
    headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  }
  return new NextResponse(stream, { status, headers });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  if (!segmentExists(id, segmentId)) {
    return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }
  const vendor = getProject(id)?.vendor ?? "doubao";
  const ext = EXT_BY_MIME[file.type] ?? "mp4";
  const dest = getPath(id, vendor, segmentId, ext);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const previous = getSegmentVideoPath(id, segmentId);
  fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()));
  setSegmentVideo(id, segmentId, dest);
  // 扩展名变化会换路径，清掉旧文件避免残留。
  if (previous && previous !== dest && fs.existsSync(previous)) {
    fs.rmSync(previous, { force: true });
  }
  // 回传后只生成尾帧候选，不自动采用；截取失败不影响视频回传。
  let tail: { captured: boolean; reason?: string } = { captured: false };
  try {
    tail = await captureTailCandidate(id, segmentId);
  } catch (error) {
    tail = { captured: false, reason: (error as Error).message };
  }
  return NextResponse.json({ videoPath: dest, status: "returned", tail });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  if (!segmentExists(id, segmentId)) {
    return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  }
  const videoPath = getSegmentVideoPath(id, segmentId);
  if (videoPath && fs.existsSync(videoPath)) {
    fs.rmSync(videoPath, { force: true });
  }
  const db = getProjectDb(id);
  db.prepare(
    "UPDATE segment SET video_path = NULL, status = 'generated' WHERE id = ?",
  ).run(segmentId);
  db.prepare("DELETE FROM video_asset WHERE segment_id = ?").run(segmentId);
  // 视频没了，别段不应再采用本段的残留帧图。
  releaseSegmentFrameAdoptions(id, segmentId);
  return NextResponse.json({ ok: true });
}
