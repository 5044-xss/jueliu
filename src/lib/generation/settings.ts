import { z } from "zod";
import { registerSettingsSection } from "@core/server/setup";
import {
  readSettingsSection,
  writeSettingsSection,
  maskSectionSecrets,
} from "@core/server/settings";

// 产品设置段：云端生成（当前走 Toapi 异步图像接口）。
// core 只认自己注册的段，这里把 jueman 的生成配置单独归档进 settings.json 的 "generation" 键。

export const GENERATION_SECTION = "generation";

export const RESOLUTION_OPTIONS = ["1k", "2k", "4k"] as const;

/** 视频一采分辨率档位（按短边 P）。上限 768P = H3 原生上限（约 0.98MP）。 */
export const VIDEO_RESOLUTION_OPTIONS = ["480p", "540p", "608p", "768p"] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTION_OPTIONS)[number];

/** 解析 P 档位字符串（如 "720p"）为**短边**像素。横屏短边=高，竖屏短边=宽。 */
export function resolutionHeightP(res: string): number {
  const n = Number.parseInt(String(res).replace(/p$/i, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 720;
}

function aspectRatioOf(aspect: string): number {
  const [w, h] = aspect.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

/** 目标 P（短边）+ 画幅 → 宽高像素（未对齐）。如竖屏 720p → 720×1280。 */
function resolutionDimensions(
  res: string,
  aspect: string,
): { width: number; height: number } {
  const short = resolutionHeightP(res);
  const ratio = aspectRatioOf(aspect);
  const height = short / Math.min(ratio, 1);
  return { width: height * ratio, height };
}

/**
 * 目标 P + 画幅 → H3 一次采样像素预算（MP）。
 * H3 原生上限约 0.98MP：720P≈0.92MP 接近上限，1080P（≈2.07MP）会被钳制。
 */
export function resolutionToMegapixels(res: string, aspect: string): number {
  const { width, height } = resolutionDimensions(res, aspect);
  const mp = (width * height) / 1_000_000;
  return Math.min(Math.max(mp, 0.1), 0.98);
}

/** 目标 P + 画幅 → 宽高像素（对齐 32）。供无 XB 分辨率节点时回退使用。 */
export function resolutionToSize(
  res: string,
  aspect: string,
): { width: number; height: number } {
  const dim = resolutionDimensions(res, aspect);
  const cap = 0.98;
  const mp = (dim.width * dim.height) / 1_000_000;
  if (mp > cap) {
    // 与 resolutionToMegapixels 同口径：超上限时等比缩小，避免宽高与 MP 不一致。
    const k = Math.sqrt(cap / mp);
    dim.width *= k;
    dim.height *= k;
  }
  const snap = (n: number) => Math.max(32, Math.round(n / 32) * 32);
  return { width: snap(dim.width), height: snap(dim.height) };
}

export const IMAGE_API_PROTOCOLS = ["toapis-image", "apimart-image"] as const;
export type ImageApiProtocol = (typeof IMAGE_API_PROTOCOLS)[number];

export const generationSchema = z.object({
  /** 图像接口地址（Toapi / APIMart 兼容）。国内 Toapi 用 https://toapis.cn/v1。 */
  baseUrl: z.string().min(1).default("https://toapis.cn/v1"),
  /** 图像接口协议；由服务商能力路由写入。 */
  imageProtocol: z.enum(IMAGE_API_PROTOCOLS).default("toapis-image"),
  /** 图像 API Key（密钥，读取时打码）。 */
  apiKey: z.string().default(""),
  /** 图像模型。默认 gpt-image-2（支持文生图 + reference_images 图生图）。 */
  imageModel: z.string().min(1).default("gpt-image-2"),
  /** 输出分辨率档位。 */
  imageResolution: z.enum(RESOLUTION_OPTIONS).default("1k"),
  /** 轮询间隔。 */
  pollIntervalMs: z.number().int().min(500).max(60_000).default(3_000),
  /** 单张出图任务超时（毫秒）。 */
  timeoutMs: z.number().int().min(10_000).max(3_600_000).default(600_000),
  /** 单段视频生成超时（毫秒）。H3 长片常见 15–25 分钟，不能沿用出图超时。 */
  videoTimeoutMs: z
    .number()
    .int()
    .min(60_000)
    .max(21_600_000)
    .default(1_800_000),
  /** 单个任务最多上传的参考图张数（Toapi 上限 14）。 */
  maxRefImages: z.number().int().min(0).max(14).default(14),
  /** 批量出图时同时在跑的任务数（Toapi 账号限流，默认 2；过高会 service_busy）。 */
  imageConcurrency: z.number().int().min(1).max(8).default(2),

  // —— 生视频：自建 ComfyUI（MiniMax H3 极速版镜像）——
  /** ComfyUI 实例地址，如 https://xxxx.container.x-gpu.com 。 */
  comfyUrl: z.string().default(""),
  /** 主模型档：pruned=剪枝（默认）；int8=非剪枝（48G 用，画质更好）。 */
  comfyVideoModel: z.enum(["pruned", "int8"]).default("pruned"),
  /** 采样步数（Turbo 4步 LoRA 设计点 4；推荐 8）。 */
  videoSteps: z.number().int().min(1).max(30).default(8),
  /** 一采分辨率（按视频短边 P）；内部按画幅换算成 MP，H3 像素预算上限约 0.98。 */
  videoResolution: z.enum(VIDEO_RESOLUTION_OPTIONS).default("540p"),
  /** 覆盖画幅（如 "16:9"）；留空用项目比例。 */
  videoAspect: z.string().default(""),
  /** Sage 预设；短片开加速，长片自动关（见 sageMaxDurationSec）。 */
  sagePreset: z.string().default("Nvidia-Sage"),
  /** 段时长 ≥ 该值（秒）时自动关 Sage（新版本栈下 Sage × 长片会崩）。 */
  sageMaxDurationSec: z.number().int().min(1).max(60).default(12),
  /** 显存块互换数；24G 必须 50（否则 OOM），48G 可 0。 */
  blocksToSwap: z.number().int().min(0).max(60).default(50),
  /** 像素放大模型；留空=不放大。长片只用 RealESRGAN_x2，禁用 4x。 */
  videoUpscaleModel: z.string().default(""),
  /** 放大后目标输出高度（如 1440/2160）；0=按倍数。 */
  videoOutHeight: z.number().int().min(0).max(4320).default(0),
  /** 二采（latent 放大重采样）。 */
  videoSecondPass: z.boolean().default(false),
});

export type GenerationSettings = z.infer<typeof generationSchema>;

const DEFAULTS: GenerationSettings = generationSchema.parse({});

/** 幂等注册；可在任何读取设置之前重复调用。 */
export function registerGenerationSettings(): void {
  registerSettingsSection<GenerationSettings>({
    key: GENERATION_SECTION,
    defaults: DEFAULTS,
    schema: generationSchema,
    secrets: ["apiKey"],
  });
}

/** 读取生成配置（未注册/解析失败回退默认）。 */
export function getGenerationSettings(): GenerationSettings {
  registerGenerationSettings();
  return (
    readSettingsSection<GenerationSettings>(GENERATION_SECTION) ?? DEFAULTS
  );
}

/** 读取并打码，供设置页展示。 */
export function getMaskedGenerationSettings(): GenerationSettings {
  return maskSectionSecrets(GENERATION_SECTION, getGenerationSettings());
}

/** 出图前校验图像接口配置（缺失时抛明确错误，避免建了任务却没配置）。 */
export function assertImageGenerationConfigured(): void {
  const s = getGenerationSettings();
  if (!s.baseUrl.trim()) {
    throw new Error("未配置图像接口地址（设置 → 服务商 → 能力路由）");
  }
  if (!s.apiKey.trim()) {
    throw new Error("未配置图像 API Key（设置 → 服务商）");
  }
}

/** 生视频前校验 ComfyUI 配置。 */
export function assertVideoGenerationConfigured(): void {
  const s = getGenerationSettings();
  if (!s.comfyUrl.trim()) {
    throw new Error("未配置 ComfyUI 实例地址（设置 → 生视频（自建 ComfyUI））");
  }
}

/** 写入生成配置（写入前按 schema 校验）。 */
export function saveGenerationSettings(
  patch: Partial<GenerationSettings>,
): GenerationSettings {
  registerGenerationSettings();
  const merged = { ...getGenerationSettings(), ...patch };
  return writeSettingsSection<GenerationSettings>(GENERATION_SECTION, merged);
}
