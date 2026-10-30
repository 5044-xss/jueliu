import { NextResponse } from "next/server";
import { getStoredScript } from "@core/server/script";
import { getProjectDb } from "@core/server/db";
import { clearAssets } from "@core/server/assets";
import { clearStoryboard } from "@core/server/storyboard";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({ script: getStoredScript(id) });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  getProjectDb(id).prepare("DELETE FROM script WHERE project_id = ?").run(id);
  // 失效级联：剧本清空 → 下游资产、分镜一并清空。
  clearAssets(id);
  clearStoryboard(id);
  return NextResponse.json({ ok: true });
}
