import { NextResponse } from "next/server";
import { z } from "zod";
import { createSeries, listSeriesWithCounts } from "@/lib/projects";

const createSchema = z.object({
  name: z.string().min(1, "项目名不能为空"),
});

export async function GET() {
  return NextResponse.json({ series: listSeriesWithCounts() });
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数不合法" },
      { status: 400 },
    );
  }
  const series = createSeries(parsed.data.name);
  return NextResponse.json({ series }, { status: 201 });
}
