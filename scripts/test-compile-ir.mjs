import test from "node:test";
import assert from "node:assert/strict";
import {
  compiledPromptDraftSchema,
  validateCompiledPromptDraft,
} from "../packages/core/src/shared/schemas/compiled-prompt.ts";
import { renderH3Prompt } from "../packages/core/src/server/compile/h3-render.ts";

function makeDraft() {
  return compiledPromptDraftSchema.parse({
    mode: "reference",
    shots: [
      {
        index: 1,
        timecodeMs: 0,
        visual: "Chen Wan'er walks forward in a red wedding dress, smiling.",
        subjectIds: ["n5"],
        sound: "Light footsteps on stone.",
      },
      {
        index: 2,
        timecodeMs: 3000,
        visual: "She stops and points at the sweeper in the distance.",
        subjectIds: ["n5", "n1"],
        sound: "A sudden hush.",
      },
    ],
    soundscape: "Wind moves through the red banners.",
    music: "N/A",
    firstFrame: { picture: 1, shotIndex: 1 },
  });
}

const expectation = {
  shotCount: 2,
  targetMs: 5500,
  allowedSubjectIds: [["n5"], ["n5", "n1"]],
  dialogueSources: [
    [],
    [{ character: "陈婉儿", text: "谁准他到前殿来的？", target: "陈平生" }],
  ],
  pictureSlots: [1, 2, 3],
};

test("合法 IR 通过校验", () => {
  const errors = validateCompiledPromptDraft(makeDraft(), expectation);
  assert.deepEqual(errors, []);
});

test("镜头数不一致必须报错", () => {
  const draft = makeDraft();
  draft.shots.pop();
  const errors = validateCompiledPromptDraft(draft, expectation);
  assert.equal(errors.some((error) => error.includes("镜头数不一致")), true);
});

test("subjectIds 越界必须报错", () => {
  const draft = makeDraft();
  draft.shots[0].subjectIds = ["n1"];
  const errors = validateCompiledPromptDraft(draft, expectation);
  assert.equal(errors.some((error) => error.includes("不允许的主体")), true);
});

test("IR 不输出台词时允许（台词由代码注入）", () => {
  const draft = makeDraft();
  draft.shots[1].dialogue = [];
  const errors = validateCompiledPromptDraft(draft, expectation);
  assert.equal(errors.length, 0);
});

test("IR 改写台词必须报错", () => {
  const draft = makeDraft();
  draft.shots[1].dialogue = [
    {
      speakerId: "S1",
      text: "谁准他来这里？",
      language: "Chinese",
      offscreen: false,
    },
  ];
  const errors = validateCompiledPromptDraft(draft, expectation);
  assert.equal(errors.some((error) => error.includes("与分镜原文不一致")), true);
});

test("时间码不递增必须报错", () => {
  const draft = makeDraft();
  draft.shots[0].timecodeMs = 500;
  draft.shots[1].timecodeMs = 100;
  const errors = validateCompiledPromptDraft(draft, expectation);
  assert.equal(errors.some((error) => error.includes("timecodeMs")), true);
});

test("参考模式渲染：六段格式、代码注入台词、时间码与主体边界", () => {
  const text = renderH3Prompt({
    mode: "reference",
    aspectRatio: "16:9",
    subjects: [
      { id: "n5", name: "陈婉儿", kind: "character", sourcePictures: [2] },
      { id: "n1", name: "陈平生", kind: "character", sourcePictures: [3] },
      { id: "scene", name: "望天峰前殿广场", kind: "scene", sourcePictures: [1] },
    ],
    shots: [
      {
        index: 1,
        durationMs: 3000,
        visual: "Chen Wan'er walks forward in a red wedding dress, smiling.",
        sound: "Light footsteps on stone.",
        subjectIds: ["n5"],
        dialogue: [],
      },
      {
        index: 2,
        durationMs: 2500,
        visual: "She stops and points at the sweeper in the distance.",
        sound: "A sudden hush.",
        subjectIds: ["n5", "n1"],
        dialogue: [
          {
            character: "陈婉儿",
            text: "谁准他到前殿来的？",
            target: "陈平生",
          },
        ],
      },
    ],
    soundscape: "Wind moves through the red banners.",
    music: "N/A",
    firstFrame: { picture: 1, shotIndex: 1 },
  });

  assert.match(text, /^For the target video, at 0\.00 seconds into the target video, <Picture 1> \(from \[Shot 1\]\) is fully referenced\./);
  assert.match(text, /subject_definitions:/);
  assert.match(text, /summary:/);
  assert.match(text, /retention_analysis:/);
  assert.match(text, /detailed_description:/);
  assert.match(text, /overall_soundscape:/);
  assert.match(text, /non_diegetic_music:/);
  assert.match(text, /At 00:03\.000, the camera cuts to/);
  assert.equal(text.includes("Spatial positioning is locked"), false);
  assert.equal((text.match(/<d>\[Chinese\]谁准他到前殿来的？<\/d>/g) || []).length, 1);
  assert.match(text, /<Subject 1> \(S1\) says, addressing <Subject 2>:/);

  const shot1Line = text.split("\n").find((line) => line.startsWith("[Shot 1]"));
  assert.ok(shot1Line);
  assert.equal(shot1Line.includes("陈平生"), false);
  assert.equal(shot1Line.includes("<Subject 2>"), false);

  assert.match(text, /<Subject 1> \(appears in \[Shot 1\], \[Shot 2\]\): fully_preserved/);
});

test("基础模式渲染：首帧 + integrated_multimodal_description，不写 subject_definitions", () => {
  const text = renderH3Prompt({
    mode: "basic",
    aspectRatio: "16:9",
    subjects: [{ id: "n5", name: "陈婉儿", kind: "character", sourcePictures: [] }],
    shots: [
      {
        index: 1,
        durationMs: 3000,
        visual: "Chen Wan'er walks forward in a red wedding dress.",
        sound: "",
        subjectIds: ["n5"],
        dialogue: [{ character: "陈婉儿", text: "谁准他到前殿来的？" }],
      },
    ],
    soundscape: "N/A",
    music: "N/A",
    firstFrame: { picture: 1, shotIndex: 1 },
  });

  assert.match(text, /^For the target video, at 0\.00 seconds into the target video/);
  assert.match(text, /integrated_multimodal_description:/);
  assert.equal(text.includes("subject_definitions:"), false);
  assert.equal(text.includes("<Subject "), false);
  assert.match(text, /<d>\[Chinese\]谁准他到前殿来的？<\/d>/);
});
