import { NextResponse } from "next/server";
import { ensureCore } from "@/lib/bootstrap";
import { projectExists } from "@core/server/projects";
import { getViewContext } from "@core/server/assets";
import { submitAssetViewImage } from "@/lib/generation/asset";

type Ctx = { params: Promise<{ id: string; viewId: string }> };

// 提交单个资产视图出图（Toapi）。立即返回 taskId，进度看 job 表。
export async function POST(_request: Request, { params }: Ctx) {
  ensureCore();
  const { id, viewId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  if (!getViewContext(id, viewId)) {
    return NextResponse.json({ error: "视角不存在" }, { status: 404 });
  }
  try {
    const result = await submitAssetViewImage(id, viewId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
