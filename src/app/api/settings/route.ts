import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readGlobalSettings,
  writeGlobalSettings,
  maskApiKey,
  PROVIDER_PRESETS,
  type LlmProvider,
} from "@/lib/settings";
import { detectFfmpeg } from "@/lib/ffmpeg";

const providerEnum = z.enum([
  "dashscope",
  "openai",
  "deepseek",
  "moonshot",
  "zhipu",
  "custom",
]);

const updateSchema = z.object({
  llm: z
    .object({
      provider: providerEnum.optional(),
      baseURL: z.string().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
    })
    .optional(),
  ffmpeg: z.object({ path: z.string().optional() }).optional(),
  autoGenerateAiPrompt: z.boolean().optional(),
});

export async function GET() {
  const settings = readGlobalSettings();
  return NextResponse.json({
    settings: maskApiKey(settings),
    presets: PROVIDER_PRESETS,
    ffmpeg: detectFfmpeg(settings.ffmpeg.path),
  });
}

export async function PUT(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数不合法", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const current = readGlobalSettings();
  const input = parsed.data;
  const llm = { ...input.llm };

  if (llm?.apiKey !== undefined) {
    const incoming = llm.apiKey.trim();
    const maskedCurrent = maskApiKey(current).llm.apiKey;
    if (!incoming || incoming === maskedCurrent) {
      delete llm.apiKey;
    }
  }

  if (llm?.provider && llm.provider !== "custom") {
    const preset = PROVIDER_PRESETS[llm.provider as Exclude<LlmProvider, "custom">];
    if (!llm.baseURL) llm.baseURL = preset.baseURL;
    if (!llm.model) llm.model = preset.defaultModel;
  }

  const next = writeGlobalSettings({
    llm,
    ffmpeg: input.ffmpeg,
    autoGenerateAiPrompt: input.autoGenerateAiPrompt,
  });

  return NextResponse.json({
    settings: maskApiKey(next),
    ffmpeg: detectFfmpeg(next.ffmpeg.path),
  });
}
