import { NextResponse } from "next/server";
import { z } from "zod";
import { blockingSchema } from "@core/shared/schemas/storyboard";
import { saveSceneBlocking } from "@core/server/storyboard";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; sceneId: string }> };

const patchSchema = z.object({
  blocking: blockingSchema,
});

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, sceneId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const ok = saveSceneBlocking(id, sceneId, parsed.data.blocking);
  if (!ok) return NextResponse.json({ error: "场次不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
