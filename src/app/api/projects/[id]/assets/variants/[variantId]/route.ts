import { NextResponse } from "next/server";
import { z } from "zod";
import { updateVariant, deleteVariant } from "@core/server/assets";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; variantId: string }> };

const patchSchema = z.object({
  label: z.string().min(1).optional(),
  prompt: z.string().optional(),
});

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, variantId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const ok = updateVariant(id, variantId, parsed.data);
  if (!ok) return NextResponse.json({ error: "变体不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, variantId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const ok = deleteVariant(id, variantId);
  if (!ok) return NextResponse.json({ error: "变体不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
