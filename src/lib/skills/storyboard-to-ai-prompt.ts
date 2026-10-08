import { z } from "zod";
import { generateText } from "@/lib/llm/structured";
import { renderSegment } from "@/lib/render";
import { DEFAULT_NEGATIVE_TEXT } from "@/lib/templates-defaults";
import type { SkillDefinition } from "@/lib/skills/types";
import {
  getActiveSkillPrompt,
  getActiveSkillTemperature,
} from "@/lib/library/skills";
import { STORYBOARD_TO_AI_PROMPT } from "@/lib/skills/prompts";

const inputSchema = z.object({
  segmentId: z.string().min(1),
  platform: z.string().default("doubao"),
});

type Input = z.infer<typeof inputSchema>;

export const storyboardToAiPromptSkill: SkillDefinition<Input, string> = {
  id: "storyboard-to-ai-prompt",
  name: "分镜 → AI 提示词",
  description: "把给人看的分镜提示词编译成 AI 图/视频生成可执行提示词",
  version: "1",
  systemPrompt: STORYBOARD_TO_AI_PROMPT,
  inputSchema,
  outputSchema: z.string(),
  async run(ctx, input) {
    const rendered = renderSegment(
      ctx.projectId,
      input.segmentId,
      input.platform,
    );
    if (!rendered) {
      throw new Error("段落不存在，请刷新分镜后重试。");
    }
    const humanPrompt = [
      rendered.body,
      "",
      "【图片清单】",
      rendered.legend,
      "",
      "【生成参数】",
      rendered.params,
    ].join("\n");
    const user = [
      `【项目风格】${ctx.project.style || "未指定"}`,
      `【画面比例】${ctx.project.aspectRatio}`,
      `【负面约束基础项】${DEFAULT_NEGATIVE_TEXT}`,
      "",
      "【给人看的分镜提示词（待编译）】",
      humanPrompt,
      "",
      "请按格式输出 AI 可执行分镜提示词。",
    ].join("\n");

    return generateText({
      system: getActiveSkillPrompt("storyboard-to-ai-prompt"),
      temperature: getActiveSkillTemperature("storyboard-to-ai-prompt"),
      user,
    });
  },
};
