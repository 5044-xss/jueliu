import { NextResponse } from "next/server";
import { z } from "zod";
import { getProject, updateProject } from "@core/server/projects";
import {
  applyOrchestration,
  planOrchestration,
  type OrchestrationPlan,
} from "@core/server/orchestration/apply";
import {
  captureOrchestrationState,
  restoreOrchestrationState,
} from "@core/server/orchestration/cache";
import { isVendorId } from "@core/server/library/vendors";
import { withLock } from "@core/server/lock";

const bodySchema = z.object({
  vendor: z.string(),
  dryRun: z.boolean().optional(),
  maxSegmentMs: z.number().int().min(4000).max(30000).optional(),
  maxShotsPerSegment: z.number().int().min(1).max(20).optional(),
  qualityMaxShots: z.number().int().min(1).max(20).optional(),
  maxCastPerSegment: z.number().int().min(1).max(20).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

function planResponse(plan: OrchestrationPlan) {
  return {
    ok: true,
    dryRun: true,
    vendor: plan.vendor,
    usesV2: plan.usesV2,
    scenes: plan.scenes.length,
    segments: plan.totalSegments,
    shots: plan.totalShots,
    totalTargetMs: plan.totalTargetMs,
    scenesPlan: plan.scenes.map((scene) => ({
      sceneIndex: scene.sceneIndex,
      sceneSlug: scene.sceneSlug,
      shotCount: scene.flatShots.length,
      usesV2: scene.usesV2,
      segments: scene.segments.map((segment, index) => ({
        index: index + 1,
        shotIndexes: segment.shotIndexes.map((value) => value + 1),
        shotCount: segment.shotIndexes.length,
        targetMs: segment.targetMs,
        shotDurations: segment.shotDurations,
        hardCut: segment.hardCut,
        hardCutReason: segment.hardCutReason,
        warnings: segment.warnings,
      })),
    })),
  };
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success || !isVendorId(parsed.data.vendor)) {
    return NextResponse.json({ error: "厂商参数不合法" }, { status: 400 });
  }

  const options = {
    maxSegmentMs: parsed.data.maxSegmentMs,
    maxShotsPerSegment: parsed.data.maxShotsPerSegment,
    qualityMaxShots: parsed.data.qualityMaxShots,
    maxCastPerSegment: parsed.data.maxCastPerSegment,
  };

  if (parsed.data.dryRun) {
    try {
      const plan = planOrchestration(id, parsed.data.vendor, options);
      return NextResponse.json(planResponse(plan));
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message || "dry-run 失败" },
        { status: 500 },
      );
    }
  }

  return withLock(`orchestrate:${id}`, async () => {
    try {
      const project = getProject(id);
      if (!project) {
        return NextResponse.json({ error: "子集不存在" }, { status: 404 });
      }
      captureOrchestrationState(id, project.vendor);
      const result = applyOrchestration(id, parsed.data.vendor, options);
      const restored = restoreOrchestrationState(id, parsed.data.vendor);
      updateProject(id, { vendor: parsed.data.vendor });
      return NextResponse.json({ ok: true, ...result, restored });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message || "编排失败" },
        { status: 500 },
      );
    }
  });
}
