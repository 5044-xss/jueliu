import { NextResponse } from "next/server";
import { z } from "zod";
import { copyGlobalLibraryAsset } from "@core/server/library/assets";
import { getSeries } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  seriesId: z.string().min(1),
});

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "缺少项目标识" }, { status: 400 });
  }
  if (!getSeries(parsed.data.seriesId)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const result = copyGlobalLibraryAsset(id, parsed.data.seriesId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ item: result.item }, { status: 201 });
}
