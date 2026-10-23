import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBeats,
  normalizeBeatTypes,
  rejoinInlineQuoteBeats,
  validateScriptBeatTypes,
} from "../packages/core/src/shared/script-beats.ts";

function beat(type, character, text) {
  return { type, character, text };
}

test("纯神态/动作的对白 beat 改为 action", () => {
  const beats = normalizeBeats([
    beat("dialogue", "陈平生", "眼睛微眯，嘴角勾起一抹冷笑。"),
    beat("dialogue", "何文成", "大笑，毫不在意。"),
  ]);
  assert.deepEqual(beats, [
    beat("action", "陈平生", "眼睛微眯，嘴角勾起一抹冷笑。"),
    beat("action", "何文成", "大笑，毫不在意。"),
  ]);
});

test("动作 + 台词合并的 beat 拆成 action 和 dialogue", () => {
  const beats = normalizeBeats([
    beat("dialogue", "何文成", "怒吼：你找死！"),
    beat("dialogue", "何文成", "怒急攻心，口出狂言。今日大喜，不和狗见识。"),
  ]);
  assert.deepEqual(beats, [
    beat("action", "何文成", "怒吼"),
    beat("dialogue", "何文成", "你找死！"),
    beat("action", "何文成", "怒急攻心，口出狂言。"),
    beat("dialogue", "何文成", "今日大喜，不和狗见识。"),
  ]);
});

test("正常台词保持不变", () => {
  const lines = [
    "像你这样胡咬乱吠的狗么？",
    "何师兄很大方啊。",
    "谁准他到前殿来的？",
    "同门一场，回礼而已。",
    "我知道你急。今天大喜日子，不跟一条狗见识。",
    "明天见。",
  ];
  const beats = normalizeBeats(
    lines.map((line) => beat("dialogue", "陈平生", line)),
  );
  assert.deepEqual(
    beats.map((item) => item.text),
    lines,
  );
  assert.equal(
    beats.every((item) => item.type === "dialogue"),
    true,
  );
});

test("带引号的动作 beat 拆出对白，带提示语的对白也拆开", () => {
  assert.deepEqual(
    normalizeBeats([beat("action", "陈平生", "陈平生冷笑：「你来了。」")]),
    [
      beat("action", "陈平生", "陈平生冷笑："),
      beat("dialogue", "陈平生", "你来了。"),
    ],
  );
  assert.deepEqual(
    normalizeBeats([beat("dialogue", "陈平生", "陈平生冷笑一声：“你来了。”")]),
    [
      beat("action", "陈平生", "陈平生冷笑一声："),
      beat("dialogue", "陈平生", "你来了。"),
    ],
  );
});

test("强调/称谓引号不当作台词拆开", () => {
  const text = "窃窃私语，认为这是杀人诛心，逼陈平生收下以表“祝福”。";
  assert.deepEqual(normalizeBeats([beat("action", "围观弟子", text)]), [
    beat("action", "围观弟子", text),
  ]);
  assert.deepEqual(
    normalizeBeats([beat("dialogue", "陈平生", "「祝福」")]),
    [beat("dialogue", "陈平生", "祝福")],
  );
});

test("修复历史误拆：动作 + 强调引号 + 纯标点动作重新拼回", () => {
  assert.deepEqual(
    rejoinInlineQuoteBeats([
      beat("action", "围观弟子", "窃窃私语，认为这是杀人诛心，逼陈平生收下以表"),
      beat("dialogue", "围观弟子", "祝福"),
      beat("action", "围观弟子", "。"),
      beat("action", "陈平生", "陈平生伸手接过金元。"),
    ]),
    [
      beat("action", "围观弟子", "窃窃私语，认为这是杀人诛心，逼陈平生收下以表“祝福”。"),
      beat("action", "陈平生", "陈平生伸手接过金元。"),
    ],
  );
});

test("规范化后校验为零，且重复执行结果不变", () => {
  const script = {
    title: "",
    scenes: [
      {
        index: "1-2",
        slug: "",
        location: "",
        timeOfDay: "",
        interiorExterior: "",
        summary: "",
        characters: [],
        beats: [
          beat("dialogue", "陈平生", "眼睛微眯，嘴角勾起一抹冷笑。"),
          beat("dialogue", "何文成", "大笑，毫不在意。"),
          beat("dialogue", "陈平生", "像你这样胡咬乱吠的狗么？"),
          beat("dialogue", "何文成", "怒吼：你找死！"),
        ],
      },
    ],
  };
  const once = normalizeBeatTypes(script);
  assert.deepEqual(validateScriptBeatTypes(once), []);
  assert.deepEqual(normalizeBeatTypes(once), once);
});
