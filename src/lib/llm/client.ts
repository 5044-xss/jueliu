import OpenAI from "openai";
import type { LlmSettings } from "@/lib/settings";

export function createLlmClient(llm: LlmSettings): OpenAI {
  if (!llm.apiKey.trim()) {
    throw new Error("尚未配置 LLM apiKey，请前往设置页填写。");
  }
  return new OpenAI({
    apiKey: llm.apiKey,
    baseURL: llm.baseURL || undefined,
  });
}
