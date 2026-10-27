import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPreflight } from "../../packages/core/src/shared/preflight.ts";
import { cameraJump } from "../../packages/core/src/shared/camera-continuity.ts";
import {
  augmentCharacterRefs,
  augmentShotSubjects,
  normalizeActionForCast,
  castContinuityCompatible,
} from "../../packages/core/src/shared/cast-refs.ts";
import { packSceneV2 } from "../../packages/core/src/server/orchestration/pack.ts";
import {
  buildTransitionBrief,
  decideSeam,
} from "../../packages/core/src/shared/continuity-engine.ts";
import { shotBudgetFromBeats } from "../../packages/core/src/shared/shot-budget.ts";
import {
  buildBeatSlots,
  hydrateStoryboardDraft,
  repairStoryboardCoverage,
  validateStoryboardCoverage,
} from "../../packages/core/src/shared/storyboard-coverage.ts";
import { checkDialogueCoverage } from "../../packages/core/src/shared/dialogue-coverage.ts";
import { renderH3Prompt } from "../../packages/core/src/server/compile/h3-render.ts";
import { buildShotBlockingTextEn } from "../../packages/core/src/shared/blocking-text.ts";
import { stripCostumeColors } from "../../packages/core/src/shared/costume-text.ts";
import { preferredVideoImage } from "../../packages/core/src/shared/video-ref.ts";
import { normalizeShotState } from "../../packages/core/src/server/storyboard/normalize-shot-state.ts";
import { auditPropTrajectory } from "../../packages/core/src/shared/prompt-audit.ts";
import {
  auditShotCinematics,
  cinematicStats,
  diversifyCameraMovement,
  findSelfTargets,
  isGenericLighting,
  isUnfilmableAction,
} from "../../packages/core/src/shared/cinematic-audit.ts";
import { buildH3Workflow } from "../../src/lib/generation/comfy.ts";
import { STORYBOARD_SKELETON_PROMPT } from "../../packages/core/src/server/skills/prompts.ts";
import { buildStoryboardSystemPrompt } from "../../packages/core/src/server/skills/assemble-storyboard-prompt.ts";
import {
  BUILTIN_STORYBOARD_STRATEGIES,
  UNIVERSAL_STRATEGY,
} from "../../packages/core/src/shared/library/storyboard-strategies.ts";
import { actionMentions } from "../../packages/core/src/server/storyboard/normalize-shot-state.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(root, "cases");

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function loadCases() {
  if (!fs.existsSync(casesDir)) return [];
  return fs
    .readdirSync(casesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(casesDir, entry.name, "case.json");
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return { ...data, dir: entry.name, file };
    })
    .filter((item) => item.id && item.stage);
}

function sortedCodes(issues, level) {
  return [...new Set(
    issues
      .filter((issue) => issue.level === level)
      .map((issue) => issue.code),
  )].sort();
}

function assertCodes(actual, expected, label) {
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    `${label} mismatch`,
  );
}

function assertContains(text, needle, label) {
  assert.ok(text.includes(needle), `${label}：缺少「${needle}」`);
}

function assertNotContains(text, needle, label) {
  assert.ok(!text.includes(needle), `${label}：不应出现「${needle}」`);
}

function parseShotBlocks(description) {
  const matches = [...description.matchAll(/\[Shot (\d+)\]/g)];
  return matches.map((match, index) => {
    const start = match.index;
    const end =
      index + 1 < matches.length ? matches[index + 1].index : description.length;
    return { index: Number(match[1]), text: description.slice(start, end) };
  });
}

function inFrameIds(text) {
  const match = text.match(
    /((?:<Subject\s+\d+>[\s,]*)+?)\s*(?:are|is)\s+in frame/i,
  );
  if (!match) return [];
  return [...match[1].matchAll(/<Subject\s+(\d+)>/g)].map((item) =>
    Number(item[1]),
  );
}

function parseRetention(block) {
  const map = new Map();
  for (const match of block.matchAll(/<Subject (\d+)> \(appears in ([^)]*)\)/g)) {
    map.set(
      Number(match[1]),
      [...match[2].matchAll(/\[Shot (\d+)\]/g)]
        .map((item) => Number(item[1]))
        .sort((a, b) => a - b),
    );
  }
  return map;
}

function parseDialogue(text) {
  return [...text.matchAll(/<d>\s*(?:\[[^\]]*\])?\s*([\s\S]*?)<\/d>/g)].map(
    (match) => match[1].trim(),
  );
}

function parseTimecode(text) {
  const match = text.match(/At (\d{2}):(\d{2}\.\d{3})/);
  if (!match) return null;
  return Math.round((Number(match[1]) * 60 + Number(match[2])) * 1000);
}

async function runPreflightCase(item) {
  const issues = runPreflight(item.input);
  if (item.expect.errors) {
    assertCodes(
      sortedCodes(issues, "error"),
      item.expect.errors,
      "preflight errors",
    );
  }
  if (item.expect.warnings) {
    assertCodes(
      sortedCodes(issues, "warning"),
      item.expect.warnings,
      "preflight warnings",
    );
  }
}

async function runCameraJumpCase(item) {
  const jump = cameraJump(item.input.prev, item.input.next);
  if (typeof item.expect.continuous === "boolean") {
    assert.equal(jump.continuous, item.expect.continuous, "continuous");
  }
  if (typeof item.expect.rankDiff === "number") {
    assert.equal(jump.rankDiff, item.expect.rankDiff, "rankDiff");
  }
  if (typeof item.expect.focalRatio === "number") {
    assert.ok(
      Math.abs(jump.focalRatio - item.expect.focalRatio) < 0.011,
      `focalRatio expected ${item.expect.focalRatio}, got ${jump.focalRatio}`,
    );
  }
}

async function runAugmentCastCase(item) {
  const shot = item.input.shot;
  const refs = augmentCharacterRefs(
    shot,
    item.input.blocking,
    item.input.assets,
    new Map(),
  );
  const subjects = augmentShotSubjects(shot, item.input.blocking, refs);
  const refNames = refs.map((ref) => ref.assetName);
  for (const name of item.expect.refsInclude ?? []) {
    assert.ok(refNames.includes(name), `refs 缺少「${name}」`);
  }
  for (const name of item.expect.refsExclude ?? []) {
    assert.ok(!refNames.includes(name), `refs 不应包含「${name}」`);
  }
  for (const id of item.expect.subjectIdsInclude ?? []) {
    assert.ok(subjects.includes(id), `subjectNodeIds 缺少「${id}」`);
  }
  for (const id of item.expect.subjectIdsExclude ?? []) {
    assert.ok(!subjects.includes(id), `subjectNodeIds 不应包含「${id}」`);
  }
}

async function runDialogueCoverageCase(item) {
  const coverage = checkDialogueCoverage(item.input.prompt, item.input.sources);
  if (typeof item.expect.compiledCount === "number") {
    assert.equal(coverage.compiledCount, item.expect.compiledCount, "compiledCount");
  }
  if (typeof item.expect.sourceCount === "number") {
    assert.equal(coverage.sourceCount, item.expect.sourceCount, "sourceCount");
  }
  if (typeof item.expect.placeholderOnly === "boolean") {
    assert.equal(
      coverage.placeholderOnly,
      item.expect.placeholderOnly,
      "placeholderOnly",
    );
  }
  if (item.expect.missingTexts) {
    assert.deepEqual(
      coverage.missing.map((line) => line.text).sort(),
      [...item.expect.missingTexts].sort(),
      "missing dialogue",
    );
  }
}

async function runPackV2Case(item) {
  const result = packSceneV2(
    item.input.shots,
    item.input.vendor,
    item.input.defaultSegmentMs,
    item.input.options ?? {},
  );
  assert.deepEqual(
    result.segments.map((segment) => segment.shotIndexes),
    item.expect.segments,
    "segment shot indexes",
  );
  if (typeof item.expect.minMs === "number") {
    for (const segment of result.segments) {
      assert.ok(
        segment.targetMs >= item.expect.minMs,
        `segment target ${segment.targetMs} < min ${item.expect.minMs}`,
      );
      assert.equal(
        segment.shotDurations.reduce((a, b) => a + b, 0),
        segment.targetMs,
        "shot durations sum",
      );
    }
  }
  if (item.expect.targetMs) {
    assert.deepEqual(
      result.segments.map((segment) => segment.targetMs),
      item.expect.targetMs,
      "segment target ms",
    );
  }
  if (item.expect.shotDurations) {
    assert.deepEqual(
      result.segments.map((segment) => segment.shotDurations),
      item.expect.shotDurations,
      "shot durations",
    );
  }
}

async function runCastContinuityCase(item) {
  assert.equal(
    castContinuityCompatible(item.input.prev, item.input.next),
    item.expect.compatible,
    "cast continuity",
  );
}

async function runNormalizeActionCase(item) {
  assert.equal(
    normalizeActionForCast(item.input.action, item.input.subjectLabels ?? []),
    item.expect.action,
    "normalized action",
  );
}

async function runVideoRefCase(item) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pipe-video-ref-"));
  try {
    const source = path.join(dir, "sheet.png");
    fs.writeFileSync(source, "source");
    if (item.input.hasDerived) {
      fs.writeFileSync(path.join(dir, "video-ref.png"), "derived");
    }
    const result = preferredVideoImage(
      item.input.hasImage === false ? null : source,
    );
    assert.equal(
      result,
      item.input.hasImage === false
        ? null
        : item.input.hasDerived
          ? path.join(dir, "video-ref.png")
          : source,
      "preferred video image",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function runH3RenderCase(item) {
  const output = renderH3Prompt(item.input);
  for (const needle of item.expect.contains ?? []) {
    assertContains(output, needle, "h3 output");
  }
  for (const needle of item.expect.notContains ?? []) {
    assertNotContains(output, needle, "h3 output");
  }
  const detailed =
    output.split("detailed_description:")[1]?.split("overall_soundscape:")[0] ??
    output;
  const blocks = parseShotBlocks(detailed);
  if (typeof item.expect.shotCount === "number") {
    assert.equal(blocks.length, item.expect.shotCount, "shot count");
  }
  if (item.expect.shotSubjectIds) {
    const actual = Object.fromEntries(
      blocks.map((block) => [String(block.index), inFrameIds(block.text)]),
    );
    assert.deepEqual(
      actual,
      item.expect.shotSubjectIds,
      "per-shot in-frame subjects",
    );
  }
  if (item.expect.retention) {
    const defs = output.split("retention_analysis:")[1]?.split("detailed_description:")[0] ?? "";
    const actual = Object.fromEntries(
      [...parseRetention(defs)].map(([id, shots]) => [String(id), shots]),
    );
    assert.deepEqual(actual, item.expect.retention, "retention");
  }
  if (item.expect.dialogueByShot) {
    const actual = Object.fromEntries(
      blocks.map((block) => [String(block.index), parseDialogue(block.text)]),
    );
    assert.deepEqual(
      actual,
      item.expect.dialogueByShot,
      "dialogue by shot",
    );
  }
  if (item.expect.timecodes) {
    const actual = blocks.map((block) => parseTimecode(block.text));
    assert.deepEqual(actual, item.expect.timecodes, "timecodes");
  }
  if (item.expect.blockingContains) {
    for (const [shotIndex, needle] of Object.entries(
      item.expect.blockingContains,
    )) {
      const block = blocks.find((item) => String(item.index) === shotIndex);
      assert.ok(block, `缺少 [Shot ${shotIndex}]`);
      assertContains(block.text, needle, `[Shot ${shotIndex}]`);
    }
  }
}

async function runH3BlockingCase(item) {
  const text = buildShotBlockingTextEn(
    item.input.blocking,
    item.input.subjectNodeIds,
    item.input.action,
  );
  for (const needle of item.expect.contains ?? []) {
    assertContains(text, needle, "blocking text");
  }
  for (const needle of item.expect.notContains ?? []) {
    assertNotContains(text, needle, "blocking text");
  }
}

async function runCostumeTextCase(item) {
  const text = stripCostumeColors(item.input.text);
  for (const needle of item.expect.contains ?? []) {
    assertContains(text, needle, "costume text");
  }
  for (const needle of item.expect.notContains ?? []) {
    assertNotContains(text, needle, "costume text");
  }
}

async function runSubmitPayloadCase(item) {  const built = buildH3Workflow(item.input);
  const workflow = built.workflow;
  const promptNode = workflow[item.expect.promptNode ?? "209"];
  assert.ok(promptNode, "缺少 prompt 节点");
  assert.equal(promptNode.inputs.value, item.input.prompt, "提示词未进入工作流");
  const conditional = workflow["167"];
  assert.ok(conditional, "缺少条件节点 167");
  if (item.expect.conditionalClass) {
    assert.equal(
      conditional.class_type,
      item.expect.conditionalClass,
      "条件节点类型",
    );
  }
  if (typeof item.expect.imageCount === "number") {
    const count = Object.values(workflow).filter(
      (node) => node.class_type === "LoadImage",
    ).length;
    assert.equal(count, item.expect.imageCount, "参考图数量");
  }
  if (typeof item.expect.duration === "number") {
    assert.equal(workflow["555"]?.inputs.duration, item.expect.duration, "时长");
  }
  if (item.expect.filenamePrefix) {
    const save = Object.values(workflow).find(
      (node) =>
        node.class_type === "SaveVideo" ||
        node.class_type === "VHS_VideoCombine",
    );
    assert.ok(save, "缺少输出节点");
    assertContains(
      String(save.inputs.filename_prefix ?? ""),
      item.expect.filenamePrefix,
      "输出文件名",
    );
  }
  if (item.expect.modeContains) {
    assertContains(built.mode, item.expect.modeContains, "工作流模式");
  }
}

async function runDialogueTargetCase(item) {
  const shot = item.input.shot;
  const previous = item.input.previousShot
    ? {
        presentCast: item.input.previousShot.subjectNodeIds ?? [],
        dialogue: item.input.previousShot.dialogue ?? [],
        camera: {},
      }
    : null;
  const result = normalizeShotState({
    shotId: "shot-1",
    sceneId: "scene-1",
    sceneIndex: "1-1",
    sceneLocation: "",
    shotIndex: 0,
    blocking: item.input.blocking,
    assets: item.input.assets ?? [],
    draft: {
      action: shot.action ?? "",
      dialogue: shot.dialogue ?? [],
      subjectNodeIds: shot.subjectNodeIds ?? [],
      refs: shot.refs ?? [],
      camera: shot.camera ?? {},
      continuesPrev: true,
      durationMs: 3000,
    },
    previous,
    isFirstShotOfScene: true,
  });
  const speaker = result.state.presentCast.find(
    (member) => member.role === "speaker",
  )?.nodeId;
  const addressee = result.state.dialogue[0]?.addresseeId;
  if (item.expect.speaker) assert.equal(speaker, item.expect.speaker, "speaker");
  if (item.expect.addressee) {
    assert.equal(addressee, item.expect.addressee, "addressee");
    assert.equal(
      result.shot.dialogue[0]?.target,
      item.input.blocking.nodes.find((node) => node.id === item.expect.addressee)
        ?.label,
      "dialogue target label",
    );
  }
  if (item.expect.presentCast) {
    assert.deepEqual(
      [...result.presentCast].sort(),
      [...item.expect.presentCast].sort(),
      "present cast",
    );
  }
  if (item.expect.removed) {
    assert.deepEqual(
      [...result.removedCast].sort(),
      [...item.expect.removed].sort(),
      "removed cast",
    );
  }
}

async function runCinematicAuditCase(item) {
  const kind = item.input.kind;
  if (kind === "self-target") {
    assert.deepEqual(
      findSelfTargets(item.input.action, item.input.labels).map(
        (hit) => hit.label,
      ),
      item.expect.labels,
      "self-target labels",
    );
    return;
  }
  if (kind === "unfilmable") {
    assert.deepEqual(
      item.input.actions.map((action) => isUnfilmableAction(action)),
      item.expect.results,
      "unfilmable results",
    );
    return;
  }
  if (kind === "lighting") {
    assert.deepEqual(
      item.input.lightings.map((lighting) => isGenericLighting(lighting)),
      item.expect.generic,
      "generic lighting",
    );
    return;
  }
  if (kind === "shot") {
    const issues = auditShotCinematics(item.input);
    assertCodes(
      [...new Set(issues.map((issue) => issue.code))],
      item.expect.codes,
      "cinematic issue codes",
    );
    return;
  }
  if (kind === "camera-pass") {
    const result = diversifyCameraMovement(item.input.draft);
    const stats = cinematicStats(result.scenes.flatMap((scene) => scene.shots));
    assert.ok(
      stats.fixedRatio <= 0.6 + 1e-9,
      `fixedRatio ${stats.fixedRatio} > 0.6`,
    );
    const moving = result.scenes.flatMap((scene) =>
      scene.shots.filter(
        (shot) =>
          shot.camera.movement && shot.camera.movement !== "固定",
      ),
    );
    assert.ok(moving.length > 0, "至少应有一个镜头被补上运镜");
    return;
  }
  if (kind === "stats") {
    const stats = cinematicStats(item.input.shots);
    for (const [key, value] of Object.entries(item.expect)) {
      if (key === "fixedRatio") {
        assert.ok(
          Math.abs(stats.fixedRatio - value) < 0.001,
          `fixedRatio expected ${value}, got ${stats.fixedRatio}`,
        );
      } else {
        assert.equal(stats[key], value, key);
      }
    }
    return;
  }
  assert.fail(`未知 cinematic-audit kind：${kind}`);
}

async function runPromptAuditCase(item) {
  const issues = auditPropTrajectory(
    item.input.action,
    item.input.promptShot,
    item.input.expectedTarget,
  );
  assertCodes(
    [...new Set(issues.map((issue) => issue.code))],
    item.expect.codes,
    "prompt audit codes",
  );
}

async function runContinuitySeamCase(item) {
  const decision = decideSeam(item.input);
  assert.equal(decision.linkMode, item.expect.linkMode, "linkMode");
  if (item.expect.reason) {
    assert.equal(decision.reason, item.expect.reason, "reason");
  }
  if (item.expect.transition) {
    assert.equal(decision.transition, item.expect.transition, "transition");
  }
  if (typeof item.expect.hardCut === "boolean") {
    assert.equal(decision.hardCut, item.expect.hardCut, "hardCut");
  }
  if (item.expect.gates) {
    for (const [key, value] of Object.entries(item.expect.gates)) {
      assert.equal(decision.gates[key], value, `gate ${key}`);
    }
  }
}

async function runContinuityBriefCase(item) {
  const text = buildTransitionBrief(item.input);
  for (const needle of item.expect.contains ?? []) {
    assertContains(text, needle, "transition brief");
  }
  for (const needle of item.expect.notContains ?? []) {
    assertNotContains(text, needle, "transition brief");
  }
}

async function runShotBudgetCase(item) {
  const budget = shotBudgetFromBeats(item.input.beats);
  const { expect } = item;
  for (const key of ["minMs", "idealMs", "maxMs", "speechChars"]) {
    if (typeof expect[key] === "number") {
      assert.equal(budget[key], expect[key], key);
    }
  }
  if (typeof expect.minAtLeast === "number") {
    assert.ok(
      budget.minMs >= expect.minAtLeast,
      `minMs ${budget.minMs} < ${expect.minAtLeast}`,
    );
  }
}

async function runCoverageCase(item) {
  const slotsByScene = buildBeatSlots(
    (item.input.scenes ?? []).map((scene) => ({
      index: scene.index,
      beats: scene.beats,
    })),
  );
  let draft = item.input.generated
    ? hydrateStoryboardDraft(item.input.generated, slotsByScene).draft
    : item.input.draft;
  let repairs = [];
  if (item.input.repair === true) {
    const repaired = repairStoryboardCoverage(draft, slotsByScene);
    draft = repaired.draft;
    repairs = repaired.repairs;
  }
  const errors = validateStoryboardCoverage(
    draft,
    slotsByScene,
    item.input.options ?? {},
  );
  const { expect } = item;
  if (typeof expect.repairCount === "number") {
    assert.equal(repairs.length, expect.repairCount, "repair count");
  }
  if (Array.isArray(expect.beatIdsByShot)) {
    assert.deepEqual(
      draft.scenes[0].shots.map((shot) => shot.beatIds),
      expect.beatIdsByShot,
      "beatIds",
    );
  }
  if (Array.isArray(expect.dialogueTextsByShot)) {
    assert.deepEqual(
      draft.scenes[0].shots.map((shot) => shot.dialogue.map((line) => line.text)),
      expect.dialogueTextsByShot,
      "dialogue texts",
    );
  }
  if (Array.isArray(expect.dialogueTargetsByShot)) {
    assert.deepEqual(
      draft.scenes[0].shots.map((shot) =>
        shot.dialogue.map((line) => line.target ?? ""),
      ),
      expect.dialogueTargetsByShot,
      "dialogue targets",
    );
  }
  if (expect.valid) {
    assert.deepEqual(errors, [], "expected valid coverage");
  } else {
    assert.ok(errors.length > 0, "expected coverage errors");
  }
  if (typeof expect.errorCount === "number") {
    assert.equal(errors.length, expect.errorCount, "coverage error count");
  }
  for (const fragment of expect.errorIncludes ?? []) {
    assert.ok(
      errors.some((message) => message.includes(fragment)),
      `missing error fragment ${fragment}: ${errors.join(" | ")}`,
    );
  }
}

const handlers = {
  preflight: runPreflightCase,
  "shot-budget": runShotBudgetCase,
  coverage: runCoverageCase,
  "continuity-seam": runContinuitySeamCase,
  "continuity-brief": runContinuityBriefCase,
  "camera-jump": runCameraJumpCase,
  "augment-cast": runAugmentCastCase,
  "normalize-action": runNormalizeActionCase,
  "dialogue-target": runDialogueTargetCase,
  "cinematic-audit": runCinematicAuditCase,
  "prompt-audit": runPromptAuditCase,
  "pack-v2": runPackV2Case,
  "cast-continuity": runCastContinuityCase,
  "dialogue-coverage": runDialogueCoverageCase,
  "h3-render": runH3RenderCase,
  "h3-blocking": runH3BlockingCase,
  "costume-text": runCostumeTextCase,
  "video-ref": runVideoRefCase,
  "submit-payload": runSubmitPayloadCase,
};

function selectedCases() {
  const onlyCase = arg("case");
  const onlyTag = arg("tag");
  return loadCases().filter((item) => {
    if (onlyCase && item.id !== onlyCase) return false;
    if (onlyTag && !(item.tags ?? []).includes(onlyTag)) return false;
    return true;
  });
}

if (process.argv.includes("--list")) {
  for (const item of selectedCases()) {
    console.log(
      `${item.id}\t${item.stage}\t${(item.tags ?? []).join(",")}\t${item.title}`,
    );
  }
  process.exit(0);
}

const cases = selectedCases();
for (const item of cases) {
  const name = `${item.id} · ${item.title}`;
  const fn = async () => {
    const handler = handlers[item.stage];
    assert.ok(handler, `未知 stage：${item.stage}`);
    await handler(item);
  };
  if (item.pending) {
    test(name, { skip: item.pendingReason ?? "待实现" }, fn);
  } else {
    test(name, fn);
  }
}

if (cases.length === 0) {
  test("pipeline cases", () => {
    assert.fail("没有匹配的测试用例");
  });
}

test("PIPE-082 · 策略组装：通用包无占位符残留且契约段完整", () => {
  const prompt = buildStoryboardSystemPrompt(STORYBOARD_SKELETON_PROMPT, UNIVERSAL_STRATEGY);
  assert.ok(!/\{\{[^}]+\}\}/.test(prompt), "残留占位符");
  assertContains(prompt, "切镜契约", "contract");
  assertContains(prompt, "cutReason", "cut reason rule");
  assertContains(prompt, "同一角色的连续说话：留在同一镜", "same-speaker default");
  assertContains(prompt, "对话段：关系镜", "universal coverage");
  assertContains(prompt, "最多连续 2 镜", "param render");
  assertContains(prompt, "特效须符合设定", "fx light");
});

test("PIPE-083 · 策略组装：内置题材包渲染出差异", () => {
  const render = (id) => {
    const strategy = BUILTIN_STORYBOARD_STRATEGIES.find((item) => item.id === id);
    assert.ok(strategy, "missing strategy " + id);
    return buildStoryboardSystemPrompt(STORYBOARD_SKELETON_PROMPT, {
      params: strategy.params,
      texts: strategy.texts,
    });
  };
  for (const strategy of BUILTIN_STORYBOARD_STRATEGIES) {
    const prompt = buildStoryboardSystemPrompt(STORYBOARD_SKELETON_PROMPT, {
      params: strategy.params,
      texts: strategy.texts,
    });
    assert.ok(!/\{\{[^}]+\}\}/.test(prompt), strategy.id + " 残留占位符");
  }
  const xianxia = render("xianxia");
  assertContains(xianxia, "本片特效全开", "xianxia fx heavy");
  assertContains(xianxia, "斗法段", "xianxia coverage");
  assertContains(xianxia, "同一角色的连续说话可以按情绪升级切镜", "xianxia pacing");
  const boss = render("urban-boss");
  assertContains(boss, "本片为现实题材", "boss fx none");
  assertContains(boss, "谈判/对峙优先双人同框", "boss coverage");
  const ancient = render("ancient");
  assertContains(ancient, "情绪克制、镜头含蓄", "ancient pacing");
  assertContains(ancient, "最多 3 级", "ancient emotion levels");
});

test("PIPE-084 · 动作点名：角色修饰前缀剥除匹配", () => {
  assert.equal(actionMentions("弟子丙抱臂冷笑", "路人弟子丙"), true);
  assert.equal(actionMentions("弟子甲抬下巴", "路人弟子甲"), true);
  assert.equal(actionMentions("陈平生扫地", "陈平生"), true);
  assert.equal(actionMentions("陈平生扫地", "何文成"), false);
  assert.equal(actionMentions("弟子乙撇嘴", "路人弟子丙"), false);
});
