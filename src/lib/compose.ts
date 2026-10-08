import fs from "node:fs";
import path from "node:path";
import { getProjectDb, newId, nowIso } from "@/lib/db";
import { getProject } from "@/lib/projects";
import { getStoryboard } from "@/lib/storyboard";
import { readGlobalSettings } from "@/lib/settings";
import { getExportPath } from "@/lib/paths";
import { runFfmpeg } from "@/lib/ffmpeg";
import {
  DEFAULT_TRANSITION,
  DEFAULT_TRANSITION_MS,
  isTransitionValue,
} from "@/lib/compose-shared";
import type {
  ComposableSegment,
  CompositionInfo,
  CompositionStatus,
} from "@/lib/compose-shared";

export {
  TRANSITIONS,
  TRANSITION_DURATIONS_MS,
  DEFAULT_TRANSITION,
  DEFAULT_TRANSITION_MS,
} from "@/lib/compose-shared";

export type { ComposableSegment, CompositionInfo, CompositionStatus };

export interface ComposeInput {
  segmentIds: string[];
  transition?: string;
  transitionMs?: number;
  name?: string;
}

interface CompositionRow {
  id: string;
  name: string;
  segment_ids_json: string;
  export_path: string | null;
  transition: string;
  transition_ms: number;
  status: string;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

const FPS = 30;

function parseIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function mapComposition(row: CompositionRow): CompositionInfo {
  const exportPath = row.export_path;
  return {
    id: row.id,
    name: row.name,
    segmentIds: parseIds(row.segment_ids_json),
    transition: row.transition,
    transitionMs: row.transition_ms,
    status: row.status as CompositionStatus,
    error: row.error,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    hasExport: exportPath ? fs.existsSync(exportPath) : false,
  };
}

export function listComposableSegments(projectId: string): ComposableSegment[] {
  const scenes = getStoryboard(projectId);
  const result: ComposableSegment[] = [];
  for (const scene of scenes) {
    for (const segment of scene.segments) {
      const hasVideo =
        Boolean(segment.videoPath) &&
        fs.existsSync(segment.videoPath as string);
      result.push({
        segmentId: segment.id,
        sceneIndex: scene.sceneIndex,
        sceneSlug: scene.sceneSlug,
        index: segment.index,
        targetMs: segment.targetMs,
        status: segment.status,
        hardCut: segment.hardCut,
        hasVideo,
      });
    }
  }
  return result;
}

export function listCompositions(projectId: string): CompositionInfo[] {
  const db = getProjectDb(projectId);
  const rows = db
    .prepare(
      "SELECT * FROM composition WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(projectId) as CompositionRow[];
  return rows.map(mapComposition);
}

export function getComposition(
  projectId: string,
  compositionId: string,
): CompositionInfo | null {
  const db = getProjectDb(projectId);
  const row = db
    .prepare("SELECT * FROM composition WHERE id = ? AND project_id = ?")
    .get(compositionId, projectId) as CompositionRow | undefined;
  return row ? mapComposition(row) : null;
}

export function getCompositionExportPath(
  projectId: string,
  compositionId: string,
): string | null {
  const db = getProjectDb(projectId);
  const row = db
    .prepare("SELECT export_path FROM composition WHERE id = ? AND project_id = ?")
    .get(compositionId, projectId) as { export_path: string | null } | undefined;
  return row?.export_path ?? null;
}

export function deleteComposition(projectId: string, compositionId: string): void {
  const db = getProjectDb(projectId);
  const exportPath = getCompositionExportPath(projectId, compositionId);
  if (exportPath && fs.existsSync(/* turbopackIgnore: true */ exportPath)) {
    fs.rmSync(/* turbopackIgnore: true */ exportPath, { force: true });
  }
  db.prepare("DELETE FROM composition WHERE id = ? AND project_id = ?").run(
    compositionId,
    projectId,
  );
}

function resolutionFor(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case "16:9":
      return { width: 1280, height: 720 };
    case "4:3":
      return { width: 1024, height: 768 };
    case "3:4":
      return { width: 768, height: 1024 };
    case "1:1":
      return { width: 1024, height: 1024 };
    case "9:16":
    default:
      return { width: 720, height: 1280 };
  }
}

async function probeMedia(
  binPath: string,
  file: string,
): Promise<{ duration: number; hasAudio: boolean }> {
  const { stderr } = await runFfmpeg(binPath, ["-hide_banner", "-i", file]);
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = match
    ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    : 0;
  const hasAudio = /Stream #\d+:\d+.*: Audio:/.test(stderr);
  return { duration, hasAudio };
}

function clampTransition(requested: number, prev: number, next: number): number {
  const limit = Math.min(prev, next) / 2;
  return Math.max(0.05, Math.min(requested, limit));
}

function buildFilterGraph(
  count: number,
  durations: number[],
  transition: string,
  transitionMs: number,
  hasAudio: boolean[],
  width: number,
  height: number,
): { graph: string; outV: string; outA: string | null } {
  const anyAudio = hasAudio.some(Boolean);
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    parts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},` +
        `format=yuv420p,setpts=PTS-STARTPTS[v${i}]`,
    );
    if (anyAudio) {
      if (hasAudio[i]) {
        parts.push(
          `[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
            `asetpts=PTS-STARTPTS[a${i}]`,
        );
      } else {
        // 该段没有音轨时补等长静音，避免「任一段无音轨 → 整条合成丢音」。
        parts.push(
          `anullsrc=channel_layout=stereo:sample_rate=44100,` +
            `atrim=0:${Math.max(0, durations[i]).toFixed(3)},` +
            `asetpts=PTS-STARTPTS[a${i}]`,
        );
      }
    }
  }

  const useXfade = transition !== "none" && count > 1;
  if (!useXfade) {
    if (count === 1) {
      return { graph: parts.join(";"), outV: "v0", outA: anyAudio ? "a0" : null };
    }
    const inputs: string[] = [];
    for (let i = 0; i < count; i += 1) {
      inputs.push(`[v${i}]`);
      if (anyAudio) inputs.push(`[a${i}]`);
    }
    parts.push(
      `${inputs.join("")}concat=n=${count}:v=1:a=${anyAudio ? 1 : 0}` +
        `[outv]${anyAudio ? "[outa]" : ""}`,
    );
    return { graph: parts.join(";"), outV: "outv", outA: anyAudio ? "outa" : null };
  }

  const requested = transitionMs / 1000;
  let currentV = "v0";
  let currentA = anyAudio ? "a0" : null;
  let outDuration = durations[0];
  for (let i = 1; i < count; i += 1) {
    const d = clampTransition(requested, durations[i - 1], durations[i]);
    const offset = Math.max(0, outDuration - d);
    const nextV = `vx${i}`;
    parts.push(
      `[${currentV}][v${i}]xfade=transition=${transition}:` +
        `duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}[${nextV}]`,
    );
    currentV = nextV;
    if (anyAudio && currentA) {
      const nextA = `ax${i}`;
      parts.push(
        `[${currentA}][a${i}]acrossfade=d=${d.toFixed(3)}:c1=tri:c2=tri[${nextA}]`,
      );
      currentA = nextA;
    }
    outDuration = outDuration + durations[i] - d;
  }
  return { graph: parts.join(";"), outV: currentV, outA: currentA };
}

export async function composeSegments(
  projectId: string,
  input: ComposeInput,
): Promise<CompositionInfo> {
  const project = getProject(projectId);
  if (!project) throw new Error("项目不存在");

  const ids = input.segmentIds.filter(Boolean);
  if (ids.length === 0) throw new Error("请至少选择一个段落");

  const scenes = getStoryboard(projectId);
  const segmentById = new Map<
    string,
    { videoPath: string | null; label: string }
  >();
  for (const scene of scenes) {
    for (const segment of scene.segments) {
      segmentById.set(segment.id, {
        videoPath: segment.videoPath,
        label: `第${scene.sceneIndex}场·第${segment.index}段`,
      });
    }
  }

  const files: string[] = [];
  for (const id of ids) {
    const found = segmentById.get(id);
    if (!found) throw new Error("包含不存在的段落，请刷新后重试");
    if (!found.videoPath || !fs.existsSync(found.videoPath)) {
      throw new Error(`${found.label}尚未回传视频，无法合成`);
    }
    files.push(found.videoPath);
  }

  const transition = isTransitionValue(input.transition)
    ? input.transition
    : DEFAULT_TRANSITION;
  const requestedMs = Number.isFinite(input.transitionMs)
    ? Math.max(100, Math.min(5000, Math.round(input.transitionMs as number)))
    : DEFAULT_TRANSITION_MS;

  const binPath = readGlobalSettings().ffmpeg.path;
  const { width, height } = resolutionFor(project.aspectRatio);

  const compositionId = newId();
  const output = getExportPath(projectId, compositionId, "mp4");
  fs.mkdirSync(path.dirname(output), { recursive: true });

  const db = getProjectDb(projectId);
  db.prepare(
    `INSERT INTO composition
     (id, project_id, name, segment_ids_json, export_path, transition, transition_ms, status, error, duration_ms, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, 'running', NULL, NULL, ?)`,
  ).run(
    compositionId,
    projectId,
    input.name?.trim() || "",
    JSON.stringify(ids),
    transition,
    requestedMs,
    nowIso(),
  );

  try {
    const probes = await Promise.all(
      files.map((file) => probeMedia(binPath, file)),
    );
    const durations = probes.map((p) => p.duration);
    if (durations.some((d) => !Number.isFinite(d) || d <= 0)) {
      throw new Error("无法读取某个视频的时长，请确认文件完整");
    }
    const hasAudio = probes.map((p) => p.hasAudio);

    const { graph, outV, outA } = buildFilterGraph(
      files.length,
      durations,
      transition,
      requestedMs,
      hasAudio,
      width,
      height,
    );

    const args: string[] = ["-y", "-hide_banner"];
    for (const file of files) args.push("-i", file);
    args.push("-filter_complex", graph, "-map", `[${outV}]`);
    if (outA) args.push("-map", `[${outA}]`);
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(FPS),
    );
    if (outA) {
      args.push("-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2");
    } else {
      args.push("-an");
    }
    args.push("-movflags", "+faststart", output);

    const { code, stderr } = await runFfmpeg(binPath, args);
    if (code !== 0) {
      const tail = stderr.split("\n").filter(Boolean).slice(-3).join(" ");
      throw new Error(`ffmpeg 合成失败：${tail || `退出码 ${code}`}`);
    }
    if (!fs.existsSync(output)) {
      throw new Error("ffmpeg 未生成输出文件");
    }

    const transitionSeconds =
      transition === "none"
        ? 0
        : durations
            .slice(0, -1)
            .reduce(
              (acc, d, i) =>
                acc +
                clampTransition(requestedMs / 1000, d, durations[i + 1]),
              0,
            );
    const durationMs = Math.round(
      (durations.reduce((a, b) => a + b, 0) - transitionSeconds) * 1000,
    );

    db.prepare(
      `UPDATE composition
       SET export_path = ?, status = 'ready', error = NULL, duration_ms = ?
       WHERE id = ?`,
    ).run(output, durationMs, compositionId);

    return getComposition(projectId, compositionId)!;
  } catch (error) {
    db.prepare(
      "UPDATE composition SET status = 'failed', error = ? WHERE id = ?",
    ).run((error as Error).message, compositionId);
    throw error;
  }
}
