import { NextResponse } from "next/server";
import { getTestPipelineState } from "@core/server/pipeline-test";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const state = getTestPipelineState({
      segmentId: url.searchParams.get("segmentId"),
      platform: url.searchParams.get("platform"),
    });
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "读取调试状态失败" },
      { status: 500 },
    );
  }
}
