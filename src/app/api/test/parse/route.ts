import { NextResponse } from "next/server";
import { z } from "zod";
import { parseTestScript } from "@core/server/pipeline-test";

const bodySchema = z.object({ scriptText: z.string().min(1) });

// 只解析剧本，不落库、不调用 LLM；供调试台第 0 步预览结构化结果。
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "剧本不能为空" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      script: parseTestScript(parsed.data.scriptText),
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "剧本解析失败" },
      { status: 400 },
    );
  }
}
