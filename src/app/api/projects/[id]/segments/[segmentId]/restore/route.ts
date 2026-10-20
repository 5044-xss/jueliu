import { NextResponse } from "next/server";
import { restoreSegment } from "@core/server/storyboard";
import { getAssets } from "@core/server/assets";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const count = restoreSegment(id, segmentId, getAssets(id));
  return NextResponse.json({ restored: count });
}
