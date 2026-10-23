import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteProject,
  getProject,
  updateProject,
  projectExists,
} from "@core/server/projects";
import { stripStyleFromAssetPrompts, getAssets } from "@core/server/assets";
import { isVendorId } from "@core/server/library/vendors";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  style: z.string().optional(),
  videoStyle: z.string().optional(),
  styleId: z.string().nullable().optional(),
  aspectRatio: z.string().optional(),
  vendor: z.string().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "子集不存在" }, { status: 404 });
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
  if (parsed.data.vendor !== undefined && !isVendorId(parsed.data.vendor)) {
    return NextResponse.json({ error: "厂商参数不合法" }, { status: 400 });
  }
  const before = getProject(id);
  if (!before) {
    return NextResponse.json({ error: "子集不存在" }, { status: 404 });
  }
  // 风格锁：一旦按剧本生成过资产，就不再允许切换风格，否则素材与提示词风格会串。
  const touchingStyle =
    (parsed.data.style !== undefined && parsed.data.style !== before.style) ||
    (parsed.data.styleId !== undefined &&
      (parsed.data.styleId ?? null) !== before.styleId);
  if (touchingStyle && getAssets(id).length > 0) {
    return NextResponse.json(
      { error: "已按剧本生成资产，风格已锁定，不能再切换（避免素材风格串味）。如需换风格请新建项目。" },
      { status: 409 },
    );
  }
  const project = updateProject(id, parsed.data);
  if (!project) {
    return NextResponse.json({ error: "子集不存在" }, { status: 404 });
  }
  if (before.style !== project.style) {
    stripStyleFromAssetPrompts(id, before.style);
  }
  return NextResponse.json({ project });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "子集不存在" }, { status: 404 });
  }
  deleteProject(id);
  return NextResponse.json({ ok: true });
}
