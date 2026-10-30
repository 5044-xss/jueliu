import { NextResponse } from "next/server";
import { z } from "zod";
import { getProject, getStory } from "@core/server/projects";
import { getSkill } from "@core/server/skills/registry";
import { saveScript, getStoredScript } from "@core/server/script";
import { saveAssetDrafts, getAssets, clearAssets } from "@core/server/assets";
import { seedAssetBaseImagesFromLibrary } from "@core/server/asset-library";
import {
  saveStoryboard,
  getStoryboard,
  getContinuityRules,
  clearStoryboard,
} from "@core/server/storyboard";
import { applyOrchestration } from "@core/server/orchestration/apply";
import { resolveStoryboardStrategy } from "@core/server/library/storyboard-strategies";
import {
  isScript,
  isAssetsDraft,
  isStoryboardDraft,
} from "@core/shared/schemas/guards";
import {
  startJob,
  finishJob,
  isJobActive,
  updateJobParams,
} from "@core/server/jobs";
import { withLock } from "@core/server/lock";

export const maxDuration = 300;

// LLM 调用可能很长；期间同类新任务会把旧任务标成 failed。写库前再确认，
// 防止被取代的旧请求最后才返回、把新结果覆盖掉。
function assertJobActive(projectId: string, jobId: string): void {
  if (!isJobActive(projectId, jobId)) {
    throw new Error("任务已被新的生成取代或已取消，本次结果已丢弃。");
  }
}

const bodySchema = z.object({
  skillId: z.string(),
  projectId: z.string(),
  input: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const { skillId, projectId, input } = parsed.data;

  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const skill = getSkill(skillId);
  if (!skill) {
    return NextResponse.json({ error: "技能不存在" }, { status: 404 });
  }

  const inputParsed = skill.inputSchema.safeParse(input);
  if (!inputParsed.success) {
    return NextResponse.json({ error: "输入不合法" }, { status: 400 });
  }

  const jobId = startJob(projectId, skillId);
  const skillInput = inputParsed.data;

  try {
    const story = getStory(projectId).content;
    const script = getStoredScript(projectId);
    const assets = getAssets(projectId);
    const rules = getContinuityRules();
    const output = await skill.run(
      { projectId, project, story, script, assets, rules },
      skillInput,
    );

    if (skillId === "story-to-script" && isScript(output)) {
      // 任务可能已在等待期间被新任务取代/取消：丢弃本次结果，避免旧输出覆盖新结果。
      assertJobActive(projectId, jobId);
      const stored = saveScript(projectId, output);
      // 失效级联：剧本变了 → 下游资产、分镜全部失效并清空。
      clearAssets(projectId);
      clearStoryboard(projectId);
      finishJob(projectId, jobId, "succeeded");
      return NextResponse.json({ result: stored, cleared: ["assets", "storyboard"] });
    }

    if (skillId === "script-to-assets" && isAssetsDraft(output)) {
      assertJobActive(projectId, jobId);
      saveAssetDrafts(projectId, output.assets);
      // 读项目资产库：把已入库的角色/场景/道具基础图回填到本集新资产的基础槽位。
      seedAssetBaseImagesFromLibrary(projectId);
      // 失效级联：资产变了 → 分镜引用失效，清空分镜。
      clearStoryboard(projectId);
      finishJob(projectId, jobId, "succeeded");
      return NextResponse.json({ result: getAssets(projectId), cleared: ["storyboard"] });
    }

    if (skillId === "script-to-storyboard" && isStoryboardDraft(output)) {
      const strategy = resolveStoryboardStrategy(
        (inputParsed.data as { strategyId?: string }).strategyId ??
          project.storyboardStrategyId,
      );
      // 与「重新编排」共用同一把锁：保存分镜 + 编排必须原子，不能被并发编排插队。
      const appliedResult = await withLock(
        `orchestrate:${projectId}`,
        async () => {
          assertJobActive(projectId, jobId);
          saveStoryboard(projectId, output, assets);
          const applied = applyOrchestration(projectId, project.vendor);
          return { scenes: getStoryboard(projectId), applied };
        },
      );
      const outputShots = output.scenes.reduce(
        (sum, scene) => sum + scene.shots.length,
        0,
      );
      const totalDurationMs = appliedResult.scenes.reduce(
        (sum, scene) =>
          sum + scene.segments.reduce((inner, segment) => inner + segment.targetMs, 0),
        0,
      );
      const assembly = { outputShots, totalDurationMs };
      updateJobParams(projectId, jobId, {
        strategyId: strategy.strategy.id,
        strategyVersion: strategy.strategy.version,
        assembly,
        orchestration: appliedResult.applied,
      });
      finishJob(projectId, jobId, "succeeded");
      return NextResponse.json({
        result: appliedResult.scenes,
        strategy: {
          id: strategy.strategy.id,
          name: strategy.strategy.name,
          version: strategy.strategy.version,
        },
        assembly,
        orchestration: appliedResult.applied,
      });
    }

    finishJob(projectId, jobId, "succeeded");
    return NextResponse.json({ result: output });
  } catch (error) {
    const message = (error as Error).message || "技能执行失败";
    finishJob(projectId, jobId, "failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
