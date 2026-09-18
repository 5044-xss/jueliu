import { NextResponse } from "next/server";
import { z } from "zod";
import { getStyles, createStyle } from "@/lib/library/styles";

const createSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  prompt: z.string().default(""),
});

export async function GET() {
  return NextResponse.json({ styles: getStyles() });
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
  return NextResponse.json({ style: createStyle(parsed.data) }, { status: 201 });
}
