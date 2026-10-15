import { z } from "zod";
import { generateStructured } from "@/lib/llm/structured";
import {
  storyboardDraftSchema,
  type StoryboardDraft,
} from "@/lib/schemas/storyboard";
import type { SkillDefinition } from "@/lib/skills/types";
import type { StoredScript } from "@/lib/script";
import type { StoredAsset } from "@/lib/schemas/assets";
import {
  getActiveSkillPrompt,
  getActiveSkillTemperature,
} from "@/lib/library/skills";
import { SCRIPT_TO_STORYBOARD_PROMPT } from "@/lib/skills/prompts";

const inputSchema = z.object({
  extraInstructions: z.string().optional().default(""),
});

type Input = z.infer<typeof inputSchema>;

function assetsToText(assets: StoredAsset[]): string {
  if (assets.length === 0) return "（暂无资产，请尽量只引用角色名作为 character）";
  return assets
    .map((a) => {
      const variants = a.variants
        .map(
          (v) =>
            `    - 变体「${v.label}」视角：${v.views.map((vw) => vw.label).join("、") || "无"}`,
        )
        .join("\n");
      return `- [${a.type}] ${a.name}\n${variants}`;
    })
    .join("\n");
}

function scriptToText(script: StoredScript): string {
  const lines: string[] = [];
  for (const scene of script.scenes) {
    lines.push(
      `\n【场次 ${scene.index}】${scene.slug}｜${scene.location}｜${scene.timeOfDay}｜${scene.interiorExterior}`,
    );
    if (scene.summary) lines.push(`概述：${scene.summary}`);
    if (scene.characters.length) lines.push(`出场：${scene.characters.join("、")}`);
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

function rulesToText(rules: Record<string, boolean>): string {
  const enabled = Object.entries(rules)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return enabled.length ? enabled.join("、") : "（未启用任何规则）";
}

export const scriptToStoryboardSkill: SkillDefinition<
  Input,
  StoryboardDraft
> = {
  id: "script-to-storyboard",
  name: "剧本 → 分镜",
  description: "生成段落、分镜、参考图引用与 blocking，受连续性规则约束",
  version: "1",
  systemPrompt: SCRIPT_TO_STORYBOARD_PROMPT,
  inputSchema,
  outputSchema: storyboardDraftSchema,
  async run(ctx, input) {
    if (!ctx.script) {
      throw new Error("尚未生成剧本，请先生成剧本。");
    }
    const user = [
      `【项目风格】${ctx.project.style || "未指定"}`,
      `【画面比例】${ctx.project.aspectRatio}`,
      `【启用的连续性规则】${rulesToText(ctx.rules)}`,
      "",
      "【资产清单】",
      assetsToText(ctx.assets),
      "",
      "【结构化剧本】",
      scriptToText(ctx.script),
      input.extraInstructions ? `\n【额外要求】\n${input.extraInstructions}` : "",
      "",
      "请输出每一场的「镜序列」JSON（只出镜、不出段）。",
    ].join("\n");

    return generateStructured({
      schema: storyboardDraftSchema,
      system: getActiveSkillPrompt("script-to-storyboard"),
      temperature: getActiveSkillTemperature("script-to-storyboard"),
      user,
    });
  },
};
