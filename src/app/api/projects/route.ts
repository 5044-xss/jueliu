import { NextResponse } from "next/server";
import { z } from "zod";
import { createProject, listProjectSummaries } from "@/lib/projects";

const createSchema = z.object({
  name: z.string().min(1, "项目名不能为空"),
  style: z.string().optional(),
  styleId: z.string().nullable().optional(),
  aspectRatio: z.string().optional(),
  defaultSegmentMs: z.number().int().positive().optional(),
});

export async function GET() {
  return NextResponse.json({ projects: listProjectSummaries() });
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
  const project = createProject(parsed.data);
  return NextResponse.json({ project }, { status: 201 });
}
