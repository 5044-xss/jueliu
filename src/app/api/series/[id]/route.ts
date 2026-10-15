import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteSeries,
  getEpisodeThumbnail,
  getSeries,
  listEpisodes,
  renameSeries,
} from "@/lib/projects";

const renameSchema = z.object({
  name: z.string().min(1, "项目名不能为空"),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const series = getSeries(id);
  if (!series) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const episodes = listEpisodes(id).map((e) => ({
    ...e,
    thumbnail: getEpisodeThumbnail(e.id),
  }));
  return NextResponse.json({ series, episodes });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = renameSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数不合法" },
      { status: 400 },
    );
  }
  const series = renameSeries(id, parsed.data.name);
  if (!series) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({ series });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getSeries(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  deleteSeries(id);
  return NextResponse.json({ ok: true });
}
