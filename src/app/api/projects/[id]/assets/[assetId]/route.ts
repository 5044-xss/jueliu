import { NextResponse } from "next/server";
import { z } from "zod";
import { updateAsset, deleteAsset } from "@/lib/assets";
import { projectExists } from "@/lib/projects";

type Ctx = { params: Promise<{ id: string; assetId: string }> };

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  basePrompt: z.string().optional(),
});

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, assetId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const ok = updateAsset(id, assetId, parsed.data);
  if (!ok) return NextResponse.json({ error: "资产不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, assetId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const ok = deleteAsset(id, assetId);
  if (!ok) return NextResponse.json({ error: "资产不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
