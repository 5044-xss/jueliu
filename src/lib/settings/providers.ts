import { z } from "zod";

// 服务商与能力路由：产品侧的设置模型。
// 设计原则：连接（Connection）只存账号级信息，能力绑定（Binding）只决定“谁干什么”。
// 协议与端点由下面的类型预设提供，用户只填一次 API Key。

export const CAPABILITIES = ["llm", "image", "video"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  llm: "文本",
  image: "图片",
  video: "视频",
};

export const CAPABILITY_DESCRIPTIONS: Record<Capability, string> = {
  llm: "剧本、资产、分镜、提示词",
  image: "起始画面、参考图",
  video: "分镜片段生成",
};

export const CONNECTION_TYPES = [
  "aliyun",
  "doubao",
  "toapis",
  "apimart",
  "openai",
  "opencode-go",
  "comfyui",
  "custom",
] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

/** 运行时协议，决定用哪个客户端实现。第二/三期逐步补齐。 */
export type Protocol =
  | "openai-chat"
  | "toapis-image"
  | "apimart-image"
  | "comfy-video"
  | "dashscope-image"
  | "dashscope-video"
  | "ark-image"
  | "ark-video";

export interface CapabilityPreset {
  protocol: Protocol;
  /** 默认端点。空字符串表示必须由用户填写。 */
  baseUrl: string;
  /** 模型建议（仅提示，允许手填）。 */
  models: string[];
  /** 当前运行时是否已支持。未支持的能力不能路由。 */
  implemented: boolean;
  note?: string;
}

export interface ConnectionTypePreset {
  label: string;
  blurb: string;
  requiresKey: boolean;
  capabilities: Partial<Record<Capability, CapabilityPreset>>;
}

export const CONNECTION_PRESETS: Record<ConnectionType, ConnectionTypePreset> = {
  aliyun: {
    label: "阿里百炼",
    blurb: "DashScope。文本走 OpenAI 兼容模式。",
    requiresKey: true,
    capabilities: {
      llm: {
        protocol: "openai-chat",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        models: ["qwen-plus", "qwen-max", "qwen-turbo"],
        implemented: true,
      },
      image: {
        protocol: "dashscope-image",
        baseUrl: "https://dashscope.aliyuncs.com/api/v1",
        models: ["wan2.2-t2i-flash", "qwen-image"],
        implemented: false,
        note: "DashScope 原生异步协议，待接入",
      },
      video: {
        protocol: "dashscope-video",
        baseUrl: "https://dashscope.aliyuncs.com/api/v1",
        models: ["wan2.2-t2v-plus", "wan2.5-i2v-preview"],
        implemented: false,
        note: "DashScope 原生异步协议，待接入",
      },
    },
  },
  doubao: {
    label: "豆包（火山方舟）",
    blurb: "火山方舟 Ark。文本走 OpenAI 兼容模式。",
    requiresKey: true,
    capabilities: {
      llm: {
        protocol: "openai-chat",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        models: ["doubao-seed-1-6", "doubao-pro-32k"],
        implemented: true,
      },
      image: {
        protocol: "ark-image",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        models: ["doubao-seedream-4-0"],
        implemented: false,
        note: "方舟图像协议，待接入",
      },
      video: {
        protocol: "ark-video",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        models: ["doubao-seedance-1-0-pro"],
        implemented: false,
        note: "方舟视频协议，待接入",
      },
    },
  },
  toapis: {
    label: "toapis",
    blurb: "OpenAI 兼容聚合接口，图片走异步任务。",
    requiresKey: true,
    capabilities: {
      llm: {
        protocol: "openai-chat",
        baseUrl: "https://toapis.cn/v1",
        models: ["gpt-4.1-mini", "claude-sonnet-4"],
        implemented: true,
      },
      image: {
        protocol: "toapis-image",
        baseUrl: "https://toapis.cn/v1",
        models: ["gpt-image-2"],
        implemented: true,
      },
      video: {
        protocol: "ark-video",
        baseUrl: "https://toapis.cn/v1",
        models: ["veo3-fast", "kling-2.1"],
        implemented: false,
        note: "待接入",
      },
    },
  },
  apimart: {
    label: "APIMart",
    blurb: "OpenAI 兼容网关，文本与图片共用 https://api.apimart.ai/v1。",
    requiresKey: true,
    capabilities: {
      llm: {
        protocol: "openai-chat",
        baseUrl: "https://api.apimart.ai/v1",
        models: ["gpt-5", "claude-sonnet-4.5", "gemini-2.5-flash"],
        implemented: true,
      },
      image: {
        protocol: "apimart-image",
        baseUrl: "https://api.apimart.ai/v1",
        models: ["gpt-image-2", "gemini-3-pro-image-preview"],
        implemented: true,
        note: "异步任务：上传参考图 → 提交 → 轮询 /tasks",
      },
      video: {
        protocol: "ark-video",
        baseUrl: "https://api.apimart.ai/v1",
        models: [],
        implemented: false,
        note: "待接入",
      },
    },
  },
  openai: {
    label: "OpenAI",
    blurb: "官方 OpenAI 接口。",
    requiresKey: true,
    capabilities: {
      llm: {
        protocol: "openai-chat",
        baseUrl: "https://api.openai.com/v1",
        models: ["gpt-4o-mini", "gpt-4o"],
        implemented: true,
      },
      image: {
        protocol: "ark-image",
        baseUrl: "https://api.openai.com/v1",
        models: ["gpt-image-1"],
        implemented: false,
        note: "待接入",
      },
    },
  },
  "opencode-go": {
    label: "OpenCode Go",
    blurb: "OpenCode Go 订阅，OpenAI 兼容接口；请求会自动带上会话标识。",
    requiresKey: true,
    capabilities: {
      llm: {
        protocol: "openai-chat",
        baseUrl: "https://opencode.ai/inference/go/openai/v1",
        models: [
          "deepseek-v4.1-flash",
          "deepseek-v4-pro",
          "glm-5.3-flash",
          "glm-5.3",
          "glm-5.2",
          "kimi-k3",
          "kimi-k2.7-code",
          "longcat-2.0",
          "mimo-v2.6-flash",
          "mimo-v2.6-pro",
          "mimo-v2.5",
          "mimo-v2.5-pro",
          "hy4-preview",
          "hy3",
          "step-5-preview",
          "minimax-m3.1-flash-free",
          "longcat-2.5-preview-free",
          "beam-free",
        ],
        implemented: true,
        note: "仅列出走 OpenAI Chat Completions 的模型；CLI、Codex 等模型走其它协议，暂不支持。",
      },
    },
  },
  comfyui: {
    label: "自建 ComfyUI",
    blurb: "MiniMax H3 极速版镜像。只需实例地址。",
    requiresKey: false,
    capabilities: {
      video: {
        protocol: "comfy-video",
        baseUrl: "",
        models: ["minimax-h3"],
        implemented: true,
      },
    },
  },
  custom: {
    label: "自定义（OpenAI 兼容）",
    blurb: "任意 OpenAI 兼容服务；图片需兼容 toapis 异步接口。",
    requiresKey: true,
    capabilities: {
      llm: {
        protocol: "openai-chat",
        baseUrl: "",
        models: [],
        implemented: true,
      },
      image: {
        protocol: "toapis-image",
        baseUrl: "",
        models: [],
        implemented: true,
        note: "需兼容 toapis 异步图像接口",
      },
    },
  },
};

export function capabilitiesOf(type: ConnectionType): Capability[] {
  const preset = CONNECTION_PRESETS[type];
  return CAPABILITIES.filter((cap) => Boolean(preset.capabilities[cap]));
}

/** 连接可选的模型：优先用用户填写的列表，否则回退到类型预设。 */
export function modelsOf(
  conn: Pick<ProviderConnection, "type" | "models"> | undefined,
  cap: Capability,
): string[] {
  if (!conn) return [];
  const custom = (conn.models ?? []).map((model) => model.trim()).filter(Boolean);
  if (custom.length > 0) return custom;
  return presetOf(conn.type, cap)?.models ?? [];
}

/** 某类型预设里所有能力的模型建议，去重后用于新建连接时预填。 */
export function presetModelsOf(type: ConnectionType): string[] {
  const values = capabilitiesOf(type).flatMap(
    (cap) => presetOf(type, cap)?.models ?? [],
  );
  return [...new Set(values)];
}

/** 能力切换服务商时的默认模型：优先该能力的预设模型，否则用列表第一个。 */
export function defaultModelOf(
  conn: Pick<ProviderConnection, "type" | "models">,
  cap: Capability,
): string {
  const options = modelsOf(conn, cap);
  const preset = presetOf(conn.type, cap)?.models ?? [];
  const matched = options.find((model) => preset.includes(model));
  if (matched) return matched;
  // 用户手填的模型列表可能跨能力混排（例如图片模型排在前面），
  // 默认模型应避开明确属于其它能力的模型。
  const otherPresetModels = new Set(
    capabilitiesOf(conn.type)
      .filter((item) => item !== cap)
      .flatMap((item) => presetOf(conn.type, item)?.models ?? []),
  );
  const candidates = options.filter((model) => !otherPresetModels.has(model));
  const imageHint = /image|imagen|dall-?e|seedream|flux|midjourney/i;
  const videoHint =
    /seedance|sora|veo\d|kling|wan2|hailuo|video|t2v|i2v/i;
  const chatHint = /gpt|claude|deepseek|gemini|qwen|glm|kimi|llama|mistral|grok|doubao/i;
  const byCapability =
    cap === "image"
      ? candidates.find((model) => imageHint.test(model))
      : cap === "video"
        ? candidates.find(
            (model) => videoHint.test(model) && !imageHint.test(model),
          )
        : candidates.find((model) => chatHint.test(model));
  return byCapability ?? candidates[0] ?? options[0] ?? "";
}

export function presetOf(
  type: ConnectionType,
  cap: Capability,
): CapabilityPreset | undefined {
  return CONNECTION_PRESETS[type].capabilities[cap];
}

export function isImplemented(type: ConnectionType, cap: Capability): boolean {
  return Boolean(presetOf(type, cap)?.implemented);
}

/** 该类型各能力的默认端点（去重后用于编辑表单）。 */
export function distinctBaseUrls(type: ConnectionType): string[] {
  const values = capabilitiesOf(type)
    .map((cap) => presetOf(type, cap)?.baseUrl ?? "")
    .filter((url) => Boolean(url));
  return [...new Set(values)];
}

export const IMAGE_RESOLUTIONS = ["1k", "2k", "4k"] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];

export const connectionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(CONNECTION_TYPES),
  name: z.string().min(1).max(80),
  apiKey: z.string().default(""),
  /** 用户手动维护的模型列表；能力绑定从这里选择模型。 */
  models: z.array(z.string().trim().min(1).max(120)).default([]),
  /** 能力级端点覆盖；缺省时用类型预设。 */
  baseUrls: z.record(z.string(), z.string()).default({}),
  imageConcurrency: z.number().int().min(1).max(8).default(2),
  videoConcurrency: z.number().int().min(1).max(4).default(1),
  imageTimeoutMs: z.number().int().min(10_000).max(3_600_000).default(600_000),
  videoTimeoutMs: z
    .number()
    .int()
    .min(60_000)
    .max(21_600_000)
    .default(1_800_000),
});

export type ProviderConnection = z.infer<typeof connectionSchema>;

export const capabilityBindingSchema = z.object({
  connectionId: z.string().default(""),
  model: z.string().default(""),
  fallbackConnectionId: z.string().default(""),
  // 文本
  temperature: z.number().min(0).max(2).default(0.7),
  // 图片
  imageResolution: z.enum(IMAGE_RESOLUTIONS).default("1k"),
  maxRefImages: z.number().int().min(0).max(14).default(14),
});

export type CapabilityBinding = z.infer<typeof capabilityBindingSchema>;

export const bindingsSchema = z.object({
  llm: capabilityBindingSchema.optional(),
  image: capabilityBindingSchema.optional(),
  video: capabilityBindingSchema.optional(),
});

export type CapabilityBindings = z.infer<typeof bindingsSchema>;

export const providerSettingsSchema = z.object({
  /** 0 = 尚未迁移过旧配置。 */
  version: z.number().int().default(0),
  connections: z.array(connectionSchema).default([]),
  bindings: bindingsSchema.default({}),
});

export type ProviderSettings = z.infer<typeof providerSettingsSchema>;

export const generationOverridesSchema = z.object({
  pollIntervalMs: z.number().int().min(500).max(60_000).optional(),
  comfyVideoModel: z.enum(["pruned", "int8"]).optional(),
  videoSteps: z.number().int().min(1).max(30).optional(),
  videoResolution: z.enum(["480p", "540p", "608p", "768p"]).optional(),
  videoAspect: z.string().optional(),
  sagePreset: z.string().optional(),
  sageMaxDurationSec: z.number().int().min(1).max(60).optional(),
  blocksToSwap: z.number().int().min(0).max(60).optional(),
  videoUpscaleModel: z.string().optional(),
  videoOutHeight: z.number().int().min(0).max(4320).optional(),
  videoSecondPass: z.boolean().optional(),
});

export type GenerationOverrides = z.infer<typeof generationOverridesSchema>;

export const saveProviderRequestSchema = z.object({
  settings: providerSettingsSchema,
  generation: generationOverridesSchema.optional(),
  autoGenerateAiPrompt: z.boolean().optional(),
});

export type SaveProviderRequest = z.infer<typeof saveProviderRequestSchema>;

/** 连接在某项能力上的实际端点。 */
export function resolveEndpoint(
  conn: Pick<ProviderConnection, "type" | "baseUrls"> | undefined,
  cap: Capability,
): string {
  if (!conn) return "";
  const override = conn.baseUrls?.[cap]?.trim();
  if (override) return override;
  return presetOf(conn.type, cap)?.baseUrl?.trim() ?? "";
}

/** 与 core 一致的掩码规则（首 4 尾 4）。 */
export function maskApiKeyValue(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "*".repeat(key.length);
  return `${key.slice(0, 4)}${"*".repeat(Math.min(8, key.length - 8))}${key.slice(-4)}`;
}

export function maskProviderSettings(s: ProviderSettings): ProviderSettings {
  return {
    ...s,
    connections: s.connections.map((conn) => ({
      ...conn,
      apiKey: maskApiKeyValue(conn.apiKey),
    })),
  };
}

export function connectionLabel(conn: ProviderConnection | undefined): string {
  return conn ? conn.name : "未选择";
}

export const DEFAULT_BINDING: CapabilityBinding = capabilityBindingSchema.parse({});

/** 新连接加入后，把还没有可用路由的能力自动指向它。 */
export function withAutoBindings(
  settings: ProviderSettings,
  conn: ProviderConnection,
): ProviderSettings {
  const bindings: CapabilityBindings = { ...settings.bindings };
  for (const cap of capabilitiesOf(conn.type)) {
    const preset = presetOf(conn.type, cap);
    if (!preset?.implemented) continue;
    const current = bindings[cap];
    const currentConn = settings.connections.find(
      (item) => item.id === current?.connectionId,
    );
    const usable = Boolean(
      currentConn && presetOf(currentConn.type, cap)?.implemented,
    );
    if (!usable) {
      bindings[cap] = {
        ...(current ?? DEFAULT_BINDING),
        connectionId: conn.id,
        model: current?.model || defaultModelOf(conn, cap) || preset.models[0] || "",
      };
    }
  }
  return { ...settings, bindings };
}

/** 删除连接后，把受影响的能力自动切到其它可用连接。 */
export function withoutConnection(
  settings: ProviderSettings,
  id: string,
): ProviderSettings {
  const connections = settings.connections.filter((conn) => conn.id !== id);
  const bindings: CapabilityBindings = { ...settings.bindings };

  for (const cap of CAPABILITIES) {
    const binding = bindings[cap];
    if (!binding) continue;
    if (binding.connectionId === id) {
      const replacement = connections.find(
        (conn) => presetOf(conn.type, cap)?.implemented,
      );
      bindings[cap] = replacement
        ? {
            ...binding,
            connectionId: replacement.id,
            model:
              defaultModelOf(replacement, cap) ||
              presetOf(replacement.type, cap)?.models[0] ||
              binding.model,
          }
        : { ...binding, connectionId: "" };
    }
    if (binding.fallbackConnectionId === id) {
      bindings[cap] = {
        ...(bindings[cap] ?? binding),
        fallbackConnectionId: "",
      };
    }
  }

  return { ...settings, connections, bindings };
}

