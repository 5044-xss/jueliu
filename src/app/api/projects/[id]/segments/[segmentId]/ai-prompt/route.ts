import { NextResponse } from "next/server";
import { buildAiPromptSignature, getCachedAiPrompt } from "@core/server/ai-prompt";
import { projectExists } from "@core/server/projects";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

// 读取已缓存的 AI 翻译提示词（不调用 LLM）。
// 命中签名的缓存才返回；签名失效或无缓存时 prompt 为 null，由前端决定是否重新生成。
export async function GET(request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const platform = new URL(request.url).searchParams.get("platform") ?? "doubao";
  const info = buildAiPromptSignature(id, segmentId, platform);
  if (!info) {
    return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  }
  const prompt = getCachedAiPrompt(id, segmentId, info.sig);
  return NextResponse.json({ prompt, sig: info.sig, cached: Boolean(prompt) });
}
