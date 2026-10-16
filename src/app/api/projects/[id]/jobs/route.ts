import { NextResponse } from "next/server";
import { getProjectJobs } from "@core/server/jobs";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({ jobs: getProjectJobs(id) });
}
