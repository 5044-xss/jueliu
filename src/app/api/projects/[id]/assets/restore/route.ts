import { NextResponse } from "next/server";
import { z } from "zod";
import { restoreAssets } from "@/lib/assets";
import { projectExists } from "@/lib/projects";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  assetId: z.string().optional(),
  variantId: z.string().optional(),
  viewId: z.string().optional(),
});

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  return NextResponse.json({ assets: restoreAssets(id, parsed.data) });
}
