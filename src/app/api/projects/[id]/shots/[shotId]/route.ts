import { NextResponse } from "next/server";
import { z } from "zod";
import {
  cameraSchema,
  dialogueLineSchema,
  refRoleSchema,
} from "@core/shared/schemas/storyboard";
import { updateShot } from "@core/server/storyboard";
import { getAssets } from "@core/server/assets";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; shotId: string }> };

const refSchema = z.object({
  role: refRoleSchema,
  assetName: z.string().default(""),
  variantLabel: z.string().default(""),
  viewLabel: z.string().default(""),
});

const patchSchema = z.object({
  durationMs: z.number().int().nonnegative().optional(),
  camera: cameraSchema.optional(),
  lighting: z.string().optional(),
  action: z.string().optional(),
  dialogue: z.array(dialogueLineSchema).optional(),
  expression: z.string().optional(),
  cutReason: z.string().optional(),
  subjectNodeIds: z.array(z.string()).optional(),
  continuesPrev: z.boolean().optional(),
  refs: z.array(refSchema).optional(),
});

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, shotId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const ok = updateShot(id, shotId, parsed.data, getAssets(id));
  if (!ok) return NextResponse.json({ error: "分镜不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
