import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createStoryboardStrategy,
  getStoryboardStrategies,
} from "@core/server/library/storyboard-strategies";

const createSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  description: z.string().optional().default(""),
  params: z.record(z.string(), z.unknown()).optional(),
  texts: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  return NextResponse.json({ strategies: getStoryboardStrategies() });
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
  const strategy = createStoryboardStrategy({
    name: parsed.data.name,
    description: parsed.data.description,
    params: parsed.data.params as never,
    texts: parsed.data.texts as never,
  });
  return NextResponse.json({ strategy }, { status: 201 });
}
