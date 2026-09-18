export type LlmProvider =
  | "dashscope"
  | "openai"
  | "deepseek"
  | "moonshot"
  | "zhipu"
  | "custom";

export interface LlmSettings {
  provider: LlmProvider;
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export interface FfmpegSettings {
  path: string;
}

export interface GlobalSettings {
  llm: LlmSettings;
  ffmpeg: FfmpegSettings;
}

export const PROVIDER_PRESETS: Record<
  Exclude<LlmProvider, "custom">,
  { label: string; baseURL: string; defaultModel: string }
> = {
  dashscope: {
    label: "阿里百炼 (DashScope)",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
  },
  openai: {
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
  deepseek: {
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
  },
  moonshot: {
    label: "月之暗面 (Kimi)",
    baseURL: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
  },
  zhipu: {
    label: "智谱 (GLM)",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
  },
};

export const PROVIDER_OPTIONS: { value: LlmProvider; label: string }[] = [
  ...Object.entries(PROVIDER_PRESETS).map(([value, preset]) => ({
    value: value as LlmProvider,
    label: preset.label,
  })),
  { value: "custom", label: "自定义 (OpenAI 兼容)" },
];

export interface FfmpegStatus {
  available: boolean;
  path: string;
  version?: string;
  error?: string;
}

export function maskApiKey(settings: GlobalSettings): GlobalSettings {
  const key = settings.llm.apiKey;
  const masked = key
    ? `${key.slice(0, 4)}${"*".repeat(Math.max(0, Math.min(8, key.length - 8)))}${key.slice(-4)}`
    : "";
  return { ...settings, llm: { ...settings.llm, apiKey: masked } };
}
