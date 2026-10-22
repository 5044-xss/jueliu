import { NextResponse } from "next/server";
import { getLatestGenerationSnapshot } from "@core/server/generation-snapshot";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

// 最近一次视频生成实际使用的提示词快照（只读）。
export async function GET(_request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({
    snapshot: getLatestGenerationSnapshot(id, segmentId),
  });
}
