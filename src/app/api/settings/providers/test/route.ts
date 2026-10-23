import { NextResponse } from "next/server";
import { z } from "zod";
import { createLlmClient } from "@core/server/llm/client";
import { ensureCore } from "@/lib/bootstrap";
import { ComfyClient } from "@/lib/generation/comfy";
import { createImageClient } from "@/lib/generation/image-client";
import { getProviderSettings } from "@/lib/settings/providers-server";
import {
  CAPABILITIES,
  capabilitiesOf,
  connectionSchema,
  defaultModelOf,
  maskApiKeyValue,
  presetOf,
  resolveEndpoint,
  type Capability,
  type ProviderConnection,
} from "@/lib/settings/providers";

const bodySchema = z.object({
  connectionId: z.string().optional(),
  connection: connectionSchema.optional(),
  capabilities: z.array(z.enum(CAPABILITIES)).optional(),
});

interface CapabilityResult {
  ok: boolean;
  implemented: boolean;
  message: string;
}

async function testLlm(
  conn: ProviderConnection,
  model: string,
): Promise<CapabilityResult> {
  const apiKey = conn.apiKey.trim();
  if (!apiKey) {
    return { ok: false, implemented: true, message: "未填写 API Key" };
  }
  const baseURL = resolveEndpoint(conn, "llm");
  if (!baseURL) {
    return { ok: false, implemented: true, message: "未填写接口地址" };
  }
  if (!model) {
    return { ok: false, implemented: true, message: "未填写模型名" };
  }
  const started = Date.now();
  try {
    const client = createLlmClient({
      provider: "custom",
      baseURL,
      apiKey,
      model,
      temperature: 0.2,
    });
    const res = await client.chat.completions.create({
      model,
      max_tokens: 8,
      messages: [{ role: "user", content: "ping，只回复 pong" }],
    });
    const reply = res.choices[0]?.message?.content?.trim() ?? "";
    return {
      ok: true,
      implemented: true,
      message: `连通 · ${model} · ${Date.now() - started}ms${
        reply ? ` · ${reply.slice(0, 20)}` : ""
      }`,
    };
  } catch (error) {
    return {
      ok: false,
      implemented: true,
      message: (error as Error).message || "连接失败",
    };
  }
}

async function testImage(conn: ProviderConnection): Promise<CapabilityResult> {
  const baseUrl = resolveEndpoint(conn, "image");
  if (!baseUrl) {
    return { ok: false, implemented: true, message: "未填写接口地址" };
  }
  if (!conn.apiKey.trim()) {
    return { ok: false, implemented: true, message: "未填写 API Key" };
  }
  const client = createImageClient({
    baseUrl,
    apiKey: conn.apiKey,
    timeoutMs: 20_000,
    protocol:
      presetOf(conn.type, "image")?.protocol === "apimart-image"
        ? "apimart-image"
        : "toapis-image",
  });
  const result = await client.testConnection();
  return {
    ok: result.ok,
    implemented: true,
    message: result.ok
      ? `连通 · HTTP ${result.status}`
      : result.detail || `HTTP ${result.status}`,
  };
}

async function testVideo(conn: ProviderConnection): Promise<CapabilityResult> {
  const baseUrl = resolveEndpoint(conn, "video");
  if (!baseUrl) {
    return { ok: false, implemented: true, message: "未填写实例地址" };
  }
  const client = new ComfyClient({ baseUrl, timeoutMs: 30_000 });
  const result = await client.test();
  return {
    ok: result.ok,
    implemented: true,
    message: result.ok ? "实例在线" : result.detail || "连接失败",
  };
}

export async function POST(request: Request) {
  ensureCore();
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }

  const settings = getProviderSettings();

  let conn = parsed.data.connection;
  if (conn) {
    const saved = conn.id
      ? settings.connections.find((item) => item.id === conn!.id)
      : undefined;
    // 表单里回传的是打码 Key 或留空：用已保存的真实 Key。
    if (saved && (!conn.apiKey.trim() || conn.apiKey === maskApiKeyValue(saved.apiKey))) {
      conn = { ...conn, apiKey: saved.apiKey };
    }
  } else if (parsed.data.connectionId) {
    conn = settings.connections.find(
      (item) => item.id === parsed.data.connectionId,
    );
  }

  if (!conn) {
    return NextResponse.json({ error: "连接不存在" }, { status: 404 });
  }

  const owned = capabilitiesOf(conn.type);
  const requested = (parsed.data.capabilities?.length
    ? parsed.data.capabilities
    : owned
  ).filter((cap): cap is Capability => owned.includes(cap));

  const llmBinding = settings.bindings.llm;
  const llmModel =
    llmBinding?.connectionId === conn.id && llmBinding.model
      ? llmBinding.model
      : defaultModelOf(conn, "llm") || presetOf(conn.type, "llm")?.models[0] || "";

  const entries = await Promise.all(
    requested.map(async (cap) => {
      const preset = presetOf(conn.type, cap);
      if (!preset?.implemented) {
        return [
          cap,
          {
            ok: false,
            implemented: false,
            message: preset?.note || "该能力尚未接入",
          },
        ] as const;
      }
      const result =
        cap === "llm"
          ? await testLlm(conn, llmModel)
          : cap === "image"
            ? await testImage(conn)
            : await testVideo(conn);
      return [cap, result] as const;
    }),
  );

  return NextResponse.json({
    connectionId: conn.id,
    results: Object.fromEntries(entries),
  });
}
