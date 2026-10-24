import { NextResponse } from "next/server";
import {
  composeSegments,
  listComposableSegments,
  listCompositions,
} from "@core/server/compose";
import { projectExists } from "@core/server/projects";
import { startJob, finishJob } from "@core/server/jobs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({
    segments: listComposableSegments(id),
    compositions: listCompositions(id),
  });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const segmentIds = Array.isArray(body?.segmentIds)
    ? (body.segmentIds as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : [];
  if (segmentIds.length === 0) {
    return NextResponse.json({ error: "请至少选择一个段落" }, { status: 400 });
  }

  const jobId = startJob(id, "compose");
  try {
    const composition = await composeSegments(id, {
      segmentIds,
      transition: typeof body?.transition === "string" ? body.transition : undefined,
      transitionMs:
        typeof body?.transitionMs === "number" ? body.transitionMs : undefined,
      name: typeof body?.name === "string" ? body.name : undefined,
      subtitles: body?.subtitles === true,
    });
    finishJob(id, jobId, "succeeded");
    return NextResponse.json({
      composition,
      compositions: listCompositions(id),
    });
  } catch (error) {
    const message = (error as Error).message || "合成失败";
    finishJob(id, jobId, "failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
