import { SCRIPT_TO_ASSETS_PROMPT } from "@core/server/skills/prompts";
import {
  assetsDraftSchema,
  inferViewKind,
  type StoredAsset,
} from "@core/shared/schemas/assets";
import type { Script } from "@core/shared/schemas/script";
import { generateStructured } from "../llm/structured";
import type { LlmConfig } from "../storage/settings";

export interface ScriptToAssetsInput {
  script: Script;
  style: string;
  config: LlmConfig;
  extraInstructions?: string;
  systemPrompt?: string;
  temperature?: number;
}

function scriptToText(script: Script): string {
  const lines: string[] = [];
  if (script.title) lines.push(`剧本标题：${script.title}`);
  for (const scene of script.scenes) {
    lines.push(
      `\n【${scene.slug || `${scene.index}场`}】地点：${scene.location}；时间：${scene.timeOfDay}；${scene.interiorExterior}景`,
    );
    if (scene.summary) lines.push(`概述：${scene.summary}`);
    if (scene.characters.length) {
      lines.push(`出场角色：${scene.characters.join("、")}`);
    }
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

function buildUserPrompt(input: ScriptToAssetsInput): string {
  const sceneSpaces = [
    ...new Map(
      input.script.scenes
        .map((scene) => ({
          location: scene.location.trim(),
          interiorExterior: scene.interiorExterior.trim(),
        }))
        .filter((item) => item.location)
        .map((item) => [`${item.location}|${item.interiorExterior}`, item]),
    ).values(),
  ];
  const characters = [
    ...new Set(
      input.script.scenes
        .flatMap((scene) => scene.characters)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];

  return [
    `【风格说明】项目风格为「${input.style || "未指定"}」，不要把风格词写进 prompt。`,
    "【参考图比例】角色单图全身照用竖版 3:4；四视图用横版 16:9；场景用 16:9；道具用 1:1。",
    "",
    `【必须覆盖的场景空间清单】共 ${sceneSpaces.length} 个：`,
    sceneSpaces
      .map(
        (item) =>
          `- ${item.location}（${
            item.interiorExterior === "内"
              ? "内景"
              : item.interiorExterior === "外"
                ? "外景"
                : "未标注"
          }）`,
      )
      .join("\n"),
    "",
    `【必须覆盖的角色清单】共 ${characters.length} 个：`,
    characters.map((name) => `- ${name}`).join("\n"),
    "",
    "【结构化剧本】",
    scriptToText(input.script),
    input.extraInstructions?.trim()
      ? `\n【额外要求】\n${input.extraInstructions.trim()}`
      : "",
    "",
    "请输出资产 JSON。",
  ].join("\n");
}

export async function generateAssets(
  input: ScriptToAssetsInput,
): Promise<StoredAsset[]> {
  const draft = await generateStructured({
    config: input.config,
    schema: assetsDraftSchema,
    system: input.systemPrompt || SCRIPT_TO_ASSETS_PROMPT,
    temperature: input.temperature ?? input.config.temperature,
    user: buildUserPrompt(input),
    maxRetries: 1,
  });

  return draft.assets.map((asset) => ({
    id: crypto.randomUUID(),
    type: asset.type,
    name: asset.name,
    basePrompt: asset.basePrompt,
    interiorExterior: asset.interiorExterior,
    characterViewMode: "single",
    variants: asset.variants.map((variant) => ({
      id: crypto.randomUUID(),
      label: variant.label,
      prompt: variant.prompt,
      originalLabel: null,
      originalPrompt: null,
      views: variant.views.map((view) => ({
        id: crypto.randomUUID(),
        label: view.label,
        prompt: view.prompt,
        kind: view.kind ?? inferViewKind(view.label),
        imagePath: null,
        originalLabel: null,
        originalPrompt: null,
      })),
    })),
    originalName: null,
    originalBasePrompt: null,
  }));
}
