import test from "node:test";
import assert from "node:assert/strict";
import {
  isAutoRetryableQc,
  suggestQcRetry,
} from "../src/lib/generation/retry.ts";

test("R1: 人物/切镜类失败只给修分镜与重编译，不自动重试", () => {
  const suggestions = suggestQcRetry([
    {
      level: "hard",
      code: "cut-count",
      message: "切镜数不对",
    },
  ]);
  assert.equal(suggestions.some((item) => item.action === "edit-storyboard"), true);
  assert.equal(suggestions.some((item) => item.autoRetry), false);
});

test("R2: 黑帧/冻结/文件坏允许换种子自动重试一次", () => {
  const issues = [
    {
      level: "hard",
      code: "black-frame",
      message: "黑帧",
    },
  ];
  assert.equal(isAutoRetryableQc(issues), true);
  const suggestions = suggestQcRetry(issues);
  assert.equal(
    suggestions.some(
      (item) => item.action === "regenerate-video" && item.seedChange,
    ),
    true,
  );
});

test("数据类失败不进入自动重试", () => {
  assert.equal(
    isAutoRetryableQc([
      { level: "hard", code: "duration", message: "时长不对" },
    ]),
    false,
  );
});

test("无硬失败时优先重编译提示词", () => {
  const suggestions = suggestQcRetry([
    { level: "soft", code: "cut-count", message: "差一次" },
  ]);
  assert.equal(suggestions[0].action, "recompile-prompt");
});
