import { NextResponse } from "next/server";
import { getAssets, saveAssetDrafts, clearAssets } from "@/lib/assets";
import { clearStoryboard } from "@/lib/storyboard";
import { projectExists } from "@/lib/projects";
import { assetsDraftSchema } from "@/lib/schemas/assets";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({ assets: getAssets(id) });
}

export async function PUT(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = assetsDraftSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const stored = saveAssetDrafts(id, parsed.data.assets);
  // 失效级联：资产变了 → 分镜引用失效，清空分镜。
  clearStoryboard(id);
  return NextResponse.json({ assets: stored });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  clearAssets(id);
  // 失效级联：资产清空 → 分镜引用失效，一并清空。
  clearStoryboard(id);
  return NextResponse.json({ ok: true });
}
