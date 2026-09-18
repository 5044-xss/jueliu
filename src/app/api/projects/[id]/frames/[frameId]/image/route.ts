import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getFrameImagePath } from "@/lib/frames";

type Ctx = { params: Promise<{ id: string; frameId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id, frameId } = await params;
  const imagePath = getFrameImagePath(id, frameId);
  if (!imagePath || !fs.existsSync(imagePath)) {
    return NextResponse.json({ error: "帧图不存在" }, { status: 404 });
  }
  const ext = path.extname(imagePath).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  return new NextResponse(new Uint8Array(fs.readFileSync(imagePath)), {
    headers: { "Content-Type": mime, "Cache-Control": "no-store" },
  });
}
