import { NextResponse } from "next/server";
import { z } from "zod";
import { getStory, saveStory, projectExists } from "@/lib/projects";

const putSchema = z.object({ content: z.string() });

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json(getStory(id));
}

export async function PUT(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  saveStory(id, parsed.data.content);
  return NextResponse.json({ ok: true });
}
