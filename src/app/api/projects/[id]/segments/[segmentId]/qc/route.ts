import { NextResponse } from "next/server";
import { getProject } from "@core/server/projects";
import {
  getLatestQcByProject,
  getLatestSegmentQc,
  runSegmentQc,
} from "@core/server/qc";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!getProject(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({
    qc: getLatestSegmentQc(id, segmentId),
    all: getLatestQcByProject(id),
  });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!getProject(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    const qc = await runSegmentQc({
      projectId: id,
      segmentId,
      videoPath: typeof body?.videoPath === "string" ? body.videoPath : undefined,
      extractFrames: body?.extractFrames !== false,
    });
    return NextResponse.json({ qc });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "QC 失败" },
      { status: 422 },
    );
  }
}
