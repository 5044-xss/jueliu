import { NextResponse } from "next/server";
import { saveFirstFrameImage } from "@/lib/keyframe";
import { getProjectDb } from "@/lib/db";
import { projectExists } from "@/lib/projects";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const db = getProjectDb(id);
  const segment = db
    .prepare("SELECT id FROM segment WHERE id = ?")
    .get(segmentId);
  if (!segment) {
    return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "请上传图片文件" }, { status: 400 });
  }

  const ext = EXT_BY_MIME[file.type] ?? "png";
  const frame = saveFirstFrameImage(
    id,
    segmentId,
    Buffer.from(await file.arrayBuffer()),
    ext,
  );
  return NextResponse.json({ frame });
}
