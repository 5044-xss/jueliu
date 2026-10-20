import { NextResponse } from "next/server";
import { ensureCore } from "@/lib/bootstrap";
import { projectExists } from "@core/server/projects";
import { cancelRunningJobs } from "@core/server/jobs";
import { cancelAssetImages } from "@/lib/generation/asset";

type Ctx = { params: Promise<{ id: string }> };

// 取消本集正在排队/执行的资产出图：中断在跑的请求 + 标记运行中的任务为已取消。
export async function POST(_request: Request, { params }: Ctx) {
  ensureCore();
  const { id } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const { cancelled } = cancelAssetImages(id);
  const jobs = cancelRunningJobs(id, "gen-asset-image", "已取消（用户中断）");
  return NextResponse.json({ cancelled, jobs });
}
