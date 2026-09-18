import { NextResponse } from "next/server";
import { z } from "zod";
import {
  updateSkill,
  setDefaultSkill,
  deleteSkill,
} from "@/lib/library/skills";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  isDefault: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const { isDefault, ...rest } = parsed.data;
  let skill = null;
  if (Object.keys(rest).length > 0) {
    skill = updateSkill(id, rest);
    if (!skill) {
      return NextResponse.json({ error: "技能不存在" }, { status: 404 });
    }
  }
  if (isDefault) {
    skill = setDefaultSkill(id);
    if (!skill) {
      return NextResponse.json({ error: "技能不存在" }, { status: 404 });
    }
  }
  return NextResponse.json({ skill });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = deleteSkill(id);
  if (!ok) {
    return NextResponse.json({ error: "技能不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
