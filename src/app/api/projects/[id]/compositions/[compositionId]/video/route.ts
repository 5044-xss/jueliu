import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCompositionExportPath } from "@core/server/compose";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; compositionId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { id, compositionId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const exportPath = getCompositionExportPath(id, compositionId);
  if (!exportPath || !fs.existsSync(exportPath)) {
    return NextResponse.json({ error: "成片不存在" }, { status: 404 });
  }
  const ext = path.extname(exportPath).slice(1).toLowerCase();
  const mime =
    ext === "webm"
      ? "video/webm"
      : ext === "mov"
        ? "video/quicktime"
        : "video/mp4";
  const stat = fs.statSync(exportPath);
  const download = new URL(request.url).searchParams.has("download");
  const disposition = download
    ? `attachment; filename="composition-${compositionId}.${ext}"`
    : "inline";

  const range = request.headers.get("range");
  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : stat.size - 1;
    const chunk = fs.readFileSync(exportPath).subarray(start, end + 1);
    return new NextResponse(new Uint8Array(chunk), {
      status: 206,
      headers: {
        "Content-Type": mime,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunk.length),
        "Content-Disposition": disposition,
      },
    });
  }
  return new NextResponse(new Uint8Array(fs.readFileSync(exportPath)), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Content-Disposition": disposition,
    },
  });
}
