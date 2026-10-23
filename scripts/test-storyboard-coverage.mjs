import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBeatSlots,
  makeBeatId,
  missingBeatIds,
  validateSegmentBeatIds,
  validateStoryboardCoverage,
} from "../packages/core/src/shared/storyboard-coverage.ts";
import {
  shotBudget,
  countSpeechChars,
} from "../packages/core/src/shared/shot-budget.ts";
import { packSceneV2 } from "../packages/core/src/server/orchestration/pack.ts";
import { DEFAULT_VENDORS } from "../packages/core/src/shared/orchestration/vendors.ts";

const beats = [
  ["action", "", "身着素袍，手持扫帚清扫落叶。眼底淡漠，与满山大红灯笼、十里红妆的喜庆格格不入。"],
  ["dialogue", "路人弟子甲", "瞧，陈平生居然也来了，我还以为他躲房里呢。"],
  ["dialogue", "路人弟子乙", "当年陈师姐可是他指腹为婚的未婚妻，该不会来抢亲吧？"],
  ["dialogue", "路人弟子丙", "呵，修为都被废了，拿什么争何师兄？一个害死双亲的人渣罢了。"],
  ["dialogue", "路人弟子甲", "要不是门主念他是陈长老唯一血脉，早杀了。废修为贬杂役，已是天大恩赐。"],
  ["action", "", "恍若未闻，垂眸间眼底闪过冷意，握扫帚的手骨节发白。"],
  ["dialogue", "路人弟子乙", "新娘子来咯！"],
  ["action", "", "一袭红妆走来，脸颊带笑。目光触及陈平生，笑容骤停，眉头紧皱，满眼嫌恶。"],
  ["dialogue", "陈婉儿", "谁准他到前殿来的？"],
  ["action", "", "头戴紫金冠，穿苏绣红锦袍阔步而来。瞥见陈平生时微不可察地皱眉，随即揽住陈婉儿。"],
  ["dialogue", "何文成", "前殿也需要狗来看门吗？"],
  ["action", "", "全场哗然，面面相觑。"],
  ["action", "", "淡淡看向何文成，眼睛微眯。"],
  ["dialogue", "陈平生", "像你这样胡咬乱吠的狗么？"],
  ["action", "", "倒吸凉气，惊恐后退半步。"],
  ["action", "", "不怒反笑，眼神居高临下。"],
  ["dialogue", "何文成", "我知道你急。今天大喜日子，不跟一条狗见识。"],
  ["dialogue", "何文成", "给他一份喜钱，让陈大天才沾沾喜气。"],
  ["action", "", "捏着一枚金元走到陈平生面前，满脸嘲弄。"],
  ["dialogue", "小厮", "拿着吧，没新郎官赏赐，你这杂役一辈子见不到这么多钱。"],
  ["action", "", "伸手接过金元，放在唇边吹了一下，金元发出嗡鸣。"],
  ["dialogue", "陈平生", "何师兄很大方啊。"],
  ["dialogue", "路人弟子甲", "昔日亲传弟子也会为了一个金元折腰。"],
  ["dialogue", "路人弟子乙", "给块骨头就认主人的看门狗罢了。"],
  ["action", "", "厌恶地别过脸去。"],
  ["dialogue", "陈婉儿", "成哥我们走，多看一眼都作呕。"],
  ["action", "", "指尖发力，将金元高高抛起。金元划出弧线，精准落入左侧大红喜轿内。"],
  ["action", "", "脚步猛地顿住，回头。"],
  ["action", "", "打了个响指，薄唇勾起。"],
  ["dialogue", "陈平生", "同门一场，当是给你回礼了。"],
  ["action", "", "脸色大变，纷纷捂嘴。"],
  ["action", "", "呼吸骤沉，脸色青紫，周身灵气暴动。"],
  ["dialogue", "何文成", "你找死！"],
  ["action", "", "怒吼着握紧拳头，杀气四溢，朝陈平生面门挥去。"],
].map(([type, character, text]) => ({ type, character, text }));

const scriptScene = { index: "1", beats };
const slotsByScene = buildBeatSlots([scriptScene]);
const slots = slotsByScene.get("1");

function makeDraftShots(list) {
  return list.map((slot, index) => ({
    beatIds: [slot.beatId],
    durationMs: 0,
    camera: {
      focal: "50mm",
      shotSize: "中景",
      angle: "平视",
      movement: "固定",
      side: "left",
    },
    lighting: "",
    action:
      slot.type === "action" ? slot.text : "角色站在原地说话。",
    dialogue:
      slot.type === "dialogue"
        ? [{ character: slot.character, text: slot.text }]
        : [],
    expression: "",
    subjectNodeIds: [],
    continuesPrev: index > 0,
    refs: [],
  }));
}

function draftFromShots(shots) {
  return {
    scenes: [
      {
        sceneIndex: "1",
        blocking: {
          axis: { from: "", to: "" },
          cameraSide: "left",
          nodes: [],
          paths: [],
        },
        shots,
      },
    ],
  };
}

test("34 个 beat 固定 34 镜通过覆盖校验", () => {
  const draft = draftFromShots(makeDraftShots(slots));
  assert.deepEqual(validateStoryboardCoverage(draft, slotsByScene), []);
});

test("压成 24 镜必须失败并列出缺失 beat", () => {
  const draft = draftFromShots(makeDraftShots(slots).slice(0, 24));
  const errors = validateStoryboardCoverage(draft, slotsByScene);
  assert.equal(errors.some((message) => message.includes("输出 24 个镜位")), true);
  const missing = missingBeatIds(draft, slotsByScene);
  assert.deepEqual(
    missing,
    slots.slice(24).map((slot) => slot.beatId),
  );
});

test("一镜两句台词必须失败", () => {
  const shots = makeDraftShots(slots);
  const dialogueIndex = shots.findIndex((shot) => shot.dialogue.length > 0);
  shots[dialogueIndex].dialogue = [
    shots[dialogueIndex].dialogue[0],
    { character: "路人弟子甲", text: "多出来的一句台词。" },
  ];
  const errors = validateStoryboardCoverage(draftFromShots(shots), slotsByScene);
  assert.equal(errors.some((message) => message.includes("必须恰好 1 句台词")), true);
});

test("beatIds 被改动或镜数变化必须失败", () => {
  const expected = slots.map((slot) => [slot.beatId]);
  assert.deepEqual(
    validateSegmentBeatIds(expected, slots.map((slot) => ({ beatIds: [slot.beatId] }))),
    [],
  );
  assert.equal(
    validateSegmentBeatIds(expected, slots.slice(0, 3).map((slot) => ({ beatIds: [slot.beatId] })))
      .length > 0,
    true,
  );
  const changed = slots.map((slot) => ({ beatIds: [slot.beatId] }));
  changed[0] = { beatIds: [makeBeatId("1", 1)] };
  assert.equal(validateSegmentBeatIds(expected, changed).length > 0, true);
});

test("预算：对白按 5 字/秒，动作按信息量，永不低于 min", () => {
  const dialogueBudget = shotBudget({
    dialogue: [{ text: "拿着吧，没新郎官赏赐，你这杂役一辈子见不到这么多钱。" }],
    action: "",
  });
  const chars = countSpeechChars("拿着吧，没新郎官赏赐，你这杂役一辈子见不到这么多钱。");
  assert.equal(dialogueBudget.kind, "dialogue");
  assert.equal(dialogueBudget.speechChars, chars);
  assert.equal(dialogueBudget.speechMs, Math.ceil((chars / 5) * 1000));
  assert.equal(dialogueBudget.minMs, dialogueBudget.speechMs + 400);

  const actionBudget = shotBudget({ dialogue: [], action: "倒了倒吸一口凉气，惊恐地后退半步。" });
  assert.equal(actionBudget.kind, "action");
  assert.ok(actionBudget.minMs >= 1500 && actionBudget.minMs <= 3000);
});

test("v2 装段：切镜后允许人物出画，same-take 仍禁止", () => {
  const h3 = DEFAULT_VENDORS.find((vendor) => vendor.id === "h3");
  const shot = (castIds, transition) => ({
    minMs: 4000,
    idealMs: 4000,
    maxMs: 4000,
    fixedMs: 4000,
    continuesPrev: true,
    transition,
    subjectKey: "action",
    castIds,
    refLabels: [],
  });
  const options = {
    ignoreDefaultSegmentMs: true,
    maxSegmentMs: 15000,
    maxShotsPerSegment: 6,
  };
  const cut = packSceneV2(
    [shot(["a", "b"], undefined), shot(["a"], "new-angle")],
    h3,
    15000,
    options,
  );
  assert.equal(cut.segments.length, 1);

  const sameTake = packSceneV2(
    [shot(["a", "b"], undefined), shot(["a"], "same-take")],
    h3,
    15000,
    options,
  );
  assert.equal(sameTake.segments.length, 2);
});

test("v2 装段：34 镜 → 9 段 / 89s，全部多镜且不压缩单镜", () => {
  const h3 = DEFAULT_VENDORS.find((vendor) => vendor.id === "h3");
  const packShots = beats.map((beat, index) => {
    const budget = shotBudget({
      dialogue: beat.type === "dialogue" ? [{ text: beat.text }] : [],
      action: beat.type === "action" ? beat.text : "",
    });
    return {
      minMs: budget.minMs,
      idealMs: budget.idealMs,
      maxMs: budget.maxMs,
      continuesPrev: index > 0,
      subjectKey: `${beat.type}-${index}`,
      refLabels: [],
    };
  });
  const { segments } = packSceneV2(packShots, h3, 12000);
  assert.equal(segments.length, 9);
  assert.equal(segments.some((segment) => segment.shotIndexes.length === 1), false);
  assert.equal(
    segments.every(
      (segment) =>
        segment.shotIndexes.length >= 2 && segment.shotIndexes.length <= 5,
    ),
    true,
  );
  assert.equal(
    segments.reduce((sum, segment) => sum + segment.targetMs, 0),
    89000,
  );
  segments.forEach((segment) => {
    assert.ok(segment.targetMs <= 12000);
    assert.equal(
      segment.shotDurations.reduce((sum, value) => sum + value, 0),
      segment.targetMs,
    );
    segment.shotIndexes.forEach((shotIndex, k) => {
      assert.ok(segment.shotDurations[k] >= packShots[shotIndex].minMs);
      assert.ok(segment.shotDurations[k] <= packShots[shotIndex].maxMs);
    });
  });
});
