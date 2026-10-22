import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSegmentQc } from "../packages/core/src/shared/qc.ts";

const expectation = {
  targetMs: 11000,
  shotCount: 4,
  aspectRatio: "16:9",
};

function probe(overrides = {}) {
  return {
    decodable: true,
    durationMs: 11000,
    width: 1120,
    height: 608,
    fps: 24,
    blackSegments: [],
    freezeSegments: [],
    detectedCuts: 3,
    ...overrides,
  };
}

test("Q1: 正常视频通过", () => {
  const result = evaluateSegmentQc(probe(), expectation);
  assert.equal(result.status, "passed");
  assert.equal(result.hardFail, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.score, 100);
});

test("Q2: 黑帧判失败", () => {
  const result = evaluateSegmentQc(
    probe({ blackSegments: [{ startMs: 2000, endMs: 2600 }] }),
    expectation,
  );
  assert.equal(result.status, "failed");
  assert.equal(result.issues.some((issue) => issue.code === "black-frame"), true);
});

test("Q2: 冻结画面判失败", () => {
  const result = evaluateSegmentQc(
    probe({ freezeSegments: [{ startMs: 1000, endMs: 3200 }] }),
    expectation,
  );
  assert.equal(result.status, "failed");
  assert.equal(result.issues.some((issue) => issue.code === "freeze-frame"), true);
});

test("Q3: 切镜数明显不对判失败", () => {
  const result = evaluateSegmentQc(probe({ detectedCuts: 1 }), expectation);
  assert.equal(result.status, "failed");
  assert.equal(result.issues.some((issue) => issue.code === "cut-count"), true);
});

test("Q3: 切镜数差 1 次只判待复核", () => {
  const result = evaluateSegmentQc(probe({ detectedCuts: 2 }), expectation);
  assert.equal(result.status, "needs_review");
  assert.equal(result.hardFail, false);
});

test("Q4: 时长偏差过大判失败", () => {
  const result = evaluateSegmentQc(probe({ durationMs: 6000 }), expectation);
  assert.equal(result.status, "failed");
  assert.equal(result.issues.some((issue) => issue.code === "duration"), true);
});

test("分辨率/比例不一致判失败", () => {
  const result = evaluateSegmentQc(probe({ width: 1080, height: 1080 }), expectation);
  assert.equal(result.status, "failed");
  assert.equal(result.issues.some((issue) => issue.code === "resolution"), true);
});

test("无法解码判失败", () => {
  const result = evaluateSegmentQc(
    probe({ decodable: false, durationMs: null }),
    expectation,
  );
  assert.equal(result.status, "failed");
  assert.equal(result.score, 0);
});
