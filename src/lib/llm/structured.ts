import type OpenAI from "openai";
import { z, type ZodType } from "zod";
import { createLlmClient } from "@/lib/llm/client";
import { readGlobalSettings } from "@/lib/settings";

export interface GenerateStructuredOptions<T> {
  schema: ZodType<T>;
  system: string;
  user: string;
  temperature?: number;
  maxRetries?: number;
}

/**
 * 由 schema 自动生成、强制附加到 system 的输出契约。
 * 与用户可编辑的提示词完全解耦：无论提示词怎么写，模型都必须按此结构输出。
 */
function buildOutputContract(schema: ZodType): string {
  let jsonSchema = "";
  try {
    // 紧凑输出（不缩进）：schema 文本越短，输入 token 越少、首字越快。
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
  const slice = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  return JSON.parse(slice);
}

async function complete(
  client: OpenAI,
  model: string,
  system: string,
  user: string,
  temperature: number,
  jsonMode: boolean,
  extraBody?: Record<string, unknown>,
): Promise<string> {
  const body = {
    model,
    temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...(jsonMode
      ? { response_format: { type: "json_object" as const } }
      : {}),
    ...(extraBody ?? {}),
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
  const response = await client.chat.completions.create(body);
  return response.choices[0]?.message?.content ?? "";
}

// 阿里百炼的 qwen3 系列默认开启「思考」，结构化输出场景下会白白多花几十秒。
// 这里对 dashscope + qwen3 显式关闭思考；若供应商不认这个参数，会回退重试。
function thinkingExtraBody(
  llm: { baseURL: string; model: string },
): Record<string, unknown> | undefined {
  const isDashscope = llm.baseURL.includes("dashscope");
  const isQwen3 = /qwen3/i.test(llm.model);
  return isDashscope && isQwen3 ? { enable_thinking: false } : undefined;
}

function isThinkingParamError(error: unknown): boolean {
  const message = (error as Error)?.message ?? "";
  return /enable_thinking|thinking|unknown parameter|invalid parameter/i.test(
    message,
  );
}

// 超时不重试：供应商卡住时重试只会把等待时间成倍拉长，直接失败并给出明确提示。
function isTimeoutError(error: unknown): boolean {
  const err = error as { name?: string; message?: string };
  return /timeout|timed out|ETIMEDOUT|APIConnectionTimeout/i.test(
    `${err?.name ?? ""} ${err?.message ?? ""}`,
  );
}

export async function generateStructured<T>({
  schema,
  system,
  user,
  temperature,
  maxRetries = 1,
}: GenerateStructuredOptions<T>): Promise<T> {
  const settings = readGlobalSettings();
  const client = createLlmClient(settings.llm);
  const model = settings.llm.model;
  const temp = temperature ?? settings.llm.temperature;
  const systemWithContract = `${system}\n\n${buildOutputContract(schema)}`;

  let lastError = "";
  let jsonMode = true;
  let extraBody = thinkingExtraBody(settings.llm);
  let thinkingFallbackUsed = false;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const feedback = lastError
      ? `\n\n上一次输出不合法，错误信息：${lastError}\n请严格按要求重新输出。`
      : "";
    let raw = "";
    try {
      raw = await complete(
        client,
        model,
        systemWithContract,
        user + feedback,
        temp,
        jsonMode,
        extraBody,
      );
    } catch (error) {
      // 供应商不认 enable_thinking 时，去掉该参数再试一次。
      if (extraBody && !thinkingFallbackUsed && isThinkingParamError(error)) {
        extraBody = undefined;
        thinkingFallbackUsed = true;
        lastError = `接口调用失败：${(error as Error).message}`;
        continue;
      }
      if (isTimeoutError(error)) {
        lastError =
          "LLM 请求超时（长时间无响应）。请检查网络/供应商状态，或在设置页换更快的模型。";
        break;
      }
      if (jsonMode) {
        jsonMode = false;
        lastError = `接口调用失败：${(error as Error).message}`;
        continue;
      }
      lastError = (error as Error).message;
      continue;
    }

    try {
      const parsed = extractJson(raw);
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      lastError = result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } catch (error) {
      lastError = `JSON 解析失败：${(error as Error).message}`;
    }
  }

  throw new Error(`LLM 结构化输出失败：${lastError}`);
}

export interface GenerateTextOptions {
  system: string;
  user: string;
  temperature?: number;
  maxRetries?: number;
}

// 纯文本生成：不附加 JSON 契约，直接把模型返回的文本作为结果。
// 用于「分镜 → AI 提示词」这类输出整段格式化文本、不需要结构化解析的场景。
export async function generateText({
  system,
  user,
  temperature,
  maxRetries = 1,
}: GenerateTextOptions): Promise<string> {
  const settings = readGlobalSettings();
  const client = createLlmClient(settings.llm);
  const model = settings.llm.model;
  const temp = temperature ?? settings.llm.temperature;

  let lastError = "";
  let extraBody = thinkingExtraBody(settings.llm);
  let thinkingFallbackUsed = false;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const raw = await complete(
        client,
        model,
        system,
        user,
        temp,
        false,
        extraBody,
      );
      const text = raw.trim();
      if (text) return text;
      lastError = "模型返回了空内容";
    } catch (error) {
      if (extraBody && !thinkingFallbackUsed && isThinkingParamError(error)) {
        extraBody = undefined;
        thinkingFallbackUsed = true;
        lastError = `接口调用失败：${(error as Error).message}`;
        continue;
      }
      if (isTimeoutError(error)) {
        lastError =
          "LLM 请求超时（长时间无响应）。请检查网络/供应商状态，或在设置页换更快的模型。";
        break;
      }
      lastError = (error as Error).message;
    }
  }

  throw new Error(`LLM 生成失败：${lastError}`);
}
