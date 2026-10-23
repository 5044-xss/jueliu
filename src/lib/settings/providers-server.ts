import { registerSettingsSection } from "@core/server/setup";
import {
  readGlobalSettings,
  readSettingsSection,
  writeGlobalSettings,
  writeSettingsSection,
  type LlmProvider,
} from "@core/server/settings";
import {
  getGenerationSettings,
  saveGenerationSettings,
  type GenerationSettings,
} from "@/lib/generation/settings";
import {
  capabilityBindingSchema,
  connectionSchema,
  CONNECTION_PRESETS,
  maskApiKeyValue,
  maskProviderSettings,
  presetOf,
  providerSettingsSchema,
  resolveEndpoint,
  type Capability,
  type CapabilityBinding,
  type CapabilityBindings,
  type ConnectionType,
  type GenerationOverrides,
  type ProviderConnection,
  type ProviderSettings,
} from "./providers";

export const PROVIDERS_SECTION = "providers";
const SECTION_VERSION = 1;

const DEFAULTS: ProviderSettings = providerSettingsSchema.parse({});

/** 幂等注册；可在任何读取之前重复调用。 */
export function registerProviderSettings(): void {
  registerSettingsSection<ProviderSettings>({
    key: PROVIDERS_SECTION,
    defaults: DEFAULTS,
    schema: providerSettingsSchema,
  });
}

function readStored(): ProviderSettings | null {
  registerProviderSettings();
  const stored = readSettingsSection<ProviderSettings>(PROVIDERS_SECTION);
  return stored && stored.version >= SECTION_VERSION ? stored : null;
}

/** 读取服务商与能力路由；从未保存过时从旧的 llm/generation 配置迁移。 */
export function getProviderSettings(): ProviderSettings {
  const stored = readStored();
  if (stored) return stored;
  const migrated = migrateLegacySettings();
  writeSettingsSection<ProviderSettings>(PROVIDERS_SECTION, migrated);
  return migrated;
}

export function getMaskedProviderSettings(): ProviderSettings {
  return maskProviderSettings(getProviderSettings());
}

function inferType(baseUrl: string, fallback: ConnectionType): ConnectionType {
  const url = baseUrl.trim().toLowerCase();
  if (!url) return fallback;
  if (url.includes("toapis")) return "toapis";
  if (url.includes("apimart")) return "apimart";
  if (url.includes("dashscope") || url.includes("aliyuncs")) return "aliyun";
  if (url.includes("volces") || url.includes("ark.cn")) return "doubao";
  if (url.includes("api.openai.com")) return "openai";
  if (url.includes("opencode.ai/inference/go")) return "opencode-go";
  return fallback;
}

function llmTypeFromLegacy(provider: LlmProvider, baseURL: string): ConnectionType {
  if (provider === "dashscope") return "aliyun";
  if (provider === "openai") return "openai";
  return inferType(baseURL, "custom");
}

function uniqueName(
  base: string,
  connections: ProviderConnection[],
): string {
  if (!connections.some((c) => c.name === base)) return base;
  let n = 2;
  while (connections.some((c) => c.name === `${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

function effectiveEndpoint(
  type: ConnectionType,
  cap: Capability,
  override: string,
): string {
  const trimmed = override.trim();
  if (trimmed) return trimmed;
  return presetOf(type, cap)?.baseUrl.trim() ?? "";
}

interface LegacySeed {
  cap: Capability;
  type: ConnectionType;
  apiKey: string;
  endpoint: string;
  model: string;
  binding?: Partial<CapabilityBinding>;
  limits?: Partial<
    Pick<
      ProviderConnection,
      "imageConcurrency" | "imageTimeoutMs" | "videoTimeoutMs"
    >
  >;
}

function migrateLegacySettings(): ProviderSettings {
  const llm = readGlobalSettings().llm;
  const gen = getGenerationSettings();
  const seeds: LegacySeed[] = [];

  if (llm.apiKey.trim() || llm.baseURL.trim() || llm.model.trim()) {
    seeds.push({
      cap: "llm",
      type: llmTypeFromLegacy(llm.provider, llm.baseURL),
      apiKey: llm.apiKey,
      endpoint: llm.baseURL,
      model: llm.model,
      binding: { temperature: llm.temperature },
    });
  }

  if (gen.baseUrl.trim() || gen.apiKey.trim()) {
    seeds.push({
      cap: "image",
      type: inferType(gen.baseUrl, "custom"),
      apiKey: gen.apiKey,
      endpoint: gen.baseUrl,
      model: gen.imageModel,
      binding: {
        imageResolution: gen.imageResolution,
        maxRefImages: gen.maxRefImages,
      },
      limits: {
        imageConcurrency: gen.imageConcurrency,
        imageTimeoutMs: gen.timeoutMs,
      },
    });
  }

  if (gen.comfyUrl.trim()) {
    seeds.push({
      cap: "video",
      type: "comfyui",
      apiKey: "",
      endpoint: gen.comfyUrl,
      model: "minimax-h3",
      limits: { videoTimeoutMs: gen.videoTimeoutMs },
    });
  }

  const connections: ProviderConnection[] = [];
  const bindings: CapabilityBindings = {};

  for (const seed of seeds) {
    const preset = CONNECTION_PRESETS[seed.type];
    const endpoint = effectiveEndpoint(seed.type, seed.cap, seed.endpoint);
    const existing = connections.find(
      (conn) =>
        conn.type === seed.type &&
        conn.apiKey.trim() === seed.apiKey.trim() &&
        resolveEndpoint(conn, seed.cap) === endpoint,
    );

    let conn = existing;
    if (!conn) {
      const baseUrls: Record<string, string> = {};
      const presetBase = presetOf(seed.type, seed.cap)?.baseUrl.trim() ?? "";
      if (endpoint && endpoint !== presetBase) baseUrls[seed.cap] = endpoint;
      conn = {
        ...CONNECTION_DEFAULTS,
        id: `conn-${connections.length + 1}`,
        type: seed.type,
        name: uniqueName(preset.label, connections),
        apiKey: seed.apiKey,
        baseUrls,
        ...(seed.limits ?? {}),
      };
      connections.push(conn);
    } else {
      const presetBase = presetOf(seed.type, seed.cap)?.baseUrl.trim() ?? "";
      if (endpoint && endpoint !== presetBase) {
        conn.baseUrls = { ...conn.baseUrls, [seed.cap]: endpoint };
      }
      if (seed.limits) conn = { ...conn, ...seed.limits };
      const idx = connections.findIndex((c) => c.id === conn!.id);
      if (idx >= 0) connections[idx] = conn;
    }

    bindings[seed.cap] = capabilityBindingSchema.parse({
      connectionId: conn.id,
      model: seed.model,
      ...(seed.binding ?? {}),
    });
  }

  return providerSettingsSchema.parse({
    version: SECTION_VERSION,
    connections,
    bindings,
  });
}

const CONNECTION_DEFAULTS = connectionSchema.parse({
  id: "default",
  type: "custom",
  name: "default",
});

function llmProviderOf(type: ConnectionType): LlmProvider {
  if (type === "aliyun") return "dashscope";
  if (type === "openai") return "openai";
  return "custom";
}

function findConnection(
  settings: ProviderSettings,
  id: string | undefined,
): ProviderConnection | undefined {
  if (!id) return undefined;
  return settings.connections.find((conn) => conn.id === id);
}

/** 打码值回传时保留真实 Key；空值也视为不修改。 */
function mergeSecrets(
  incoming: ProviderConnection[],
  current: ProviderConnection[],
): ProviderConnection[] {
  const byId = new Map(current.map((conn) => [conn.id, conn]));
  const seen = new Set<string>();
  return incoming.map((conn, index) => {
    let id = conn.id;
    if (!id || seen.has(id)) id = `conn-${Date.now()}-${index + 1}`;
    seen.add(id);

    const prev = byId.get(id) ?? byId.get(conn.id);
    const incomingKey = conn.apiKey.trim();
    let apiKey = conn.apiKey;
    if (!incomingKey) {
      apiKey = prev?.apiKey ?? "";
    } else if (prev && incomingKey === maskApiKeyValue(prev.apiKey)) {
      apiKey = prev.apiKey;
    }
    return { ...conn, id, apiKey };
  });
}

/**
 * 把路由结果回写到旧的 llm / generation 设置，保证现有生成链路零改动。
 * 第二期接入多协议后，由 provider 适配层直接消费这里的数据。
 */
function materialize(
  settings: ProviderSettings,
  opts: {
    generation?: GenerationOverrides;
    autoGenerateAiPrompt?: boolean;
  },
): void {
  const base = readGlobalSettings();
  const currentGen = getGenerationSettings();

  const llmConn = findConnection(settings, settings.bindings.llm?.connectionId);
  const imageConn = findConnection(
    settings,
    settings.bindings.image?.connectionId,
  );
  const videoConn = findConnection(
    settings,
    settings.bindings.video?.connectionId,
  );

  const llm = {
    provider: llmConn ? llmProviderOf(llmConn.type) : base.llm.provider,
    baseURL: llmConn ? resolveEndpoint(llmConn, "llm") : "",
    apiKey: llmConn?.apiKey ?? "",
    model: settings.bindings.llm?.model ?? "",
    temperature: settings.bindings.llm?.temperature ?? base.llm.temperature,
  };

  const imageBinding = settings.bindings.image;
  const imagePreset = imageConn ? presetOf(imageConn.type, "image") : undefined;
  const imageProtocol =
    imagePreset?.protocol === "apimart-image" ||
    imagePreset?.protocol === "toapis-image"
      ? imagePreset.protocol
      : currentGen.imageProtocol;
  const genPatch: Partial<GenerationSettings> = {
    ...(opts.generation ?? {}),
    baseUrl: imageConn ? resolveEndpoint(imageConn, "image") : "",
    imageProtocol,
    apiKey: imageConn?.apiKey ?? "",
    imageModel: imageBinding?.model || currentGen.imageModel,
    imageResolution: imageBinding?.imageResolution ?? currentGen.imageResolution,
    maxRefImages: imageBinding?.maxRefImages ?? currentGen.maxRefImages,
    imageConcurrency: imageConn?.imageConcurrency ?? currentGen.imageConcurrency,
    timeoutMs: imageConn?.imageTimeoutMs ?? currentGen.timeoutMs,
    comfyUrl: videoConn ? resolveEndpoint(videoConn, "video") : "",
    videoTimeoutMs: videoConn?.videoTimeoutMs ?? currentGen.videoTimeoutMs,
  };

  writeGlobalSettings({
    llm,
    ...(opts.autoGenerateAiPrompt === undefined
      ? {}
      : { autoGenerateAiPrompt: opts.autoGenerateAiPrompt }),
  });
  saveGenerationSettings(genPatch);
}

export function saveProviderSettings(
  input: ProviderSettings,
  opts: {
    generation?: GenerationOverrides;
    autoGenerateAiPrompt?: boolean;
  } = {},
): ProviderSettings {
  const current = getProviderSettings();
  const merged = providerSettingsSchema.parse({
    ...input,
    version: SECTION_VERSION,
    connections: mergeSecrets(input.connections, current.connections),
  });
  writeSettingsSection<ProviderSettings>(PROVIDERS_SECTION, merged);
  materialize(merged, opts);
  return merged;
}

/** 供测试接口使用：拿未打码的连接。 */
export function getConnection(
  connectionId: string,
): ProviderConnection | undefined {
  return getProviderSettings().connections.find(
    (conn) => conn.id === connectionId,
  );
}

export function connectionsSupporting(cap: Capability): ProviderConnection[] {
  return getProviderSettings().connections.filter((conn) =>
    Boolean(presetOf(conn.type, cap)),
  );
}
