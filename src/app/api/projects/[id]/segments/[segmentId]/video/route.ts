import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSegmentVideoPath, setSegmentVideo } from "@/lib/frames";
import { getProjectDb } from "@/lib/db";
import { getSegmentVideoPath as getPath } from "@/lib/paths";

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

export async function GET(_request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  const videoPath = getSegmentVideoPath(id, segmentId);
  if (!videoPath || !fs.existsSync(videoPath)) {
    return NextResponse.json({ error: "视频不存在" }, { status: 404 });
  }
  const ext = path.extname(videoPath).slice(1).toLowerCase();
  const mime =
    ext === "webm"
      ? "video/webm"
      : ext === "mov"
        ? "video/quicktime"
        : "video/mp4";
  const stat = fs.statSync(videoPath);
  const range = _request.headers.get("range");
  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : stat.size - 1;
    const chunk = fs.readFileSync(videoPath).subarray(start, end + 1);
    return new NextResponse(new Uint8Array(chunk), {
      status: 206,
      headers: {
        "Content-Type": mime,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunk.length),
      },
    });
  }
  return new NextResponse(new Uint8Array(fs.readFileSync(videoPath)), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
    },
  });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!segmentExists(id, segmentId)) {
    return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }
  const ext = EXT_BY_MIME[file.type] ?? "mp4";
  const dest = getPath(id, segmentId, ext);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()));
  setSegmentVideo(id, segmentId, dest);
  return NextResponse.json({ videoPath: dest, status: "returned" });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  const videoPath = getSegmentVideoPath(id, segmentId);
  if (videoPath && fs.existsSync(videoPath)) fs.rmSync(videoPath, { force: true });
  const db = getProjectDb(id);
  db.prepare(
    "UPDATE segment SET video_path = NULL, status = 'generated' WHERE id = ?",
  ).run(segmentId);
  db.prepare("DELETE FROM video_asset WHERE segment_id = ?").run(segmentId);
  return NextResponse.json({ ok: true });
}
