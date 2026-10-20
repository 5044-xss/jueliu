import { NextResponse } from "next/server";
import { ensureCore } from "@/lib/bootstrap";
import { projectExists } from "@core/server/projects";
import { startSequentialVideoRun } from "@/lib/generation/video";

type Ctx = { params: Promise<{ id: string }> };

// 顺序生成视频：整批一个任务，按场次/段顺序逐段生成（不并发）。
// 每段出片后，连续段的尾帧自动接为下一段起始画面。body: { onlyMissing? }
export async function POST(request: Request, { params }: Ctx) {
  ensureCore();
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { onlyMissing?: boolean };
  try {
    const result = await startSequentialVideoRun(id, { onlyMissing: body.onlyMissing });
    return NextResponse.json({ started: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
