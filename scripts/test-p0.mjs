import test from "node:test";
import assert from "node:assert/strict";
import {
  checkDialogueCoverage,
  extractCompiledDialogue,
} from "../packages/core/src/shared/dialogue-coverage.ts";
import { buildShotBlockingLines } from "../packages/core/src/shared/blocking-text.ts";
import { formatDialogueLine } from "../packages/core/src/shared/dialogue-format.ts";

const seg2Sources = [
  {
    shotIndex: 0,
    character: "路人弟子丙",
    text: "呵，修为都被废了，拿什么争何师兄？一个害死双亲的人渣罢了。",
  },
  {
    shotIndex: 1,
    character: "路人弟子甲",
    text: "要不是门主念他是陈长老唯一血脉，早杀了。废修为贬杂役，已是天大恩赐。",
  },
  {
    shotIndex: 2,
    character: "路人弟子乙",
    text: "新娘子来咯！",
  },
];

const seg2GoodPrompt = `
detailed_description:
[Shot 1] He speaks: <d>[Chinese] 呵，修为都被废了，拿什么争何师兄？一个害死双亲的人渣罢了。</d>
[Shot 2] He says: <d>[Chinese] 要不是门主念他是陈长老唯一血脉，早杀了。废修为贬杂役，已是天大恩赐。</d>
[Shot 3] He shouts: <d>[Chinese] 新娘子来咯！</d>
`;

test("S2: 0 个 <d> 且只有占位句时必须判失败", () => {
  const prompt = "[Shot 1] He speaks his line contemptuously. [Shot 2] He delivers his dialogue. [Shot 3] He shouts his line.";
  const result = checkDialogueCoverage(prompt, seg2Sources);
  assert.equal(result.compiledCount, 0);
  assert.equal(result.missing.length, 3);
  assert.equal(result.placeholderOnly, true);
});

test("S2: 3 句逐字进入 <d> 才通过", () => {
  const result = checkDialogueCoverage(seg2GoodPrompt, seg2Sources);
  assert.equal(result.missing.length, 0);
  assert.equal(result.compiledCount, 3);
  assert.equal(extractCompiledDialogue(seg2GoodPrompt).length, 3);
});

test("S3: 单人镜只出现本镜主体，不点名其他角色", () => {
  const blocking = {
    axis: { from: "n5", to: "n6" },
    cameraSide: "left",
    nodes: [
      { id: "n5", label: "陈婉儿", type: "character", pos: { x: 0.5, y: 0.5 }, facing: 90 },
      { id: "n3", label: "陈平生", type: "character", pos: { x: 0.2, y: 0.6 }, facing: 0 },
      { id: "n6", label: "何文成", type: "character", pos: { x: 0.8, y: 0.7 }, facing: 180 },
    ],
    paths: [],
  };
  const text = buildShotBlockingLines(blocking, ["n5"]).join("\n");
  assert.match(text, /本镜仅出现：陈婉儿/);
  assert.equal(text.includes("陈平生"), false);
  assert.equal(text.includes("何文成"), false);
});

test("S5: 画外台词对象渲染为「对画外陈平生说」", () => {
  const line = formatDialogueLine({
    character: "何文成",
    text: "我知道你急。今天大喜日子，不跟一条狗见识。",
    target: "陈平生",
    offscreen: true,
  });
  assert.equal(
    line,
    "何文成（对画外陈平生说）：「我知道你急。今天大喜日子，不跟一条狗见识。」",
  );
});

test("台词覆盖比较会忽略空白与标点差异", () => {
  const result = checkDialogueCoverage(
    "[Shot 1] <d>[Chinese] 呵 修为都被废了，拿什么争何师兄？一个害死双亲的人渣罢了</d>",
    [seg2Sources[0]],
  );
  assert.equal(result.missing.length, 0);
});
