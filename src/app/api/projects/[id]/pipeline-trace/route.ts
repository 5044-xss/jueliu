import { NextResponse } from "next/server";
import { getLatestGenerationSnapshot } from "@core/server/generation-snapshot";
import { buildPipelineTrace } from "@core/server/pipeline-trace";
import { projectExists } from "@core/server/projects";
import { getStoredScript } from "@core/server/script";

type Ctx = { params: Promise<{ id: string }> };

// 项目内的「分镜执行记录」：读取当前分镜链路的逐步输入/输出（只读）。
export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const url = new URL(request.url);
  try {
    const trace = buildPipelineTrace(id, {
      segmentId: url.searchParams.get("segmentId"),
      platform: url.searchParams.get("platform"),
    });
    return NextResponse.json({
      trace,
      script: getStoredScript(id),
      snapshot: trace.segmentId
        ? getLatestGenerationSnapshot(id, trace.segmentId)
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "读取执行记录失败" },
      { status: 500 },
    );
  }
}
