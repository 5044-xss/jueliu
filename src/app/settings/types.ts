export interface GenerationView {
  pollIntervalMs: number;
  comfyVideoModel: "pruned" | "int8";
  videoSteps: number;
  videoResolution: string;
  videoAspect: string;
  sagePreset: string;
  sageMaxDurationSec: number;
  blocksToSwap: number;
  videoUpscaleModel: string;
  videoOutHeight: number;
  videoSecondPass: boolean;
}

export interface ApiCapabilityTestResult {
  ok: boolean;
  implemented: boolean;
  message: string;
}
