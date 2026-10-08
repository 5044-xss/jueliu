import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createProjectGroup,
  deleteProjectGroup,
  listProjectGroups,
  renameProjectGroup,
} from "@/lib/projects";

const nameSchema = z.object({
  name: z.string().min(1, "分组名不能为空"),
});

const renameSchema = z.object({
  name: z.string().min(1, "分组名不能为空"),
  newName: z.string().min(1, "新分组名不能为空"),
});

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  return NextResponse.json({ groups: listProjectGroups() });
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = nameSchema.safeParse(json);
  if (!parsed.success) {
    return bad(parsed.error.issues[0]?.message ?? "参数不合法");
  }
  return NextResponse.json(
    { groups: createProjectGroup(parsed.data.name) },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = renameSchema.safeParse(json);
  if (!parsed.success) {
    return bad(parsed.error.issues[0]?.message ?? "参数不合法");
  }
  return NextResponse.json({
    groups: renameProjectGroup(parsed.data.name, parsed.data.newName),
  });
}

export async function DELETE(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = nameSchema.safeParse(json);
  if (!parsed.success) {
    return bad(parsed.error.issues[0]?.message ?? "参数不合法");
  }
  return NextResponse.json({ groups: deleteProjectGroup(parsed.data.name) });
}
