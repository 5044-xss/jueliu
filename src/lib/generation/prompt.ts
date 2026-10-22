import { buildAiPromptSignature, getCachedAiPrompt } from "@core/server/ai-prompt";
import { getProject } from "@core/server/projects";
import { getSkill } from "@core/server/skills/registry";

export interface CompiledH3Prompt {
  prompt: string;
  sig: string;
  /** 给人看的分镜提示词（render 后的正文），用于生成快照。 */
  humanPrompt: string;
  keyframeOnly: boolean;
}

/**
 * 取本段的 H3 可执行提示词：命中缓存直接用，否则调「分镜 → AI 提示词」技能
 * （用 H3 厂商翻译提示词编译）并落库缓存。
 *
 * keyframeOnly=true 时只按「本段起始画面」编译（基础模式 I2VA/FL2VA），
 * 与云端出片实际只上传首帧的行为保持一致。
 */
export async function getOrCompileH3PromptInfo(
  projectId: string,
  segmentId: string,
  keyframeOnly: boolean,
): Promise<CompiledH3Prompt> {
  const info = buildAiPromptSignature(projectId, segmentId, "h3", {
    keyframeOnly,
  });
  if (!info) throw new Error("无法编译视频提示词（段落不存在或无分镜）");

  const cached = getCachedAiPrompt(projectId, segmentId, info.sig);
  if (cached) {
    return {
      prompt: cached,
      sig: info.sig,
      humanPrompt: info.rendered.body,
      keyframeOnly,
    };
  }

  const project = getProject(projectId);
  if (!project) throw new Error("项目不存在");

  const skill = getSkill("storyboard-to-ai-prompt");
  if (!skill) throw new Error("缺少 storyboard-to-ai-prompt 技能");

  const text = await skill.run(
    { projectId, project, story: "", script: null, assets: [], rules: {} },
    { segmentId, platform: "h3", keyframeOnly },
  );
  return {
    prompt: String(text),
    sig: info.sig,
    humanPrompt: info.rendered.body,
    keyframeOnly,
  };
}

export async function getOrCompileH3Prompt(
  projectId: string,
  segmentId: string,
  keyframeOnly: boolean,
): Promise<string> {
  const info = await getOrCompileH3PromptInfo(
    projectId,
    segmentId,
    keyframeOnly,
  );
  return info.prompt;
}
