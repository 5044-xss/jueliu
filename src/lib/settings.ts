import fs from "node:fs";
import path from "node:path";
import { getGlobalSettingsPath, ensureWorkspace } from "@/lib/paths";
import {
  PROVIDER_PRESETS,
  type FfmpegSettings,
  type GlobalSettings,
  type LlmSettings,
} from "@/lib/settings-shared";

export type SettingsPatch = {
  llm?: Partial<LlmSettings>;
  ffmpeg?: Partial<FfmpegSettings>;
};

export * from "@/lib/settings-shared";

function envDefaults(): GlobalSettings {
  const envKey = process.env.DASHSCOPE_API_KEY ?? process.env.dashscope ?? "";
  const envModel = process.env.MODENAME ?? process.env.modename ?? "";
  return {
    llm: {
      provider: "dashscope",
      baseURL: PROVIDER_PRESETS.dashscope.baseURL,
      apiKey: envKey,
      model: envModel || PROVIDER_PRESETS.dashscope.defaultModel,
      temperature: 0.7,
    },
    ffmpeg: { path: "ffmpeg" },
  };
}

function mergeSettings(
  base: GlobalSettings,
  partial: SettingsPatch,
): GlobalSettings {
  return {
    llm: { ...base.llm, ...(partial.llm ?? {}) },
    ffmpeg: { ...base.ffmpeg, ...(partial.ffmpeg ?? {}) },
  };
}

export function readGlobalSettings(): GlobalSettings {
  const defaults = envDefaults();
  const file = getGlobalSettingsPath();
  if (!fs.existsSync(file)) return defaults;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, "utf8"),
    ) as Partial<GlobalSettings>;
    return mergeSettings(defaults, parsed);
  } catch {
    return defaults;
  }
}

export function writeGlobalSettings(
  partial: SettingsPatch,
): GlobalSettings {
  ensureWorkspace();
  const current = readGlobalSettings();
  const next = mergeSettings(current, partial);
  const file = getGlobalSettingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function hasApiKey(settings: GlobalSettings): boolean {
  return settings.llm.apiKey.trim().length > 0;
}
