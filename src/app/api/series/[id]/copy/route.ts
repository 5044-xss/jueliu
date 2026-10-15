import { NextResponse } from "next/server";
import { z } from "zod";
import { copySeries } from "@/lib/projects";

const copySchema = z.object({
  name: z.string().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const json = await request.json().catch(() => ({}));
  const parsed = copySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  try {
    const series = await copySeries(id, parsed.data.name);
    return NextResponse.json({ series }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "复制失败" },
      { status: 400 },
    );
  }
}
