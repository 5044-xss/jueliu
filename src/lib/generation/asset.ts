import fs from "node:fs";
import path from "node:path";
import { getAssets, setViewImage } from "@core/server/assets";
import { getAssetViewPath } from "@core/server/paths";
import { composeAssetViewPrompt } from "@core/shared/asset-prompt";
import { startJob, finishJob } from "@core/server/jobs";
import { getProject } from "@core/server/projects";
import {
  getGenerationSettings,
  assertImageGenerationConfigured,
  type GenerationSettings,
} from "./settings";
import { createImageClient, type ImageClient } from "./image-client";
import { extFromUrl, type CreateImageTaskInput } from "./toapi";
import { Semaphore, mapLimit, sleep } from "./concurrency";
import type {
  StoredAsset,
  StoredVariant,
  StoredView,
} from "@core/shared/schemas/assets";

const JOB_KIND = "gen-asset-image";

// 资产视图出图（Toapi）：把「资产锚点 + 变体变化 + 视角构图 + 风格」编译成提示词，
// 用同资产已出图的视图做参考图保持一致性，结果写入 view.image_path。

// 进程级并发闸门：限制「建任务 → 轮询 → 下载」同时在跑的数量。
// Toapi 账号对并发有限制（gpt-image-2-vip 实测约 3，超过会 service_busy），
// 批量出图必须经过它，避免大量任务被上游拒绝。
const gate = new Semaphore(2);

/** 把闸门上限同步为设置里的并发数（设置可随时改）。 */
function syncGate(settings: GenerationSettings): void {
  gate.setLimit(settings.imageConcurrency);
}

// 同一张图可能被多个并发请求（变体参考基础图、一键出图重复点等）同时需要，
// 用 in-flight 去重，保证一个视角只生成一次。
const inflightView = new Map<string, Promise<unknown>>();

const MAX_ATTEMPTS = 4;

// Toapi 繁忙/限流类错误可重试（新建任务重跑）；其它错误（参数、内容违规、取消）直接失败。
const RETRYABLE = /服务繁忙|service_busy|RateLimitReached|rate limit|429|503|too many/i;

function isRetryable(error: unknown): boolean {
  return RETRYABLE.test((error as Error)?.message ?? "");
}

/* ---------------- 取消出图 ---------------- */

interface RunCtx {
  signal: AbortSignal;
  done: () => void;
}

// 每个项目当前在跑的出图批次（可能同时有批量 + 单张）。取消时全部中断。
const activeRuns = new Map<string, Set<AbortController>>();

function beginRun(projectId: string): RunCtx {
  const controller = new AbortController();
  let bucket = activeRuns.get(projectId);
  if (!bucket) {
    bucket = new Set();
    activeRuns.set(projectId, bucket);
  }
  const set = bucket;
  set.add(controller);
  return {
    signal: controller.signal,
    done: () => {
      set.delete(controller);
      if (set.size === 0) activeRuns.delete(projectId);
    },
  };
}

/** 取消本集正在排队/执行的出图；返回被中断的运行数（粗计数）。 */
export function cancelAssetImages(projectId: string): { cancelled: number } {
  const set = activeRuns.get(projectId);
  if (!set || set.size === 0) return { cancelled: 0 };
  const count = set.size;
  for (const controller of set) controller.abort();
  activeRuns.delete(projectId);
  return { cancelled: count };
}

export function isAssetImagesRunning(projectId: string): boolean {
  return (activeRuns.get(projectId)?.size ?? 0) > 0;
}

export interface SubmitAssetResult {
  jobId: string;
}

export interface GenerateAssetResult {
  viewId: string;
  imagePath: string;
  imageUrl: string;
  taskId: string;
  refCount: number;
}

interface Resolved {
  asset: StoredAsset;
  variant: StoredVariant;
  view: StoredView;
}

function resolveView(projectId: string, viewId: string): Resolved | null {
  for (const asset of getAssets(projectId)) {
    for (const variant of asset.variants) {
      const view = variant.views.find((v) => v.id === viewId);
      if (view) return { asset, variant, view };
    }
  }
  return null;
}

/**
 * 参考图：
 *  - 变体 → 参考「基础图」（第一个变体的首个视角）：妆造/时段都基于基础造型/地点出。
 *  - 同变体 → 参考已出图的兄弟视角（如场景同一时段的 全景↔俯瞰↔反打）。
 * 基础图自身、或基础图尚未出图时，不产生跨变体依赖。
 */
function collectRefs(
  asset: StoredAsset,
  variant: StoredVariant,
  excludeViewId: string,
  max: number,
): string[] {
  const paths: string[] = [];
  const baseVariant = asset.variants[0];
  const baseView = baseVariant?.views[0];
  if (
    baseVariant &&
    baseVariant.id !== variant.id &&
    baseView?.imagePath &&
    fs.existsSync(baseView.imagePath)
  ) {
    paths.push(baseView.imagePath);
  }
  for (const view of variant.views) {
    if (view.id === excludeViewId) continue;
    if (view.imagePath && fs.existsSync(view.imagePath) && paths.length < max) {
      paths.push(view.imagePath);
    }
  }
  return paths.slice(0, Math.max(0, max));
}

/**
 * 出变体/妆造/其它视角前，先确保「基础图」存在。
 * 基础图 = 该资产按序（变体顺序 × 视角顺序）的第一张图；目标视角若正是基础槽位则跳过。
 * 依赖统一走 generateAssetViewImage 的 in-flight 去重，确保只出一张。
 */
async function ensureBaseSlotImage(
  projectId: string,
  resolved: Resolved,
  ctx: RunCtx,
): Promise<void> {
  const baseView = resolved.asset.variants[0]?.views[0];
  if (!baseView || baseView.id === resolved.view.id) return;
  if (hasImage(baseView)) return;
  await generateAssetViewImage(projectId, baseView.id, ctx);
}

function makeClient(settings: GenerationSettings): ImageClient {
  return createImageClient({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    timeoutMs: settings.timeoutMs,
    protocol: settings.imageProtocol,
  });
}

function viewSize(asset: StoredAsset, view: StoredView): string {
  // 道具三视图 = 正方形；角色单图全身 = 竖版 3:4；角色四视图 / 场景空镜 = 横版 16:9。
  if (asset.type === "prop") return "1:1";
  if (asset.type === "character" && view.kind !== "sheet") return "3:4";
  return "16:9";
}

function buildPrompt(projectId: string, resolved: Resolved): string {
  const style = getProject(projectId)?.style ?? "";
  return composeAssetViewPrompt({
    type: resolved.asset.type,
    viewLabel: resolved.view.label,
    viewKind: resolved.view.kind,
    viewPrompt: resolved.view.prompt,
    basePrompt: resolved.asset.basePrompt,
    variantPrompt: resolved.variant.prompt,
    style,
  });
}

/** 出图前的准备结果：已经确保基础图、拼好提示词、上传好参考图。 */
interface Prepared {
  asset: StoredAsset;
  variant: StoredVariant;
  view: StoredView;
  prompt: string;
  refUrls: string[];
}

async function prepareView(
  projectId: string,
  viewId: string,
  settings: GenerationSettings,
  ctx: RunCtx,
): Promise<Prepared> {
  let resolved = resolveView(projectId, viewId);
  if (!resolved) throw new Error("视角不存在");
  const prompt = buildPrompt(projectId, resolved);
  if (!prompt.trim()) {
    throw new Error("该视角没有可用的提示词（请先补全资产/变体/风格）");
  }

  // 先保证「基础图」（第一个槽位）已出，变体才有参考；随后重新解析拿到最新图片。
  await ensureBaseSlotImage(projectId, resolved, ctx);
  if (ctx.signal.aborted) throw new Error("已取消");
  resolved = resolveView(projectId, viewId) ?? resolved;

  const client = makeClient(settings);
  const refs = collectRefs(
    resolved.asset,
    resolved.variant,
    viewId,
    settings.maxRefImages,
  );
  const refUrls: string[] = [];
  for (const p of refs) {
    if (ctx.signal.aborted) throw new Error("已取消");
    refUrls.push(await client.uploadImage(p));
  }

  return { ...resolved, prompt, refUrls };
}

function taskInput(settings: GenerationSettings, prepared: Prepared): CreateImageTaskInput {
  return {
    model: settings.imageModel,
    prompt: prepared.prompt,
    size: viewSize(prepared.asset, prepared.view),
    resolution: settings.imageResolution,
    reference_images: prepared.refUrls.length ? prepared.refUrls : undefined,
  };
}

/**
 * 完整跑完一次出图：建任务 → 轮询 → 下载 → 落盘回填。
 * 全程在闸门内，保证同时在 Toapi 上执行的任务数不超过上限；
 * 遇到上游繁忙/限流时新建任务重试（最多 MAX_ATTEMPTS 次）。
 */
async function runGeneration(
  projectId: string,
  prepared: Prepared,
  settings: GenerationSettings,
  ctx: RunCtx,
): Promise<{ taskId: string; imageUrl: string; imagePath: string }> {
  const client = makeClient(settings);
  const input = taskInput(settings, prepared);
  return gate.run(async () => {
    if (ctx.signal.aborted) throw new Error("已取消");
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const task = await client.createImageTask(input, ctx.signal);
        const imageUrl = await client.waitForImage(task.id, {
          intervalMs: settings.pollIntervalMs,
          timeoutMs: settings.timeoutMs,
          signal: ctx.signal,
        });
        const buf = await client.downloadImage(imageUrl, ctx.signal);
        const ext = extFromUrl(imageUrl);
        const target = getAssetViewPath(
          projectId,
          prepared.asset.id,
          prepared.variant.id,
          prepared.view.id,
          ext,
        );
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, buf);
        setViewImage(projectId, prepared.view.id, target);
        return { taskId: task.id, imageUrl, imagePath: target };
      } catch (error) {
        if (ctx.signal.aborted) throw new Error("已取消");
        lastError = error;
        if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) throw error;
        await sleep(Math.min(30_000, 3_000 * 2 ** (attempt - 1)));
      }
    }
    throw lastError;
  });
}

/** 后台跑一个视角的出图（供单张出图 / 批量第二阶段使用）。 */
async function runViewJob(
  projectId: string,
  jobId: string,
  viewId: string,
  settings: GenerationSettings,
  ctx: RunCtx,
): Promise<void> {
  try {
    const prepared = await prepareView(projectId, viewId, settings, ctx);
    await runGeneration(projectId, prepared, settings, ctx);
    finishJob(
      projectId,
      jobId,
      "succeeded",
      `已生成资产图（${prepared.asset.name}·${prepared.view.label}）`,
    );
  } catch (error) {
    finishJob(projectId, jobId, "failed", (error as Error).message);
  }
}

/**
 * 提交单个资产视图出图；立即返回 jobId，实际生成在后台跑（受并发闸门限制）。
 * 同一视角若已在生成中（in-flight）则跳过，避免重复扣费。
 */
export async function submitAssetViewImage(
  projectId: string,
  viewId: string,
  ctx?: RunCtx,
): Promise<SubmitAssetResult> {
  assertImageGenerationConfigured();
  const settings = getGenerationSettings();
  syncGate(settings);
  const own = ctx ?? beginRun(projectId);
  const jobId = startJob(projectId, JOB_KIND, {
    replaceRunning: false,
    targetId: viewId,
  });

  if (inflightView.has(viewId)) {
    finishJob(projectId, jobId, "succeeded", "该视角已在生成中，已跳过");
    if (!ctx) own.done();
    return { jobId };
  }

  const job = runViewJob(projectId, jobId, viewId, settings, own).finally(() => {
    inflightView.delete(viewId);
    if (!ctx) own.done();
  });
  inflightView.set(viewId, job);
  return { jobId };
}

/** 同步版本：一次跑完，供批量第一阶段（基础图）与需要立即拿到结果的场景。 */
export async function generateAssetViewImage(
  projectId: string,
  viewId: string,
  ctx?: RunCtx,
): Promise<GenerateAssetResult> {
  const settings = getGenerationSettings();
  syncGate(settings);
  const own = ctx ?? beginRun(projectId);

  const running = inflightView.get(viewId);
  if (running) {
    if (!ctx) own.done();
    return (await running) as GenerateAssetResult;
  }

  const jobId = startJob(projectId, JOB_KIND, {
    replaceRunning: false,
    targetId: viewId,
  });
  const job = (async (): Promise<GenerateAssetResult> => {
    try {
      const prepared = await prepareView(projectId, viewId, settings, own);
      const result = await runGeneration(projectId, prepared, settings, own);
      finishJob(projectId, jobId, "succeeded", "已生成资产图");
      return {
        viewId,
        imagePath: result.imagePath,
        imageUrl: result.imageUrl,
        taskId: result.taskId,
        refCount: prepared.refUrls.length,
      };
    } catch (error) {
      finishJob(projectId, jobId, "failed", (error as Error).message);
      throw error;
    }
  })().finally(() => {
    inflightView.delete(viewId);
    if (!ctx) own.done();
  });
  inflightView.set(viewId, job);
  return job;
}

function hasImage(view: StoredView): boolean {
  return !!view.imagePath && fs.existsSync(view.imagePath);
}

/**
 * 一键出图：为项目（或指定资产）下所有视图提交生成。默认跳过已有图的视图。
 *
 * 依赖分层，分两阶段并发：
 *  1) 基础图（每个资产的第一个变体首视角）：互不依赖，按并发数同时出；
 *  2) 其余视角/变体：此时基础图已就绪，提交后各自后台执行。
 * 每个阶段内部受并发闸门限制，整体在后台跑，立即返回。
 */
export async function submitAllAssetImages(
  projectId: string,
  opts?: { assetId?: string; onlyMissing?: boolean },
): Promise<{ enqueued: number; skipped: number; total: number }> {
  assertImageGenerationConfigured();
  // 已有批次/单张出图在跑时直接拒绝，避免把尚未进入 in-flight 的排队视角重复提交。
  if (isAssetImagesRunning(projectId)) {
    throw new Error("已有出图任务在进行中，请等待完成或先「取消出图」再试");
  }
  const onlyMissing = opts?.onlyMissing !== false;
  const assets = getAssets(projectId).filter(
    (a) => !opts?.assetId || a.id === opts.assetId,
  );

  const baseViewIds: string[] = [];
  const restViewIds: string[] = [];
  let skipped = 0;
  let total = 0;
  for (const asset of assets) {
    asset.variants.forEach((variant, vi) => {
      variant.views.forEach((view, wi) => {
        const isBase = vi === 0 && wi === 0;
        total += 1;
        // 已有图、或该视角正在生成中（重复点击）都跳过，避免重复扣费。
        if (onlyMissing && (hasImage(view) || inflightView.has(view.id))) {
          skipped += 1;
          return;
        }
        (isBase ? baseViewIds : restViewIds).push(view.id);
      });
    });
  }
  const enqueued = baseViewIds.length + restViewIds.length;
  if (enqueued === 0) {
    throw new Error("没有可生成的视角（可能都已有图，或正在生成中）");
  }

  const ctx = beginRun(projectId);
  void runAssetBatch(projectId, baseViewIds, restViewIds, ctx).finally(ctx.done);
  return { enqueued, skipped, total };
}

async function runAssetBatch(
  projectId: string,
  baseViewIds: string[],
  restViewIds: string[],
  ctx: RunCtx,
): Promise<void> {
  const settings = getGenerationSettings();
  const concurrency = settings.imageConcurrency;

  // 1) 基础图：互不依赖，先并发出好，保证后续变体有参考。
  await mapLimit(baseViewIds, concurrency, async (viewId) => {
    if (ctx.signal.aborted) return;
    try {
      await generateAssetViewImage(projectId, viewId, ctx);
    } catch {
      // 单个失败不阻断整批。
    }
  });

  // 2) 其余视角/变体：基础图已就绪，提交后由各自后台任务出图。
  await mapLimit(restViewIds, concurrency, async (viewId) => {
    if (ctx.signal.aborted) return;
    try {
      await submitAssetViewImage(projectId, viewId, ctx);
    } catch {
      // 单个失败不阻断整批。
    }
  });
}
