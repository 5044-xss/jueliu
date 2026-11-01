import { z, type ZodType } from "zod";
import type { LlmConfig } from "../storage/settings";
import { llmFetch } from "./http";

function endpointOf(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions")
    ? trimmed
    : `${trimmed}/chat/completions`;
}

function buildOutputContract(schema: ZodType): string {
  let jsonSchema = "";
  try {
    jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  } catch {
    jsonSchema = "（无法导出 schema）";
  }
  return [
    "【输出格式契约（系统内置，不可更改）】",
    "你只能输出一个 JSON 对象，禁止输出任何解释文字、Markdown 或代码块标记。",
    "该 JSON 必须严格符合以下 JSON Schema：",
    jsonSchema,
    "所有必填字段必须存在，字段类型必须正确；不得新增 schema 之外的顶层字段。",
  ].join("\n");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.search(/[[{]/);
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  const slice =
    start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  return JSON.parse(slice);
}

interface ChatBody {
  model: string;
  temperature: number;
  messages: { role: "system" | "user"; content: string }[];
  response_format?: { type: "json_object" };
  enable_thinking?: boolean;
}

async function requestOnce(
  config: LlmConfig,
  body: ChatBody,
): Promise<string> {
  const key = config.apiKey.trim();
  if (!key) throw new Error("请先在设置中填写 API Key");

  const controller = new AbortController();
  // 对齐桌面端：剧本/分镜是长任务，单次请求最长给 40 分钟；超时后不再重试。
  const timer = setTimeout(() => controller.abort(), 40 * 60 * 1000);
  try {
    const response = await llmFetch(endpointOf(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `LLM 请求失败（HTTP ${response.status}）${
          text ? `：${text.slice(0, 300)}` : ""
        }`,
      );
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? "";
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("LLM 请求超时，请检查网络或在设置中换更快的模型");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export interface GenerateStructuredOptions<T> {
  config: LlmConfig;
  schema: ZodType<T>;
  system: string;
  user: string;
  temperature?: number;
  maxRetries?: number;
}

export async function generateStructured<T>({
  config,
  schema,
  system,
  user,
  temperature,
  maxRetries = 1,
}: GenerateStructuredOptions<T>): Promise<T> {
  const systemWithContract = `${system}\n\n${buildOutputContract(schema)}`;
  const isDashscope = /dashscope|aliyuncs/i.test(config.baseUrl);
  const isQwen3 = /qwen3/i.test(config.model);
  const extraThinking = isDashscope && isQwen3;

  let lastError = "";
  let jsonMode = true;
  let thinking = extraThinking;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const feedback = lastError
      ? `\n\n上一次输出不合法，错误信息：${lastError}\n请严格按要求重新输出。`
      : "";
    const body: ChatBody = {
      model: config.model,
      temperature: temperature ?? config.temperature,
      messages: [
        { role: "system", content: systemWithContract },
        { role: "user", content: user + feedback },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...(thinking ? { enable_thinking: false } : {}),
    };

    try {
      const raw = await requestOnce(config, body);
      try {
        const parsed = extractJson(raw);
        const result = schema.safeParse(parsed);
        if (result.success) return result.data;
        lastError = result.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ");
      } catch (error) {
        lastError = `JSON 解析失败：${(error as Error).message}`;
      }
    } catch (error) {
      const message = (error as Error).message || String(error);
      if (thinking && /thinking|unknown parameter|invalid parameter/i.test(message)) {
        thinking = false;
        attempt -= 1;
        continue;
      }
      if (jsonMode && /response_format|json_object|unknown parameter|invalid parameter/i.test(message)) {
        jsonMode = false;
        attempt -= 1;
        continue;
      }
      lastError = message;
      if (/超时|timeout|timed out|ETIMEDOUT|APIConnectionTimeout|aborted/i.test(message)) break;
    }
  }

  throw new Error(`LLM 结构化输出失败：${lastError}`);
}
