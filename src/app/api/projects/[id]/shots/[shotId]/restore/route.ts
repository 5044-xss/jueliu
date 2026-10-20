import { NextResponse } from "next/server";
import { restoreShot } from "@core/server/storyboard";
import { getAssets } from "@core/server/assets";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; shotId: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  const { id, shotId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const ok = restoreShot(id, shotId, getAssets(id));
  if (!ok) {
    return NextResponse.json({ error: "没有可还原的原始分镜" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
