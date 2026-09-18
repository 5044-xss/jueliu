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

const inputSchema = z.object({
  extraInstructions: z.string().optional().default(""),
});

type Input = z.infer<typeof inputSchema>;

const SYSTEM_PROMPT = `你是漫剧的分镜导演。根据结构化剧本、资产清单与连续性规则，输出可直接生成视频的分镜脚本。

只输出 JSON，不要任何解释或代码块标记。结构必须严格为：
{
  "scenes": [
    {
      "sceneIndex": "1-1",
      "blocking": {
        "axis": { "from": "节点id", "to": "节点id" },
        "cameraSide": "left" | "right",
        "nodes": [
          { "id": "c1", "label": "角色名", "type": "character" | "prop" | "screen" | "landmark", "pos": { "x": 0.3, "y": 0.5 }, "facing": 45 }
        ],
        "paths": [ { "nodeId": "c1", "points": [ { "x": 0.3, "y": 0.5 } ] } ]
      },
      "segments": [
        {
          "index": 1,
          "generationMode": "multi-shot",
          "targetMs": 10000,
          "shots": [
            {
              "durationMs": 5000,
              "camera": { "focal": "85mm", "shotSize": "近景", "angle": "略仰拍", "movement": "固定" },
              "lighting": "高调柔光",
              "action": "角色动作描述",
              "dialogue": "台词（无则空字符串）",
              "expression": "表情",
              "refs": [
                { "role": "character", "assetName": "沈清和", "variantLabel": "日常装", "viewLabel": "四视图" },
                { "role": "scene", "assetName": "城市广场", "variantLabel": "白天", "viewLabel": "全景" }
              ]
            }
          ]
        }
      ]
    }
  ]
}

规则：
1. sceneIndex 必须与剧本中的场次 index 一一对应，不能增减场次。
2. 段（segment）是一次视频生成单位：每个段最多 3 个分镜；段内各分镜 durationMs 之和必须等于该段 targetMs。
3. 一个场次可按下列条件拆成多段：超过最大时长、主体或机位组发生变化、对白过多。
4. 相邻段之间使用首尾帧锚定：除每场第一段外，每个段的第一个分镜的 refs 必须包含 role 为 "first_frame" 的引用（assetName 留空）。
5. refs 只能引用给定资产清单中真实存在的 assetName / variantLabel / viewLabel；角色用四视图，场景按机位选择全景/反打/左/右等视角。角色出场时其所在分镜必须包含该角色的 character 引用。
6. 必须遵守连续性规则：不跨越 180° 轴线（cameraSide 保持恒定）、视线匹配、光线连续、焦段变化有逻辑、服装道具一致、动作衔接、站位锁定。
7. camera.focal 用具体焦段（如 24mm/35mm/50mm/85mm），shotSize 用景别（远景/全景/中景/近景/特写），angle 用机位角度，movement 用运镜（固定/推/拉/摇/移/跟）。
8. blocking 的 pos 为俯视相对坐标（0~1），facing 为朝向角度（0~360，0 为画面右方）。所有文本使用中文。`;

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
  systemPrompt: SYSTEM_PROMPT,
  inputSchema,
  outputSchema: storyboardDraftSchema,
  async run(ctx, input) {
    if (!ctx.script) {
      throw new Error("尚未生成剧本，请先生成剧本。");
    }
    const user = [
      `【项目风格】${ctx.project.style || "未指定"}`,
      `【画面比例】${ctx.project.aspectRatio}`,
      `【默认段时长】${ctx.project.defaultSegmentMs}ms`,
      `【启用的连续性规则】${rulesToText(ctx.rules)}`,
      "",
      "【资产清单】",
      assetsToText(ctx.assets),
      "",
      "【结构化剧本】",
      scriptToText(ctx.script),
      input.extraInstructions ? `\n【额外要求】\n${input.extraInstructions}` : "",
      "",
      "请输出分镜 JSON。",
    ].join("\n");

    return generateStructured({
      schema: storyboardDraftSchema,
      system: getActiveSkillPrompt("script-to-storyboard") ?? SYSTEM_PROMPT,
      temperature: getActiveSkillTemperature("script-to-storyboard"),
      user,
    });
  },
};
