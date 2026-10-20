import { NextResponse } from "next/server";
import { ensureCore } from "@/lib/bootstrap";
import { getGenerationSettings } from "@/lib/generation/settings";
import { ComfyClient } from "@/lib/generation/comfy";

// ComfyUI 连接自检：可用请求体临时覆盖 comfyUrl（否则用已保存配置）。
// 只有返回真正的 /system_stats JSON 才算连通（排除填了云厂商控制台网页）。
export async function POST(request: Request) {
  ensureCore();
  const json = (await request.json().catch(() => ({}))) as { comfyUrl?: string };
  const saved = getGenerationSettings();
  const comfyUrl = json.comfyUrl?.trim() || saved.comfyUrl;
  if (!comfyUrl) {
    return NextResponse.json({ ok: false, detail: "未配置 ComfyUI 实例地址" }, { status: 400 });
  }
  const client = new ComfyClient({ baseUrl: comfyUrl, timeoutMs: 30_000 });
  const result = await client.test();
  return NextResponse.json(result);
}
