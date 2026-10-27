import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteStoryboardStrategy,
  getStoryboardStrategies,
  setDefaultStoryboardStrategy,
  updateStoryboardStrategy,
} from "@core/server/library/storyboard-strategies";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  texts: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const { isDefault, params: paramsPatch, texts, ...rest } = parsed.data;
  let strategy = null;
  if (Object.keys(rest).length > 0 || paramsPatch || texts) {
    strategy = updateStoryboardStrategy(id, {
      ...rest,
      params: paramsPatch as never,
      texts: texts as never,
    });
    if (!strategy) {
      return NextResponse.json({ error: "策略包不存在" }, { status: 404 });
    }
  }
  if (isDefault) {
    strategy = setDefaultStoryboardStrategy(id);
    if (!strategy) {
      return NextResponse.json({ error: "策略包不存在" }, { status: 404 });
    }
  }
  return NextResponse.json({ strategy });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const target = getStoryboardStrategies().find((item) => item.id === id);
  if (!target) {
    return NextResponse.json({ error: "策略包不存在" }, { status: 404 });
  }
  if (target.builtin) {
    return NextResponse.json({ error: "内置策略包不可删除" }, { status: 400 });
  }
  if (!deleteStoryboardStrategy(id)) {
    return NextResponse.json({ error: "删除失败" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
