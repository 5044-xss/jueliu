import { NextResponse } from "next/server";
import { z } from "zod";
import { readGlobalSettings, maskApiKey } from "@core/server/settings";
import { createLlmClient } from "@core/server/llm/client";
import { serverFetch } from "@/lib/server-fetch";

const bodySchema = z.object({
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

// 用当前表单值（未填的用已保存值）真实发一次最小请求，验证连通性。
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "参数不合法" },
      { status: 400 },
    );
  }

  const saved = readGlobalSettings();
  const maskedKey = maskApiKey(saved).llm.apiKey;
  const incomingKey = parsed.data.apiKey?.trim() ?? "";
  const apiKey =
    incomingKey && incomingKey !== maskedKey ? incomingKey : saved.llm.apiKey;
  const baseURL = parsed.data.baseURL?.trim() || saved.llm.baseURL;
  const model = parsed.data.model?.trim() || saved.llm.model;

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "未配置 API Key" },
      { status: 400 },
    );
  }
  if (!model) {
    return NextResponse.json(
      { ok: false, error: "未配置模型名" },
      { status: 400 },
    );
  }

  const started = Date.now();
  try {
    const client = createLlmClient(
      {
        provider: saved.llm.provider,
        baseURL,
        apiKey,
        model,
        temperature: parsed.data.temperature ?? saved.llm.temperature,
      },
      { fetch: serverFetch as unknown as typeof fetch },
    );
    const response = await client.chat.completions.create({
      model,
      max_tokens: 16,
      stream: false,
      messages: [{ role: "user", content: "ping，只回复 pong" }],
    });
    const latencyMs = Date.now() - started;
    const reply = response.choices[0]?.message?.content?.trim() ?? "";
    return NextResponse.json({ ok: true, latencyMs, model, reply });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message || "连接失败" },
      { status: 502 },
    );
  }
}
