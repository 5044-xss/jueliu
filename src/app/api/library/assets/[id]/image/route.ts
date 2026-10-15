import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  findLibraryAsset,
  getLibraryAssetImagePath,
  type AssetLibraryScope,
} from "@/lib/library/assets";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  const url = new URL(request.url);
  const raw = url.searchParams.get("scope") ?? "global";
  const seriesId = url.searchParams.get("seriesId");
  if (raw !== "global" && raw !== "project") {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  if (raw === "project" && !seriesId) {
    return NextResponse.json({ error: "缺少项目标识" }, { status: 400 });
  }
  const scope = raw as AssetLibraryScope;
  const item = findLibraryAsset(
    scope,
    scope === "global" ? null : seriesId,
    id,
  );
  if (!item) return NextResponse.json({ error: "资源不存在" }, { status: 404 });
  const p = getLibraryAssetImagePath(item);
  if (!fs.existsSync(p)) {
    return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  }
  const ext = path.extname(p).slice(1).toLowerCase();
  const buffer = fs.readFileSync(p);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
