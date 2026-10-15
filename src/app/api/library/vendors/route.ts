import { NextResponse } from "next/server";
import { z } from "zod";
import { getVendors, createVendor } from "@/lib/library/vendors";

const createSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  platform: z.string().optional(),
  note: z.string().optional(),
});

export async function GET() {
  return NextResponse.json({ vendors: getVendors() });
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
    { vendor: createVendor({ name: parsed.data.name, platform: parsed.data.platform, note: parsed.data.note }) },
    { status: 201 },
  );
}
