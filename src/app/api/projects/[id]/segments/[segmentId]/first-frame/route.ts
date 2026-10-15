import { NextResponse } from "next/server";
import { z } from "zod";
import { setSegmentFirstFrame } from "@/lib/frames";
import { getProjectDb } from "@/lib/db";
import { projectExists } from "@/lib/projects";

const putSchema = z.object({ frameId: z.string().nullable() });

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

export async function PUT(request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const db = getProjectDb(id);
  const exists = db
    .prepare("SELECT id FROM segment WHERE id = ?")
    .get(segmentId);
  if (!exists) {
    return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  }
  setSegmentFirstFrame(id, segmentId, parsed.data.frameId);
  return NextResponse.json({ ok: true });
}
