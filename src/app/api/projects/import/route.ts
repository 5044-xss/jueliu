import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { importSeriesArchive } from "@core/server/project-transfer";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "项目包过大" }, { status: 413 });
  }
  if (!request.body) {
    return NextResponse.json({ error: "缺少项目包文件" }, { status: 400 });
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jueman-upload-"));
  const zipPath = path.join(tempDir, "upload.zip");
  try {
    await pipeline(
      Readable.fromWeb(request.body as never),
      fs.createWriteStream(zipPath),
    );
    const stat = fs.statSync(zipPath);
    if (stat.size === 0) {
      return NextResponse.json({ error: "项目包为空" }, { status: 400 });
    }
    if (stat.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "项目包过大" }, { status: 413 });
    }
    const result = await importSeriesArchive(zipPath);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "导入失败" },
      { status: 400 },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
