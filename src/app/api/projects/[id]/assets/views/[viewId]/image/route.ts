import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  getViewContext,
  getViewImagePath,
  setViewImage,
} from "@/lib/assets";
import { getAssetViewPath } from "@/lib/paths";
import { projectExists } from "@/lib/projects";

type Ctx = { params: Promise<{ id: string; viewId: string }> };

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function GET(_request: Request, { params }: Ctx) {
  const { id, viewId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const imagePath = getViewImagePath(id, viewId);
  if (!imagePath || !fs.existsSync(imagePath)) {
    return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  }
  const ext = path.extname(imagePath).slice(1).toLowerCase();
  const buffer = fs.readFileSync(imagePath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id, viewId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const ctx = getViewContext(id, viewId);
  if (!ctx) {
    return NextResponse.json({ error: "视角不存在" }, { status: 404 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }
  const ext = EXT_BY_MIME[file.type] ?? "png";
  const dest = getAssetViewPath(id, ctx.assetId, ctx.variantId, viewId, ext);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  // 先写临时文件再原子替换，避免写失败时丢失旧图。
  const tmp = `${dest}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, Buffer.from(await file.arrayBuffer()));
  fs.renameSync(tmp, dest);

  const previous = getViewImagePath(id, viewId);
  if (previous && previous !== dest && fs.existsSync(previous)) {
    fs.rmSync(previous, { force: true });
  }
  setViewImage(id, viewId, dest);
  return NextResponse.json({ imagePath: dest });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, viewId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const previous = getViewImagePath(id, viewId);
  if (previous && fs.existsSync(previous)) fs.rmSync(previous, { force: true });
  setViewImage(id, viewId, null);
  return NextResponse.json({ ok: true });
}
