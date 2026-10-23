import { NextResponse } from "next/server";
import { ensureCore } from "@/lib/bootstrap";
import { projectExists } from "@core/server/projects";
import { startSequentialStartFrameRun } from "@/lib/generation/image";

type Ctx = { params: Promise<{ id: string }> };

// 批量补齐硬切/场首的 AI 起始画面；连续段仍由顺序生成视频时接上一段尾帧。
export async function POST(_request: Request, { params }: Ctx) {
  ensureCore();
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  try {
    const result = await startSequentialStartFrameRun(id);
    return NextResponse.json({ started: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
