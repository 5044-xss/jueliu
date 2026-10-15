import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmFrame, deleteFrame } from "@/lib/frames";
import { getProjectDb } from "@/lib/db";
import { projectExists } from "@/lib/projects";

const patchSchema = z.object({ confirmed: z.boolean() });

type Ctx = { params: Promise<{ id: string; frameId: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, frameId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const db = getProjectDb(id);
  const exists = db
    .prepare(
      `SELECT f.id FROM frame f
       JOIN segment s ON f.segment_id = s.id
       WHERE f.id = ? AND s.project_id = ?`,
    )
    .get(frameId, id);
  if (!exists) {
    return NextResponse.json({ error: "帧不存在" }, { status: 404 });
  }
  confirmFrame(id, frameId, parsed.data.confirmed);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, frameId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  if (!deleteFrame(id, frameId)) {
    return NextResponse.json({ error: "帧不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
