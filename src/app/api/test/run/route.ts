import { NextResponse } from "next/server";
import { z } from "zod";
import { runTestPipeline } from "@core/server/pipeline-test";

export const maxDuration = 300;

const bodySchema = z.object({
  scriptText: z.string().min(1, "剧本不能为空"),
  styleId: z.string().nullish(),
  aspectRatio: z.string().optional(),
  vendor: z.string().optional(),
  defaultSegmentMs: z.number().int().optional(),
  platform: z.string().optional(),
  compile: z.boolean().optional(),
  segmentId: z.string().nullish(),
  extraInstructions: z.string().optional(),
});

// 调试台：剧本 → LLM 分镜 → 编排 →（可选）编译首段，全部落在沙盒项目里。
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数不合法" },
      { status: 400 },
    );
  }
  try {
    const state = await runTestPipeline(parsed.data);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "生成分镜失败" },
      { status: 500 },
    );
  }
}
