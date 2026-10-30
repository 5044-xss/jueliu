import { z } from "zod";

// 服务商与能力路由：掘流只使用文本模型。
// 连接（Connection）只存账号级信息，绑定（Binding）决定用哪个模型。
// 协议与端点由类型预设提供，用户只填一次 API Key。

export const CAPABILITIES = ["llm"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  llm: "文本",
};

export const CAPABILITY_DESCRIPTIONS: Record<Capability, string> = {
  llm: "剧本、资产、分镜、提示词",
};

export const CAPABILITY_MODEL_LABELS: Record<Capability, string> = {
  llm: "大语言模型",
};

export const CONNECTION_TYPES = [
  "aliyun",
  "doubao",
  "toapis",
  "apimart",
  "openai",
  "opencode-go",
  "custom",
] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export type Protocol = "openai-chat";

export interface CapabilityPreset {
  protocol: Protocol;
  /** 默认端点。空字符串表示必须由用户填写。 */
  baseUrl: string;
  /** 模型建议（仅提示，允许手填）。 */
  models: string[];
  /** 当前运行时是否已支持。 */
  implemented: boolean;
  note?: string;
}

export interface ConnectionTypePreset {
  label: string;
  blurb: string;
  requiresKey: boolean;
  capabilities: Partial<Record<Capability, CapabilityPreset>>;
}

export const CONNECTION_PRESETS: Record<
  ConnectionType,
  ConnectionTypePreset
> = {
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
    },
  },
  toapis: {
    label: "toapis",
    blurb: "OpenAI 兼容聚合接口。",
    requiresKey: true,
    capabilities: {
      llm: {
        protocol: "openai-chat",
        baseUrl: "https://toapis.cn/v1",
        models: ["gpt-4.1-mini", "claude-sonnet-4"],
        implemented: true,
      },
    },
  },
  apimart: {
    label: "APIMart",
    blurb: "OpenAI 兼容网关，文本走 https://api.apimart.ai/v1。",
    requiresKey: true,
    capabilities: {
      llm: {
        protocol: "openai-chat",
        baseUrl: "https://api.apimart.ai/v1",
        models: ["gpt-5", "claude-sonnet-4.5", "gemini-2.5-flash"],
        implemented: true,
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
  custom: {
    label: "自定义（OpenAI 兼容）",
    blurb: "任意 OpenAI 兼容服务。",
    requiresKey: true,
    capabilities: {
      llm: {
        protocol: "openai-chat",
        baseUrl: "",
        models: [],
        implemented: true,
      },
    },
  },
};

export function capabilitiesOf(type: ConnectionType): Capability[] {
  const preset = CONNECTION_PRESETS[type];
  return CAPABILITIES.filter((cap) => Boolean(preset.capabilities[cap]));
}

export function presetOf(
  type: ConnectionType,
  cap: Capability,
): CapabilityPreset | undefined {
  return CONNECTION_PRESETS[type].capabilities[cap];
}

function normalizeModels(list: string[] | undefined): string[] {
  return [...new Set((list ?? []).map((model) => model.trim()).filter(Boolean))];
}

export function presetModelsByCapability(
  type: ConnectionType,
): Partial<Record<Capability, string[]>> {
  return {
    llm: [...(presetOf(type, "llm")?.models ?? [])],
  };
}

export function modelsByCapabilityOf(
  conn: Pick<ProviderConnection, "type" | "models" | "modelsByCapability">,
): Partial<Record<Capability, string[]>> {
  const explicit = conn.modelsByCapability ?? {};
  const hasExplicit = Object.prototype.hasOwnProperty.call(explicit, "llm");
  const legacy = normalizeModels(conn.models);
  const preset = [...(presetOf(conn.type, "llm")?.models ?? [])];
  const scoped = normalizeModels(explicit.llm);
  const list = scoped.length > 0 ? scoped : hasExplicit ? [] : legacy;
  return { llm: list.length > 0 ? list : preset };
}

export function modelsOf(
  conn:
    | Pick<ProviderConnection, "type" | "models" | "modelsByCapability">
    | undefined,
  cap: Capability,
): string[] {
  if (!conn || cap !== "llm") return [];
  const explicit = conn.modelsByCapability ?? {};
  if (Object.prototype.hasOwnProperty.call(explicit, "llm")) {
    const scoped = normalizeModels(explicit.llm);
    return scoped.length > 0
      ? scoped
      : [...(presetOf(conn.type, "llm")?.models ?? [])];
  }
  const legacy = normalizeModels(conn.models);
  if (legacy.length > 0) return legacy;
  return [...(presetOf(conn.type, "llm")?.models ?? [])];
}

export function defaultModelOf(
  conn: Pick<ProviderConnection, "type" | "models" | "modelsByCapability">,
  cap: Capability,
): string {
  const options = modelsOf(conn, cap);
  const preset = presetOf(conn.type, cap)?.models ?? [];
  return options.find((model) => preset.includes(model)) ?? options[0] ?? "";
}

export const connectionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(CONNECTION_TYPES),
  name: z.string().min(1).max(80),
  apiKey: z.string().default(""),
  /** 旧的扁平模型列表；仅作兼容。 */
  models: z.array(z.string().trim().min(1).max(120)).default([]),
  /** 按能力分组的模型列表。 */
  modelsByCapability: z
    .partialRecord(
      z.enum(CAPABILITIES),
      z.array(z.string().trim().min(1).max(120)),
    )
    .default({}),
  /** 能力级端点覆盖；缺省时用类型预设。 */
  baseUrls: z.record(z.string(), z.string()).default({}),
});

export type ProviderConnection = z.infer<typeof connectionSchema>;

export const capabilityBindingSchema = z.object({
  connectionId: z.string().default(""),
  model: z.string().default(""),
  fallbackConnectionId: z.string().default(""),
  temperature: z.number().min(0).max(2).default(0.7),
});

export type CapabilityBinding = z.infer<typeof capabilityBindingSchema>;

export const bindingsSchema = z.object({
  llm: capabilityBindingSchema.optional(),
});

export type CapabilityBindings = z.infer<typeof bindingsSchema>;

export const providerSettingsSchema = z.object({
  /** 0 = 尚未迁移过旧配置。 */
  version: z.number().int().default(0),
  connections: z.array(connectionSchema).default([]),
  bindings: bindingsSchema.default({}),
});

export type ProviderSettings = z.infer<typeof providerSettingsSchema>;

export const saveProviderRequestSchema = z.object({
  settings: providerSettingsSchema,
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

export const DEFAULT_BINDING: CapabilityBinding = capabilityBindingSchema.parse({});

export function defaultParamsFor(
  cap: Capability,
): Partial<CapabilityBinding> {
  return cap === "llm" ? { temperature: DEFAULT_BINDING.temperature } : {};
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
        model:
          current?.model || defaultModelOf(conn, cap) || preset.models[0] || "",
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
