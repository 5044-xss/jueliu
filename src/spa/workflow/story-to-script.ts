import { STORY_TO_SCRIPT_PROMPT } from "@core/server/skills/prompts";
import {
  normalizeBeatTypes,
  validateScriptBeatTypes,
} from "@core/shared/script-beats";
import { scriptSchema, type Script } from "@core/shared/schemas/script";
import { generateStructured } from "../llm/structured";
import type { LlmConfig } from "../storage/settings";

export interface StoryToScriptInput {
  story: string;
  style: string;
  aspectRatio: string;
  extraInstructions?: string;
  config: LlmConfig;
  systemPrompt?: string;
  temperature?: number;
}

function buildUserPrompt(input: StoryToScriptInput): string {
  return [
    `【项目风格】${input.style || "未指定"}`,
    `【画面比例】${input.aspectRatio}`,
    "",
    "【原始故事】",
    input.story,
    input.extraInstructions?.trim()
      ? `\n【额外要求】\n${input.extraInstructions.trim()}`
      : "",
    "",
    "请输出结构化剧本 JSON。",
  ].join("\n");
}

export async function generateScript(
  input: StoryToScriptInput,
): Promise<Script> {
  if (!input.story.trim()) throw new Error("故事内容为空，请先填写故事。");

  const baseUser = buildUserPrompt(input);
  let feedback = "";
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const output = await generateStructured({
      config: input.config,
      schema: scriptSchema,
      system: input.systemPrompt || STORY_TO_SCRIPT_PROMPT,
      temperature: input.temperature ?? input.config.temperature,
      user: baseUser + feedback,
      maxRetries: 1,
    });

    const normalized = normalizeBeatTypes(output);
    const errors = validateScriptBeatTypes(normalized);
    if (errors.length === 0) return normalized;
    lastErrors = errors;
    feedback = `\n\n【上次输出的 beat 类型不合格，请只修正以下问题后重新输出】\n${errors
      .slice(0, 12)
      .join("\n")}`;
  }

  throw new Error(
    `剧本 beat 类型不合法（${lastErrors.length} 项）：${lastErrors
      .slice(0, 5)
      .join("；")}`,
  );
}
