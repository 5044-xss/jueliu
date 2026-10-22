import { NextResponse } from "next/server";
import { z } from "zod";
import { updateStyle, deleteStyle } from "@core/server/library/styles";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().optional(),
  videoStyle: z.string().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const style = updateStyle(id, parsed.data);
  if (!style) {
    return NextResponse.json({ error: "风格不存在" }, { status: 404 });
  }
  return NextResponse.json({ style });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = deleteStyle(id);
  if (!ok) {
    return NextResponse.json({ error: "风格不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
