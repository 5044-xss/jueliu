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
import { SCRIPT_TO_ASSETS_PROMPT } from "@/lib/skills/prompts";

const inputSchema = z.object({
  extraInstructions: z.string().optional().default(""),
});

type Input = z.infer<typeof inputSchema>;

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
  systemPrompt: SCRIPT_TO_ASSETS_PROMPT,
  inputSchema,
  outputSchema: assetsDraftSchema,
  async run(ctx, input) {
    if (!ctx.script) {
      throw new Error("尚未生成剧本，请先生成剧本。");
    }
    // 显式列出地点/角色清单，强制模型逐个覆盖，避免漏建资产（模型常漏掉某一两个）。
    const locations = [
      ...new Set(ctx.script.scenes.map((s) => s.location.trim()).filter(Boolean)),
    ];
    const characters = [
      ...new Set(
        ctx.script.scenes
          .flatMap((s) => s.characters)
          .map((c) => c.trim())
          .filter(Boolean),
      ),
    ];
    const user = [
      `【风格说明】项目风格为「${ctx.project.style || "未指定"}」，但**不要把它或任何其他画风词写进 prompt**；风格由系统在展示/复制时自动附加。`,
      `【参考图比例】角色四视图用横版 16:9（正面/侧面/背面/45°四个全身并排，留白足够）；场景用横版 16:9；道具用正方形 1:1。这些是给模型看的参考图，不要用成片视频的 ${ctx.project.aspectRatio} 竖版比例。`,
      "",
      `【必须覆盖的地点清单】共 ${locations.length} 个：每个地点都必须建一个场景资产，name 用该地点名，不得遗漏、不得合并：`,
      locations.map((l) => `- ${l}`).join("\n"),
      "",
      `【必须覆盖的角色清单】共 ${characters.length} 个：每个角色都必须建一个角色资产（画外音/电话角色除外）：`,
      characters.map((c) => `- ${c}`).join("\n"),
      "",
      "【结构化剧本】",
      scriptToText(ctx.script),
      input.extraInstructions ? `\n【额外要求】\n${input.extraInstructions}` : "",
      "",
      "请输出资产 JSON。",
    ].join("\n");

    return generateStructured({
      schema: assetsDraftSchema,
      system: getActiveSkillPrompt("script-to-assets"),
      temperature: getActiveSkillTemperature("script-to-assets"),
      user,
    });
  },
};
