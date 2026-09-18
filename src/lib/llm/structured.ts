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
    jsonSchema = JSON.stringify(z.toJSONSchema(schema), null, 2);
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
): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...(jsonMode
      ? { response_format: { type: "json_object" as const } }
      : {}),
  });
  return response.choices[0]?.message?.content ?? "";
}

export async function generateStructured<T>({
  schema,
  system,
  user,
  temperature,
  maxRetries = 2,
}: GenerateStructuredOptions<T>): Promise<T> {
  const settings = readGlobalSettings();
  const client = createLlmClient(settings.llm);
  const model = settings.llm.model;
  const temp = temperature ?? settings.llm.temperature;
  const systemWithContract = `${system}\n\n${buildOutputContract(schema)}`;

  let lastError = "";
  let jsonMode = true;

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
      );
    } catch (error) {
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
