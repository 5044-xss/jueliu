import { NextResponse } from "next/server";
import { getAssets, saveAssetDrafts } from "@/lib/assets";
import { getProjectDb } from "@/lib/db";
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
  return NextResponse.json({ assets: saveAssetDrafts(id, parsed.data.assets) });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  getProjectDb(id).prepare("DELETE FROM asset WHERE project_id = ?").run(id);
  return NextResponse.json({ ok: true });
}
