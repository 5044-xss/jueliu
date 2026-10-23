import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import {
  getSegmentVideoPath,
  releaseSegmentFrameAdoptions,
  setSegmentVideo,
} from "@core/server/frames";
import { getProjectDb, nowIso } from "@core/server/db";
import { buildManifest } from "@core/server/render";
import { mediaSignature } from "@core/server/media-signature";
import { getSegmentVideoPath as getPath } from "@core/server/paths";
import { getProject, projectExists } from "@core/server/projects";
import { runSegmentQc } from "@core/server/qc";
import { captureAndAdoptTail } from "@/lib/generation/tail";

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
  const attempt = path.join(
    path.dirname(dest),
    `upload-${Date.now()}.${ext}`,
  );
  const previous = getSegmentVideoPath(id, segmentId);
  // 记录回传时的分镜内容签名，之后编辑分镜才能准确判定视频「已过期」。
  const built = buildManifest(id, segmentId);
  const mediaSig = built
    ? mediaSignature(built.scene.blocking, built.segment)
    : null;
  fs.writeFileSync(attempt, Buffer.from(await file.arrayBuffer()));
  let qc = null;
  try {
    qc = await runSegmentQc({ projectId: id, segmentId, videoPath: attempt });
  } catch {
    qc = null;
  }
  if (qc) {
    const db = getProjectDb(id);
    db.prepare(
      "UPDATE segment SET gen_status = ?, updated_at = ? WHERE id = ?",
    ).run(qc.hardFail ? "qc_failed" : "completed", nowIso(), segmentId);
  }
  fs.copyFileSync(attempt, dest);
  setSegmentVideo(id, segmentId, dest, mediaSig);
  // 扩展名变化会换路径，清掉旧文件避免残留。
  if (previous && previous !== dest && fs.existsSync(previous)) {
    fs.rmSync(previous, { force: true });
  }
  // 回传后：下一段若为连续段，截本段尾帧并自动接为下一段起始画面；否则不截尾帧。
  // 截取失败不影响视频回传。
  let tail: { captured: boolean; adoptedSegmentId?: string; reason?: string } = {
    captured: false,
  };
  try {
    tail = await captureAndAdoptTail(id, segmentId);
  } catch (error) {
    tail = { captured: false, reason: (error as Error).message };
  }
  return NextResponse.json({ videoPath: dest, status: "returned", tail, qc });
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
    "UPDATE segment SET video_path = NULL, media_sig = NULL, status = 'generated' WHERE id = ?",
  ).run(segmentId);
  db.prepare("DELETE FROM video_asset WHERE segment_id = ?").run(segmentId);
  // 视频没了，别段不应再采用本段的残留帧图。
  releaseSegmentFrameAdoptions(id, segmentId);
  return NextResponse.json({ ok: true });
}
