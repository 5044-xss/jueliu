import { getProject } from "@core/server/projects";
import { getVendor } from "@core/server/library/vendors";
import type { GenerationSettings } from "../settings";
import { resolutionToMegapixels, resolutionToSize } from "../settings";
import type { H3GenParams } from "../comfy";

// ComfyUI（MiniMax H3 极速版）provider profile：
// 把「产品设置 + 本段信息」折成 H3 生成参数（节点级能力由 buildH3Workflow 按 /object_info 决定）。

export const COMFY_PROVIDER_ID = "comfyui";
export const COMFY_PROVIDER_LABEL = "自建 ComfyUI（MiniMax H3）";

const ALLOWED_ASPECTS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);

export interface ResolveH3Input {
  targetMs: number;
  /** 项目比例，如 "9:16"。 */
  aspect: string;
}

// 云端生成只适配 MiniMax H3（platform === "h3"）。其它厂商请先切到 H3。
export function assertH3Project(projectId: string): void {
  const vendor = getVendor(getProject(projectId)?.vendor);
  if (vendor.platform !== "h3") {
    throw new Error(
      "云端生成仅适配 MiniMax H3：请在「分镜」页把厂商切换为「MiniMax H3」后再试",
    );
  }
}

export function isH3Project(projectId: string): boolean {
  return getVendor(getProject(projectId)?.vendor).platform === "h3";
}

export function resolveH3GenParams(
  settings: GenerationSettings,
  input: ResolveH3Input,
): H3GenParams {
  const duration = Math.max(4, Math.min(15, Math.round(input.targetMs / 1000)));
  const aspect = ALLOWED_ASPECTS.has(settings.videoAspect)
    ? settings.videoAspect
    : ALLOWED_ASPECTS.has(input.aspect)
      ? input.aspect
      : "16:9";
  // 长片关 Sage（新版本栈下 Sage × 长片会崩），只留 block swap。
  const longClip = duration >= settings.sageMaxDurationSec;

  // 768P 在长片（默认 ≥12s）下会崩，自动降为 608P，用户无感。
  const resolution =
    settings.videoResolution === "768p" && longClip
      ? "608p"
      : settings.videoResolution;

  // 分辨率：用户给短边 P，按画幅换算成 H3 的 MP 预算与宽高像素。
  const size = resolutionToSize(resolution, aspect);

  return {
    duration,
    steps: settings.videoSteps,
    audioSteps: settings.videoSteps,
    megapixels: resolutionToMegapixels(resolution, aspect),
    aspect,
    width: size.width,
    height: size.height,
    seedAuto: true,
    loraStrength: 1.0,
    sageEnabled: !longClip,
    sagePreset: settings.sagePreset,
    blocksToSwap: settings.blocksToSwap,
    modelPrefix: "",
    loraPrefix: "",
    secondPass: settings.videoSecondPass,
  };
}
