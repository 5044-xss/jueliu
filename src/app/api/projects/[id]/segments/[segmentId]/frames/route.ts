import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getFrames,
  getSegmentVideoPath,
  extractAndSaveFrame,
} from "@/lib/frames";
import { getProjectDb } from "@/lib/db";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

const postSchema = z.object({ kind: z.enum(["first", "last"]) });

export async function GET(_request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  const db = getProjectDb(id);
  const segment = db
    .prepare("SELECT first_frame_id, status FROM segment WHERE id = ?")
    .get(segmentId) as
    | { first_frame_id: string | null; status: string }
    | undefined;
  if (!segment) {
    return NextResponse.json({ error: "段落不存在" }, { status: 404 });
  }
  return NextResponse.json({
    frames: getFrames(id, segmentId),
    videoPath: getSegmentVideoPath(id, segmentId),
    firstFrameId: segment.first_frame_id,
    status: segment.status,
  });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  try {
    const frame = await extractAndSaveFrame(id, segmentId, parsed.data.kind);
    return NextResponse.json({ frame });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
