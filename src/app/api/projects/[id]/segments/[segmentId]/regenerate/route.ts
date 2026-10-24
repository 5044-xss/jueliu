import { NextResponse } from "next/server";
import { getProjectDb, newId, nowIso } from "@core/server/db";
import {
  augmentCharacterRefs,
  dialogueToText,
  getStoryboard,
  recomputeSceneHardCuts,
  resolveRefLabels,
  toDialogue,
} from "@core/server/storyboard";
import { getAssets } from "@core/server/assets";
import { getProject } from "@core/server/projects";
import { getStoredScript } from "@core/server/script";
import { generateStructured } from "@core/server/llm/structured";
import { segmentRepairSchema } from "@core/shared/schemas/storyboard";
import { STORYBOARD_REGENERATE_PROMPT } from "@core/server/skills/prompts";
import { getActiveSkillTemperature } from "@core/server/library/skills";
import { startJob, finishJob } from "@core/server/jobs";
import { validateSegmentBeatIds } from "@core/shared/storyboard-coverage";
import { shotBudget } from "@core/shared/shot-budget";
import type { StoredSceneStoryboard } from "@core/shared/schemas/storyboard";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

export const maxDuration = 300;

function fitDurations(durations: number[], targetMs: number): number[] {
  const values = durations.map((value) => Math.max(1, Math.round(value || 0)));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!targetMs || total === targetMs) return values;
  const scaled = values.map((value) =>
    Math.max(1, Math.round((targetMs * value) / total)),
  );
  const diff = targetMs - scaled.reduce((sum, value) => sum + value, 0);
  scaled[scaled.length - 1] = Math.max(1, scaled[scaled.length - 1] + diff);
  return scaled;
}

export async function POST(_request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const db = getProjectDb(id);
  const fullStoryboardRunning = db
    .prepare(
      `SELECT 1 FROM job
       WHERE project_id = ? AND status = 'running' AND kind = 'script-to-storyboard'
       LIMIT 1`,
    )
    .get(id);
  if (fullStoryboardRunning) {
    return NextResponse.json(
      { error: "分镜正在整体生成中，请等待完成后再重新生成本段" },
      { status: 409 },
    );
  }

  const scenes = getStoryboard(id);
  let scene: StoredSceneStoryboard | null = null;
  let segIndex = -1;
  for (const candidate of scenes) {
    const index = candidate.segments.findIndex((x) => x.id === segmentId);
    if (index >= 0) {
      scene = candidate;
      segIndex = index;
      break;
    }
  }
  if (!scene || segIndex < 0) {
    return NextResponse.json({ error: "段不存在" }, { status: 404 });
  }

  const segment = scene.segments[segIndex];
  const isFirstOfScene = segIndex === 0;
  const assets = getAssets(id);

  // 沿用本场已使用的造型，避免重新生成后同一角色换装。
  const variantHint = new Map<
    string,
    { variantLabel: string; viewLabel: string }
  >();
  for (const sceneSegment of scene.segments) {
    for (const shot of sceneSegment.shots) {
      for (const ref of shot.refs) {
        if (ref.role !== "character" || !ref.assetName.trim()) continue;
        const key = ref.assetName.trim().toLowerCase();
        if (!variantHint.has(key)) {
          variantHint.set(key, {
            variantLabel: ref.variantLabel,
            viewLabel: ref.viewLabel,
          });
        }
      }
    }
  }

  const summarize = (target: StoredSceneStoryboard["segments"][number]) =>
    target.shots
      .map((shot, index) => {
        const dialogue = dialogueToText(shot.dialogue);
        return `镜${index + 1}：${shot.action}${dialogue ? `｜台词：${dialogue}` : ""}`;
      })
      .join("\n");

  const assetsText = assets
    .map(
      (asset) =>
        `- [${asset.type}] ${asset.name}：${asset.variants
          .map(
            (variant) =>
              `${variant.label}（${variant.views.map((view) => view.label).join("/") || "无视角"}）`,
          )
          .join("；")}`,
    )
    .join("\n");

  const script = getStoredScript(id);
  const scriptScene = script?.scenes.find((s) => s.index === scene!.sceneIndex);
  const scriptText = scriptScene
    ? scriptScene.beats
        .map((beat) =>
          beat.type === "dialogue"
            ? `${beat.character || "旁白"}：${beat.text}`
            : `（动作）${beat.text}`,
        )
        .join("\n")
    : "";

  const currentShots = segment.shots.map((shot) => ({
    beatIds: shot.beatIds,
    intent: shot.intent ?? "action",
    durationMs: shot.durationMs,
    continuesPrev: shot.continuesPrev,
    camera: shot.camera,
    lighting: shot.lighting,
    action: shot.action,
    dialogue: shot.dialogue,
    expression: shot.expression,
    subjectNodeIds: shot.subjectNodeIds,
    refs: shot.refs.map((ref) => ({
      role: ref.role,
      assetName: ref.assetName,
      variantLabel: ref.variantLabel,
      viewLabel: ref.viewLabel,
    })),
  }));

  const prev = segIndex > 0 ? scene.segments[segIndex - 1] : null;
  const next =
    segIndex < scene.segments.length - 1 ? scene.segments[segIndex + 1] : null;
  const continuityNote = isFirstOfScene
    ? "本段为场次首段，必须独立起镜，不能延续上一场"
    : segment.hardCut
      ? "本段与上一段为硬切"
      : "本段与上一段连续，需在动作、视线、光线、服装、站位上与之衔接";

  const jobId = startJob(id, "segment-regenerate");

  try {
    const user = [
      `【项目风格】${project.style || "未指定"}`,
      `【画面比例】${project.aspectRatio}`,
      `【本场】${scene.sceneIndex} ${scene.location}｜${scene.timeOfDay}｜${scene.interiorExterior}`,
      `【本场 blocking】${scene.blocking ? JSON.stringify(scene.blocking) : "（缺失，请依据分镜内容保持合理站位与轴线）"}`,
      `【本段】第${segment.index}段，必须保持 ${segment.shots.length} 个镜位、beatIds 与 intent 不变；时长由编排层计算；${continuityNote}`,
      "",
      "【资产清单】",
      assetsText || "（暂无资产）",
      scriptText
        ? `\n【本场剧本（仅用于理解上下文，不要重复上一段/下一段已覆盖的内容）】\n${scriptText}`
        : "",
      "",
      "【当前本段分镜（以此为基础重写，可调整镜头划分、机位、节奏与表演）】",
      JSON.stringify(currentShots, null, 2),
      prev ? `\n【上一段（只读，不要改动，本段需与之衔接）】\n${summarize(prev)}` : "",
      next ? `\n【下一段（只读，不要改动，本段需与之衔接）】\n${summarize(next)}` : "",
      "",
      "请只输出重新设计后的本段分镜 JSON。",
    ]
      .filter(Boolean)
      .join("\n");

    const output = await generateStructured({
      schema: segmentRepairSchema,
      system: STORYBOARD_REGENERATE_PROMPT,
      temperature: getActiveSkillTemperature("script-to-storyboard"),
      user,
    });

    const beatErrors = validateSegmentBeatIds(
      segment.shots.map((shot) => shot.beatIds),
      output.shots,
    );
    if (beatErrors.length > 0) {
      finishJob(id, jobId, "failed", beatErrors.join("；"));
      return NextResponse.json(
        { error: `重新生成本段失败：${beatErrors.join("；")}` },
        { status: 422 },
      );
    }

    const budgets = output.shots.map((shot) =>
      shotBudget({ dialogue: toDialogue(shot.dialogue), action: shot.action }),
    );
    const minSum = budgets.reduce((sum, budget) => sum + budget.minMs, 0);
    const targetMs = Math.max(segment.targetMs, minSum);
    const durations = fitDurations(
      budgets.map((budget) => budget.idealMs),
      targetMs,
    ).map((duration, index) => Math.max(duration, budgets[index].minMs));
    const actualTargetMs = durations.reduce((sum, value) => sum + value, 0);

    const tx = db.transaction(() => {
      const exists = db
        .prepare("SELECT id FROM segment WHERE id = ? AND project_id = ?")
        .get(segmentId, id);
      if (!exists) throw new Error("本段已被删除或重新编排，请刷新后再试");

      db.prepare("DELETE FROM shot WHERE segment_id = ?").run(segmentId);
      const insertShot = db.prepare(
        `INSERT INTO shot
         (id, segment_id, idx, duration_ms, ideal_ms, continues_prev,
          camera_json, lighting, action, dialogue, dialogue_json, expression,
          subject_node_ids_json, original_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
      );
      const insertRef = db.prepare(
        `INSERT INTO shot_ref (id, shot_id, role, asset_id, variant_id, view_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );

      output.shots.forEach((shot, index) => {
        const refs = augmentCharacterRefs(
          shot,
          scene!.blocking,
          assets,
          variantHint,
        );
        const durationMs = durations[index] ?? shot.durationMs;
        const continuesPrev = isFirstOfScene ? false : shot.continuesPrev;
        const dialogue = toDialogue(shot.dialogue);
        const shotId = newId();
        insertShot.run(
          shotId,
          segmentId,
          index,
          durationMs,
          budgets[index]?.idealMs ?? durationMs,
          continuesPrev ? 1 : 0,
          JSON.stringify(shot.camera),
          shot.lighting,
          shot.action,
          JSON.stringify(dialogue),
          shot.expression,
          JSON.stringify(shot.subjectNodeIds ?? []),
          JSON.stringify({
            beatIds: shot.beatIds ?? [],
            intent: shot.intent,
            durationMs,
            idealMs: budgets[index]?.idealMs ?? durationMs,
            continuesPrev,
            camera: shot.camera,
            lighting: shot.lighting,
            action: shot.action,
            dialogue,
            expression: shot.expression,
            subjectNodeIds: shot.subjectNodeIds ?? [],
            refs,
          }),
        );
        refs.forEach((ref, refIndex) => {
          const resolved = resolveRefLabels(assets, ref);
          if (!resolved.assetId) return;
          insertRef.run(
            newId(),
            shotId,
            ref.role,
            resolved.assetId,
            resolved.variantId,
            resolved.viewId,
            refIndex,
          );
        });
      });

      // 有旧视频时写入一个必定与当前内容不符的签名，让界面显示「已过期」，
      // 而不是在读取时把旧视频误认为与新分镜匹配。
      db.prepare(
        `UPDATE segment SET
           generation_mode = ?,
           target_ms = ?,
           media_sig = CASE
             WHEN video_path IS NOT NULL AND video_path <> '' THEN '__regenerated__'
             ELSE media_sig
           END,
           updated_at = ?
         WHERE id = ?`,
      ).run(
        output.shots.length > 1 ? "multi-shot" : "per-shot",
        actualTargetMs,
        nowIso(),
        segmentId,
      );
    });
    tx();

    recomputeSceneHardCuts(id, scene.sceneId);
    finishJob(id, jobId, "succeeded");
    return NextResponse.json({ scenes: getStoryboard(id) });
  } catch (error) {
    const message = (error as Error).message || "重新生成本段失败";
    finishJob(id, jobId, "failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
