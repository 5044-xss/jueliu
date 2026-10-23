import { NextResponse } from "next/server";
import { ensureCore } from "@/lib/bootstrap";
import { getGenerationSettings, getMaskedGenerationSettings } from "@/lib/generation/settings";
import { createImageClient } from "@/lib/generation/image-client";

// 连接自检：可用请求体临时覆盖 baseUrl / apiKey（否则用已保存配置）。
export async function POST(request: Request) {
  ensureCore();
  const json = (await request.json().catch(() => ({}))) as {
    baseUrl?: string;
    apiKey?: string;
  };
  const saved = getGenerationSettings();
  const maskedKey = getMaskedGenerationSettings().apiKey;

  const baseUrl = json.baseUrl?.trim() || saved.baseUrl;
  let apiKey = saved.apiKey;
  if (json.apiKey && json.apiKey.trim() && json.apiKey.trim() !== maskedKey) {
    apiKey = json.apiKey.trim();
  }

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, status: 0, detail: "未配置 API Key" },
      { status: 400 },
    );
  }

  const client = createImageClient({
    baseUrl,
    apiKey,
    timeoutMs: 20_000,
    protocol: saved.imageProtocol,
  });
  const result = await client.testConnection();
  return NextResponse.json(result);
}
