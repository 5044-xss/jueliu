import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteProject,
  getProject,
  updateProject,
} from "@/lib/projects";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  style: z.string().optional(),
  styleId: z.string().nullable().optional(),
  aspectRatio: z.string().optional(),
  defaultSegmentMs: z.number().int().positive().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({ project });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const project = updateProject(id, parsed.data);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return NextResponse.json({ project });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  deleteProject(id);
  return NextResponse.json({ ok: true });
}
