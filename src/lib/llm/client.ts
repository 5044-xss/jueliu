import OpenAI from "openai";
import type { LlmSettings } from "@/lib/settings";

export function createLlmClient(llm: LlmSettings): OpenAI {
  if (!llm.apiKey.trim()) {
    throw new Error("尚未配置 LLM apiKey，请前往设置页填写。");
  }
  return new OpenAI({
    apiKey: llm.apiKey,
    baseURL: llm.baseURL || undefined,
    // 单次请求超时 40 分钟（生成剧本/资产/分镜都是长任务，给足时间）。
    // 超时由上层 generateStructured 直接失败并给出明确提示，不再重试。
    timeout: 40 * 60 * 1000,
    // 关掉 SDK 自带的隐式重试，避免与上层重试叠加成多次慢请求。
    maxRetries: 0,
  });
}
