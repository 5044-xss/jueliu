import { NextResponse } from "next/server";
import { ensureCore } from "@/lib/bootstrap";
import { projectExists } from "@core/server/projects";
import { cancelProjectVideos } from "@/lib/generation/video";

type Ctx = { params: Promise<{ id: string }> };

// 取消本集正在排队/执行的视频生成（中断 ComfyUI + 清队列 + 标记段落取消）。
export async function POST(_request: Request, { params }: Ctx) {
  ensureCore();
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  try {
    const result = await cancelProjectVideos(id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
