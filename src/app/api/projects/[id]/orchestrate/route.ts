import { NextResponse } from "next/server";
import { z } from "zod";
import { getProject, updateProject } from "@/lib/projects";
import { applyOrchestration } from "@/lib/orchestration/apply";
import {
  captureOrchestrationState,
  restoreOrchestrationState,
} from "@/lib/orchestration/cache";
import { isVendorId } from "@/lib/library/vendors";
import { withLock } from "@/lib/lock";

const bodySchema = z.object({ vendor: z.string() });

type Ctx = { params: Promise<{ id: string }> };

// 按所选厂商重新编排：拉平镜序列 → 按厂商重打包成段 → 写回。
// 切换厂商会清空受影响段（含其视频/帧图），因此先把原厂商的编排结果缓存下来，
// 再还原目标厂商此前缓存的结果，避免来回切换丢工作量。
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success || !isVendorId(parsed.data.vendor)) {
    return NextResponse.json({ error: "厂商参数不合法" }, { status: 400 });
  }
  // 同一项目的编排串行执行：capture→apply→restore 三次写入不能交错。
  return withLock(`orchestrate:${id}`, async () => {
    try {
      // 锁内读取当前厂商，保证 capture 用的是真正生效的厂商。
      const project = getProject(id);
      if (!project) {
        return NextResponse.json({ error: "子集不存在" }, { status: 404 });
      }
      // 先保存当前厂商的分段/视频/帧图，再按目标厂商重打包。
      captureOrchestrationState(id, project.vendor);
      const result = applyOrchestration(id, parsed.data.vendor);
      // 还原目标厂商此前缓存的分段/视频/帧图。
      const restored = restoreOrchestrationState(id, parsed.data.vendor);
      updateProject(id, { vendor: parsed.data.vendor });
      return NextResponse.json({ ok: true, ...result, restored });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message || "编排失败" },
        { status: 500 },
      );
    }
  });
}
