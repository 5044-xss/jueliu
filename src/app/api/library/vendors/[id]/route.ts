import { NextResponse } from "next/server";
import { z } from "zod";
import { updateVendor, deleteVendor, getVendors } from "@core/server/library/vendors";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  platform: z.string().optional(),
  maxShotsPerSegment: z.number().int().optional(),
  supportMultiShot: z.boolean().optional(),
  maxRefImages: z.number().int().optional(),
  minSegmentMs: z.number().int().optional(),
  maxSegmentMs: z.number().int().optional(),
  durationStepMs: z.number().int().optional(),
  supportFirstFrame: z.boolean().optional(),
  supportLastFrame: z.boolean().optional(),
  note: z.string().optional(),
  compilePrompt: z.string().optional(),
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
  const vendor = updateVendor(id, parsed.data);
  if (!vendor) {
    return NextResponse.json({ error: "厂商不存在" }, { status: 404 });
  }
  return NextResponse.json({ vendor });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const target = getVendors().find((v) => v.id === id);
  if (!target) {
    return NextResponse.json({ error: "厂商不存在" }, { status: 404 });
  }
  if (target.builtin) {
    return NextResponse.json({ error: "内置厂商不可删除" }, { status: 400 });
  }
  const ok = deleteVendor(id);
  if (!ok) {
    return NextResponse.json({ error: "删除失败" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
