import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const dbPath = arg("db", "E:/ai/02_projects/jueman/workspace/0ab5e9c3-c884-4fff-8b1d-d4b7b6e96ef5/project.db");
const projectId = arg("project-id", "0ab5e9c3-c884-4fff-8b1d-d4b7b6e96ef5");
const outPath = arg("out", "E:/ai/02_projects/jueman/审计报告-段级基线.md");
const jsonPath = arg("json", outPath.replace(/\.md$/i, ".json"));
const ffmpegPath = arg("ffmpeg", "E:/ai/02_projects/jueman/resources/ffmpeg/ffmpeg.exe");

const SHOT_SIZE_RANK = { 大远景: 0, 远景: 1, 全景: 2, 中全景: 3, 中景: 4, 中近景: 5, 近景: 6, 特写: 7, 大特写: 8 };
const SPEED_MAX = 7.5;

const db = new Database(dbPath, { readonly: true });
const scenes = db.prepare("select * from scene").all();
const sceneById = new Map(scenes.map((s) => [s.id, s]));
const assets = db.prepare("select id, name from asset").all();
const assetNameById = new Map(assets.map((a) => [a.id, a.name]));

const segments = db
  .prepare("select * from segment where project_id=? order by idx")
  .all(projectId);

const parseJson = (raw, fallback) => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const charCount = (text) => (String(text).match(/[\u4e00-\u9fffA-Za-z0-9]/g) || []).length;
const round = (n) => Math.round(n * 100) / 100;

function mediaInfo(path) {
  if (!path || !existsSync(path) || !existsSync(ffmpegPath)) return null;
  let stderr = "";
  try {
    execFileSync(ffmpegPath, ["-hide_banner", "-i", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    stderr = String(e.stderr || "");
  }
  const duration = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const video = stderr.match(/Video:.*?\s(\d{2,5})x(\d{2,5})/);
  const fps = stderr.match(/(\d+(?:\.\d+)?)\s*fps/);
  return {
    durationMs: duration
      ? Math.round((Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000)
      : null,
    width: video ? Number(video[1]) : null,
    height: video ? Number(video[2]) : null,
    fps: fps ? Number(fps[1]) : null,
  };
}

function shotRefs(shot) {
  const original = parseJson(shot.original_json, {});
  const refs = Array.isArray(original.refs) ? original.refs : [];
  if (refs.length) {
    return refs
      .filter((r) => r && r.role === "character" && r.assetName)
      .map((r) => ({ name: r.assetName, source: "original_json" }));
  }
  const rows = db
    .prepare("select role, asset_id from shot_ref where shot_id=? order by sort_order")
    .all(shot.id);
  return rows
    .filter((r) => r.role === "character" && assetNameById.has(r.asset_id))
    .map((r) => ({ name: assetNameById.get(r.asset_id), source: "shot_ref" }));
}

const baseline = [];
const issues = [];

for (let i = 0; i < segments.length; i += 1) {
  const segment = segments[i];
  const scene = sceneById.get(segment.scene_id);
  const blocking = parseJson(scene?.blocking_json, { nodes: [] });
  const nodes = Array.isArray(blocking.nodes) ? blocking.nodes : [];
  const characterNodes = nodes.filter((n) => n.type === "character");
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const nodeIdByName = new Map(characterNodes.map((n) => [n.label, n.id]));

  const shots = db
    .prepare("select * from shot where segment_id=? order by idx")
    .all(segment.id);

  const prompt = segment.ai_prompt || "";
  const compiledLines = [...prompt.matchAll(/<d>\[Chinese\]([\s\S]*?)<\/d>/g)].map((m) => m[1]);
  const sourceLines = shots.flatMap((s) =>
    parseJson(s.dialogue_json, []).map((line) => ({ shotIndex: s.idx, ...line })),
  );
  const video = mediaInfo(segment.video_path);

  baseline.push({
    idx: segment.idx,
    id: segment.id,
    status: segment.status,
    genStatus: segment.gen_status,
    targetMs: segment.target_ms,
    hardCut: segment.hard_cut,
    aiPromptSig: segment.ai_prompt_sig,
    aiPromptLength: prompt.length,
    compiledDialogueCount: compiledLines.length,
    sourceDialogueCount: sourceLines.length,
    shotCount: shots.length,
    shotDurationSum: shots.reduce((sum, s) => sum + (s.duration_ms || 0), 0),
    firstFrameOrigin: segment.first_frame_origin,
    videoPath: segment.video_path,
    video,
  });

  const push = (issue) => issues.push({ segmentIdx: segment.idx, segmentId: segment.id, ...issue });

  if (sourceLines.length !== compiledLines.length) {
    push({
      level: "error",
      code: "dialogue-coverage",
      message: `源台词 ${sourceLines.length} 句，编译后 <d> ${compiledLines.length} 句`,
      fixAction: "recompile-prompt",
    });
  }

  for (const shot of shots) {
    const subjectIds = parseJson(shot.subject_node_ids_json, []);
    const subjectLabels = new Set(subjectIds.map((id) => nodeById.get(id)?.label).filter(Boolean));
    const action = String(shot.action || "");
    const refs = shotRefs(shot);
    const dialogue = parseJson(shot.dialogue_json, []);

    const actionNamed = new Set();
    for (const node of characterNodes) {
      if (action.includes(node.label) && !subjectIds.includes(node.id)) {
        actionNamed.add(node.label);
        push({
          level: "error",
          code: "cast-missing",
          shotIndex: shot.idx,
          shotId: shot.id,
          character: node.label,
          message: `action 点名「${node.label}」，但 subjectNodeIds 只有 [${subjectIds.join(", ")}]`,
          fixAction: "edit-storyboard",
        });
      }
    }

    for (const ref of refs) {
      if (ref.name && !actionNamed.has(ref.name) && nodeIdByName.has(ref.name) && !subjectLabels.has(ref.name)) {
        push({
          level: "error",
          code: "cast-extra",
          shotIndex: shot.idx,
          shotId: shot.id,
          character: ref.name,
          message: `refs 含「${ref.name}」，但不在 subjectNodeIds`,
          fixAction: "edit-storyboard",
        });
      }
    }

    for (const line of dialogue) {
      if (line.target) {
        const targetId = nodeIdByName.get(line.target);
        if (!line.offscreen && (!targetId || !subjectIds.includes(targetId))) {
          push({
            level: "error",
            code: "target-missing",
            shotIndex: shot.idx,
            shotId: shot.id,
            character: line.character,
            message: `台词对象「${line.target}」不在本镜 subjectNodeIds，且未标 offscreen`,
            fixAction: "edit-target",
          });
        }
      }
      const text = String(line.text || "");
      if (!text || !shot.duration_ms) continue;
      const speed = charCount(text) / (shot.duration_ms / 1000);
      if (speed > SPEED_MAX) {
        push({
          level: "warning",
          code: "dialogue-speed",
          shotIndex: shot.idx,
          shotId: shot.id,
          character: line.character,
          message: `台词语速 ${round(speed)} 字/秒（>${SPEED_MAX}）：「${text.slice(0, 18)}…」`,
          fixAction: "edit-storyboard",
        });
      }
    }

    const refCount = refs.length;
    if (refCount > 9) {
      push({
        level: "warning",
        code: "ref-slot-overflow",
        shotIndex: shot.idx,
        shotId: shot.id,
        message: `参考图 ${refCount} 张，超过 H3 上限 9`,
        fixAction: "edit-storyboard",
      });
    }
  }

  if (segment.hard_cut === 0 && i > 0) {
    const prev = segments[i - 1];
    const prevShots = db.prepare("select * from shot where segment_id=? order by idx").all(prev.id);
    const prevTail = prevShots[prevShots.length - 1];
    const head = shots[0];
    if (prevTail && head) {
      const a = parseJson(prevTail.camera_json, {});
      const b = parseJson(head.camera_json, {});
      const rankA = SHOT_SIZE_RANK[a.shotSize];
      const rankB = SHOT_SIZE_RANK[b.shotSize];
      const focalA = Number(String(a.focal || "").replace(/[^\d.]/g, "")) || 0;
      const focalB = Number(String(b.focal || "").replace(/[^\d.]/g, "")) || 0;
      const rankDiff = rankA !== undefined && rankB !== undefined ? Math.abs(rankA - rankB) : 0;
      const focalRatio = focalA && focalB ? Math.max(focalA, focalB) / Math.min(focalA, focalB) : 1;
      if (rankDiff >= 2 || focalRatio > 3) {
        push({
          level: "error",
          code: "hardcut-conflict",
          shotIndex: head.idx,
          shotId: head.id,
          message: `hardCut=0，但本段首镜 ${b.shotSize}/${b.focal} 与第 ${prev.idx} 段尾镜 ${a.shotSize}/${a.focal} 差 ${rankDiff} 档、焦段比 ${round(focalRatio)}`,
          fixAction: "set-hard-cut",
        });
      }
    }
  }
}

const severity = { error: 0, warning: 1 };
issues.sort(
  (a, b) =>
    severity[a.level] - severity[b.level] ||
    a.segmentIdx - b.segmentIdx ||
    (a.shotIndex ?? -1) - (b.shotIndex ?? -1),
);

const errorCount = issues.filter((i) => i.level === "error").length;
const warningCount = issues.filter((i) => i.level === "warning").length;
const generatedAt = new Date().toISOString();
const report = {
  generatedAt,
  dbPath,
  projectId,
  project: db.prepare("select * from project where id=?").get(projectId),
  baseline,
  issues,
  summary: { errorCount, warningCount, segmentCount: segments.length },
};

const md = [];
md.push("# 审计报告 · 段级基线（只读）", "");
md.push(`- 生成时间：${generatedAt}`);
md.push(`- 项目：${report.project?.name || ""}（${projectId}）`);
md.push(`- DB：\`${dbPath}\``);
md.push(`- 只读：是（未改 DB、未改媒体、未生成）`);
md.push(`- 结论：${errorCount} 个 error，${warningCount} 个 warning`, "");

md.push("## 1. 基线", "");
md.push("| 段 | status | gen_status | target_ms | hard_cut | ai_prompt_sig | <d> / 源台词 | 镜数 | 镜时长和 | 视频 | 分辨率 | 视频时长 |");
md.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const b of baseline) {
  const res = b.video?.width ? `${b.video.width}x${b.video.height}` : "—";
  const dur = b.video?.durationMs ? `${b.video.durationMs}ms` : "—";
  md.push(
    `| ${b.idx} | ${b.status} | ${b.genStatus} | ${b.targetMs} | ${b.hardCut} | \`${(b.aiPromptSig || "").slice(0, 12)}\` | ${b.compiledDialogueCount} / ${b.sourceDialogueCount} | ${b.shotCount} | ${b.shotDurationSum} | ${b.videoPath ? "有" : "无"} | ${res} | ${dur} |`,
  );
}
md.push("");

md.push("## 2. 问题清单", "");
if (!issues.length) {
  md.push("无。", "");
} else {
  md.push("| 级别 | code | 段 | 镜 | 角色 | 说明 | 修复动作 |");
  md.push("|---|---|---|---|---|---|---|");
  for (const i of issues) {
    md.push(
      `| ${i.level} | ${i.code} | ${i.segmentIdx} | ${i.shotIndex === undefined ? "—" : i.shotIndex + 1} | ${i.character || "—"} | ${i.message.replace(/\|/g, "\\|")} | ${i.fixAction} |`,
    );
  }
  md.push("");
}

md.push("## 3. 按段汇总", "");
md.push("| 段 | error | warning |");
md.push("|---|---|---|");
for (const b of baseline) {
  const own = issues.filter((i) => i.segmentIdx === b.idx);
  md.push(
    `| ${b.idx} | ${own.filter((i) => i.level === "error").length} | ${own.filter((i) => i.level === "warning").length} |`,
  );
}
md.push("");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, md.join("\n"), "utf8");
writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

console.log(`report: ${outPath}`);
console.log(`json:   ${jsonPath}`);
console.log(`errors: ${errorCount}, warnings: ${warningCount}, segments: ${segments.length}`);
for (const i of issues) {
  console.log(`${i.level}\tseg ${i.segmentIdx}\tshot ${i.shotIndex === undefined ? "-" : i.shotIndex + 1}\t${i.code}\t${i.character || ""}\t${i.message}`);
}
