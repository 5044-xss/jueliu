import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSegmentRefUpload } from "@core/server/ref-uploads";
import { projectExists } from "@core/server/projects";

type Ctx = {
  params: Promise<{ id: string; segmentId: string; uploadId: string }>;
};

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(_request: Request, { params }: Ctx) {
  const { id, segmentId, uploadId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const upload = getSegmentRefUpload(id, segmentId, uploadId);
  if (
    !upload ||
    !fs.existsSync(/* turbopackIgnore: true */ upload.imagePath)
  ) {
    return NextResponse.json({ error: "参考图不存在" }, { status: 404 });
  }
  const ext = path.extname(upload.imagePath).slice(1).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "image/png";
  return new NextResponse(
    new Uint8Array(
      fs.readFileSync(/* turbopackIgnore: true */ upload.imagePath),
    ),
    {
      headers: { "Content-Type": mime, "Cache-Control": "no-store" },
    },
  );
}
