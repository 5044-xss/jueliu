import { z } from "zod";
import { generateStructured } from "@/lib/llm/structured";
import { scriptSchema, type Script } from "@/lib/schemas/script";
import type { SkillDefinition } from "@/lib/skills/types";
import {
  getActiveSkillPrompt,
  getActiveSkillTemperature,
} from "@/lib/library/skills";
import { STORY_TO_SCRIPT_PROMPT } from "@/lib/skills/prompts";

const inputSchema = z.object({
  extraInstructions: z.string().optional().default(""),
});

type Input = z.infer<typeof inputSchema>;

function buildUserPrompt(ctx: {
  story: string;
  style: string;
  aspectRatio: string;
  extra: string;
}): string {
  return [
    `【项目风格】${ctx.style || "未指定"}`,
    `【画面比例】${ctx.aspectRatio}`,
    "",
    "【原始故事】",
    ctx.story,
    ctx.extra ? `\n【额外要求】\n${ctx.extra}` : "",
    "",
    "请输出结构化剧本 JSON。",
  ].join("\n");
}

export const storyToScriptSkill: SkillDefinition<Input, Script> = {
  id: "story-to-script",
  name: "故事 → 剧本",
  description: "把原始故事改编为结构化分场剧本（场次/对白/动作）",
  version: "1",
  systemPrompt: STORY_TO_SCRIPT_PROMPT,
  inputSchema,
  outputSchema: scriptSchema,
  async run(ctx, input) {
    if (!ctx.story.trim()) {
      throw new Error("故事内容为空，请先填写故事。");
    }
    return generateStructured({
      schema: scriptSchema,
      system: getActiveSkillPrompt("story-to-script"),
      temperature: getActiveSkillTemperature("story-to-script"),
      user: buildUserPrompt({
        story: ctx.story,
        style: ctx.project.style,
        aspectRatio: ctx.project.aspectRatio,
        extra: input.extraInstructions ?? "",
      }),
    });
  },
};
