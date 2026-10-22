import test from "node:test";
import assert from "node:assert/strict";
import {
  runPreflight,
  hasPreflightErrors,
} from "../packages/core/src/shared/preflight.ts";

const blocking = {
  nodes: [
    { id: "n1", label: "陈平生", type: "character" },
    { id: "n2", label: "路人弟子甲", type: "character" },
    { id: "n5", label: "陈婉儿", type: "character" },
    { id: "n6", label: "何文成", type: "character" },
  ],
};

const vendor = {
  maxRefImages: 9,
  maxShotsPerSegment: 6,
  minSegmentMs: 4000,
  maxSegmentMs: 12000,
};

function makeShot(overrides = {}) {
  return {
    id: "sh1",
    index: 0,
    durationMs: 3000,
    camera: { shotSize: "中景", focal: "50mm" },
    action: "",
    dialogue: [],
    subjectNodeIds: [],
    refs: [],
    ...overrides,
  };
}

function makeSegment(overrides = {}) {
  return {
    id: "sg1",
    index: 1,
    targetMs: 3000,
    hardCut: true,
    shots: [],
    ...overrides,
  };
}

function run(segments, extra = {}) {
  return runPreflight({
    scene: { index: "1-1", blocking },
    segments,
    vendor,
    ...extra,
  });
}

const wanEr = {
  role: "character",
  assetName: "陈婉儿",
  variantLabel: "婚嫁红妆",
  viewLabel: "四视图",
};
const pingSheng = {
  role: "character",
  assetName: "陈平生",
  variantLabel: "杂役装",
  viewLabel: "四视图",
};

test("S3B: 动作点名但 subjectNodeIds 缺人时必须 error", () => {
  const segment = makeSegment({
    hardCut: true,
    shots: [
      makeShot({
        index: 2,
        action: "陈婉儿厌恶地指着陈平生，厉声质问。",
        dialogue: [{ character: "陈婉儿", text: "谁准他到前殿来的？" }],
        subjectNodeIds: ["n5"],
        refs: [wanEr, pingSheng],
      }),
    ],
  });
  const issues = run([segment]);
  const missing = issues.filter((issue) => issue.code === "cast-missing");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].level, "error");
  assert.equal(missing[0].character, "陈平生");
  assert.equal(missing[0].shotIndex, 2);
  assert.equal(hasPreflightErrors(issues), true);
});

test("S3B: 补 n1 后通过", () => {
  const segment = makeSegment({
    shots: [
      makeShot({
        index: 2,
        action: "陈婉儿厌恶地指着陈平生，厉声质问。",
        dialogue: [{ character: "陈婉儿", text: "谁准他到前殿来的？" }],
        subjectNodeIds: ["n5", "n1"],
        refs: [wanEr, pingSheng],
      }),
    ],
  });
  const issues = run([segment]);
  assert.equal(hasPreflightErrors(issues), false);
});

test("refs 有角色但不在 subjectNodeIds 时必须 error", () => {
  const segment = makeSegment({
    shots: [
      makeShot({
        action: "陈婉儿独自站着。",
        subjectNodeIds: ["n5"],
        refs: [wanEr, pingSheng],
      }),
    ],
  });
  const issues = run([segment]);
  const extra = issues.filter((issue) => issue.code === "cast-extra");
  assert.equal(extra.length, 1);
  assert.equal(extra[0].character, "陈平生");
});

test("台词对象不在场且未标 offscreen 时必须 error", () => {
  const segment = makeSegment({
    shots: [
      makeShot({
        action: "陈婉儿冷冷开口。",
        dialogue: [
          { character: "陈婉儿", text: "谁准他到前殿来的？", target: "陈平生" },
        ],
        subjectNodeIds: ["n5"],
        refs: [wanEr],
      }),
    ],
  });
  const issues = run([segment]);
  const target = issues.filter((issue) => issue.code === "target-missing");
  assert.equal(target.length, 1);
  assert.equal(target[0].level, "error");
});

test("台词对象标 offscreen 后通过", () => {
  const segment = makeSegment({
    shots: [
      makeShot({
        action: "陈婉儿看向画外。",
        dialogue: [
          {
            character: "陈婉儿",
            text: "谁准他到前殿来的？",
            target: "陈平生",
            offscreen: true,
          },
        ],
        subjectNodeIds: ["n5"],
        refs: [wanEr],
      }),
    ],
  });
  const issues = run([segment]);
  assert.equal(hasPreflightErrors(issues), false);
});

test("正常单人镜通过", () => {
  const segment = makeSegment({
    shots: [
      makeShot({
        action: "陈婉儿一袭红妆走来，脸颊带笑。",
        subjectNodeIds: ["n5"],
        refs: [wanEr],
      }),
    ],
  });
  const issues = run([segment]);
  assert.equal(hasPreflightErrors(issues), false);
});

test("S6: hardCut=否但首镜与上段尾镜差 3 档时必须 error", () => {
  const first = makeSegment({
    id: "sg1",
    index: 1,
    hardCut: true,
    shots: [
      makeShot({
        id: "sh1",
        camera: { shotSize: "特写", focal: "85mm" },
        subjectNodeIds: ["n6"],
        refs: [{ role: "character", assetName: "何文成" }],
      }),
    ],
  });
  const second = makeSegment({
    id: "sg2",
    index: 2,
    hardCut: false,
    shots: [
      makeShot({
        id: "sh2",
        camera: { shotSize: "中景", focal: "50mm" },
        subjectNodeIds: ["n1"],
        refs: [pingSheng],
      }),
    ],
  });
  const issues = run([first, second]);
  const conflict = issues.filter((issue) => issue.code === "hardcut-conflict");
  assert.equal(conflict.length, 1);
  assert.equal(conflict[0].level, "error");
});

test("S2: 编译结果缺台词时 error", () => {
  const segment = makeSegment({
    shots: [
      makeShot({
        subjectNodeIds: ["n2"],
        refs: [{ role: "character", assetName: "路人弟子甲" }],
        dialogue: [
          {
            character: "路人弟子甲",
            text: "要不是门主念他是陈长老唯一血脉，早杀了。",
          },
        ],
      }),
    ],
  });
  const issues = run([segment], {
    compiledPrompt: "[Shot 1] He speaks his line.",
    dialogueSources: [
      {
        shotId: "sh1",
        shotIndex: 0,
        character: "路人弟子甲",
        text: "要不是门主念他是陈长老唯一血脉，早杀了。",
      },
    ],
  });
  const coverage = issues.filter((issue) => issue.code === "dialogue-coverage");
  assert.equal(coverage.length, 1);
  assert.equal(coverage[0].level, "error");
});

test("台词语速 >7.5 字/秒时给 warning", () => {
  const segment = makeSegment({
    shots: [
      makeShot({
        action: "路人弟子甲开口。",
        durationMs: 3000,
        subjectNodeIds: ["n2"],
        refs: [{ role: "character", assetName: "路人弟子甲" }],
        dialogue: [
          {
            character: "路人弟子甲",
            text: "要不是门主念他是陈长老唯一血脉，早杀了。废修为贬杂役，已是天大恩赐。",
          },
        ],
      }),
    ],
  });
  const issues = run([segment]);
  const speed = issues.filter((issue) => issue.code === "dialogue-speed");
  assert.equal(speed.length, 1);
  assert.equal(speed[0].level, "warning");
});

test("非严格项目：error 降级为 warning", () => {
  const segment = makeSegment({
    shots: [
      makeShot({
        action: "陈婉儿指着陈平生。",
        subjectNodeIds: ["n5"],
        refs: [wanEr, pingSheng],
      }),
    ],
  });
  const issues = run([segment], { enforceErrors: false });
  assert.equal(hasPreflightErrors(issues), false);
  assert.equal(
    issues.filter((issue) => issue.code === "cast-missing")[0].level,
    "warning",
  );
});
