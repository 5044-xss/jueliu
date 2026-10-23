import { NextResponse } from "next/server";
import { z } from "zod";
import { createEpisode, getSeries, listEpisodes } from "@core/server/projects";

const createSchema = z.object({
  name: z.string().min(1, "子集名不能为空"),
  style: z.string().optional(),
  videoStyle: z.string().optional(),
  styleId: z.string().nullable().optional(),
  aspectRatio: z.string().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getSeries(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({ episodes: listEpisodes(id) });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getSeries(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数不合法" },
      { status: 400 },
    );
  }
  const project = createEpisode(id, parsed.data);
  return NextResponse.json({ project }, { status: 201 });
}
