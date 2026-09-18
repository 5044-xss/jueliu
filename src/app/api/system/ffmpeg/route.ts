import { NextResponse } from "next/server";
import { z } from "zod";
import { detectFfmpeg } from "@/lib/ffmpeg";
import { readGlobalSettings } from "@/lib/settings";

const bodySchema = z.object({ path: z.string().optional() });

export async function POST(request: Request) {
  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  const binPath = parsed.success && parsed.data.path
    ? parsed.data.path
    : readGlobalSettings().ffmpeg.path;
  return NextResponse.json(detectFfmpeg(binPath));
}
