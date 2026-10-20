import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureDefaultViews, getAssets } from "@core/server/assets";
import { projectExists } from "@core/server/projects";
import { assetTypeSchema } from "@core/shared/schemas/assets";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ type: assetTypeSchema.optional() });

// 一键补全默认视角：场景补「全景」、道具「正面」→「三视图」、角色补「四视图」。
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const changed = ensureDefaultViews(id, parsed.data.type);
  return NextResponse.json({ changed, assets: getAssets(id) });
}
