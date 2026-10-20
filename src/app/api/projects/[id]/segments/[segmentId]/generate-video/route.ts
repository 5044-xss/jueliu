import { NextResponse } from "next/server";
import { ensureCore } from "@/lib/bootstrap";
import { getProjectDb } from "@core/server/db";
import { projectExists } from "@core/server/projects";
import { submitSegmentVideo } from "@/lib/generation/video";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

// 提交本段视频生成（自建 ComfyUI + MiniMax H3）。立即返回 promptId，进度看 job 表。
export async function POST(_request: Request, { params }: Ctx) {
  ensureCore();
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

  try {
    const result = await submitSegmentVideo(id, segmentId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
