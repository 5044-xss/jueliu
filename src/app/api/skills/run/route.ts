import { NextResponse } from "next/server";
import { z } from "zod";
import { getProject, getStory } from "@/lib/projects";
import { getSkill } from "@/lib/skills/registry";
import { saveScript, getStoredScript } from "@/lib/script";
import { saveAssetDrafts, getAssets } from "@/lib/assets";
import {
  saveStoryboard,
  getContinuityRules,
} from "@/lib/storyboard";
import {
  isScript,
  isAssetsDraft,
  isStoryboardDraft,
} from "@/lib/schemas/guards";

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

  try {
    const story = getStory(projectId).content;
    const script = getStoredScript(projectId);
    const assets = getAssets(projectId);
    const rules = getContinuityRules(projectId);
    const output = await skill.run(
      { projectId, project, story, script, assets, rules },
      inputParsed.data,
    );

    if (skillId === "story-to-script" && isScript(output)) {
      const stored = saveScript(projectId, output);
      return NextResponse.json({ result: stored });
    }

    if (skillId === "script-to-assets" && isAssetsDraft(output)) {
      const stored = saveAssetDrafts(projectId, output.assets);
      return NextResponse.json({ result: stored });
    }

    if (skillId === "script-to-storyboard" && isStoryboardDraft(output)) {
      const stored = saveStoryboard(projectId, output, assets);
      return NextResponse.json({ result: stored });
    }

    return NextResponse.json({ result: output });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "技能执行失败" },
      { status: 500 },
    );
  }
}
