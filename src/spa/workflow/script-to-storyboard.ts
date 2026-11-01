import { buildStoryboardSystemPrompt } from "@core/server/skills/assemble-storyboard-prompt";
import { STORYBOARD_SKELETON_PROMPT } from "@core/server/skills/prompts";
import {
  UNIVERSAL_STRATEGY,
  type StoryboardStrategy,
} from "@core/shared/library/storyboard-strategies";
import {
  buildBeatSlots,
  DEFAULT_MAX_BEATS_PER_SHOT,
  hydrateStoryboardDraft,
  repairStoryboardCoverage,
  validateStoryboardCoverage,
  type BeatSlot,
} from "@core/shared/storyboard-coverage";
import {
  generatedStoryboardDraftSchema,
  type StoredRef,
  type StoredSceneStoryboard,
  type StoredSegment,
  type StoredShot,
  type StoryboardDraft,
} from "@core/shared/schemas/storyboard";
import type { StoredAsset } from "@core/shared/schemas/assets";
import type { Script } from "@core/shared/schemas/script";
import { generateStructured } from "../llm/structured";
import type { LlmConfig } from "../storage/settings";

export interface ScriptToStoryboardInput {
  script: Script;
  assets: StoredAsset[];
  style: string;
  aspectRatio: string;
  config: LlmConfig;
  extraInstructions?: string;
  strategy?: StoryboardStrategy;
  systemPrompt?: string;
  temperature?: number;
}

function assetsToText(assets: StoredAsset[]): string {
  if (assets.length === 0) return "（暂无资产，只能引用角色名）";
  return assets
    .map((asset) => {
      const variants = asset.variants
        .map(
          (variant) =>
            `    - 变体「${variant.label}」视角：${
              variant.views.map((view) => view.label).join("、") || "无"
            }`,
        )
        .join("\n");
      return `- [${asset.type}] ${asset.name}\n${variants}`;
    })
    .join("\n");
}

function scriptToText(
  script: Script,
  slotsByScene: Map<string, BeatSlot[]>,
  maxBeatsPerShot: number,
): string {
  const lines: string[] = [];
  for (const scene of script.scenes) {
    lines.push(
      `\n【场次 ${scene.index}｜${scene.slug}｜${scene.location}｜${scene.timeOfDay}｜${scene.interiorExterior}】`,
    );
    if (scene.summary) lines.push(`概述：${scene.summary}`);
    if (scene.characters.length) {
      lines.push(`出场：${scene.characters.join("、")}`);
    }
    const slots = slotsByScene.get(scene.index) ?? [];
    lines.push(
      `本场 beat 数：${slots.length}，每个叙事镜最多覆盖 ${maxBeatsPerShot} 个连续 beat；全部 beat 必须覆盖且保序`,
    );
    slots.forEach((slot, index) => {
      lines.push(
        `${index + 1}. [${slot.beatId}][${
          slot.type === "dialogue"
            ? `对白·${slot.character || "旁白"}`
            : "动作"
        }] ${slot.text}`,
      );
    });
  }
  return lines.join("\n");
}

function buildUserPrompt(
  input: ScriptToStoryboardInput,
  slotsByScene: Map<string, BeatSlot[]>,
  maxBeatsPerShot: number,
): string {
  return [
    `【项目风格】${input.style || "未指定"}`,
    `【画面比例】${input.aspectRatio}`,
    `【切镜上限】每个叙事镜最多覆盖 ${maxBeatsPerShot} 个连续 beat`,
    "",
    "【资产清单】",
    assetsToText(input.assets),
    "",
    "【结构化剧本（每行开头的数字是本场 beat 序号）】",
    scriptToText(input.script, slotsByScene, maxBeatsPerShot),
    input.extraInstructions?.trim()
      ? `\n【额外要求】\n${input.extraInstructions.trim()}`
      : "",
    "",
    `请按 beat 顺序输出每一场的镜头 JSON：每镜用 beats 数组写本镜覆盖的 beat 序号（从 1 开始，每镜 1–${maxBeatsPerShot} 个连续序号），不要写 beatId；系统会根据 beats 自动生成 beatIds 与台词。每镜标记 intent，并写 cutReason（切镜理由）；人物离场写进 exits。`,
  ].join("\n");
}

function estimateShotMs(shot: { action: string; dialogue: unknown[] }): number {
  const base = shot.dialogue.length > 0 ? 2200 : 1400;
  const text = shot.action.length;
  return Math.max(1000, Math.min(6000, base + Math.round(text * 60)));
}

function mapRef(ref: {
  role: StoredRef["role"];
  assetName: string;
  variantLabel: string;
  viewLabel: string;
}): StoredRef {
  return {
    id: crypto.randomUUID(),
    role: ref.role,
    assetId: null,
    variantId: null,
    viewId: null,
    assetName: ref.assetName,
    variantLabel: ref.variantLabel,
    viewLabel: ref.viewLabel,
    imagePath: null,
  };
}

function toStored(
  draft: StoryboardDraft,
  script: Script,
): StoredSceneStoryboard[] {
  const scriptByIndex = new Map(
    script.scenes.map((scene) => [scene.index, scene]),
  );
  return draft.scenes.map((scene) => {
    const source = scriptByIndex.get(scene.sceneIndex);
    const sceneId = crypto.randomUUID();
    const shots: StoredShot[] = scene.shots.map((shot, index) => {
      const duration = estimateShotMs(shot);
      return {
        id: crypto.randomUUID(),
        index: index + 1,
        beatIds: shot.beatIds,
        intent: shot.intent,
        cutReason: shot.cutReason,
        exits: shot.exits,
        durationMs: duration,
        idealMs: duration,
        continuesPrev: shot.continuesPrev,
        transition: shot.transition,
        camera: shot.camera,
        lighting: shot.lighting,
        action: shot.action,
        dialogue: shot.dialogue,
        expression: shot.expression,
        subjectNodeIds: shot.subjectNodeIds,
        mentionedNodeIds: shot.mentionedNodeIds ?? [],
        refs: shot.refs.map(mapRef),
        state: null,
        stateIssues: [],
        hasOriginal: false,
      };
    });

    const segments: StoredSegment[] = [];
    for (let offset = 0; offset < shots.length; offset += 3) {
      const group = shots.slice(offset, offset + 3);
      const targetMs = group.reduce((sum, shot) => sum + shot.durationMs, 0);
      segments.push({
        id: crypto.randomUUID(),
        sceneId,
        index: segments.length + 1,
        generationMode: "multi-shot",
        targetMs,
        firstFrameId: null,
        firstFrameOrigin: null,
        mediaSig: null,
        refOverride: null,
        stale: false,
        hardCut: segments.length === 0,
        linkMode: segments.length === 0 ? "hard-cut" : "tail-frame",
        seamReason: null,
        status: "draft",
        videoPath: null,
        genStatus: null,
        genProgress: null,
        genProgressCurrent: null,
        shots: group,
      });
    }

    return {
      sceneId,
      sceneIndex: scene.sceneIndex,
      sceneSlug: source?.slug ?? scene.sceneIndex,
      location: source?.location ?? "",
      timeOfDay: source?.timeOfDay ?? "",
      interiorExterior: source?.interiorExterior ?? "",
      blocking: scene.blocking ?? null,
      segments,
    };
  });
}

export async function generateStoryboard(
  input: ScriptToStoryboardInput,
): Promise<StoredSceneStoryboard[]> {
  const strategy = input.strategy ?? UNIVERSAL_STRATEGY;
  const maxBeatsPerShot =
    strategy.params?.maxBeatsPerShot ?? DEFAULT_MAX_BEATS_PER_SHOT;
  const slotsByScene = buildBeatSlots(input.script.scenes);
  const system = buildStoryboardSystemPrompt(
    input.systemPrompt || STORYBOARD_SKELETON_PROMPT,
    strategy,
  );
  const baseUser = buildUserPrompt(input, slotsByScene, maxBeatsPerShot);
  let feedback = "";
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const generated = await generateStructured({
      config: input.config,
      schema: generatedStoryboardDraftSchema,
      system,
      temperature: input.temperature ?? input.config.temperature,
      user: baseUser + feedback,
      maxRetries: 1,
    });

    const hydrated = hydrateStoryboardDraft(generated, slotsByScene, {
      maxBeatsPerShot,
    });
    const repaired = repairStoryboardCoverage(hydrated.draft, slotsByScene);
    const order = new Map(
      input.script.scenes.map((scene, index) => [scene.index, index]),
    );
    const draft: StoryboardDraft = {
      scenes: repaired.draft.scenes
        .filter((scene) => order.has(scene.sceneIndex))
        .sort(
          (a, b) =>
            (order.get(a.sceneIndex) ?? 0) - (order.get(b.sceneIndex) ?? 0),
        ),
    };
    const errors = validateStoryboardCoverage(draft, slotsByScene, {
      maxBeatsPerShot,
    });
    if (errors.length === 0) {
      return toStored(draft, input.script);
    }
    lastErrors = [...hydrated.warnings, ...errors];
    feedback = `\n\n【上次输出不合格，请只修正以下问题后重新输出】\n${lastErrors
      .slice(0, 12)
      .join("\n")}`;
  }

  throw new Error(`分镜覆盖校验失败：${lastErrors.slice(0, 5).join("；")}`);
}
