import { z } from "zod";
import { generateStructured } from "@/lib/llm/structured";
import { scriptSchema, type Script } from "@/lib/schemas/script";
import type { SkillDefinition } from "@/lib/skills/types";
import {
  getActiveSkillPrompt,
  getActiveSkillTemperature,
} from "@/lib/library/skills";

const inputSchema = z.object({
  extraInstructions: z.string().optional().default(""),
});

type Input = z.infer<typeof inputSchema>;

const SYSTEM_PROMPT = `你是一位资深的中文短剧/漫剧编剧。你的任务是把用户提供的原始故事改编成结构化的分场剧本。

要求：
1. 只输出 JSON，不要输出任何解释、Markdown 或代码块标记。
2. JSON 结构必须严格符合：
{
  "title": "剧本标题",
  "scenes": [
    {
      "index": "1-1",
      "slug": "第1-1场",
      "location": "地点",
      "timeOfDay": "日/夜/黄昏 等",
      "interiorExterior": "内 或 外",
      "summary": "本场一句话概述",
      "characters": ["出场角色名"],
      "beats": [
        { "type": "action", "text": "动作/画面描述" },
        { "type": "dialogue", "character": "角色名", "text": "台词" }
      ]
    }
  ]
}
3. index 从 "1-1" 开始，同一场次内连续编号；换地点或时间则新起一场。
4. beats 按剧中时间顺序排列，动作与台词交替，台词要口语化、有张力。
5. 所有文本使用中文。忠于原故事的人物与主线，可适度细化场面与动作，但不要新增主要角色或改写结局。
6. characters 只填本场实际出场的角色名，保持命名一致。`;

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
  systemPrompt: SYSTEM_PROMPT,
  inputSchema,
  outputSchema: scriptSchema,
  async run(ctx, input) {
    if (!ctx.story.trim()) {
      throw new Error("故事内容为空，请先填写故事。");
    }
    return generateStructured({
      schema: scriptSchema,
      system: getActiveSkillPrompt("story-to-script") ?? SYSTEM_PROMPT,
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
