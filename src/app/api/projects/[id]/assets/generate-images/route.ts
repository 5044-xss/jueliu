import { NextResponse } from "next/server";
import { ensureCore } from "@/lib/bootstrap";
import { projectExists } from "@core/server/projects";
import { submitAllAssetImages } from "@/lib/generation/asset";

type Ctx = { params: Promise<{ id: string }> };

// 一键出图：为项目（或指定资产）下所有视图提交生成。body: { assetId?, onlyMissing? }
export async function POST(request: Request, { params }: Ctx) {
  ensureCore();
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { assetId?: string; onlyMissing?: boolean };
  try {
    const result = await submitAllAssetImages(id, { assetId: body.assetId, onlyMissing: body.onlyMissing });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
