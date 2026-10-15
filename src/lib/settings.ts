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
  autoGenerateAiPrompt?: boolean;
};

export * from "@/lib/settings-shared";

function envDefaults(): GlobalSettings {
  // 打包版（JUMAN_BUNDLED=1）不读取宿主机环境变量，密钥一律由买家在设置页填写。
  const useEnv = process.env.JUMAN_BUNDLED !== "1";
  const envKey = useEnv ? process.env.DASHSCOPE_API_KEY ?? process.env.dashscope ?? "" : "";
  const envModel = useEnv ? process.env.MODENAME ?? process.env.modename ?? "" : "";
  return {
    llm: {
      provider: "dashscope",
      baseURL: PROVIDER_PRESETS.dashscope.baseURL,
      apiKey: envKey,
      model: envModel || PROVIDER_PRESETS.dashscope.defaultModel,
      temperature: 0.7,
    },
    ffmpeg: { path: process.env.FFMPEG_PATH || "ffmpeg" },
    autoGenerateAiPrompt: true,
  };
}

function mergeSettings(
  base: GlobalSettings,
  partial: SettingsPatch,
): GlobalSettings {
  return {
    llm: { ...base.llm, ...(partial.llm ?? {}) },
    ffmpeg: { ...base.ffmpeg, ...(partial.ffmpeg ?? {}) },
    autoGenerateAiPrompt:
      partial.autoGenerateAiPrompt ?? base.autoGenerateAiPrompt,
  };
}

// 读取缓存：按文件 mtime 失效，避免每次 LLM 调用都读盘。
let settingsCache: { file: string; mtimeMs: number; value: GlobalSettings } | null =
  null;

export function readGlobalSettings(): GlobalSettings {
  const defaults = envDefaults();
  const file = getGlobalSettingsPath();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return defaults;
  }
  if (
    settingsCache &&
    settingsCache.file === file &&
    settingsCache.mtimeMs === stat.mtimeMs
  ) {
    return settingsCache.value;
  }
  try {
    const parsed = JSON.parse(
      fs.readFileSync(file, "utf8"),
    ) as Partial<GlobalSettings>;
    const value = mergeSettings(defaults, parsed);
    settingsCache = { file, mtimeMs: stat.mtimeMs, value };
    return value;
  } catch {
    // 解析失败：备份坏文件，避免随后一次写入把包括 apiKey 在内的设置覆盖没了。
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}.bak`);
    } catch {
      // 备份失败不阻断
    }
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
  // 先写临时文件再原子替换，避免中断写出半个 JSON。
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, file);
  settingsCache = null;
  return next;
}

export function hasApiKey(settings: GlobalSettings): boolean {
  return settings.llm.apiKey.trim().length > 0;
}
