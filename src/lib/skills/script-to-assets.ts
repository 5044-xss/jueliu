import { z } from "zod";
import { generateStructured } from "@/lib/llm/structured";
import {
  assetsDraftSchema,
  type AssetsDraft,
} from "@/lib/schemas/assets";
import type { SkillDefinition } from "@/lib/skills/types";
import type { StoredScript } from "@/lib/script";
import {
  getActiveSkillPrompt,
  getActiveSkillTemperature,
} from "@/lib/library/skills";

const inputSchema = z.object({
  extraInstructions: z.string().optional().default(""),
});

type Input = z.infer<typeof inputSchema>;

const SYSTEM_PROMPT = `你是漫剧项目的资产设计师。根据结构化剧本，提取所有需要单独生成参考图的资产：角色、场景、道具。

只输出 JSON，不要任何解释或代码块标记。结构必须严格为：
{
  "assets": [
    {
      "type": "character" | "scene" | "prop",
      "name": "资产名（角色用剧本中的姓名）",
      "basePrompt": "该资产的基础外观描述，包含项目风格关键词",
      "variants": [
        {
          "label": "变体名",
          "prompt": "该变体完整生成提示词",
          "views": [
            { "label": "视角名", "prompt": "该视角完整生成提示词" }
          ]
        }
      ]
    }
  ]
}

规则：
1. 角色（character）：
   - 从剧本台词与动作中推断年龄、性别、发型发色、体型、服装、气质，写成稳定的外观锚点。
   - 每个角色默认 1 个变体「日常装」；若剧情需要（受伤/礼服/职业装等）可加变体。
   - 每个变体的 views 必须只有 1 项，label 固定为「四视图」，prompt 要求在同一张图内呈现正面、侧面、背面、45°四个角度，纯色背景，全身，五官发型服装完全一致。
2. 场景（scene）：
   - 按「地点」去重；不同时间/天气作为变体（如「白天」「夜晚」）。
   - 每个变体的 views 至少包含「全景」，可按需要加「反打」「左」「右」。
3. 道具（prop）：只提取剧情中关键、会反复出现的道具；1 个变体，views 用「正面」。
4. 所有 prompt 必须使用中文，且包含项目风格关键词，可直接用于文生图。
5. 不要遗漏出场角色；不要把群众角色单独建为资产。`;

function scriptToText(script: StoredScript): string {
  const lines: string[] = [];
  if (script.title) lines.push(`剧本标题：${script.title}`);
  for (const scene of script.scenes) {
    lines.push(
      `\n【${scene.slug || `第${scene.index}场`}】地点：${scene.location}；时间：${scene.timeOfDay}；${scene.interiorExterior}景`,
    );
    if (scene.summary) lines.push(`概述：${scene.summary}`);
    if (scene.characters.length) lines.push(`出场角色：${scene.characters.join("、")}`);
    for (const beat of scene.beats) {
      lines.push(
        beat.type === "dialogue"
          ? `${beat.character || "旁白"}：${beat.text}`
          : `（动作）${beat.text}`,
      );
    }
  }
  return lines.join("\n");
}

export const scriptToAssetsSkill: SkillDefinition<Input, AssetsDraft> = {
  id: "script-to-assets",
  name: "剧本 → 资产",
  description: "从剧本提取角色/场景/道具，产出四视图与变体提示词",
  version: "1",
  systemPrompt: SYSTEM_PROMPT,
  inputSchema,
  outputSchema: assetsDraftSchema,
  async run(ctx, input) {
    if (!ctx.script) {
      throw new Error("尚未生成剧本，请先生成剧本。");
    }
    const user = [
      `【项目风格】${ctx.project.style || "未指定"}`,
      `【画面比例】${ctx.project.aspectRatio}`,
      "",
      "【结构化剧本】",
      scriptToText(ctx.script),
      input.extraInstructions ? `\n【额外要求】\n${input.extraInstructions}` : "",
      "",
      "请输出资产 JSON。",
    ].join("\n");

    return generateStructured({
      schema: assetsDraftSchema,
      system: getActiveSkillPrompt("script-to-assets") ?? SYSTEM_PROMPT,
      temperature: getActiveSkillTemperature("script-to-assets"),
      user,
    });
  },
};
