import { NextResponse } from "next/server";
import { getProjectDb } from "@core/server/db";
import { projectExists } from "@core/server/projects";
import { saveSegmentRefUpload } from "@core/server/ref-uploads";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MAX_BYTES = 20 * 1024 * 1024;

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
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "图片不能超过 20MB" }, { status: 400 });
  }

  const ext = EXT_BY_MIME[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "仅支持 PNG / JPG / WebP / GIF" },
      { status: 400 },
    );
  }
  const label =
    String(form?.get("label") ?? "").trim() || file.name || "本地参考图";

  const upload = saveSegmentRefUpload(
    id,
    segmentId,
    Buffer.from(await file.arrayBuffer()),
    ext,
    label,
  );
  return NextResponse.json({
    upload: {
      id: upload.id,
      label: upload.label,
      createdAt: upload.createdAt,
    },
  });
}
