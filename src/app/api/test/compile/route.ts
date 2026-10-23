import { NextResponse } from "next/server";
import { z } from "zod";
import { compileTestSegment } from "@core/server/pipeline-test";

export const maxDuration = 300;

const bodySchema = z.object({
  segmentId: z.string().min(1),
  platform: z.string().optional(),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  try {
    const state = await compileTestSegment(
      parsed.data.segmentId,
      parsed.data.platform,
    );
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "编译失败" },
      { status: 500 },
    );
  }
}
