import { NextResponse } from "next/server";
import {
  deleteLibraryAsset,
  type AssetLibraryScope,
} from "@/lib/library/assets";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Ctx) {
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
  const ok = deleteLibraryAsset(
    scope,
    scope === "global" ? null : seriesId,
    id,
  );
  if (!ok) return NextResponse.json({ error: "资源不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
