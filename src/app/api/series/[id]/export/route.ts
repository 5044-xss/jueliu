import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import {
  exportSeriesArchive,
  type ProjectArchiveMode,
} from "@core/server/project-transfer";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_") || "project.zip";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  const mode: ProjectArchiveMode =
    new URL(request.url).searchParams.get("mode") === "full" ? "full" : "slim";
  try {
    const { zipPath, fileName } = await exportSeriesArchive(id, mode);
    const stat = fs.statSync(zipPath);
    const stream = fs.createReadStream(zipPath);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        fs.rmSync(path.dirname(zipPath), { recursive: true, force: true });
      } catch {
        // 忽略清理失败
      }
    };
    stream.on("close", cleanup);
    stream.on("error", cleanup);
    const timer = setTimeout(cleanup, 10 * 60 * 1000);
    timer.unref?.();
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(stat.size),
        "Content-Disposition": contentDisposition(fileName),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "导出失败" },
      { status: 400 },
    );
  }
}
