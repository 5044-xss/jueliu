import { NextResponse } from "next/server";
import { getStoryboard, clearStoryboard } from "@/lib/storyboard";
import { projectExists } from "@/lib/projects";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({ scenes: getStoryboard(id) });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  clearStoryboard(id);
  return NextResponse.json({ ok: true });
}
