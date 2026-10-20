import { NextResponse } from "next/server";
import { getStartFrameState } from "@core/server/keyframe";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const state = getStartFrameState(id, segmentId);
  if (!state) {
    return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  }
  return NextResponse.json(state);
}
