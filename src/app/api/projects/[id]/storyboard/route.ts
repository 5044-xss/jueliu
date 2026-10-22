import { NextResponse } from "next/server";
import { getStoryboard, clearStoryboard } from "@core/server/storyboard";
import { preflightStoryboard } from "@core/server/preflight";
import { getLatestQcByProject, getQcSummary } from "@core/server/qc";
import { projectExists } from "@core/server/projects";
import { cancelProjectGeneration } from "@/lib/generation/cancel";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const scenes = getStoryboard(id);
  return NextResponse.json({
    scenes,
    preflight: preflightStoryboard(id, scenes),
    qc: getLatestQcByProject(id),
    qcSummary: getQcSummary(id),
  });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  cancelProjectGeneration(id);
  clearStoryboard(id);
  return NextResponse.json({ ok: true });
}
