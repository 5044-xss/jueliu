import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FormData } from "undici";
import { serverFetch } from "../server-fetch.ts";

// ComfyUI（MiniMax H3 极速版镜像）客户端 + H3 工作流构建。
// 生产逻辑移植自 jueying/backend/jueman/engine（workflows.make_workflow + cloud_http）：
//   A1 schema 规整 _conform_workflow_to_schema；A2 MP 夹取；A3 Sage 策略；
//   A4 崩溃自愈（interrupt/queue_delete）；B1 只认 RealESRGAN_x2；B3 帧数吸附 17k+5。
// 工作流构建参考 jueying，节点结构以新镜像实测为准（fl2v 首尾帧 / ref2v 参生）。

const WORKFLOW_VERSION = "20261016-01";
const MAX_MEGAPIXELS = 0.98;
const FRAME_GRID = 17;
const FRAME_OFFSET = 5;
const FRAME_MIN = 124;

// H3 原生帧数栅格：17k+5（124 / 243 / 362 ...）。
export function snapLength(frames: number): number {
  const k = Math.round((Number(frames) - FRAME_OFFSET) / FRAME_GRID);
  if (!Number.isFinite(k)) return FRAME_MIN;
  return Math.max(FRAME_MIN, FRAME_GRID * k + FRAME_OFFSET);
}

const ASPECT_COMBO: Record<string, string> = {
  "1:1": "1:1 (Square)",
  "2:3": "2:3 (Portrait Photo)",
  "3:2": "3:2 (Photo)",
  "3:4": "3:4 (Portrait Standard)",
  "4:3": "4:3 (Standard)",
  "9:16": "9:16 (Portrait Widescreen)",
  "16:9": "16:9 (Widescreen)",
  "21:9": "21:9 (Ultrawide)",
  "4:5": "4:5 (Portrait Tall)",
  "5:4": "5:4 (Landscape Tall)",
};

const LORA_DEFAULT = {
  fl2v: "minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16.safetensors",
  ref2v: "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
};

const UNET_DEFAULT = {
  fl2va: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  ref2va: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
};

const CLIP_DEFAULT = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors";
const VIDEO_VAE_DEFAULT = "minimax_h3_video_vae_int8_convrot.safetensors";
const AUDIO_VAE_DEFAULT = "minimax_h3_audio_vae_fp32.safetensors";
const LEARNED_UPSCALER_DEFAULT = "minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors";

export type ComfyNode = { class_type: string; inputs: Record<string, unknown> };
export type ComfyWorkflow = Record<string, ComfyNode>;

/** 由 /object_info 探测到的集群能力。 */
export interface ClusterCaps {
  hasMultirate: boolean;
  hasSageBlockswap: boolean;
  hasSagePatch: boolean;
  hasSavevideo: boolean;
  hasVhs: boolean;
  hasXbResolution: boolean;
  hasUpscaler3d: boolean;
  hasLatentUpscale: boolean;
  upscalerModels: string[];
}

// /object_info 拉取失败时的兜底（按新镜像实测：有 XB/SaveVideo，无 MultiRate）。
export const DEFAULT_CAPS: ClusterCaps = {
  hasMultirate: false,
  hasSageBlockswap: true,
  hasSagePatch: false,
  hasSavevideo: true,
  hasVhs: true,
  hasXbResolution: true,
  hasUpscaler3d: true,
  hasLatentUpscale: true,
  upscalerModels: [],
};

export type ObjectInfo = Record<string, { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }>;

export function detectCaps(objectInfo: ObjectInfo | null | undefined): ClusterCaps {
  if (!objectInfo || typeof objectInfo !== "object") return { ...DEFAULT_CAPS };
  const has = (name: string) => !!objectInfo[name];
  const upSpec = objectInfo["MinimaxH3LatentUpscaler3D"]?.input?.required?.model_name;
  const upscalerModels =
    Array.isArray(upSpec) && Array.isArray((upSpec as unknown[])[0])
      ? ((upSpec as unknown[])[0] as string[])
      : [];
  return {
    hasMultirate: has("MiniMaxH3MultiRateSamplerEXPT8"),
    hasSageBlockswap: has("XB_Sage_BlockSwap"),
    hasSagePatch: has("MiniMaxH3MemoryEfficientSageAttentionPatch"),
    hasSavevideo: has("SaveVideo") && has("CreateVideo"),
    hasVhs: has("VHS_VideoCombine"),
    hasXbResolution: has("XB_HailuoH3VideoParams"),
    hasUpscaler3d: has("MinimaxH3LatentUpscaler3D"),
    hasLatentUpscale: has("H3LatentUpscaleByJingchen573"),
    upscalerModels,
  };
}

export interface H3GenParams {
  duration: number; // 秒，4–15
  steps?: number;
  audioSteps?: number;
  megapixels?: number;
  aspect?: string;
  width?: number;
  height?: number;
  seed?: number;
  seedAuto?: boolean;
  loraStrength?: number;
  qualityLora?: string;
  qualityLoraStrength?: number;
  sageEnabled?: boolean;
  sagePreset?: string;
  blocksToSwap?: number;
  modelPrefix?: string;
  loraPrefix?: string;
  unetName?: string;
  ref2vaUnetName?: string;
  clipName?: string;
  videoVae?: string;
  audioVae?: string;
  learnedModel?: string;
  secondPass?: boolean;
  secondScale?: number;
  secondSteps?: number;
  secondDenoise?: number;
  secondUpscaler?: "learned" | "h3" | "latent";
}

export interface BuildH3Input {
  prompt: string;
  name: string;
  images?: string[];
  audios?: string[];
  videos?: string[];
  gen: H3GenParams;
  caps?: ClusterCaps;
  /** true=参生 Ref2VA（多参考图）；false=图生/文生 FL2VA（images[0]=首帧、[1]=尾帧）。 */
  useReference?: boolean;
}

export interface BuiltWorkflow {
  workflow: ComfyWorkflow;
  seed: number;
  mode: string;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function join(prefix: string, fname: string): string {
  return (prefix ? prefix + "/" : "") + fname;
}

/** 构建 H3 工作流（按集群能力选择采样/输出/Sage/二采链路）。 */
export function buildH3Workflow(input: BuildH3Input): BuiltWorkflow {
  const g = input.gen;
  const caps = input.caps ?? { ...DEFAULT_CAPS };
  const dur = clamp(Math.round(g.duration || 10), 4, 15);
  const seed =
    !g.seedAuto && Number.isFinite(g.seed) && (g.seed as number) > 0
      ? Math.trunc(g.seed as number)
      : Math.floor(Math.random() * 1e9);
  const images = (input.images ?? []).filter(Boolean).slice(0, 9);
  const audios = (input.audios ?? []).filter(Boolean).slice(0, 3);
  const videos = (input.videos ?? []).filter(Boolean).slice(0, 3);
  const useRef = !!input.useReference;
  const modelPrefix = g.modelPrefix ?? "";
  const loraPrefix = g.loraPrefix ?? modelPrefix;

  const unetFile = useRef
    ? g.ref2vaUnetName?.trim() || UNET_DEFAULT.ref2va
    : g.unetName?.trim() || UNET_DEFAULT.fl2va;
  const loraFile = useRef ? LORA_DEFAULT.ref2v : LORA_DEFAULT.fl2v;

  const wf: ComfyWorkflow = {
    "182": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "232": { class_type: "UNETLoader", inputs: { unet_name: join(modelPrefix, unetFile), weight_dtype: "default" } },
    "231": { class_type: "LoraLoaderModelOnly", inputs: { model: ["232", 0], lora_name: join(loraPrefix, loraFile), strength_model: g.loraStrength ?? 1.0 } },
    "233": { class_type: "CLIPLoader", inputs: { clip_name: g.clipName?.trim() || CLIP_DEFAULT, type: "minimax", device: "default" } },
    "234": { class_type: "VAELoader", inputs: { vae_name: join(modelPrefix, g.videoVae?.trim() || VIDEO_VAE_DEFAULT) } },
    "235": { class_type: "VAELoader", inputs: { vae_name: join(modelPrefix, g.audioVae?.trim() || AUDIO_VAE_DEFAULT) } },
    "209": { class_type: "PrimitiveStringMultiline", inputs: { value: input.prompt } },
  };

  // 质感 LoRA（可选）
  let modelRef: [string, number] = ["231", 0];
  if (g.qualityLora?.trim()) {
    wf["252"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: modelRef, lora_name: join(loraPrefix, g.qualityLora.trim()), strength_model: g.qualityLoraStrength ?? 0.8 },
    };
    modelRef = ["252", 0];
  }

  // Sage / block swap（A3）
  if (caps.hasSageBlockswap) {
    const preset = g.sageEnabled === false ? "关闭" : g.sagePreset || "Nvidia-Sage";
    wf["230"] = { class_type: "XB_Sage_BlockSwap", inputs: { model: modelRef, sage_preset: preset, blocks_to_swap: g.blocksToSwap ?? 50 } };
    modelRef = ["230", 0];
  } else if (caps.hasSagePatch) {
    wf["230"] = { class_type: "MiniMaxH3MemoryEfficientSageAttentionPatch", inputs: { model: modelRef } };
    modelRef = ["230", 0];
  }

  const steps = g.steps ?? 8;
  const width = g.width ?? 960;
  const height = g.height ?? 544;
  const snap = snapLength(dur * 24 + 3);

  // 条件节点：参生 ReferenceToVideo / 图生 ImageToVideo
  if (useRef) {
    const refNode: Record<string, unknown> = {
      clip: ["233", 0], vae: ["234", 0], audio_vae: ["235", 0], prompt: ["209", 0],
      width, height, length: snap, ref_image_size: "match",
    };
    images.forEach((img, i) => {
      wf[String(1000 + i)] = { class_type: "LoadImage", inputs: { image: img } };
      refNode[`ref_images.ref_image_${i}`] = [String(1000 + i), 0];
    });
    wf["167"] = { class_type: "MiniMaxH3ReferenceToVideo", inputs: refNode };
  } else {
    const refNode: Record<string, unknown> = { clip: ["233", 0], vae: ["234", 0], prompt: ["209", 0], width, height, length: snap };
    images.forEach((img, i) => {
      wf[String(1000 + i)] = { class_type: "LoadImage", inputs: { image: img } };
      if (i === 0) refNode.first_frame = [String(1000 + i), 0];
      else if (i === 1) refNode.last_frame = [String(1000 + i), 0];
    });
    wf["167"] = { class_type: "MiniMaxH3ImageToVideo", inputs: refNode };
  }

  // 音频/视频参考（参生）
  audios.forEach((a, i) => {
    wf[String(2000 + i)] = { class_type: "LoadAudio", inputs: { audio: a } };
    (wf["167"].inputs as Record<string, unknown>)[`ref_audios.ref_audio_${i}`] = [String(2000 + i), 0];
  });
  videos.forEach((v, i) => {
    wf[String(3000 + i)] = { class_type: "LoadVideo", inputs: { video: v } };
    (wf["167"].inputs as Record<string, unknown>)[`ref_videos.ref_video_${i}`] = [String(3000 + i), 0];
  });

  // 分辨率节点（XB_HailuoH3VideoParams）：输出 Width/Height/Frames
  if (caps.hasXbResolution) {
    const aspect = ASPECT_COMBO[g.aspect ?? ""] ?? ASPECT_COMBO["16:9"];
    const mp = clamp(Number(g.megapixels) || 1.0, 0.1, MAX_MEGAPIXELS);
    wf["555"] = {
      class_type: "XB_HailuoH3VideoParams",
      inputs: { aspect_ratio: aspect, megapixels: mp, multiple: 32, frames_display: "", duration: dur, scale_factor: 1.0 },
    };
    const ri = wf["167"].inputs as Record<string, unknown>;
    ri.width = ["555", 0];
    ri.height = ["555", 1];
    ri.length = ["555", 2];
  }

  // 一采：MultiRate（若集群有）或核心 KSamplerSelect + BasicScheduler
  if (caps.hasMultirate) {
    const vs = Math.max(1, Math.round(g.steps ?? 8));
    const as = Math.max(vs, Math.round(g.audioSteps ?? g.steps ?? 8));
    wf["241"] = {
      class_type: "MiniMaxH3MultiRateSamplerEXPT8",
      inputs: { model: modelRef, av_latent: ["167", 1], video_steps: vs, audio_steps: as, shift_video: 12, shift_audio: 3 },
    };
    wf["183"] = { class_type: "BasicGuider", inputs: { model: ["241", 0], conditioning: ["167", 0] } };
    wf["188"] = { class_type: "SamplerCustomAdvanced", inputs: { noise: ["182", 0], guider: ["183", 0], sampler: ["241", 1], sigmas: ["241", 2], latent_image: ["167", 1] } };
  } else {
    wf["236"] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
    wf["238"] = { class_type: "BasicScheduler", inputs: { model: modelRef, steps: Math.max(1, Math.round(steps)), scheduler: "simple", denoise: 1.0 } };
    wf["183"] = { class_type: "BasicGuider", inputs: { model: modelRef, conditioning: ["167", 0] } };
    wf["188"] = { class_type: "SamplerCustomAdvanced", inputs: { noise: ["182", 0], guider: ["183", 0], sampler: ["236", 0], sigmas: ["238", 0], latent_image: ["167", 1] } };
  }
  let sampleOut = "188";

  // 二采（可选）
  if (g.secondPass) {
    const secondScale = clamp(Number(g.secondScale) || 1.5, 1.0, 4.0);
    const secondDenoise = clamp(Number(g.secondDenoise) || 0.3, 0.1, 1.0);
    const secondSteps = Math.max(1, Math.round(g.secondSteps ?? steps));
    wf["242"] = { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: [sampleOut, 0] } };
    let upscaler = (g.secondUpscaler ?? "learned").toLowerCase();
    if (upscaler === "learned" && (!caps.hasUpscaler3d || (caps.upscalerModels.length === 0 && caps.hasUpscaler3d))) {
      if (!caps.hasUpscaler3d) upscaler = "latent";
    }
    if (upscaler === "learned") {
      let learned = g.learnedModel?.trim() || LEARNED_UPSCALER_DEFAULT;
      if (caps.upscalerModels.length) {
        const base = (p: string) => p.split("/").pop()?.toLowerCase() ?? p.toLowerCase();
        if (!caps.upscalerModels.some((m) => base(m) === base(learned))) {
          const cands = caps.upscalerModels.filter((m) => m.toLowerCase().includes("latent_upscaler"));
          const pool = cands.length ? cands : caps.upscalerModels;
          const sorted = [...pool].sort((a, b) => (a.toLowerCase().includes("conv_v1") ? 0 : 1) - (b.toLowerCase().includes("conv_v1") ? 0 : 1));
          learned = sorted[0];
        }
      }
      wf["243"] = {
        class_type: "MinimaxH3LatentUpscaler3D",
        inputs: { latent: ["242", 0], model_name: learned, mode: "scale by multiplier", "mode.scale": secondScale, align: 32, enable_temporal_chunking: true, force_unload: true, device: "cuda", precision: "bf16" },
      };
    } else if (upscaler === "h3" && caps.hasLatentUpscale) {
      wf["243"] = { class_type: "H3LatentUpscaleByJingchen573", inputs: { samples: ["242", 0], upscale_method: "bicubic", scale_by: secondScale } };
    } else {
      wf["243"] = { class_type: "LatentUpscaleBy", inputs: { samples: ["242", 0], upscale_method: "bicubic", scale_by: secondScale } };
    }
    wf["244"] = { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["243", 0], audio_latent: ["242", 1] } };
    wf["245"] = { class_type: "RandomNoise", inputs: { noise_seed: seed } };
    wf["246"] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
    wf["247"] = { class_type: "BasicScheduler", inputs: { model: modelRef, steps: secondSteps, scheduler: "simple", denoise: secondDenoise } };
    wf["248"] = { class_type: "BasicGuider", inputs: { model: modelRef, conditioning: ["167", 0] } };
    wf["249"] = { class_type: "SamplerCustomAdvanced", inputs: { noise: ["245", 0], guider: ["248", 0], sampler: ["246", 0], sigmas: ["247", 0], latent_image: ["244", 0] } };
    // 音频锁定：二采只精修视频，音频换回一采原始 latent。
    wf["250"] = { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["249", 0] } };
    wf["251"] = { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["250", 0], audio_latent: ["242", 1] } };
    sampleOut = "251";
  }

  wf["189"] = { class_type: "VAEDecode", inputs: { samples: [sampleOut, 0], vae: ["234", 0] } };
  wf["190"] = { class_type: "VAEDecodeAudio", inputs: { samples: [sampleOut, 0], vae: ["235", 0] } };

  // 输出：优先 SaveVideo，退回 VHS_VideoCombine
  if (caps.hasSavevideo) {
    wf["240"] = { class_type: "CreateVideo", inputs: { images: ["189", 0], audio: ["190", 0], fps: 24 } };
    wf["92"] = { class_type: "SaveVideo", inputs: { video: ["240", 0], filename_prefix: `jueman/H3Studio-${input.name}`, format: "auto" } };
  } else {
    wf["237"] = {
      class_type: "VHS_VideoCombine",
      inputs: { images: ["189", 0], audio: ["190", 0], frame_rate: 24, loop_count: 0, filename_prefix: `jueman/H3Studio-${input.name}`, format: "video/h264-mp4", pingpong: false, save_output: true },
    };
  }

  const mode = useRef ? "参生 Ref2VA" : images.length ? "图生 FL2VA" : "文生 FL2VA";
  return { workflow: wf, seed, mode: `${mode} · ${WORKFLOW_VERSION}` };
}

// ---------------- A1 / 自愈：schema 规整 + 模型名回退 ----------------

function specDefault(spec: unknown): unknown {
  const MISSING = Symbol("missing");
  if (!Array.isArray(spec) || spec.length === 0) return MISSING;
  const typ = spec[0];
  const opts = spec.length > 1 && typeof spec[1] === "object" && spec[1] ? (spec[1] as Record<string, unknown>) : {};
  if ("default" in opts) return opts.default;
  if (Array.isArray(typ) && typ.length) return typ[0];
  return MISSING;
}

/** A1：按 /object_info 删除多余普通值输入、补齐缺失必填（保留所有连线与动态控件）。 */
export function conformWorkflowToSchema(
  workflow: ComfyWorkflow,
  objectInfo: ObjectInfo | null | undefined,
): { workflow: ComfyWorkflow; notes: string[] } {
  if (!objectInfo || typeof objectInfo !== "object" || !Object.keys(objectInfo).length) {
    return { workflow, notes: [] };
  }
  const wf = JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
  const notes: string[] = [];
  for (const nid of Object.keys(wf)) {
    const node = wf[nid];
    if (!node || typeof node !== "object") continue;
    const info = objectInfo[node.class_type];
    if (!info || typeof info !== "object") continue;
    const spec = info.input ?? {};
    const req = (spec.required ?? {}) as Record<string, unknown>;
    const opt = (spec.optional ?? {}) as Record<string, unknown>;
    const known = new Set([...Object.keys(req), ...Object.keys(opt)]);
    if (!known.size) continue;
    const inputs = node.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    for (const k of Object.keys(inputs)) {
      if (known.has(k)) continue;
      if (Array.isArray(inputs[k])) continue; // 连线一律保留
      if (k.includes(".")) continue; // 动态控件（mode.scale 等）保留
      delete inputs[k];
      notes.push(`删除 ${nid}.${k}`);
    }
    for (const k of Object.keys(req)) {
      if (k in inputs) continue;
      const dv = specDefault(req[k]);
      if (typeof dv === "symbol") continue;
      inputs[k] = dv;
      notes.push(`补 ${nid}.${k}=${String(dv)}`);
    }
  }
  return { workflow: wf, notes };
}

function basename(p: string): string {
  return p.includes("/") ? p.slice(p.indexOf("/") + 1) : p;
}

const LORA_PRIORITY: [string, number][] = [
  ["8step_v1.0", 0], ["4step_v1.1", 1], ["4step_v1.0", 2], ["lightx2v_turbo_4step", 3], ["4step", 4], ["turbo", 5],
];

function loraPriority(name: string): number {
  const low = name.toLowerCase();
  for (const [pat, rank] of LORA_PRIORITY) if (low.includes(pat)) return rank;
  return 99;
}

/** 为一个 value_not_in_list 输入挑选集群可接受的替代文件名（只选同族，绝不跨 FL2VA/Ref2VA）。 */
export function pickModelFileFallback(inputName: string, cur: string, valid: string[]): string | null {
  if (!valid.length) return null;
  const curBase = basename(String(cur)).toLowerCase();
  for (const v of valid) if (basename(v).toLowerCase() === curBase) return v;
  if (inputName === "lora_name") {
    const cands = valid.filter((v) => v.toLowerCase().includes("fl2v") && v.toLowerCase().includes("turbo"));
    return cands.length ? [...cands].sort((a, b) => loraPriority(a) - loraPriority(b))[0] : null;
  }
  if (inputName === "unet_name") {
    if (curBase.includes("ref2va")) {
      const c = valid.filter((v) => v.toLowerCase().includes("ref2va"));
      return c[0] ?? null;
    }
    const c = valid.filter((v) => v.toLowerCase().includes("fl2va") || v.toLowerCase().includes("fl2v"));
    if (c.length) return [...c].sort((a, b) => (a.toLowerCase().includes("pruned") ? 0 : 1) - (b.toLowerCase().includes("pruned") ? 0 : 1))[0];
    const c2 = valid.filter((v) => v.toLowerCase().includes("minimax_h3") && !v.toLowerCase().includes("ref2va"));
    return c2[0] ?? null;
  }
  if (inputName === "clip_name") {
    for (const kw of ["qwen3vl_32b_minimax_h3", "qwen3vl_32b", "qwen3vl", "minimax_h3"]) {
      const v = valid.find((x) => x.toLowerCase().includes(kw));
      if (v) return v;
    }
    return null;
  }
  if (inputName === "vae_name") {
    for (const kw of ["minimax_h3_video_vae", "minimax_h3_audio_vae", "minimax_h3"]) {
      const v = valid.find((x) => x.toLowerCase().includes(kw));
      if (v) return v;
    }
    return null;
  }
  if (inputName === "model_name") {
    for (const kw of ["conv_v1", "latent_upscaler_3d", "latent_upscaler"]) {
      const v = valid.find((x) => x.toLowerCase().includes(kw));
      if (v) return v;
    }
    return null;
  }
  return null;
}

/** 解析 ComfyUI 400 node_errors，改选可用模型文件名；无可改返回 null。 */
export function healWorkflowFileInputs(
  workflow: ComfyWorkflow,
  rawBody: string,
): { workflow: ComfyWorkflow; notes: string[] } | null {
  let data: { node_errors?: Record<string, { errors?: unknown[] }> };
  try {
    data = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const nodeErrors = data.node_errors;
  if (!nodeErrors || typeof nodeErrors !== "object") return null;
  const wf = JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
  const notes: string[] = [];
  let changed = false;
  for (const nodeId of Object.keys(nodeErrors)) {
    const err = nodeErrors[nodeId];
    const errs = Array.isArray(err?.errors) ? err.errors : [];
    for (const e of errs) {
      const ee = e as { type?: string; extra_info?: { input_name?: string; input_config?: unknown } };
      if (ee.type !== "value_not_in_list") continue;
      const iname = ee.extra_info?.input_name;
      if (!iname) continue;
      const ival = ee.extra_info?.input_config;
      const valid = Array.isArray(ival) && Array.isArray(ival[0]) ? (ival[0] as string[]) : [];
      if (!valid.length) continue;
      const node = wf[nodeId];
      if (!node || typeof node.inputs !== "object") continue;
      const cur = node.inputs[iname];
      if (typeof cur !== "string") continue;
      const picked = pickModelFileFallback(iname, cur, valid);
      if (picked && picked !== cur) {
        node.inputs[iname] = picked;
        notes.push(`${nodeId}.${iname}: ${cur} -> ${picked}`);
        changed = true;
      }
    }
  }
  return changed ? { workflow: wf, notes } : null;
}

// ---------------- 客户端 ----------------

export interface ComfyConfig {
  baseUrl: string;
  timeoutMs?: number;
}

export interface ComfyViewItem {
  filename: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyUploadResult {
  name: string;
  subfolder: string;
  type: string;
}

/** 与 ComfyUI 前端一致的双进度：总进度 + 当前节点步进。 */
export interface ComfyProgress {
  total: number;
  current: number | null;
}

export interface ComfyHistoryItem {
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
  outputs?: Record<string, Record<string, unknown>>;
}

export type ComfyHistory = Record<string, ComfyHistoryItem>;

function joinUrl(base: string, p: string): string {
  return `${base.replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`;
}

const VIDEO_EXT = /\.(mp4|webm|mkv|mov|gif)$/i;

/** 是否是真的 ComfyUI（/system_stats 含 system.comfyui_version|os），排除控制台网页 2xx 兜底。 */
export async function isComfyUiStat(raw: string): Promise<boolean> {
  try {
    const j = JSON.parse(raw) as { system?: { comfyui_version?: unknown; os?: unknown } };
    const sys = j?.system;
    return !!sys && typeof sys === "object" && ("comfyui_version" in sys || "os" in sys);
  } catch {
    return false;
  }
}

export class ComfyClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  /**
   * 提交与 WebSocket 必须共用同一个 client_id：
   * ComfyUI 只把 executing/progress/executed 推给提交方，若提交不带
   * client_id（None），这些事件不会广播，进度条就只剩 progress_state 可依赖。
   */
  private readonly clientId = randomUUID();
  private objectInfoCache: ObjectInfo | null = null;
  private conformed = false;

  constructor(cfg: ComfyConfig) {
    if (!cfg.baseUrl || !cfg.baseUrl.trim()) {
      throw new Error("缺少 ComfyUI 实例地址，请先在设置里填写");
    }
    this.baseUrl = cfg.baseUrl.trim();
    this.timeoutMs = cfg.timeoutMs ?? 120_000;
  }

  private async request(p: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
    return serverFetch(joinUrl(this.baseUrl, p), { ...init, signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs) });
  }

  async getObjectInfo(): Promise<ObjectInfo | null> {
    if (this.objectInfoCache) return this.objectInfoCache;
    try {
      const res = await this.request("/object_info", { method: "GET" }, 60_000);
      if (!res.ok) return (this.objectInfoCache = {});
      this.objectInfoCache = ((await res.json()) as ObjectInfo) ?? {};
      return this.objectInfoCache;
    } catch {
      return (this.objectInfoCache = {});
    }
  }

  /** 连通性自检：GET /system_stats 且必须是 ComfyUI JSON。 */
  async test(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const res = await this.request("/system_stats", { method: "GET" }, 20_000);
      const raw = await res.text();
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      if (await isComfyUiStat(raw)) return { ok: true, detail: raw.slice(0, 200) };
      return { ok: false, detail: "返回内容不是 ComfyUI（疑似填了云厂商控制台/网页地址）" };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }

  async uploadImage(data: Buffer, filename: string, mime = "image/png"): Promise<ComfyUploadResult> {
    const form = new FormData();
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    form.append("image", new Blob([bytes], { type: mime }), filename);
    form.append("type", "input");
    form.append("overwrite", "true");
    const res = await this.request("/upload/image", { method: "POST", body: form as unknown as BodyInit }, 300_000);
    if (!res.ok) throw new Error(`上传参考图到 ComfyUI 失败（HTTP ${res.status}）`);
    const body = (await res.json()) as ComfyUploadResult;
    if (!body?.name) throw new Error("ComfyUI 上传返回异常（缺 name）");
    return body;
  }

  /** 提交工作流：先按 object_info 规整（A1），400 模型缺失时自愈重试（最多 3 次）。 */
  async queuePrompt(workflow: ComfyWorkflow, objectInfo: ObjectInfo | null): Promise<string> {
    const wf = objectInfo && !this.conformed ? (this.conformed = true, conformWorkflowToSchema(workflow, objectInfo).workflow) : workflow;
    return this.postPrompt(wf, objectInfo, 0);
  }

  private async postPrompt(wf: ComfyWorkflow, objectInfo: ObjectInfo | null, depth: number): Promise<string> {
    const res = await this.request("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: wf, client_id: this.clientId }) }, 120_000);
    if (res.status === 400) {
      const raw = await res.text();
      const healed = objectInfo ? healWorkflowFileInputs(wf, raw) : null;
      if (healed && depth < 3) return this.postPrompt(healed.workflow, objectInfo, depth + 1);
      throw new Error(`ComfyUI 拒绝工作流（HTTP 400）：${raw.slice(0, 400)}`);
    }
    const body = (await res.json().catch(() => null)) as { prompt_id?: string; node_errors?: Record<string, unknown> } | null;
    if (!res.ok || (body?.node_errors && Object.keys(body.node_errors).length)) {
      throw new Error(`ComfyUI 拒绝工作流（HTTP ${res.status}）：${JSON.stringify(body)}`);
    }
    if (!body?.prompt_id) throw new Error(`ComfyUI 未返回 prompt_id：${JSON.stringify(body)}`);
    return body.prompt_id;
  }

  /** 提交前的连通性探测（防止把任务提交到离线实例后卡死）。 */
  async ping(): Promise<{ ok: boolean; detail?: string }> {
    return this.test();
  }

  async getHistory(promptId: string): Promise<ComfyHistory> {
    const res = await this.request(`/history/${encodeURIComponent(promptId)}`, { method: "GET" }, 15_000);
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`查询 ComfyUI history 失败（HTTP ${res.status}）`);
    return (await res.json()) as ComfyHistory;
  }

  /**
   * 监听 ComfyUI 的实时执行进度（WebSocket）。实例不支持或环境缺少
   * WebSocket 时静默降级，不影响原有轮询流程。
   *
   * 进度口径与 ComfyUI 前端一致：
   * - total = 已完成节点数 / 本次工作流节点总数（对应云端「总进度」）；
   * - current = 正在执行节点的 value/max（对应云端「当前节点」步进）。
   */
  watchProgress(
    promptId: string,
    opts: { totalNodes: number },
    onProgress: (progress: ComfyProgress) => void,
  ): { close: () => void } {
    const WebSocketCtor = globalThis.WebSocket;
    if (typeof WebSocketCtor !== "function") return { close: () => {} };
    const totalNodes = Math.max(1, Math.floor(opts.totalNodes) || 1);
    const finished = new Set<string>();
    let current: number | null = null;
    let done = false;
    let lastTotal = -1;
    let lastCurrent: number | null = null;
    const emit = (force = false) => {
      if (done) return;
      // 收尾前最多 99%，成功后由 execution_success 推到 100。
      const total = Math.min(
        99,
        Math.round((finished.size / totalNodes) * 100),
      );
      if (!force && total === lastTotal && current === lastCurrent) return;
      lastTotal = total;
      lastCurrent = current;
      onProgress({ total, current });
    };
    let closed = false;
    let socket: WebSocket | null = null;
    try {
      const wsUrl = `${this.baseUrl.replace(/^http/i, "ws").replace(/\/+$/, "")}/ws?clientId=${this.clientId}`;
      socket = new WebSocketCtor(wsUrl);
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let message: {
          type?: string;
          data?: {
            prompt_id?: string;
            value?: number;
            max?: number;
            node?: string | null;
            nodes?:
              | string[]
              | Record<
                  string,
                  { state?: string; value?: number; max?: number }
                >;
          };
        };
        try {
          message = JSON.parse(event.data) as typeof message;
        } catch {
          return;
        }
        const data = message.data;
        if (!data || data.prompt_id !== promptId) return;
        const percent = (value?: number, max?: number) =>
          typeof value === "number" && typeof max === "number" && max > 0
            ? Math.max(0, Math.min(100, Math.round((value / max) * 100)))
            : null;

        switch (message.type) {
          case "execution_start":
            finished.clear();
            current = 0;
            emit(true);
            break;
          case "execution_cached":
            if (Array.isArray(data.nodes)) {
              for (const node of data.nodes) {
                if (typeof node === "string") finished.add(node);
              }
              emit();
            }
            break;
          case "executing":
            // 新节点开始：当前节点进度归零。
            current = 0;
            emit();
            break;
          case "executed":
            if (typeof data.node === "string") {
              finished.add(data.node);
              emit();
            }
            break;
          case "progress": {
            const value = percent(data.value, data.max);
            if (value !== null) {
              current = value;
              emit();
            }
            break;
          }
          case "progress_state":
            if (data.nodes && !Array.isArray(data.nodes)) {
              for (const [nodeId, state] of Object.entries(data.nodes)) {
                if (state?.state === "finished" || state?.state === "error") {
                  finished.add(nodeId);
                } else if (state?.state === "running") {
                  const value = percent(state.value, state.max);
                  if (value !== null) current = value;
                }
              }
              emit();
            }
            break;
          case "execution_success":
            done = true;
            onProgress({ total: 100, current });
            break;
        }
      };
    } catch {
      return { close: () => {} };
    }
    return {
      close: () => {
        if (closed) return;
        closed = true;
        try {
          socket?.close();
        } catch {
          // 忽略关闭失败
        }
      },
    };
  }

  async interrupt(): Promise<void> {
    try {
      await this.request("/interrupt", { method: "POST" }, 10_000);
    } catch {
      // 中断失败不阻断（引擎可能已崩）。
    }
  }

  /** 从云端队列删除指定任务（/queue {delete:[...]}）。 */
  async queueDelete(promptIds: string[]): Promise<void> {
    try {
      await this.request("/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: promptIds }) }, 30_000);
    } catch {
      // 忽略
    }
  }

  /** 流式下载产物到文件（不占内存，适合大视频）。 */
  async downloadToFile(item: ComfyViewItem, destPath: string, progress?: (bytes: number) => void): Promise<string> {
    const params = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder ?? "", type: item.type ?? "output" });
    const res = await this.request(`/view?${params.toString()}`, { method: "GET" }, 600_000);
    if (!res.ok || !res.body) throw new Error(`下载 ComfyUI 产物失败（HTTP ${res.status}）`);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    let bytes = 0;
    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    if (progress) {
      source.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        progress(bytes);
      });
    }
    await pipeline(source, fs.createWriteStream(destPath));
    return destPath;
  }
}

/** 从 history 条目里找出产物文件（优先 SaveVideo 节点 92，其次视频扩展）。 */
export function extractVideoOutput(history: ComfyHistory, promptId: string): ComfyViewItem | null {
  const entry = history[promptId];
  if (!entry?.outputs) return null;
  for (const nodeId of ["92", "237"]) {
    const out = entry.outputs[nodeId];
    if (!out) continue;
    for (const key of ["videos", "gifs", "images"]) {
      const arr = (out as Record<string, unknown>)[key];
      if (Array.isArray(arr) && arr.length) {
        const it = arr[0];
        if (it && typeof it === "object" && "filename" in it) return it as ComfyViewItem;
      }
    }
  }
  const candidates: ComfyViewItem[] = [];
  for (const nodeId of Object.keys(entry.outputs)) {
    const out = entry.outputs[nodeId];
    if (!out || typeof out !== "object") continue;
    for (const key of ["videos", "gifs", "images"]) {
      const arr = (out as Record<string, unknown>)[key];
      if (Array.isArray(arr)) for (const it of arr) if (it && typeof it === "object" && "filename" in it) candidates.push(it as ComfyViewItem);
    }
  }
  return candidates.find((c) => VIDEO_EXT.test(c.filename)) ?? candidates[0] ?? null;
}
