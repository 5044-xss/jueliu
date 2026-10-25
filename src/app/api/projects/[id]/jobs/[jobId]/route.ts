import { NextResponse } from "next/server";
import { deleteJob } from "@core/server/jobs";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, jobId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  if (!deleteJob(id, jobId)) {
    return NextResponse.json({ error: "任务不存在或仍在运行" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
