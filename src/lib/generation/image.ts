import fs from "node:fs";
import { buildKeyframePrompt, saveFirstFrameImage } from "@core/server/keyframe";
import type { StoredFrame } from "@core/server/frames";
import { buildManifest } from "@core/server/render";
import { getStoryboard } from "@core/server/storyboard";
import {
  startJob,
  finishJob,
  updateJobProgress,
  startJobHeartbeat,
} from "@core/server/jobs";
import { getProject } from "@core/server/projects";
import { getProjectDb, nowIso } from "@core/server/db";
import {
  getGenerationSettings,
  assertImageGenerationConfigured,
  type GenerationSettings,
} from "./settings";
import { createImageClient, type ImageClient } from "./image-client";
import {
  extFromUrl,
  type CreateImageTaskInput,
  type ToApiTask,
} from "./toapi";

// Toapi 支持的输出比例白名单（见 docs.toapis.cn 图像生成）。
const ALLOWED_SIZES = new Set([
  "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5",
  "16:9", "9:16", "2:1", "1:2", "21:9", "9:21",
]);

const JOB_KIND = "gen-image";

const MAX_ATTEMPTS = 4;

// Toapi 繁忙/限流类错误可重试（新建任务重跑）；其它错误（参数、内容违规、取消）直接失败。
const RETRYABLE = /服务繁忙|service_busy|RateLimitReached|rate limit|429|503|too many/i;

function isRetryable(error: unknown): boolean {
  return RETRYABLE.test((error as Error)?.message ?? "");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("已取消"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("已取消"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// 取消起始画面出图：每个项目一组在跑任务（AbortController），取消时中断轮询/下载。
const activeImageRuns = new Map<string, Set<AbortController>>();

interface ImageRun {
  signal: AbortSignal;
  done: () => void;
}

function beginImageRun(projectId: string): ImageRun {
  const controller = new AbortController();
  let bucket = activeImageRuns.get(projectId);
  if (!bucket) {
    bucket = new Set();
    activeImageRuns.set(projectId, bucket);
  }
  const set = bucket;
  set.add(controller);
  return {
    signal: controller.signal,
    done: () => {
      set.delete(controller);
      if (set.size === 0) activeImageRuns.delete(projectId);
    },
  };
}

/** 取消本集正在排队/执行的起始画面出图；返回被中断的运行数。 */
export function cancelSegmentImages(projectId: string): { cancelled: number } {
  const set = activeImageRuns.get(projectId);
  const count = set?.size ?? 0;
  if (set) {
    for (const controller of set) controller.abort();
    activeImageRuns.delete(projectId);
  }

  // 释放去重占位，允许取消后立刻重新生成；旧任务收尾时会按对象身份跳过删除。
  const prefix = `${projectId}:`;
  for (const key of activeSegmentImages.keys()) {
    if (key.startsWith(prefix)) activeSegmentImages.delete(key);
  }

  // 同步落状态：即使后台任务还在网络请求里、尚未感知 abort，UI 和重启恢复
  // 也不该继续看到「生成中」。后台任务随后会以自己的结果覆盖（成功则 completed）。
  try {
    const db = getProjectDb(projectId);
    db.prepare(
      `UPDATE segment SET gen_status = 'cancelled', updated_at = ?
       WHERE project_id = ? AND gen_status IN ('queued','running','retrying')`,
    ).run(nowIso(), projectId);
  } catch {
    // 状态清理属于附加信息，失败不影响取消动作。
  }

  return { cancelled: count };
}

export interface SubmitImageResult {
  jobId: string;
  taskId: string;
  refCount: number;
  reused: boolean;
}

// 同一段落已有出图在跑时复用，避免重复点按钮造成多次建任务/重复扣费。
// pending 负责同步提交窗口内的并发，active 负责覆盖整个后台轮询周期。
const activeSegmentImages = new Map<string, SubmitImageResult>();
const pendingSegmentImages = new Map<string, Promise<SubmitImageResult>>();

function segmentImageKey(projectId: string, segmentId: string): string {
  return `${projectId}:${segmentId}`;
}

export interface GenerateImageResult {
  frame: StoredFrame;
  imageUrl: string;
  taskId: string;
  refCount: number;
}

function sizeFromAspect(aspect: string): string {
  return ALLOWED_SIZES.has(aspect) ? aspect : "1:1";
}

function updateSegmentGen(
  projectId: string,
  segmentId: string,
  patch: { taskId?: string | null; status?: string | null },
): void {
  try {
    const db = getProjectDb(projectId);
    db.prepare(
      "UPDATE segment SET gen_task_id = ?, gen_status = ?, updated_at = ? WHERE id = ?",
    ).run(patch.taskId ?? null, patch.status ?? null, nowIso(), segmentId);
  } catch {
    // 记录生成状态属于附加信息，失败不影响主流程。
  }
}

/** 收集首帧可用作参考图的本地文件，按首帧 prompt 的图号顺序过滤，排除起始画面本身。 */
function collectRefImages(
  projectId: string,
  segmentId: string,
  max: number,
  allowedViewIds?: string[],
): { imagePath: string; label: string }[] {
  const built = buildManifest(projectId, segmentId);
  if (!built) return [];
  const order = allowedViewIds
    ? new Map(allowedViewIds.map((id, index) => [id, index]))
    : null;
  return built.manifest
    .filter((m) => m.role !== "start" && !!m.imagePath)
    .filter((m) => !order || (!!m.viewId && order.has(m.viewId)))
    .filter((m) => fs.existsSync(m.imagePath as string))
    .sort((a, b) =>
      order && a.viewId && b.viewId
        ? (order.get(a.viewId) ?? 0) - (order.get(b.viewId) ?? 0)
        : 0,
    )
    .slice(0, max)
    .map((m) => ({ imagePath: m.imagePath as string, label: m.label }));
}

/** 落槽前确认段落还在：生成期间重新生成分镜/切换厂商会把段删掉。 */
function assertSegmentExists(projectId: string, segmentId: string): void {
  const db = getProjectDb(projectId);
  const row = db
    .prepare("SELECT 1 FROM segment WHERE id = ?")
    .get(segmentId);
  if (!row) throw new Error("段落已被删除或重新编排，已丢弃本次生成结果");
}

function makeClient(settings: GenerationSettings): ImageClient {
  return createImageClient({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    timeoutMs: settings.timeoutMs,
    protocol: settings.imageProtocol,
  });
}

/** 建任务；上游繁忙/限流时退避重试，避免一次抖动就让整段失败。 */
async function createImageTaskWithRetry(
  client: ImageClient,
  input: CreateImageTaskInput,
  signal: AbortSignal,
): Promise<ToApiTask> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await client.createImageTask(input, signal);
    } catch (error) {
      if (signal.aborted) throw new Error("已取消");
      lastError = error;
      if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) throw error;
      await sleep(Math.min(30_000, 3_000 * 2 ** (attempt - 1)), signal);
    }
  }
  throw lastError;
}

/**
 * 提交本段「起始画面」的云端生成任务（Toapi）。
 * 同一段已有任务在跑时直接复用，避免重复建任务/重复扣费。
 */
export async function submitSegmentImage(
  projectId: string,
  segmentId: string,
): Promise<SubmitImageResult> {
  const key = segmentImageKey(projectId, segmentId);

  const active = activeSegmentImages.get(key);
  if (active) return { ...active, reused: true };

  const pending = pendingSegmentImages.get(key);
  if (pending) return { ...(await pending), reused: true };

  const submission = submitSegmentImageOnce(projectId, segmentId);
  pendingSegmentImages.set(key, submission);
  try {
    return await submission;
  } finally {
    pendingSegmentImages.delete(key);
  }
}

/**
 * 同步完成：编译提示词 + 上传参考图 + 创建任务；返回后由后台轮询接管。
 * 这样路由可以立刻返回，前端通过 job 表/watch 观察进度（不落 HTTP 长等）。
 */
async function submitSegmentImageOnce(
  projectId: string,
  segmentId: string,
): Promise<SubmitImageResult> {
  assertImageGenerationConfigured();
  const settings = getGenerationSettings();
  const client = makeClient(settings);
  const jobId = startJob(projectId, JOB_KIND, { replaceRunning: false });
  const stopHeartbeat = startJobHeartbeat(projectId, jobId);
  // 先登记取消信号，让提交阶段的参考图上传/建任务也能被「取消出图」中断。
  const run = beginImageRun(projectId);

  try {
    const kf = buildKeyframePrompt(projectId, segmentId);
    if (!kf) throw new Error("无法编译起始画面提示词（段落不存在或无分镜）");
    const aspect =
      kf.aspect || getProject(projectId)?.aspectRatio || "1:1";

    const allowedViewIds = kf.refs
      .map((ref) => ref.viewId)
      .filter((id): id is string => Boolean(id));
    const refs = collectRefImages(
      projectId,
      segmentId,
      settings.maxRefImages,
      allowedViewIds,
    );
    const refUrls: string[] = [];
    for (const ref of refs) {
      if (run.signal.aborted) throw new Error("已取消");
      refUrls.push(await client.uploadImage(ref.imagePath));
    }
    if (run.signal.aborted) throw new Error("已取消");

    const input: CreateImageTaskInput = {
      model: settings.imageModel,
      prompt: kf.prompt,
      size: sizeFromAspect(aspect),
      resolution: settings.imageResolution,
      reference_images: refUrls.length ? refUrls : undefined,
    };
    const task = await createImageTaskWithRetry(client, input, run.signal);
    if (run.signal.aborted) throw new Error("已取消");

    const state: SubmitImageResult = {
      jobId,
      taskId: task.id,
      refCount: refUrls.length,
      reused: false,
    };
    activeSegmentImages.set(segmentImageKey(projectId, segmentId), state);
    updateSegmentGen(projectId, segmentId, { taskId: task.id, status: task.status });

    // 后台接管轮询 → 下载 → 落槽；路由立即返回。任务结束后释放去重占位。
    void runImageJob(
      projectId,
      segmentId,
      jobId,
      task.id,
      input,
      settings,
      state,
      run.signal,
    ).finally(() => {
      const key = segmentImageKey(projectId, segmentId);
      if (activeSegmentImages.get(key) === state) activeSegmentImages.delete(key);
      run.done();
    });

    stopHeartbeat();
    return state;
  } catch (error) {
    const cancelled = run.signal.aborted;
    updateSegmentGen(projectId, segmentId, {
      status: cancelled ? "cancelled" : "failed",
    });
    finishJob(
      projectId,
      jobId,
      "failed",
      cancelled ? "已取消" : (error as Error).message,
    );
    run.done();
    stopHeartbeat();
    throw error;
  }
}

/** 后台：轮询任务、下载结果、写入 segment 起始画面（frame kind='start'）。 */
async function runImageJob(
  projectId: string,
  segmentId: string,
  jobId: string,
  initialTaskId: string,
  input: CreateImageTaskInput,
  settings: GenerationSettings,
  state: SubmitImageResult,
  signal: AbortSignal,
): Promise<void> {
  const client = makeClient(settings);
  let taskId = initialTaskId;
  const stopHeartbeat = startJobHeartbeat(projectId, jobId);
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const imageUrl = await client.waitForImage(taskId, {
          intervalMs: settings.pollIntervalMs,
          timeoutMs: settings.timeoutMs,
          signal,
          onProgress: (task) => {
            if (typeof task.progress === "number") {
              updateJobProgress(projectId, jobId, task.progress);
            }
          },
        });
        const buf = await client.downloadImage(imageUrl, signal);
        if (signal.aborted) throw new Error("已取消生成");
        assertSegmentExists(projectId, segmentId);
        const frame = saveFirstFrameImage(
          projectId,
          segmentId,
          buf,
          extFromUrl(imageUrl),
          "generated",
        );
        updateSegmentGen(projectId, segmentId, { taskId, status: "completed" });
        finishJob(projectId, jobId, "succeeded", `已生成起始画面（frame ${frame.id}）`);
        return;
      } catch (error) {
        if (signal.aborted) throw new Error("已取消");
        if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) throw error;

        // 繁忙/限流：标记 retrying，退避后新建任务重跑（旧任务不再等待）。
        updateSegmentGen(projectId, segmentId, { taskId, status: "retrying" });
        await sleep(Math.min(30_000, 3_000 * 2 ** (attempt - 1)), signal);
        const task = await createImageTaskWithRetry(client, input, signal);
        taskId = task.id;
        state.taskId = task.id;
        updateSegmentGen(projectId, segmentId, {
          taskId,
          status: task.status,
        });
      }
    }
  } catch (error) {
    const cancelled = signal.aborted;
    updateSegmentGen(projectId, segmentId, {
      taskId,
      status: cancelled ? "cancelled" : "failed",
    });
    finishJob(
      projectId,
      jobId,
      "failed",
      cancelled ? "已取消" : (error as Error).message,
    );
  } finally {
    stopHeartbeat();
  }
}

/** 同步版本：一次跑完（提交 → 轮询 → 落槽），供脚本 / 测试 / 需要立即拿到结果的场景。 */
export async function generateSegmentStartFrame(
  projectId: string,
  segmentId: string,
): Promise<GenerateImageResult> {
  const settings = getGenerationSettings();
  const client = makeClient(settings);
  const jobId = startJob(projectId, JOB_KIND, { replaceRunning: false });
  const stopHeartbeat = startJobHeartbeat(projectId, jobId);
  try {
    const kf = buildKeyframePrompt(projectId, segmentId);
    if (!kf) throw new Error("无法编译起始画面提示词（段落不存在或无分镜）");
    const aspect = kf.aspect || getProject(projectId)?.aspectRatio || "1:1";
    const allowedViewIds = kf.refs
      .map((ref) => ref.viewId)
      .filter((id): id is string => Boolean(id));
    const refs = collectRefImages(
      projectId,
      segmentId,
      settings.maxRefImages,
      allowedViewIds,
    );
    const refUrls: string[] = [];
    for (const ref of refs) {
      refUrls.push(await client.uploadImage(ref.imagePath));
    }
    const task = await client.createImageTask({
      model: settings.imageModel,
      prompt: kf.prompt,
      size: sizeFromAspect(aspect),
      resolution: settings.imageResolution,
      reference_images: refUrls.length ? refUrls : undefined,
    });
    updateSegmentGen(projectId, segmentId, { taskId: task.id, status: task.status });
    const imageUrl = await client.waitForImage(task.id, {
      intervalMs: settings.pollIntervalMs,
      timeoutMs: settings.timeoutMs,
      onProgress: (current) => {
        if (typeof current.progress === "number") {
          updateJobProgress(projectId, jobId, current.progress);
        }
      },
    });
    const buf = await client.downloadImage(imageUrl);
    assertSegmentExists(projectId, segmentId);
    const frame = saveFirstFrameImage(
      projectId,
      segmentId,
      buf,
      extFromUrl(imageUrl),
      "generated",
    );
    updateSegmentGen(projectId, segmentId, { taskId: task.id, status: "completed" });
    finishJob(projectId, jobId, "succeeded", `已生成起始画面（frame ${frame.id}）`);
    return { frame, imageUrl, taskId: task.id, refCount: refUrls.length };
  } catch (error) {
    finishJob(projectId, jobId, "failed", (error as Error).message);
    throw error;
  } finally {
    stopHeartbeat();
  }
}

const BATCH_START_FRAME_JOB_KIND = "gen-start-frames";

export interface StartFrameBatchResult {
  jobId: string;
  total: number;
}

function batchJobStatus(projectId: string, jobId: string): string | null {
  try {
    const db = getProjectDb(projectId);
    const row = db
      .prepare("SELECT status FROM job WHERE id = ?")
      .get(jobId) as { status: string } | undefined;
    return row?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * 批量补齐「硬切/场首」的 AI 起始画面。
 * 连续段不在这里出图：它们会在顺序生成视频时直接采用上一段尾帧。
 */
export async function startSequentialStartFrameRun(
  projectId: string,
): Promise<StartFrameBatchResult> {
  assertImageGenerationConfigured();
  const targets: { id: string; label: string }[] = [];
  for (const scene of getStoryboard(projectId)) {
    scene.segments.forEach((segment, index) => {
      const isFirstOfScene = index === 0;
      if (segment.firstFrameId) return;
      if (!isFirstOfScene && !segment.hardCut) return;
      targets.push({
        id: segment.id,
        label: `${scene.sceneSlug || `第${scene.sceneIndex}场`} · 第${segment.index}段`,
      });
    });
  }
  if (targets.length === 0) {
    throw new Error("没有需要补首帧的硬切段（连续段会直接采用上一段尾帧）。");
  }
  const jobId = startJob(projectId, BATCH_START_FRAME_JOB_KIND);
  updateJobProgress(projectId, jobId, 0);
  void runSequentialStartFrameJob(projectId, jobId, targets);
  return { jobId, total: targets.length };
}

async function runSequentialStartFrameJob(
  projectId: string,
  jobId: string,
  targets: { id: string; label: string }[],
): Promise<void> {
  const stopHeartbeat = startJobHeartbeat(projectId, jobId);
  try {
  let done = 0;
  let failed = 0;
  let processed = 0;
  let firstError: string | null = null;
  for (const target of targets) {
    if (batchJobStatus(projectId, jobId) !== "running") {
      finishJob(projectId, jobId, "failed", "已取消");
      return;
    }
    try {
      // 生成期间可能被人工补过首帧，避免覆盖。
      const db = getProjectDb(projectId);
      const current = db
        .prepare("SELECT first_frame_id FROM segment WHERE id = ?")
        .get(target.id) as { first_frame_id: string | null } | undefined;
      if (current?.first_frame_id) {
        processed += 1;
        updateJobProgress(
          projectId,
          jobId,
          Math.round((processed / targets.length) * 100),
        );
        continue;
      }
      await generateSegmentStartFrame(projectId, target.id);
      done += 1;
    } catch (error) {
      if (batchJobStatus(projectId, jobId) !== "running") {
        finishJob(projectId, jobId, "failed", "已取消");
        return;
      }
      failed += 1;
      if (!firstError) firstError = (error as Error).message;
    }
    processed += 1;
    updateJobProgress(
      projectId,
      jobId,
      Math.round((processed / targets.length) * 100),
    );
  }
  const summary = `补首帧完成：成功 ${done} 段${failed ? `，失败 ${failed} 段` : ""}${
    firstError ? `（首个错误：${firstError}）` : ""
  }`;
  finishJob(
    projectId,
    jobId,
    done > 0 || failed === 0 ? "succeeded" : "failed",
    summary,
  );
  } finally {
    stopHeartbeat();
  }
}
