import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const projectId = arg("project", "8c235423-318b-46b5-83da-f1f5da47cbd4");
const base = arg("base", "http://127.0.0.1:3000").replace(/\/+$/, "");
const platform = arg("platform", "h3");
const outPath = resolve(
  arg("out", "E:/ai/02_projects/jueman/审计报告-提示词链路.md"),
);
const jsonPath = resolve(
  arg("json", outPath.replace(/\.md$/i, ".json")),
);
const dbPath = resolve(
  arg("db", join(process.cwd(), "workspace", projectId, "project.db")),
);
const compile = !flag("no-compile");
const forceCompile = flag("force");
const requestTimeoutMs = Number(arg("timeout-ms", "300000"));

if (!existsSync(dbPath)) {
  console.error(`找不到项目数据库：${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const project = db.prepare("select * from project").get();
if (!project) {
  console.error(`项目数据库为空：${dbPath}`);
  process.exit(1);
}

const scenes = db.prepare("select * from scene order by sort_order").all();
const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
const assets = db.prepare("select id, name, type from asset").all();
const assetNames = new Set(assets.map((asset) => asset.name));

const segmentRows = db
  .prepare("select * from segment where project_id = ? order by scene_id, idx")
  .all(projectId);

const shotsBySegment = new Map();
for (const segment of segmentRows) {
  const shots = db
    .prepare("select * from shot where segment_id = ? order by idx")
    .all(segment.id);
  const refs = db
    .prepare(
      `select r.role, a.name as asset_name
       from shot_ref r
       left join asset a on a.id = r.asset_id
       where r.shot_id = ?
       order by r.sort_order`,
    );
  shotsBySegment.set(
    segment.id,
    shots.map((shot) => ({
      ...shot,
      dialogue: parseJson(
        shot.dialogue_json && shot.dialogue_json.trim() !== "[]"
          ? shot.dialogue_json
          : shot.dialogue,
        [],
      ),
      subjectNodeIds: parseJson(shot.subject_node_ids_json, []),
      camera: parseJson(shot.camera_json, {}),
      refs: refs.all(shot.id).filter((ref) => ref.asset_name),
    })),
  );
}

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeDialogue(text) {
  return String(text ?? "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

function charCount(text) {
  return (String(text).match(/[\u4e00-\u9fffA-Za-z0-9]/g) || []).length;
}

async function request(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, json, text };
}

function enc(value) {
  return encodeURIComponent(value);
}

function splitSections(prompt) {
  const names = [
    "subject_definitions",
    "summary",
    "retention_analysis",
    "detailed_description",
    "overall_soundscape",
    "non_diegetic_music",
  ];
  const re =
    /^(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music):[ \t]*/gm;
  const matches = [...prompt.matchAll(re)];
  const sections = {};
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : prompt.length;
    sections[matches[i][1]] = prompt.slice(start, end).trim();
  }
  return { sections, names };
}

function parseSubjects(block) {
  const subjects = [];
  const re =
    /<Subject (\d+)> is the (character (.+?)|location and environment) in <Picture (\d+)>/g;
  for (const match of block.matchAll(re)) {
    subjects.push({
      id: Number(match[1]),
      kind: match[2] === "location and environment" ? "location" : "character",
      name: match[2] === "location and environment" ? "" : match[3].trim(),
      picture: Number(match[4]),
    });
  }
  return subjects;
}

function parseRetention(block) {
  const map = new Map();
  for (const match of block.matchAll(/<Subject (\d+)> \(appears in ([^)]*)\)/g)) {
    const shots = [...match[2].matchAll(/\[Shot (\d+)\]/g)].map((item) =>
      Number(item[1]),
    );
    map.set(Number(match[1]), [...new Set(shots)].sort((a, b) => a - b));
  }
  return map;
}

function parseShotBlocks(description) {
  const matches = [...description.matchAll(/\[Shot (\d+)\]/g)];
  const blocks = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : description.length;
    blocks.push({
      index: Number(matches[i][1]),
      text: description.slice(start, end).trim(),
    });
  }
  return blocks;
}

function subjectTags(text) {
  return [...text.matchAll(/<Subject (\d+)>/g)].map((match) => Number(match[1]));
}

function inFrameSubjects(text) {
  const match = text.match(
    /((?:<Subject\s+\d+>[\s,]*)+?)\s*(?:are|is)\s+in frame/i,
  );
  if (!match) return null;
  return subjectTags(match[1]);
}

function parseDialogueLines(text) {
  const lines = [];
  const re =
    /((?:<Subject\s+\d+>[\s,]*)+)\(S[\d,\s]*\)\s*says(?: in an off-screen voiceover|,\s*addressing\s+((?:<Subject\s+\d+>[\s,]*)+))?:\s*<d>\s*(?:\[[^\]]*\])?\s*([\s\S]*?)<\/d>/g;
  for (const match of text.matchAll(re)) {
    lines.push({
      subjects: subjectTags(match[1]),
      targets: match[2] ? subjectTags(match[2]) : [],
      text: match[3].trim(),
    });
  }
  return lines;
}

function parseTimecode(text) {
  const match = text.match(/At (\d{2}):(\d{2}\.\d{3})/);
  if (!match) return null;
  return Math.round((Number(match[1]) * 60 + Number(match[2])) * 1000);
}

const ORIENTATION_CUE =
  /走来|迎面|面向|朝向|背对|转身|回头|看向|望向|盯着|对视|张望/;
const ORIENTATION_WORD =
  /facing|look(?:ing|s)?|turn(?:s|ed|ing)?|toward|towards|gaze|glanc/i;

function blockingWords(text) {
  return (
    /(?:left|right|center|centre)\s+side\s+of\s+the\s+frame/i.test(text) ||
    /(?:left|right|center|centre)\s+of\s+the\s+frame/i.test(text) ||
    /\bin the (?:left|right|center|centre)\b/i.test(text)
  );
}

function auditPrompt(prompt, segment, shots, scene, issues) {
  const { sections, names } = splitSections(prompt);
  const prefix = `第${segment.idx}段`;
  const push = (level, code, message, shotIndex) =>
    issues.push({
      level,
      code,
      segmentIdx: segment.idx,
      segmentId: segment.id,
      shotIndex,
      message: `${prefix}${typeof shotIndex === "number" ? ` 镜${shotIndex}` : ""}：${message}`,
    });

  for (const name of names) {
    if (!sections[name]) {
      push("error", "format", `缺少 H3 段「${name}:」。`);
    }
  }
  if (/Spatial positioning is locked/i.test(prompt)) {
    push("error", "global-blocking", "出现整段全局站位锁定。");
  }

  const shotBlocks = parseShotBlocks(sections.detailed_description ?? "");
  if (shotBlocks.length !== shots.length) {
    push(
      "error",
      "shot-count",
      `提示词 ${shotBlocks.length} 镜，分镜数据 ${shots.length} 镜。`,
    );
  }

  const subjects = parseSubjects(sections.subject_definitions ?? "");
  if (subjects.length === 0) {
    push("warning", "format", "没有 subject_definitions（可能走了基础模式）。");
  }
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const subjectByName = new Map();
  for (const subject of subjects) {
    if (subject.kind !== "character") continue;
    const key = normalize(subject.name);
    if (!key) continue;
    if (!subjectByName.has(key)) subjectByName.set(key, subject.id);
    if (!assetNames.has(subject.name)) {
      push("error", "subject-unknown", `主体「${subject.name}」不在资产清单。`);
    }
  }

  const blocking = parseJson(scene?.blocking_json, null);
  const nodeById = new Map((blocking?.nodes ?? []).map((node) => [node.id, node]));
  const characterLabels = new Set(
    (blocking?.nodes ?? [])
      .filter((node) => node.type === "character")
      .map((node) => node.label),
  );

  const expectedByName = new Map();
  for (const shot of shots) {
    const labels = shot.subjectNodeIds
      .map((id) => nodeById.get(id)?.label)
      .filter(Boolean);
    for (const label of labels) {
      if (!characterLabels.has(label)) continue;
      if (!expectedByName.has(normalize(label))) {
        expectedByName.set(normalize(label), []);
      }
      expectedByName.get(normalize(label)).push(shot.idx + 1);
    }
  }
  for (const [name, shotIndexes] of expectedByName) {
    if (!subjectByName.has(name)) {
      push(
        "error",
        "subject-def-missing",
        `分镜主体「${name}」在 subject_definitions 中没有定义（镜 ${shotIndexes.join("、")}）。`,
      );
    }
  }

  const retention = parseRetention(sections.retention_analysis ?? "");
  for (const subject of subjects) {
    if (subject.kind !== "character") continue;
    const key = normalize(subject.name);
    const expected = [
      ...new Set(expectedByName.get(key) ?? []),
    ].sort((a, b) => a - b);
    const actual = retention.get(subject.id) ?? [];
    if (expected.length === 0 && actual.length === 0) continue;
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      push(
        "error",
        "retention-mismatch",
        `retention 里 <Subject ${subject.id}>（${subject.name}）镜次 [${actual.join("、")}]，分镜数据 [${expected.join("、")}]。`,
      );
    }
  }

  const sourceLines = shots.flatMap((shot) =>
    shot.dialogue
      .filter((line) => normalizeDialogue(line.text))
      .map((line) => ({
        shotIndex: shot.idx + 1,
        character: line.character,
        text: line.text,
      })),
  );
  const compiledDialogue = [
    ...(prompt.matchAll(/<d>\s*(?:\[[^\]]*\])?\s*([\s\S]*?)<\/d>/g) ?? []),
  ].map((match) => match[1].trim());
  const compiledNormalized = compiledDialogue.map(normalizeDialogue);
  const missingDialogue = sourceLines.filter((source) => {
    const needle = normalizeDialogue(source.text);
    return !compiledNormalized.some((text) => text.includes(needle));
  });
  if (missingDialogue.length > 0) {
    push(
      "error",
      "dialogue-coverage",
      `源台词 ${sourceLines.length} 句，编译 ${compiledDialogue.length} 句，缺失：${missingDialogue
        .map((line) => `镜${line.shotIndex}${line.character ? ` ${line.character}` : ""}「${line.text}」`)
        .join("；")}`,
    );
  }
  if (compiledDialogue.length > sourceLines.length) {
    push(
      "error",
      "dialogue-extra",
      `编译台词 ${compiledDialogue.length} 句，多于源台词 ${sourceLines.length} 句。`,
    );
  }

  let prevTimecode = -1;
  for (const block of shotBlocks) {
    const shot = shots[block.index - 1];
    if (!shot) continue;
    const expectedLabels = new Set(
      shot.subjectNodeIds
        .map((id) => nodeById.get(id)?.label)
        .filter(Boolean),
    );
    const expectedSubjectIds = new Set(
      [...expectedLabels]
        .map((label) => subjectByName.get(normalize(label)))
        .filter((id) => typeof id === "number"),
    );

    const timecode = parseTimecode(block.text);
    if (block.index === 1 && timecode !== null) {
      push("warning", "timecode", "首镜不应带切镜时间码。", block.index);
    }
    if (block.index > 1) {
      if (timecode === null) {
        push("error", "timecode", "缺少切镜时间码。", block.index);
      } else {
        if (timecode <= prevTimecode) {
          push(
            "error",
            "timecode",
            `切镜时间码 ${timecode}ms 没有递增。`,
            block.index,
          );
        }
        if (timecode >= segment.target_ms + 1000) {
          push(
            "error",
            "timecode",
            `切镜时间码 ${timecode}ms 超出本段 ${segment.target_ms}ms。`,
            block.index,
          );
        }
        prevTimecode = timecode;
      }
    }

    const frame = inFrameSubjects(block.text);
    if (expectedSubjectIds.size > 0 && frame === null) {
      push("error", "subject-missing", "缺少「… are in frame」主体声明。", block.index);
    } else if (frame !== null) {
      const actual = new Set(frame);
      for (const id of expectedSubjectIds) {
        if (!actual.has(id)) {
          const subject = subjectById.get(id);
          push(
            "error",
            "subject-missing",
            `本镜主体「${subject?.name ?? id}」没有出现在 in frame 列表。`,
            block.index,
          );
        }
      }
      for (const id of actual) {
        if (expectedSubjectIds.has(id)) continue;
        const subject = subjectById.get(id);
        if (subject?.kind === "location") continue;
        push(
          "error",
          "subject-overreach",
          `in frame 出现非本镜主体「${subject?.name ?? id}」。`,
          block.index,
        );
      }
    }

    for (const id of new Set(subjectTags(block.text))) {
      if (expectedSubjectIds.has(id)) continue;
      const subject = subjectById.get(id);
      if (!subject || subject.kind === "location") continue;
      push(
        "error",
        "subject-overreach",
        `本镜正文引用了非本镜主体「${subject.name}」。`,
        block.index,
      );
    }

    const expectedLines = shot.dialogue.filter((line) =>
      normalizeDialogue(line.text),
    );
    const actualLines = parseDialogueLines(block.text);
    if (actualLines.length !== expectedLines.length) {
      push(
        "error",
        "dialogue-shot",
        `本镜台词 ${actualLines.length} 句，分镜数据 ${expectedLines.length} 句。`,
        block.index,
      );
    }
    for (let i = 0; i < Math.min(actualLines.length, expectedLines.length); i += 1) {
      const actual = actualLines[i];
      const expected = expectedLines[i];
      if (
        normalizeDialogue(actual.text) !== normalizeDialogue(expected.text)
      ) {
        push(
          "error",
          "dialogue-shot",
          `第 ${i + 1} 句台词与分镜不一致：「${actual.text}」≠「${expected.text}」。`,
          block.index,
        );
      }
      const speakerNames = actual.subjects
        .map((id) => subjectById.get(id))
        .filter((subject) => subject?.kind === "character")
        .map((subject) => normalize(subject.name));
      if (
        expected.character &&
        !speakerNames.includes(normalize(expected.character))
      ) {
        push(
          "error",
          "speaker-mismatch",
          `台词「${expected.text}」说话人应为「${expected.character}」，提示词写成 ${speakerNames.join("、") || "未标"}。`,
          block.index,
        );
      }
      const expectedTargetId = expected.target
        ? subjectByName.get(normalize(expected.target))
        : undefined;
      if (
        typeof expectedTargetId === "number" &&
        !actual.targets.includes(expectedTargetId)
      ) {
        push(
          "error",
          "addressee-missing",
          `台词「${expected.text}」应对「${expected.target}」说，但提示词没有 addressing <Subject ${expectedTargetId}>。`,
          block.index,
        );
      }
    }

    if (expectedSubjectIds.size > 0) {
      if (!blockingWords(block.text)) {
        push("warning", "blocking", "缺少画面左右/中间站位描述。", block.index);
      }
      if (
        !ORIENTATION_CUE.test(shot.action) &&
        !ORIENTATION_WORD.test(block.text)
      ) {
        push("warning", "blocking", "缺少人物朝向描述。", block.index);
      }
    }

    const dialogueChars = expectedLines.reduce(
      (sum, line) => sum + charCount(line.text),
      0,
    );
    if (dialogueChars > 0 && shot.duration_ms > 0) {
      const speed = dialogueChars / (shot.duration_ms / 1000);
      if (speed > 7.5) {
        push(
          "warning",
          "dialogue-speed",
          `台词语速 ${speed.toFixed(1)} 字/秒，超过 7.5。`,
          block.index,
        );
      }
    }
  }

  if (!sections.overall_soundscape) {
    push("error", "format", "overall_soundscape 为空。");
  }
  if (!sections.non_diegetic_music) {
    push("error", "format", "non_diegetic_music 为空。");
  }
  if (subjects.length > 0 && !subjects.some((subject) => subject.kind === "location")) {
    push("error", "scene-def-missing", "subject_definitions 没有场景/环境定义。");
  }

  return {
    segmentIdx: segment.idx,
    segmentId: segment.id,
    shots: shots.length,
    promptShots: shotBlocks.length,
    promptLength: prompt.length,
    sourceDialogue: sourceLines.length,
    compiledDialogue: compiledDialogue.length,
    subjects: subjects.length,
    issues: issues.filter((issue) => issue.segmentId === segment.id),
  };
}

function runAudit(prompt, segment) {
  const issues = [];
  auditPrompt(
    prompt,
    segment,
    shotsBySegment.get(segment.id) ?? [],
    sceneById.get(segment.scene_id),
    issues,
  );
  return issues;
}

function selfTest() {
  const segment = segmentRows.find((item) => (item.ai_prompt ?? "").trim());
  if (!segment) {
    console.error("self-test 需要一个已编译提示词的段落。");
    process.exit(1);
  }
  const base = segment.ai_prompt;
  const cases = [
    { name: "baseline", prompt: base, expect: null },
    {
      name: "missing-dialogue",
      prompt: base.replace(/<d>[\s\S]*?<\/d>/, ""),
      expect: "dialogue-coverage",
    },
    {
      name: "global-lock",
      prompt: `${base}\nSpatial positioning is locked.`,
      expect: "global-blocking",
    },
    {
      name: "missing-soundscape",
      prompt: base.replace(/^overall_soundscape:.*$/m, ""),
      expect: "format",
    },
    {
      name: "subject-overreach",
      prompt: base.replace(
        /((?:<Subject \d+>[\s,]*)+)(is|are) in frame\./,
        "$1, <Subject 999> $2 in frame.",
      ),
      expect: "subject-overreach",
    },
    {
      name: "timecode-overrun",
      prompt: base.replace(/At \d{2}:\d{2}\.\d{3}/, "At 99:00.000"),
      expect: "timecode",
    },
    {
      name: "missing-subject-def",
      prompt: base.replace(/^<Subject 1>.*$/m, ""),
      expect: "subject-def-missing",
    },
  ];
  let failed = 0;
  for (const testCase of cases) {
    const issues = runAudit(testCase.prompt, segment);
    const errors = issues.filter((issue) => issue.level === "error");
    const codes = new Set(issues.map((issue) => issue.code));
    const ok = testCase.expect
      ? codes.has(testCase.expect)
      : errors.length === 0;
    if (!ok) failed += 1;
    console.log(
      `${ok ? "[PASS]" : "[FAIL]"} self-test ${testCase.name}${
        testCase.expect ? ` -> ${testCase.expect}` : " -> 0 error"
      }`,
    );
  }
  process.exit(failed > 0 ? 1 : 0);
}

async function loadPreflight() {
  try {
    const { res, json } = await request(
      `/api/projects/${enc(projectId)}/storyboard`,
    );
    if (!res.ok) return [];
    return Array.isArray(json?.preflight) ? json.preflight : [];
  } catch {
    return [];
  }
}

async function compilePrompt(segment) {
  const cached = await request(
    `/api/projects/${enc(projectId)}/segments/${enc(segment.id)}/ai-prompt?platform=${enc(platform)}`,
  );
  if (!forceCompile && cached.res.ok && cached.json?.cached && cached.json?.prompt) {
    return { prompt: String(cached.json.prompt), cached: true, durationMs: 0 };
  }
  const started = Date.now();
  const result = await request("/api/skills/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      skillId: "storyboard-to-ai-prompt",
      projectId,
      input: { segmentId: segment.id, platform },
    }),
  });
  const durationMs = Date.now() - started;
  if (!result.res.ok) {
    throw new Error(result.json?.error || result.text.slice(0, 300));
  }
  return {
    prompt: String(result.json?.result ?? ""),
    cached: false,
    durationMs,
  };
}

if (flag("self-test")) {
  selfTest();
}

const preflight = await loadPreflight();
const issues = preflight.map((issue) => ({
  level: issue.level === "error" ? "error" : "warning",
  code: issue.code,
  segmentIdx: issue.segmentIndex ? Number(issue.segmentIndex) : undefined,
  segmentId: issue.segmentId,
  shotIndex:
    typeof issue.shotIndex === "number" ? issue.shotIndex + 1 : undefined,
  message: `preflight：${issue.message}`,
}));

const segmentReports = [];
for (const segment of segmentRows) {
  const scene = sceneById.get(segment.scene_id);
  const shots = shotsBySegment.get(segment.id) ?? [];
  let prompt = segment.ai_prompt ?? "";
  let compileInfo = { cached: true, durationMs: 0 };
  let compileError = "";
  if (compile) {
    try {
      const result = await compilePrompt(segment);
      prompt = result.prompt;
      compileInfo = { cached: result.cached, durationMs: result.durationMs };
      console.log(
        `[compile] 第${segment.idx}段 ${result.cached ? "命中缓存" : "已生成"} ${result.durationMs}ms ${prompt.length}字`,
      );
    } catch (error) {
      compileError = error.message;
      console.log(`[compile] 第${segment.idx}段 失败：${compileError}`);
    }
  }
  if (compileError) {
    issues.push({
      level: "error",
      code: "compile",
      segmentIdx: segment.idx,
      segmentId: segment.id,
      message: `第${segment.idx}段：提示词编译失败：${compileError}`,
    });
  }
  if (!prompt.trim()) {
    issues.push({
      level: "error",
      code: "prompt-empty",
      segmentIdx: segment.idx,
      segmentId: segment.id,
      message: `第${segment.idx}段：没有 AI 提示词。`,
    });
    segmentReports.push({
      segmentIdx: segment.idx,
      segmentId: segment.id,
      shots: shots.length,
      promptShots: 0,
      promptLength: 0,
      sourceDialogue: shots.reduce(
        (sum, shot) =>
          sum +
          shot.dialogue.filter((line) => normalizeDialogue(line.text)).length,
        0,
      ),
      compiledDialogue: 0,
      subjects: 0,
      cached: compileInfo.cached,
      durationMs: compileInfo.durationMs,
      issues: issues.filter((issue) => issue.segmentId === segment.id),
    });
    continue;
  }
  const report = auditPrompt(prompt, segment, shots, scene, issues);
  report.cached = compileInfo.cached;
  report.durationMs = compileInfo.durationMs;
  report.issues = issues.filter((issue) => issue.segmentId === segment.id);
  segmentReports.push(report);
}

const errors = issues.filter((issue) => issue.level === "error");
const warnings = issues.filter((issue) => issue.level === "warning");
const byCode = {};
for (const issue of issues) byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;

const lines = [];
lines.push("# 审计报告 · 分镜到视频提示词链路");
lines.push("");
lines.push(`- 项目：${project.name}（${projectId}）`);
lines.push(`- 厂商 / 画幅：${project.vendor} / ${project.aspect_ratio}`);
lines.push(`- 生成时间：${new Date().toISOString()}`);
lines.push(`- DB：\`${dbPath}\``);
lines.push(
  `- 结论：${segmentRows.length} 段，${errors.length} 个 error，${warnings.length} 个 warning`,
);
lines.push("");
lines.push("## 1. 段级结果");
lines.push("");
lines.push("| 段 | 镜数 | 提示词镜数 | 源台词 | 编译台词 | 主体数 | 字数 | 编译 | 问题 |");
lines.push("|---|---|---|---|---|---|---|---|---|");
for (const report of segmentReports) {
  const segIssues = report.issues ?? [];
  const errorCount = segIssues.filter((issue) => issue.level === "error").length;
  const warningCount = segIssues.filter((issue) => issue.level === "warning").length;
  lines.push(
    `| ${report.segmentIdx} | ${report.shots} | ${report.promptShots} | ${report.sourceDialogue} | ${report.compiledDialogue} | ${report.subjects} | ${report.promptLength} | ${
      report.cached ? "缓存" : `${report.durationMs}ms`
    } | ${errorCount} error / ${warningCount} warning |`,
  );
}
lines.push("");
lines.push("## 2. 问题分类");
lines.push("");
if (issues.length === 0) {
  lines.push("无。");
} else {
  lines.push("| code | 数量 |");
  lines.push("|---|---|");
  for (const [code, count] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${code} | ${count} |`);
  }
}
lines.push("");
lines.push("## 3. 问题清单");
lines.push("");
if (issues.length === 0) {
  lines.push("无。");
} else {
  lines.push("| 级别 | code | 段 | 镜 | 说明 |");
  lines.push("|---|---|---|---|---|");
  for (const issue of issues) {
    lines.push(
      `| ${issue.level} | ${issue.code} | ${issue.segmentIdx ?? "-"} | ${issue.shotIndex ?? "-"} | ${String(issue.message).replace(/\|/g, "\\|")} |`,
    );
  }
}
lines.push("");
lines.push("## 4. 产物");
lines.push("");
lines.push(`- JSON：\`${jsonPath}\``);
lines.push("");

writeFileSync(outPath, lines.join("\n"), "utf8");
writeFileSync(
  jsonPath,
  JSON.stringify(
    {
      project: { id: projectId, name: project.name, vendor: project.vendor },
      generatedAt: new Date().toISOString(),
      summary: {
        segments: segmentRows.length,
        errors: errors.length,
        warnings: warnings.length,
        byCode,
      },
      preflight,
      segments: segmentReports,
      issues,
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`report: ${outPath}`);
console.log(`json:   ${jsonPath}`);
console.log(
  `errors: ${errors.length}, warnings: ${warnings.length}, segments: ${segmentRows.length}`,
);
for (const issue of issues) {
  console.log(
    `${issue.level}\tseg ${issue.segmentIdx ?? "-"}\tshot ${issue.shotIndex ?? "-"}\t${issue.code}\t${issue.message}`,
  );
}

db.close();
process.exit(errors.length > 0 ? 1 : 0);
