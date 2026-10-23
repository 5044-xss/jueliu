import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createStoryboardPreset,
  getStoryboardPresets,
} from "@core/server/library/storyboard-presets";

const createSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  description: z.string().optional().default(""),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  return NextResponse.json({ presets: getStoryboardPresets() });
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
  const preset = createStoryboardPreset({
    name: parsed.data.name,
    description: parsed.data.description,
    config: parsed.data.config as never,
  });
  return NextResponse.json({ preset }, { status: 201 });
}
