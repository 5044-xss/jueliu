import { NextResponse } from "next/server";
import { deleteComposition, getComposition } from "@core/server/compose";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; compositionId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id, compositionId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const composition = getComposition(id, compositionId);
  if (!composition) {
    return NextResponse.json({ error: "合成记录不存在" }, { status: 404 });
  }
  return NextResponse.json({ composition });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, compositionId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  if (!getComposition(id, compositionId)) {
    return NextResponse.json({ error: "合成记录不存在" }, { status: 404 });
  }
  deleteComposition(id, compositionId);
  return NextResponse.json({ ok: true });
}
