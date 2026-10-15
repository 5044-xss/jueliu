import { NextResponse } from "next/server";
import { buildKeyframePrompt } from "@/lib/keyframe";
import { getProjectDb } from "@/lib/db";
import { projectExists } from "@/lib/projects";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const db = getProjectDb(id);
  const segment = db
    .prepare("SELECT id FROM segment WHERE id = ?")
    .get(segmentId);
  if (!segment) {
    return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  }
  const prompt = buildKeyframePrompt(id, segmentId);
  if (!prompt) {
    return NextResponse.json({ error: "该段没有可生成关键帧的分镜" }, { status: 404 });
  }
  return NextResponse.json(prompt);
}
