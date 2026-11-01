import { db, type SettingRecord } from "./db";
import { getActiveLlmConfig } from "./providers";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "",
  model: "qwen3.7-flash-2026-07-15",
  temperature: 0.7,
};

const LLM_KEY = "llm";

function now(): string {
  return new Date().toISOString();
}

export const settingsRepository = {
  async get<T>(key: string): Promise<T | null> {
    const record = await db.settings.get(key);
    return (record?.value as T | undefined) ?? null;
  },

  async set<T>(key: string, value: T): Promise<void> {
    const record: SettingRecord = { key, value, updatedAt: now() };
    await db.settings.put(record);
  },

  async remove(key: string): Promise<void> {
    await db.settings.delete(key);
  },

  async getLlm(): Promise<LlmConfig> {
    const active = await getActiveLlmConfig();
    const stored = await this.get<Partial<LlmConfig>>(LLM_KEY);
    return {
      ...DEFAULT_LLM_CONFIG,
      ...(stored ?? {}),
      ...active,
      baseUrl: active.baseUrl || stored?.baseUrl || DEFAULT_LLM_CONFIG.baseUrl,
      apiKey: active.apiKey || stored?.apiKey || "",
      model: active.model || stored?.model || DEFAULT_LLM_CONFIG.model,
    };
  },

  async saveLlm(value: LlmConfig): Promise<LlmConfig> {
    const next: LlmConfig = {
      ...DEFAULT_LLM_CONFIG,
      ...value,
      apiKey: value.apiKey.trim(),
      baseUrl: value.baseUrl.trim(),
      model: value.model.trim(),
    };
    await this.set(LLM_KEY, next);
    return next;
  },
};
