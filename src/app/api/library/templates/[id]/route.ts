import { NextResponse } from "next/server";
import { z } from "zod";
import { updateTemplate, deleteTemplate } from "@/lib/library/templates";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  version: z.string().optional(),
  bodyTemplate: z.string().optional(),
  paramsTemplate: z.string().optional(),
  legendTemplate: z.string().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const template = updateTemplate(id, parsed.data);
  if (!template) {
    return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  }
  return NextResponse.json({ template });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = deleteTemplate(id);
  if (!ok) {
    return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
