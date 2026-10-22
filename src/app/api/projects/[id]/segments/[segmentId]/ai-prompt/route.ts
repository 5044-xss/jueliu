import { NextResponse } from "next/server";
import {
  buildAiPromptSignature,
  getCachedAiPrompt,
  getStoredAiPrompt,
  saveAiPrompt,
} from "@core/server/ai-prompt";
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
  const keyframeOnly =
    new URL(request.url).searchParams.get("keyframeOnly") === "1";
  const info = buildAiPromptSignature(id, segmentId, platform, {
    keyframeOnly,
  });
  if (!info) {
    return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  }
  const cached = getCachedAiPrompt(id, segmentId, info.sig);
  if (cached) {
    return NextResponse.json({
      prompt: cached,
      sig: info.sig,
      cached: true,
      stale: false,
    });
  }
  // 签名失配（分镜/参考图/参数/编译提示词改过）时，仍回填上次编译结果，
  // 让用户能看到并继续编辑「最终提示词」，同时标记为过期。
  const stored = getStoredAiPrompt(id, segmentId);
  return NextResponse.json({
    prompt: stored,
    sig: info.sig,
    cached: false,
    stale: Boolean(stored),
  });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) {
    return NextResponse.json({ error: "提示词不能为空" }, { status: 400 });
  }
  const platform =
    typeof body?.platform === "string" && body.platform
      ? body.platform
      : new URL(request.url).searchParams.get("platform") ?? "doubao";
  const keyframeOnly = body?.keyframeOnly === true;
  const info = buildAiPromptSignature(id, segmentId, platform, {
    keyframeOnly,
  });
  if (!info) {
    return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  }
  saveAiPrompt(id, segmentId, info.sig, prompt);
  return NextResponse.json({ prompt, sig: info.sig });
}
