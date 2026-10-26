import { z } from "zod";
import {
  DEFAULT_VIDEO_PARAMS,
  IMAGE_RESOLUTIONS,
  videoParamsSchema,
  type VideoParams,
} from "./model-params";

export {
  DEFAULT_VIDEO_PARAMS,
  IMAGE_RESOLUTIONS,
  VIDEO_ASPECTS,
  VIDEO_RESOLUTIONS,
} from "./model-params";
export type { ImageResolution, VideoParams } from "./model-params";

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

/** 模型分组标题：让用户在添加服务商时一眼分清模型用途。 */
export const CAPABILITY_MODEL_LABELS: Record<Capability, string> = {
  llm: "大语言模型",
  image: "图片模型",
  video: "视频模型",
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

function normalizeModels(list: string[] | undefined): string[] {
  return [...new Set((list ?? []).map((model) => model.trim()).filter(Boolean))];
}

const IMAGE_MODEL_HINT = /image|imagen|dall-?e|seedream|flux|midjourney|t2i/i;
const VIDEO_MODEL_HINT =
  /seedance|sora|veo\d|kling|wan2(?:\.\d+)?-(?:t2v|i2v)|hailuo|video|t2v|i2v/i;
const CHAT_MODEL_HINT =
  /gpt|claude|deepseek|gemini|qwen|glm|kimi|llama|mistral|grok|doubao|longcat|mimo|step|minimax|hy\d|beam/i;

/** 判断一个模型名更像哪项能力的模型；预设命中优先，其次按名称特征推断。 */
export function capabilityOfModel(
  type: ConnectionType,
  model: string,
  caps: Capability[] = capabilitiesOf(type),
): Capability | undefined {
  const presetMatches = caps.filter((cap) =>
    (presetOf(type, cap)?.models ?? []).includes(model),
  );
  if (presetMatches.length === 1) return presetMatches[0];
  if (VIDEO_MODEL_HINT.test(model) && caps.includes("video")) return "video";
  if (IMAGE_MODEL_HINT.test(model) && caps.includes("image")) return "image";
  if (CHAT_MODEL_HINT.test(model) && caps.includes("llm")) return "llm";
  if (caps.includes("llm")) return "llm";
  return caps[0];
}

/** 把旧的扁平模型列表按能力拆开，用于兼容历史设置。 */
export function splitModelsByCapability(
  type: ConnectionType,
  models: string[] | undefined,
): Partial<Record<Capability, string[]>> {
  const caps = capabilitiesOf(type);
  const result: Partial<Record<Capability, string[]>> = {};
  for (const cap of caps) result[cap] = [];
  for (const model of normalizeModels(models)) {
    const cap = capabilityOfModel(type, model, caps);
    if (!cap) continue;
    result[cap] = [...(result[cap] ?? []), model];
  }
  return result;
}

/** 某类型各能力的预设模型。 */
export function presetModelsByCapability(
  type: ConnectionType,
): Partial<Record<Capability, string[]>> {
  const result: Partial<Record<Capability, string[]>> = {};
  for (const cap of capabilitiesOf(type)) {
    result[cap] = [...(presetOf(type, cap)?.models ?? [])];
  }
  return result;
}

/**
 * 连接按能力分组的模型列表。
 * 新连接直接读取分组字段；历史连接则把扁平列表按能力拆开。
 * 分组为空时回退到该能力的预设模型。
 */
export function modelsByCapabilityOf(
  conn: Pick<ProviderConnection, "type" | "models" | "modelsByCapability">,
): Partial<Record<Capability, string[]>> {
  const caps = capabilitiesOf(conn.type);
  const explicit = conn.modelsByCapability ?? {};
  const legacy = splitModelsByCapability(conn.type, conn.models);
  const result: Partial<Record<Capability, string[]>> = {};
  for (const cap of caps) {
    const scoped = normalizeModels(explicit[cap]);
    const fallback = Object.prototype.hasOwnProperty.call(explicit, cap)
      ? []
      : normalizeModels(legacy[cap]);
    const list = scoped.length > 0 ? scoped : fallback;
    result[cap] = list.length > 0 ? list : [...(presetOf(conn.type, cap)?.models ?? [])];
  }
  return result;
}

/** 连接在某项能力下可选的模型；不会混入其它能力的模型。 */
export function modelsOf(
  conn: Pick<ProviderConnection, "type" | "models" | "modelsByCapability"> | undefined,
  cap: Capability,
): string[] {
  if (!conn) return [];
  const explicit = conn.modelsByCapability ?? {};
  if (Object.prototype.hasOwnProperty.call(explicit, cap)) {
    const scoped = normalizeModels(explicit[cap]);
    return scoped.length > 0
      ? scoped
      : [...(presetOf(conn.type, cap)?.models ?? [])];
  }
  const legacy = normalizeModels(conn.models).filter(
    (model) => capabilityOfModel(conn.type, model) === cap,
  );
  if (legacy.length > 0) return legacy;
  return [...(presetOf(conn.type, cap)?.models ?? [])];
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
  conn: Pick<ProviderConnection, "type" | "models" | "modelsByCapability">,
  cap: Capability,
): string {
  const options = modelsOf(conn, cap);
  const preset = presetOf(conn.type, cap)?.models ?? [];
  return options.find((model) => preset.includes(model)) ?? options[0] ?? "";
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

export const connectionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(CONNECTION_TYPES),
  name: z.string().min(1).max(80),
  apiKey: z.string().default(""),
  /** 旧的扁平模型列表；仅作兼容，保存时写入各能力模型的并集。 */
  models: z.array(z.string().trim().min(1).max(120)).default([]),
  /** 按能力分组的模型列表；能力页只显示对应能力的模型。 */
  modelsByCapability: z
    .partialRecord(
      z.enum(CAPABILITIES),
      z.array(z.string().trim().min(1).max(120)),
    )
    .default({}),
  /** 能力级端点覆盖；缺省时用类型预设。 */
  baseUrls: z.record(z.string(), z.string()).default({}),
  imageConcurrency: z.number().int().min(1).max(8).default(2),
  videoConcurrency: z.number().int().min(1).max(4).default(1),
  imagePollIntervalMs: z.number().int().min(500).max(60_000).default(3_000),
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
  // 视频
  video: videoParamsSchema.default(DEFAULT_VIDEO_PARAMS),
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

export function videoParamsOf(
  binding: CapabilityBinding | undefined,
): VideoParams {
  return binding?.video ?? DEFAULT_VIDEO_PARAMS;
}

export function defaultParamsFor(
  cap: Capability,
): Partial<CapabilityBinding> {
  if (cap === "llm") {
    return { temperature: DEFAULT_BINDING.temperature };
  }
  if (cap === "image") {
    return {
      imageResolution: DEFAULT_BINDING.imageResolution,
      maxRefImages: DEFAULT_BINDING.maxRefImages,
    };
  }
  return { video: { ...DEFAULT_VIDEO_PARAMS } };
}

/** 绑定模型必须属于对应能力；失效时回退到该能力的默认模型。 */
export function normalizeBindings(settings: ProviderSettings): ProviderSettings {
  const bindings: CapabilityBindings = { ...settings.bindings };
  let changed = false;
  for (const cap of CAPABILITIES) {
    const binding = bindings[cap];
    if (!binding) continue;
    const conn = settings.connections.find(
      (item) => item.id === binding.connectionId,
    );
    if (!conn) continue;
    const options = modelsOf(conn, cap);
    if (options.length > 0 && !options.includes(binding.model)) {
      bindings[cap] = {
        ...binding,
        ...defaultParamsFor(cap),
        model: defaultModelOf(conn, cap),
      };
      changed = true;
    }
  }
  return changed ? { ...settings, bindings } : settings;
}

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
        ...defaultParamsFor(cap),
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
            ...defaultParamsFor(cap),
            connectionId: replacement.id,
            model:
              defaultModelOf(replacement, cap) ||
              presetOf(replacement.type, cap)?.models[0] ||
              binding.model,
          }
        : { ...binding, ...defaultParamsFor(cap), connectionId: "" };
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

