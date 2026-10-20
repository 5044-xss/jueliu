import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureCore } from "@/lib/bootstrap";
import {
  getMaskedGenerationSettings,
  saveGenerationSettings,
  RESOLUTION_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
} from "@/lib/generation/settings";

const updateSchema = z.object({
  baseUrl: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  imageModel: z.string().min(1).optional(),
  imageResolution: z.enum(RESOLUTION_OPTIONS).optional(),
  pollIntervalMs: z.number().int().min(500).max(60_000).optional(),
  timeoutMs: z.number().int().min(10_000).max(3_600_000).optional(),
  videoTimeoutMs: z.number().int().min(60_000).max(21_600_000).optional(),
  maxRefImages: z.number().int().min(0).max(14).optional(),
  imageConcurrency: z.number().int().min(1).max(8).optional(),
  comfyUrl: z.string().optional(),
  comfyVideoModel: z.enum(["pruned", "int8"]).optional(),
  videoSteps: z.number().int().min(1).max(30).optional(),
  videoResolution: z.enum(VIDEO_RESOLUTION_OPTIONS).optional(),
  videoAspect: z.string().optional(),
  sagePreset: z.string().optional(),
  sageMaxDurationSec: z.number().int().min(1).max(60).optional(),
  blocksToSwap: z.number().int().min(0).max(60).optional(),
  videoUpscaleModel: z.string().optional(),
  videoOutHeight: z.number().int().min(0).max(4320).optional(),
  videoSecondPass: z.boolean().optional(),
});

export async function GET() {
  ensureCore();
  return NextResponse.json({
    settings: getMaskedGenerationSettings(),
    resolutions: RESOLUTION_OPTIONS,
    videoResolutions: VIDEO_RESOLUTION_OPTIONS,
  });
}

export async function PUT(request: Request) {
  ensureCore();
  const json = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数不合法", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = { ...parsed.data };
  // 打码值原样回传时，不覆盖真实 Key。
  if (input.apiKey !== undefined) {
    const incoming = input.apiKey.trim();
    if (!incoming || incoming === getMaskedGenerationSettings().apiKey) {
      delete input.apiKey;
    }
  }
  saveGenerationSettings(input);
  return NextResponse.json({ settings: getMaskedGenerationSettings() });
}
