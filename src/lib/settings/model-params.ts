import { z } from "zod";

export const IMAGE_RESOLUTIONS = ["1k", "2k", "4k"] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];

export const VIDEO_RESOLUTIONS = ["480p", "540p", "608p", "768p"] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export const VIDEO_ASPECTS = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "21:9",
] as const;

export const videoParamsSchema = z.object({
  steps: z.number().int().min(1).max(30).default(8),
  resolution: z.enum(VIDEO_RESOLUTIONS).default("540p"),
  aspect: z.string().default(""),
  sagePreset: z.string().default("Nvidia-Sage"),
  sageMaxDurationSec: z.number().int().min(1).max(60).default(12),
  blocksToSwap: z.number().int().min(0).max(60).default(50),
  secondPass: z.boolean().default(false),
});

export type VideoParams = z.infer<typeof videoParamsSchema>;

export const DEFAULT_VIDEO_PARAMS: VideoParams = videoParamsSchema.parse({});
