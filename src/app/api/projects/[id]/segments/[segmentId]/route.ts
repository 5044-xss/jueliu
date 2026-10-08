import { NextResponse } from "next/server";
import { z } from "zod";
import { setSegmentHardCut, setSegmentTargetMs } from "@/lib/storyboard";
import { projectExists } from "@/lib/projects";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

const patchSchema = z.object({
  hardCut: z.boolean().optional(),
  targetMs: z.number().int().nonnegative().optional(),
});

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  if (parsed.data.hardCut !== undefined) {
    const ok = setSegmentHardCut(id, segmentId, parsed.data.hardCut);
    if (!ok) return NextResponse.json({ error: "段不存在" }, { status: 404 });
  }
  if (parsed.data.targetMs !== undefined) {
    const ok = setSegmentTargetMs(id, segmentId, parsed.data.targetMs);
    if (!ok) return NextResponse.json({ error: "段不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
