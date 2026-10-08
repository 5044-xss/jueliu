import { NextResponse } from "next/server";
import { z } from "zod";
import { createVariant } from "@/lib/assets";
import { projectExists } from "@/lib/projects";

type Ctx = { params: Promise<{ id: string; assetId: string }> };

const bodySchema = z.object({
  label: z.string().min(1),
  prompt: z.string().optional().default(""),
});

export async function POST(request: Request, { params }: Ctx) {
  const { id, assetId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const asset = createVariant(id, assetId, parsed.data);
  if (!asset) {
    return NextResponse.json({ error: "资产不存在" }, { status: 404 });
  }
  return NextResponse.json({ asset });
}
