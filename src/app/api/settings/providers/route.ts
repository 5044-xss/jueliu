import { NextResponse } from "next/server";
import { readGlobalSettings } from "@core/server/settings";
import { ensureCore } from "@/lib/bootstrap";
import { getMaskedGenerationSettings } from "@/lib/generation/settings";
import {
  getMaskedProviderSettings,
  saveProviderSettings,
} from "@/lib/settings/providers-server";
import { maskProviderSettings, saveProviderRequestSchema } from "@/lib/settings/providers";

export async function GET() {
  ensureCore();
  return NextResponse.json({
    settings: getMaskedProviderSettings(),
    generation: getMaskedGenerationSettings(),
    autoGenerateAiPrompt: readGlobalSettings().autoGenerateAiPrompt,
  });
}

export async function PUT(request: Request) {
  ensureCore();
  const json = await request.json().catch(() => null);
  const parsed = saveProviderRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数不合法", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const saved = saveProviderSettings(parsed.data.settings, {
      generation: parsed.data.generation,
      autoGenerateAiPrompt: parsed.data.autoGenerateAiPrompt,
    });
    return NextResponse.json({
      settings: maskProviderSettings(saved),
      generation: getMaskedGenerationSettings(),
      autoGenerateAiPrompt: readGlobalSettings().autoGenerateAiPrompt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "保存失败" },
      { status: 400 },
    );
  }
}
