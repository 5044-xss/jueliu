import { NextResponse } from "next/server";
import { getStoryboard, clearStoryboard } from "@/lib/storyboard";
import { validateContinuity } from "@/lib/continuity";
import { autoAnchorSegments } from "@/lib/frames";
import { projectExists } from "@/lib/projects";
import { startJob, finishJob } from "@/lib/jobs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({
    scenes: getStoryboard(id),
    warnings: validateContinuity(id),
  });
}

export async function POST(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const jobId = startJob(id, "anchor");
  try {
    const result = await autoAnchorSegments(id);
    finishJob(id, jobId, "succeeded");
    return NextResponse.json({
      ...result,
      scenes: getStoryboard(id),
      warnings: validateContinuity(id),
    });
  } catch (error) {
    finishJob(id, jobId, "failed", (error as Error).message);
    return NextResponse.json(
      { error: (error as Error).message || "批量锚定失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  clearStoryboard(id);
  return NextResponse.json({ ok: true });
}
