import { NextResponse } from "next/server";
import { z } from "zod";
import { getProject, getStory } from "@/lib/projects";
import { getSkill } from "@/lib/skills/registry";
import { saveScript, getStoredScript } from "@/lib/script";
import { saveAssetDrafts, getAssets, clearAssets } from "@/lib/assets";
import {
  saveStoryboard,
  getStoryboard,
  getContinuityRules,
  clearStoryboard,
} from "@/lib/storyboard";
import { applyOrchestration } from "@/lib/orchestration/apply";
import {
  isScript,
  isAssetsDraft,
  isStoryboardDraft,
} from "@/lib/schemas/guards";
import { startJob, finishJob } from "@/lib/jobs";

export const maxDuration = 300;

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
  try {
    const story = getStory(projectId).content;
    const script = getStoredScript(projectId);
    const assets = getAssets(projectId);
    const rules = getContinuityRules();
    const output = await skill.run(
      { projectId, project, story, script, assets, rules },
      inputParsed.data,
    );

    if (skillId === "story-to-script" && isScript(output)) {
      const stored = saveScript(projectId, output);
      // 失效级联：剧本变了 → 下游资产、分镜全部失效并清空。
      clearAssets(projectId);
      clearStoryboard(projectId);
      finishJob(projectId, jobId, "succeeded");
      return NextResponse.json({ result: stored, cleared: ["assets", "storyboard"] });
    }

    if (skillId === "script-to-assets" && isAssetsDraft(output)) {
      const stored = saveAssetDrafts(projectId, output.assets);
      // 失效级联：资产变了 → 分镜引用失效，清空分镜。
      clearStoryboard(projectId);
      finishJob(projectId, jobId, "succeeded");
      return NextResponse.json({ result: stored, cleared: ["storyboard"] });
    }

    if (skillId === "script-to-storyboard" && isStoryboardDraft(output)) {
      saveStoryboard(projectId, output, assets);
      // 以镜为主：分镜只产出镜序列，段由编排层按所选厂商派生。
      applyOrchestration(projectId, project.vendor);
      const stored = getStoryboard(projectId);
      finishJob(projectId, jobId, "succeeded");
      return NextResponse.json({ result: stored });
    }

    finishJob(projectId, jobId, "succeeded");
    return NextResponse.json({ result: output });
  } catch (error) {
    const message = (error as Error).message || "技能执行失败";
    finishJob(projectId, jobId, "failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
