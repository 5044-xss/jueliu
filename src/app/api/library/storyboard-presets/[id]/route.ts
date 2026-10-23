import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteStoryboardPreset,
  getStoryboardPresets,
  setDefaultStoryboardPreset,
  updateStoryboardPreset,
} from "@core/server/library/storyboard-presets";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
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
  const { isDefault, config, ...rest } = parsed.data;
  let preset = null;
  if (Object.keys(rest).length > 0 || config) {
    preset = updateStoryboardPreset(id, {
      ...rest,
      config: config as never,
    });
    if (!preset) {
      return NextResponse.json({ error: "预设不存在" }, { status: 404 });
    }
  }
  if (isDefault) {
    preset = setDefaultStoryboardPreset(id);
    if (!preset) {
      return NextResponse.json({ error: "预设不存在" }, { status: 404 });
    }
  }
  return NextResponse.json({ preset });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const target = getStoryboardPresets().find((item) => item.id === id);
  if (!target) {
    return NextResponse.json({ error: "预设不存在" }, { status: 404 });
  }
  if (target.builtin) {
    return NextResponse.json({ error: "内置预设不可删除" }, { status: 400 });
  }
  if (!deleteStoryboardPreset(id)) {
    return NextResponse.json({ error: "删除失败" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
