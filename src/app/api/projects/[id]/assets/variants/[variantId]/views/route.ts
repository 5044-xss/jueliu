import { NextResponse } from "next/server";
import { z } from "zod";
import { createView } from "@core/server/assets";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; variantId: string }> };

const bodySchema = z.object({
  label: z.string().min(1),
  prompt: z.string().optional().default(""),
});

export async function POST(request: Request, { params }: Ctx) {
  const { id, variantId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const variant = createView(id, variantId, parsed.data);
  if (!variant) {
    return NextResponse.json({ error: "变体不存在" }, { status: 404 });
  }
  return NextResponse.json({ variant });
}
