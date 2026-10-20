import { NextResponse } from "next/server";
import { z } from "zod";
import { getTemplates, createTemplate } from "@core/server/library/templates";
import { PLATFORM_LABELS } from "@core/shared/templates-defaults";

const createSchema = z.object({
  platform: z.string().min(1),
  name: z.string().min(1, "名称不能为空"),
});

export async function GET() {
  return NextResponse.json({
    templates: getTemplates(),
    platforms: PLATFORM_LABELS,
  });
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
  return NextResponse.json(
    { template: createTemplate(parsed.data) },
    { status: 201 },
  );
}
