import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getFrameImagePath } from "@core/server/frames";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; frameId: string }> };

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(_request: Request, { params }: Ctx) {
  const { id, frameId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const imagePath = getFrameImagePath(id, frameId);
  if (!imagePath || !fs.existsSync(imagePath)) {
    return NextResponse.json({ error: "帧图不存在" }, { status: 404 });
  }
  const ext = path.extname(imagePath).slice(1).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "image/png";
  return new NextResponse(new Uint8Array(fs.readFileSync(imagePath)), {
    headers: { "Content-Type": mime, "Cache-Control": "no-store" },
  });
}
