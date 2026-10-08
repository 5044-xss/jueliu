import { NextResponse } from "next/server";
import { getContinuityRules } from "@/lib/storyboard";
import { validateContinuity } from "@/lib/continuity";
import { projectExists } from "@/lib/projects";

type Ctx = { params: Promise<{ id: string }> };

// 连续性规则为内部固定全开，不再由用户开关；这里只返回校验结果。
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({
    rules: getContinuityRules(),
    warnings: validateContinuity(id),
  });
}
