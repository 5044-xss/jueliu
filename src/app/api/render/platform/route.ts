import { NextResponse } from "next/server";
import { z } from "zod";
import { renderSegment } from "@core/server/render";

const bodySchema = z.object({
  projectId: z.string(),
  segmentId: z.string(),
  platform: z.string().default("doubao"),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const rendered = renderSegment(
    parsed.data.projectId,
    parsed.data.segmentId,
    parsed.data.platform,
  );
  if (!rendered) {
    return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  }
  return NextResponse.json(rendered);
}
