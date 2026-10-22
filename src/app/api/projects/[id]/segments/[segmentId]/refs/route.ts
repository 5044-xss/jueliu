import { NextResponse } from "next/server";
import { z } from "zod";
import { setSegmentRefOverride } from "@core/server/storyboard";
import {
  getSegmentRefUpload,
  pruneSegmentRefUploads,
} from "@core/server/ref-uploads";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

const refSchema = z.object({
  role: z.enum(["start", "character", "scene", "prop", "upload"]),
  label: z.string().default(""),
  viewId: z.string().nullable().default(null),
  frameId: z.string().nullable().default(null),
  uploadId: z.string().nullable().default(null),
});

const bodySchema = z.object({
  refs: z.array(refSchema).nullable(),
});

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const refs = parsed.data.refs;
  const keepIds = new Set<string>();
  for (const ref of refs ?? []) {
    if (!ref.uploadId) continue;
    if (!getSegmentRefUpload(id, segmentId, ref.uploadId)) {
      return NextResponse.json(
        { error: "本地参考图已失效，请重新上传" },
        { status: 400 },
      );
    }
    keepIds.add(ref.uploadId);
  }
  const ok = setSegmentRefOverride(id, segmentId, refs);
  if (!ok) return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  // 清单已更新，清掉本段不再引用的本地上传，避免文件残留。
  pruneSegmentRefUploads(id, segmentId, keepIds);
  return NextResponse.json({ ok: true });
}
