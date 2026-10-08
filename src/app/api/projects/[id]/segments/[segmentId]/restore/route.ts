import { NextResponse } from "next/server";
import { restoreSegment } from "@/lib/storyboard";
import { getAssets } from "@/lib/assets";
import { projectExists } from "@/lib/projects";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const count = restoreSegment(id, segmentId, getAssets(id));
  return NextResponse.json({ restored: count });
}
