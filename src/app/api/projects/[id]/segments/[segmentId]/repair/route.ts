import { NextResponse } from "next/server";
import { getProjectDb, newId } from "@core/server/db";
import {
  getStoryboard,
  resolveRefLabels,
  dialogueToText,
  toDialogue,
} from "@core/server/storyboard";
import { validateContinuity, type ContinuityWarning } from "@core/server/continuity";
import { getAssets } from "@core/server/assets";
import { getProject } from "@core/server/projects";
import { getStoredScript } from "@core/server/script";
import { generateStructured } from "@core/server/llm/structured";
import { segmentRepairSchema } from "@core/shared/schemas/storyboard";
import { STORYBOARD_REPAIR_PROMPT } from "@core/server/skills/prompts";
import { getActiveSkillTemperature } from "@core/server/library/skills";
import { startJob, finishJob } from "@core/server/jobs";
import type { StoredSceneStoryboard } from "@core/shared/schemas/storyboard";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

const MAX_ATTEMPTS = 2;

function warningKey(w: ContinuityWarning): string {
  return `${w.sceneIndex}|${w.segmentIndex ?? ""}|${w.level}|${w.message}`;
}

export async function POST(_request: Request, { params }: Ctx) {
  const { id, segmentId } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const scenes = getStoryboard(id);
  let scene: StoredSceneStoryboard | null = null;
  let segIndex = -1;
  for (const s of scenes) {
    const idx = s.segments.findIndex((x) => x.id === segmentId);
    if (idx >= 0) {
      scene = s;
      segIndex = idx;
      break;
    }
  }
  if (!scene || segIndex < 0) {
    return NextResponse.json({ error: "段不存在" }, { status: 404 });
  }

  const segment = scene.segments[segIndex];
  const assets = getAssets(id);
  const isFirstOfScene = segIndex === 0;

  const before = validateContinuity(id);
  const isTarget = (w: ContinuityWarning) =>
    w.sceneIndex === scene!.sceneIndex && w.segmentIndex === segment.index;
  const targetWarnings = before.filter(isTarget);
  const targetWarningCount = targetWarnings.filter(
    (w) => w.level === "warning",
  ).length;
  const otherKeysBefore = new Set(
    before.filter((w) => !isTarget(w)).map(warningKey),
  );

  const jobId = startJob(id, "repair");

  if (targetWarningCount === 0) {
    finishJob(id, jobId, "succeeded");
    return NextResponse.json({
      scenes: getStoryboard(id),
      warnings: before,
      attempts: 0,
      message: "本段没有需要修复的警告。",
    });
  }

  const summarize = (s: StoredSceneStoryboard["segments"][number]) =>
    s.shots
      .map((sh, i) => {
        const dialogue = dialogueToText(sh.dialogue);
        return `镜${i + 1}：${sh.action}${dialogue ? `｜台词：${dialogue}` : ""}`;
      })
      .join("\n");
  const prev = segIndex > 0 ? scene.segments[segIndex - 1] : null;
  const next =
    segIndex < scene.segments.length - 1
      ? scene.segments[segIndex + 1]
      : null;

  const assetsText = assets
    .map(
      (a) =>
        `- [${a.type}] ${a.name}：${a.variants
          .map(
            (v) =>
              `${v.label}（${v.views.map((vw) => vw.label).join("/") || "无视角"}）`,
          )
          .join("；")}`,
    )
    .join("\n");

  const script = getStoredScript(id);
  const scriptScene = script?.scenes.find((s) => s.index === scene!.sceneIndex);
  const scriptText = scriptScene
    ? scriptScene.beats
        .map((b) =>
          b.type === "dialogue"
            ? `${b.character || "旁白"}：${b.text}`
            : `（动作）${b.text}`,
        )
        .join("\n")
    : "";

  const currentShots = segment.shots.map((s) => ({
    durationMs: s.durationMs,
    camera: s.camera,
    lighting: s.lighting,
    action: s.action,
    dialogue: s.dialogue,
    expression: s.expression,
    refs: s.refs.map((r) => ({
      role: r.role,
      assetName: r.assetName,
      variantLabel: r.variantLabel,
      viewLabel: r.viewLabel,
    })),
  }));

  const continuityNote =
    segment.hardCut || isFirstOfScene
      ? "本段为硬切/场次首段（独立镜头）"
      : "本段与上一段连续，需在动作、视线、光线、服装、站位上与之衔接";

  let feedback = "";
  let lastReason = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const user = [
      `【项目风格】${project.style || "未指定"}`,
      `【画面比例】${project.aspectRatio}`,
      `【本场】${scene.sceneIndex} ${scene.location}｜${scene.timeOfDay}｜${scene.interiorExterior}`,
      `【本场 blocking】${scene.blocking ? JSON.stringify(scene.blocking) : "（缺失，请依据剧本补足合理的人物站位与轴线）"}`,
      `【本段】第${segment.index}段，目标时长 ${segment.targetMs}ms；${continuityNote}`,
      "",
      "【资产清单】",
      assetsText,
      scriptText ? `\n【本场剧本（必须全部覆盖，不得漏掉任何台词/动作）】\n${scriptText}` : "",
      "",
      "【当前本段分镜 JSON】",
      JSON.stringify(currentShots, null, 2),
      prev ? `\n【上一段（不要改动，但要保持衔接）】\n${summarize(prev)}` : "",
      next ? `\n【下一段（不要改动，但要保持衔接）】\n${summarize(next)}` : "",
      "",
      "【需要修复的连续性问题】",
      targetWarnings.map((w) => `- ${w.message}`).join("\n"),
      feedback ? `\n【上次尝试的结果】\n${feedback}` : "",
      "",
      "请只输出修复后的本段分镜 JSON。",
    ]
      .filter(Boolean)
      .join("\n");

    let output;
    try {
      output = await generateStructured({
        schema: segmentRepairSchema,
        system: STORYBOARD_REPAIR_PROMPT,
        temperature: getActiveSkillTemperature("script-to-storyboard"),
        user,
      });
    } catch (error) {
      lastReason = (error as Error).message;
      feedback = `上一次调用失败：${lastReason}`;
      continue;
    }

    const db = getProjectDb(id);
    let reason = "";
    try {
      const tx = db.transaction(() => {
        const existing = db
          .prepare("SELECT original_json FROM shot WHERE segment_id = ? ORDER BY idx")
          .all(segmentId) as { original_json: string | null }[];
        db.prepare("DELETE FROM shot WHERE segment_id = ?").run(segmentId);
        const insertShot = db.prepare(
          `INSERT INTO shot
           (id, segment_id, idx, duration_ms, ideal_ms, continues_prev, camera_json, lighting, action, dialogue, dialogue_json, expression, subject_node_ids_json, original_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
        );
        const insertRef = db.prepare(
          `INSERT INTO shot_ref (id, shot_id, role, asset_id, variant_id, view_id, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        output.shots.forEach((shot, i) => {
          const shotId = newId();
          insertShot.run(
            shotId,
            segmentId,
            i,
            shot.durationMs,
            shot.durationMs,
            shot.continuesPrev ? 1 : 0,
            JSON.stringify(shot.camera),
            shot.lighting,
            shot.action,
            JSON.stringify(toDialogue(shot.dialogue)),
            shot.expression,
            JSON.stringify(shot.subjectNodeIds ?? []),
            existing[i]?.original_json ?? null,
          );
          shot.refs.forEach((ref, ri) => {
            const r = resolveRefLabels(assets, ref);
            insertRef.run(
              newId(),
              shotId,
              ref.role,
              r.assetId,
              r.variantId,
              r.viewId,
              ri,
            );
          });
        });

        const after = validateContinuity(id);
        const afterTargetWarnings = after.filter(
          (w) => isTarget(w) && w.level === "warning",
        ).length;
        const newOther = after.filter(
          (w) =>
            !isTarget(w) &&
            w.level === "warning" &&
            !otherKeysBefore.has(warningKey(w)),
        );
        if (newOther.length > 0) {
          throw new Error(`修复影响了其他段：${newOther[0].message}`);
        }
        if (afterTargetWarnings > 0) {
          throw new Error(`本段仍有 ${afterTargetWarnings} 条警告未解决`);
        }
      });
      tx();
    } catch (error) {
      reason = (error as Error).message;
    }

    if (!reason) {
      finishJob(id, jobId, "succeeded");
      return NextResponse.json({
        scenes: getStoryboard(id),
        warnings: validateContinuity(id),
        attempts: attempt,
      });
    }
    lastReason = reason;
    feedback = `上一次修复后：${reason}。请避免改动会影响其他段的字段。`;
  }

  finishJob(id, jobId, "failed", lastReason || "修复失败");
  return NextResponse.json(
    { error: `修复失败（已保留原分镜）：${lastReason}` },
    { status: 422 },
  );
}
