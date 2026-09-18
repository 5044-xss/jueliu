import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmFrame } from "@/lib/frames";
import { getProjectDb } from "@/lib/db";

const patchSchema = z.object({ confirmed: z.boolean() });

type Ctx = { params: Promise<{ id: string; frameId: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, frameId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const db = getProjectDb(id);
  const exists = db.prepare("SELECT id FROM frame WHERE id = ?").get(frameId);
  if (!exists) {
    return NextResponse.json({ error: "帧不存在" }, { status: 404 });
  }
  confirmFrame(id, frameId, parsed.data.confirmed);
  return NextResponse.json({ ok: true });
}
