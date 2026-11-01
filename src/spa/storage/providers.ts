import { db } from "./db";
import {
  CONNECTION_PRESETS,
  capabilityBindingSchema,
  connectionSchema,
  defaultModelOf,
  maskApiKeyValue,
  maskProviderSettings,
  normalizeBindings,
  presetOf,
  providerSettingsSchema,
  resolveEndpoint,
  type Capability,
  type ConnectionType,
  type ProviderConnection,
  type ProviderSettings,
} from "@/lib/settings/providers";
import type { LlmConfig } from "./settings";

const PROVIDERS_KEY = "providers";
const LEGACY_LLM_KEY = "llm";

const SECTION_VERSION = 2;

const CONNECTION_DEFAULTS = connectionSchema.parse({
  id: "default",
  type: "custom",
  name: "default",
});

function now(): string {
  return new Date().toISOString();
}

async function readSetting<T>(key: string): Promise<T | null> {
  const record = await db.settings.get(key);
  return (record?.value as T | undefined) ?? null;
}

async function writeSetting<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value, updatedAt: now() });
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
  provider: string,
  baseURL: string,
): ConnectionType {
  if (provider === "dashscope") return "aliyun";
  if (provider === "openai") return "openai";
  return inferType(baseURL, "custom");
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

async function migrateLegacySettings(): Promise<ProviderSettings> {
  const legacy =
    (await readSetting<Partial<LlmConfig>>(LEGACY_LLM_KEY)) ?? {};
  const connections: ProviderConnection[] = [];
  const bindings: ProviderSettings["bindings"] = {};
  const baseUrl = String(legacy.baseUrl ?? "");
  const apiKey = String(legacy.apiKey ?? "");
  const model = String(legacy.model ?? "");

  if (apiKey.trim() || baseUrl.trim() || model.trim()) {
    const type = llmTypeFromLegacy("custom", baseUrl);
    const preset = CONNECTION_PRESETS[type];
    const endpoint = effectiveEndpoint(type, "llm", baseUrl);
    const presetBase = presetOf(type, "llm")?.baseUrl.trim() ?? "";
    const baseUrls: Record<string, string> = {};
    if (endpoint && endpoint !== presetBase) baseUrls.llm = endpoint;
    const conn: ProviderConnection = {
      ...CONNECTION_DEFAULTS,
      id: "conn-1",
      type,
      name: preset.label,
      apiKey,
      baseUrls,
    };
    connections.push(conn);
    bindings.llm = capabilityBindingSchema.parse({
      connectionId: conn.id,
      model,
      temperature: legacy.temperature ?? 0.7,
    });
  }

  return providerSettingsSchema.parse({
    version: SECTION_VERSION,
    connections,
    bindings,
  });
}

export async function getProviderSettings(): Promise<ProviderSettings> {
  const stored = await readSetting<ProviderSettings>(PROVIDERS_KEY);
  if (stored && stored.version >= 1) {
    const normalized = normalizeBindings(providerSettingsSchema.parse(stored));
    if (normalized !== stored) {
      await writeSetting(PROVIDERS_KEY, normalized);
    }
    return normalized;
  }
  const migrated = await migrateLegacySettings();
  await writeSetting(PROVIDERS_KEY, migrated);
  return migrated;
}

export async function getMaskedProviderSettings(): Promise<ProviderSettings> {
  return maskProviderSettings(await getProviderSettings());
}

function findConnection(
  settings: ProviderSettings,
  id: string | undefined,
): ProviderConnection | undefined {
  if (!id) return undefined;
  return settings.connections.find((conn) => conn.id === id);
}

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

async function materializeLegacy(settings: ProviderSettings): Promise<void> {
  const legacy =
    (await readSetting<Partial<LlmConfig>>(LEGACY_LLM_KEY)) ?? {};
  const conn = findConnection(settings, settings.bindings.llm?.connectionId);
  const next: LlmConfig = {
    baseUrl: conn ? resolveEndpoint(conn, "llm") : "",
    apiKey: conn?.apiKey ?? "",
    model: settings.bindings.llm?.model ?? "",
    temperature:
      settings.bindings.llm?.temperature ?? legacy.temperature ?? 0.7,
  };
  await writeSetting(LEGACY_LLM_KEY, next);
}

export async function saveProviderSettings(
  input: ProviderSettings,
): Promise<ProviderSettings> {
  const current = await getProviderSettings();
  const parsed = providerSettingsSchema.parse({
    ...input,
    version: SECTION_VERSION,
    connections: mergeSecrets(input.connections, current.connections),
  });
  const merged = normalizeBindings(parsed);
  await writeSetting(PROVIDERS_KEY, merged);
  await materializeLegacy(merged);
  return merged;
}

export async function getActiveLlmConfig(): Promise<LlmConfig> {
  const settings = await getProviderSettings();
  const binding = settings.bindings.llm;
  const conn = findConnection(settings, binding?.connectionId);
  if (conn) {
    return {
      baseUrl: resolveEndpoint(conn, "llm"),
      apiKey: conn.apiKey,
      model: binding?.model || defaultModelOf(conn, "llm"),
      temperature: binding?.temperature ?? 0.7,
    };
  }
  const legacy =
    (await readSetting<Partial<LlmConfig>>(LEGACY_LLM_KEY)) ?? {};
  return {
    baseUrl: legacy.baseUrl ?? "",
    apiKey: legacy.apiKey ?? "",
    model: legacy.model ?? "",
    temperature: legacy.temperature ?? 0.7,
  };
}

export async function getConnection(
  connectionId: string,
): Promise<ProviderConnection | undefined> {
  const settings = await getProviderSettings();
  return settings.connections.find((conn) => conn.id === connectionId);
}
