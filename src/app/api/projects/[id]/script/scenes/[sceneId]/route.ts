import { NextResponse } from "next/server";
import { updateScene, getStoredScript } from "@core/server/script";
import { sceneSchema } from "@core/shared/schemas/script";

const patchSchema = sceneSchema.partial();

type Ctx = { params: Promise<{ id: string; sceneId: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, sceneId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  try {
    updateScene(id, sceneId, parsed.data);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 404 },
    );
  }
  return NextResponse.json({ script: getStoredScript(id) });
}
