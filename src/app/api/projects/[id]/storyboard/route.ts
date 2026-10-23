import { NextResponse } from "next/server";
import {
  getStoryboard,
  clearStoryboard,
  saveStoryboard,
} from "@core/server/storyboard";
import { applyOrchestration } from "@core/server/orchestration/apply";
import { getAssets } from "@core/server/assets";
import { getProject, projectExists } from "@core/server/projects";
import { preflightStoryboard } from "@core/server/preflight";
import { getLatestQcByProject, getQcSummary } from "@core/server/qc";
import { storyboardDraftSchema } from "@core/shared/schemas/storyboard";
import { withLock } from "@core/server/lock";
import { cancelProjectGeneration } from "@/lib/generation/cancel";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const scenes = getStoryboard(id);
  return NextResponse.json({
    scenes,
    preflight: preflightStoryboard(id, scenes),
    qc: getLatestQcByProject(id),
    qcSummary: getQcSummary(id),
  });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  cancelProjectGeneration(id);
  clearStoryboard(id);
  return NextResponse.json({ ok: true });
}

// 手工分镜/导演剪辑版写入：只保存分镜并重新编排，不触发任何图片/视频生成。
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const json = await request.json().catch(() => null);
  const parsed = storyboardDraftSchema.safeParse(json?.draft ?? json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: `分镜参数不合法：${parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("；")}`,
      },
      { status: 400 },
    );
  }
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  return withLock(`orchestrate:${id}`, async () => {
    try {
      saveStoryboard(id, parsed.data, getAssets(id));
      applyOrchestration(id, project.vendor);
      return NextResponse.json({ ok: true, scenes: getStoryboard(id) });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message || "保存分镜失败" },
        { status: 500 },
      );
    }
  });
}
