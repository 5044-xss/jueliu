import { NextResponse } from "next/server";
import { getStoredScript } from "@/lib/script";
import { getProjectDb } from "@/lib/db";
import { projectExists } from "@/lib/projects";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({ script: getStoredScript(id) });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  getProjectDb(id).prepare("DELETE FROM script WHERE project_id = ?").run(id);
  return NextResponse.json({ ok: true });
}
