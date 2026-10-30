import { registerSettingsSection } from "@core/server/setup";
import {
  readGlobalSettings,
  readSettingsSection,
  writeGlobalSettings,
  writeSettingsSection,
  type LlmProvider,
} from "@core/server/settings";
import {
  capabilityBindingSchema,
  connectionSchema,
  CONNECTION_PRESETS,
  maskApiKeyValue,
  maskProviderSettings,
  normalizeBindings,
  presetOf,
  providerSettingsSchema,
  resolveEndpoint,
  type Capability,
  type CapabilityBindings,
  type ConnectionType,
  type ProviderConnection,
  type ProviderSettings,
} from "./providers";

export const PROVIDERS_SECTION = "providers";
const SECTION_VERSION = 2;
const MIN_SUPPORTED_VERSION = 1;

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
  return stored && stored.version >= MIN_SUPPORTED_VERSION ? stored : null;
}

/** 读取服务商与能力路由；从未保存过时从旧 llm 配置迁移。 */
export function getProviderSettings(): ProviderSettings {
  const stored = readStored();
  if (stored) {
    const normalized = normalizeBindings(stored);
    if (normalized !== stored) {
      writeSettingsSection<ProviderSettings>(PROVIDERS_SECTION, normalized);
    }
    return normalized;
  }
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

function llmTypeFromLegacy(
  provider: LlmProvider,
  baseURL: string,
): ConnectionType {
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

function migrateLegacySettings(): ProviderSettings {
  const llm = readGlobalSettings().llm;
  const connections: ProviderConnection[] = [];
  const bindings: CapabilityBindings = {};

  if (llm.apiKey.trim() || llm.baseURL.trim() || llm.model.trim()) {
    const type = llmTypeFromLegacy(llm.provider, llm.baseURL);
    const preset = CONNECTION_PRESETS[type];
    const endpoint = effectiveEndpoint(type, "llm", llm.baseURL);
    const presetBase = presetOf(type, "llm")?.baseUrl.trim() ?? "";
    const baseUrls: Record<string, string> = {};
    if (endpoint && endpoint !== presetBase) baseUrls.llm = endpoint;
    const conn: ProviderConnection = {
      ...CONNECTION_DEFAULTS,
      id: "conn-1",
      type,
      name: uniqueName(preset.label, connections),
      apiKey: llm.apiKey,
      baseUrls,
    };
    connections.push(conn);
    bindings.llm = capabilityBindingSchema.parse({
      connectionId: conn.id,
      model: llm.model,
      temperature: llm.temperature,
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

/** 把文本路由结果回写到 core 的 llm 设置，供现有 LLM 调用链直接消费。 */
function materialize(settings: ProviderSettings): void {
  const base = readGlobalSettings();
  const llmConn = findConnection(settings, settings.bindings.llm?.connectionId);

  const llm = {
    provider: llmConn ? llmProviderOf(llmConn.type) : base.llm.provider,
    baseURL: llmConn ? resolveEndpoint(llmConn, "llm") : "",
    apiKey: llmConn?.apiKey ?? "",
    model: settings.bindings.llm?.model ?? "",
    temperature: settings.bindings.llm?.temperature ?? base.llm.temperature,
  };

  writeGlobalSettings({ llm });
}

export function saveProviderSettings(
  input: ProviderSettings,
): ProviderSettings {
  const current = getProviderSettings();
  const parsed = providerSettingsSchema.parse({
    ...input,
    version: SECTION_VERSION,
    connections: mergeSecrets(input.connections, current.connections),
  });
  const merged = normalizeBindings(parsed);
  writeSettingsSection<ProviderSettings>(PROVIDERS_SECTION, merged);
  materialize(merged);
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
