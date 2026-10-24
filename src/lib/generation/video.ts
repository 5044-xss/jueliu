import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildManifest } from "@core/server/render";
import { startJob, finishJob, cancelRunningJobs } from "@core/server/jobs";
import { getProject } from "@core/server/projects";
import { getVendor } from "@core/server/library/vendors";
import { getStoryboard } from "@core/server/storyboard";
import { mediaSignature } from "@core/server/media-signature";
import { getSegmentVideoPath, getProjectMediaDir, isSafeId } from "@core/server/paths";
import {
  getFrames,
  setSegmentFirstFrame,
  setSegmentVideo,
} from "@core/server/frames";
import { getProjectDb, nowIso } from "@core/server/db";
import { runSegmentQc } from "@core/server/qc";
import {
  attachGenerationSnapshotVideo,
  saveGenerationSnapshot,
} from "@core/server/generation-snapshot";
import { getOrCompileH3PromptInfo } from "./prompt";
import { captureAndAdoptTail } from "./tail";
import { generateSegmentStartFrame } from "./image";
import {
  getGenerationSettings,
  assertVideoGenerationConfigured,
  type GenerationSettings,
} from "./settings";
import {
  ComfyClient,
  buildH3Workflow,
  extractVideoOutput,
  detectCaps,
  type ComfyViewItem,
  type ObjectInfo,
} from "./comfy";
import { resolveH3GenParams, assertH3Project } from "./providers/comfyui";

const JOB_KIND = "gen-video";
// 顺序批量生成用独立 kind，便于前端区分「单段生成」与「整批生成」，避免单段在跑时把批量按钮也显示成 loading。
const BATCH_JOB_KIND = "gen-videos";

// 视频生成走「提交 → 轮询」，绝不单次 HTTP 死等（H3 出片 2 分钟起步，长片 ~20 分钟）。
// 提交阶段同步返回 prompt_id，之后由后台轮询接管，前端看 job 条。

export interface SubmitVideoResult {
  jobId: string;
  promptId: string;
  mode: string;
  refCount: number;
}

export interface GenerateVideoResult extends SubmitVideoResult {
  videoPath: string;
}

function updateSegmentGen(projectId: string, segmentId: string, patch: { taskId?: string | null; status?: string | null }): void {
  try {
    const db = getProjectDb(projectId);
    db.prepare("UPDATE segment SET gen_task_id = ?, gen_status = ?, updated_at = ? WHERE id = ?").run(patch.taskId ?? null, patch.status ?? null, nowIso(), segmentId);
  } catch {
    // 生成状态是附加信息，失败不影响主流程。
  }
}

function markSegmentsQueued(projectId: string, segmentIds: string[]): void {
  if (segmentIds.length === 0) return;
  try {
    const db = getProjectDb(projectId);
    const now = nowIso();
    const update = db.prepare(
      "UPDATE segment SET gen_task_id = NULL, gen_status = 'queued', updated_at = ? WHERE id = ?",
    );
    const runAll = db.transaction((ids: string[]) => {
      for (const id of ids) update.run(now, id);
    });
    runAll(segmentIds);
  } catch {
    // 排队状态是附加信息，失败不影响主流程。
  }
}

function makeClient(settings: GenerationSettings): ComfyClient {
  return new ComfyClient({ baseUrl: settings.comfyUrl });
}

/** 读取段落生成状态（取消时由 cancelProjectVideos 写为 "cancelled"）。 */
function segmentGenStatus(projectId: string, segmentId: string): string | null {
  try {
    const db = getProjectDb(projectId);
    const row = db
      .prepare("SELECT gen_status FROM segment WHERE id = ?")
      .get(segmentId) as { gen_status: string | null } | undefined;
    return row?.gen_status ?? null;
  } catch {
    return null;
  }
}

interface UploadedImage {
  name: string;
}

/** 收集本段可用图片：起始画面（首帧）优先；无则用资产视图做参生参考图。 */
function collectImages(projectId: string, segmentId: string, max: number): { startFrame: string | null; views: string[] } {
  const built = buildManifest(projectId, segmentId, max);
  if (!built) return { startFrame: null, views: [] };
  let startFrame: string | null = null;
  const views: string[] = [];
  for (const m of built.manifest) {
    if (!m.imagePath || !fs.existsSync(m.imagePath)) continue;
    if (m.role === "start") {
      if (!startFrame) startFrame = m.imagePath;
    } else if (views.length < max) {
      views.push(m.imagePath);
    }
  }
  return { startFrame, views };
}

async function uploadAll(client: ComfyClient, paths: string[]): Promise<UploadedImage[]> {
  const out: UploadedImage[] = [];
  // 每张图必须用全局唯一文件名：人物参考图都叫 video-ref.png，
  // ComfyUI 以 overwrite=true 上传时同名文件会互相覆盖，导致所有参考槽位
  // 实际指向同一张图（人物身份错乱/重复）。
  const batch = randomUUID().slice(0, 8);
  for (const p of paths) {
    const ext = path.extname(p).toLowerCase() || ".png";
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
    const filename = `ref-${batch}-${out.length}${ext}`;
    const up = await client.uploadImage(fs.readFileSync(p), filename, mime);
    out.push({ name: up.subfolder ? `${up.subfolder}/${up.name}` : up.name });
  }
  return out;
}

interface Prepared {
  client: ComfyClient;
  workflow: ReturnType<typeof buildH3Workflow>["workflow"];
  mode: string;
  refCount: number;
  targetMs: number;
  name: string;
  /** 提交时（即提示词依据的）分镜内容签名，回传视频时一并写入。 */
  mediaSig: string;
  /** 本次实际使用的编译提示词与签名，用于生成快照。 */
  prompt: string;
  promptSig: string;
  humanPrompt: string;
  /** 复用 prepare 里已拉取的 /object_info，避免重复请求。 */
  objectInfo: ObjectInfo | null;
}

async function prepare(projectId: string, segmentId: string, settings: GenerationSettings): Promise<Prepared> {
  const built = buildManifest(projectId, segmentId);
  if (!built) throw new Error("无法读取本段分镜");
  const aspect = getProject(projectId)?.aspectRatio ?? "16:9";

  const client = makeClient(settings);
  const objectInfo = await client.getObjectInfo();
  const caps = detectCaps(objectInfo);

  const maxRef = Math.max(1, getVendor(getProject(projectId)?.vendor).maxRefImages || 9);
  const { startFrame, views } = collectImages(projectId, segmentId, maxRef);
  let images: UploadedImage[] = [];
  let useReference = false;
  if (startFrame && views.length) {
    // 有起始画面又有内容参考 → 也走全参考 Ref2VA：首帧 + 角色/场景一并上传。
    useReference = true;
    images = await uploadAll(client, [startFrame, ...views].slice(0, maxRef));
  } else if (startFrame) {
    images = await uploadAll(client, [startFrame]);
  } else if (views.length) {
    useReference = true;
    images = await uploadAll(client, views);
  }

  // 只有「仅首帧、无内容参考」时用基础模式；其余用全参考模式。
  const compiled = await getOrCompileH3PromptInfo(
    projectId,
    segmentId,
    !useReference && !!startFrame,
  );

  const gen = resolveH3GenParams(settings, { targetMs: built.segment.targetMs, aspect });
  const name = `${built.scene.sceneSlug || `S${built.scene.sceneIndex}`}-第${built.segment.index}段`;
  const { workflow, mode } = buildH3Workflow({ prompt: compiled.prompt, name, images: images.map((i) => i.name), gen, caps, useReference });

  return {
    client,
    workflow,
    mode,
    refCount: images.length,
    targetMs: built.segment.targetMs,
    name,
    mediaSig: mediaSignature(built.scene.blocking, built.segment),
    prompt: compiled.prompt,
    promptSig: compiled.sig,
    humanPrompt: compiled.humanPrompt,
    objectInfo,
  };
}

function segmentExists(projectId: string, segmentId: string): boolean {
  try {
    const db = getProjectDb(projectId);
    return Boolean(
      db.prepare("SELECT 1 FROM segment WHERE id = ?").get(segmentId),
    );
  } catch {
    return false;
  }
}

/**
 * 落槽前再确认段落仍在：生成期间重新生成分镜/切换厂商会把段删掉。
 * 此时直接丢弃产物，避免视频写到已删除的段上（文件残留、任务却显示成功）。
 */
function commitVideo(
  projectId: string,
  segmentId: string,
  target: string,
  mediaSig: string,
): void {
  if (!segmentExists(projectId, segmentId)) {
    try {
      fs.rmSync(target, { force: true });
    } catch {
      // 忽略清理失败
    }
    throw new Error("段落已被删除或重新编排，已丢弃本次生成结果");
  }
  setSegmentVideo(projectId, segmentId, target, mediaSig);
  attachGenerationSnapshotVideo(projectId, segmentId, target);
}

/** 提交成功后写入本次实际提示词快照（失败不影响主流程）。 */
function recordSnapshot(
  projectId: string,
  segmentId: string,
  jobId: string,
  prep: Prepared,
): void {
  try {
    saveGenerationSnapshot(projectId, {
      segmentId,
      jobId,
      humanPrompt: prep.humanPrompt,
      compiledPrompt: prep.prompt,
      promptSig: prep.promptSig,
      mediaSig: prep.mediaSig,
    });
  } catch {
    // 快照是诊断信息，写失败不能阻断生成。
  }
}

/** 提交本段视频任务；同步返回 prompt_id，后台轮询接管。 */
export async function submitSegmentVideo(projectId: string, segmentId: string): Promise<SubmitVideoResult> {
  assertH3Project(projectId);
  assertVideoGenerationConfigured();
  const settings = getGenerationSettings();
  const jobId = startJob(projectId, JOB_KIND, { replaceRunning: false });
  try {
    const prep = await prepare(projectId, segmentId, settings);
    const promptId = await prep.client.queuePrompt(prep.workflow, prep.objectInfo);
    recordSnapshot(projectId, segmentId, jobId, prep);
    updateSegmentGen(projectId, segmentId, { taskId: promptId, status: "queued" });
    void runVideoJob(
      projectId,
      segmentId,
      jobId,
      promptId,
      prep.client,
      settings,
      prep.mediaSig,
    );
    return { jobId, promptId, mode: prep.mode, refCount: prep.refCount };
  } catch (error) {
    updateSegmentGen(projectId, segmentId, { status: "failed" });
    finishJob(projectId, jobId, "failed", (error as Error).message);
    throw error;
  }
}

/** 后台：轮询 history，下载产物并写入 segment.video_path。 */
async function runVideoJob(projectId: string, segmentId: string, jobId: string, promptId: string, client: ComfyClient, settings: GenerationSettings, mediaSig: string): Promise<void> {
  // 段状态被标成 cancelled，或任务条已不在 running（用户取消），都立即停止。
  const stopped = () =>
    segmentGenStatus(projectId, segmentId) === "cancelled" ||
    jobStatus(projectId, jobId) !== "running";
  try {
    const item = await waitForVideo(client, promptId, {
      intervalMs: 8_000,
      timeoutMs: settings.videoTimeoutMs,
      isCancelled: stopped,
    });
    const attempt = await downloadToSegment(client, projectId, segmentId, item);
    const finalized = await finalizeAttempt(projectId, segmentId, attempt, mediaSig);
    if (finalized.qcFailed) {
      updateSegmentGen(projectId, segmentId, { taskId: promptId, status: "qc_failed" });
      finishJob(
        projectId,
        jobId,
        "succeeded",
        `已生成视频；QC 未通过（${finalized.qc?.score ?? 0} 分）：${finalized.qc?.issues
          .filter((issue) => issue.level === "hard")
          .map((issue) => issue.message)
          .join("；")}`,
      );
      return;
    }
    // 尾帧只服务下一段连续性；失败不应把已成功的视频判为失败。
    let tail = { captured: false };
    try {
      tail = await captureAndAdoptTail(projectId, segmentId);
    } catch {
      // 忽略尾帧失败。
    }
    updateSegmentGen(projectId, segmentId, { taskId: promptId, status: "completed" });
    finishJob(
      projectId,
      jobId,
      "succeeded",
      `已生成视频${tail.captured ? "（尾帧已接为下一段起始画面）" : ""}${
        finalized.qc ? `；QC ${finalized.qc.status}（${finalized.qc.score ?? 0} 分）` : ""
      }`,
    );
  } catch (error) {
    const cancelled = stopped();
    updateSegmentGen(projectId, segmentId, { taskId: promptId, status: cancelled ? "cancelled" : "failed" });
    finishJob(projectId, jobId, "failed", cancelled ? "已取消" : (error as Error).message);
  }
}

async function downloadToSegment(client: ComfyClient, projectId: string, segmentId: string, item: ComfyViewItem): Promise<string> {
  const vendor = getProject(projectId)?.vendor ?? "custom";
  const ext = path.extname(item.filename).replace(".", "").toLowerCase() || "mp4";
  const safeVendor = isSafeId(vendor) ? vendor : "custom";
  const dir = path.join(getProjectMediaDir(projectId), "videos", safeVendor, segmentId);
  fs.mkdirSync(dir, { recursive: true });
  let attempt = 1;
  while (fs.existsSync(path.join(dir, `attempt-${attempt}.${ext}`))) {
    attempt += 1;
  }
  const target = path.join(dir, `attempt-${attempt}.${ext}`);
  return client.downloadToFile(item, target);
}

interface WaitOptions {
  intervalMs: number;
  timeoutMs: number;
  /** 返回 true 表示任务已被用户取消，立即停止轮询。 */
  isCancelled?: () => boolean;
}

// 轮询 history：出现产物即完成；连续多次查询失败判定引擎可能已崩（A4：中断 + 清队列）。
async function waitForVideo(client: ComfyClient, promptId: string, opts: WaitOptions): Promise<ComfyViewItem> {
  const deadline = Date.now() + opts.timeoutMs;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let consecutiveErrors = 0;

  for (;;) {
    if (opts.isCancelled?.()) {
      throw new Error("已取消生成");
    }

    try {
      const history = await client.getHistory(promptId);
      consecutiveErrors = 0;
      const entry = history[promptId];
      if (entry) {
        if (entry.status?.status_str === "error") {
          throw new Error("ComfyUI 执行报错（工作流状态为 error）");
        }
        const item = extractVideoOutput(history, promptId);
        if (item) return item;
      }
    } catch (error) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= 5) {
        // A4 崩溃自愈：先尝试中断与清队列，再抛出明确错误。
        await client.interrupt();
        await client.queueDelete([promptId]);
        throw new Error(`连续 ${consecutiveErrors} 次无法查询 ComfyUI（实例可能已崩，需要重启）：${(error as Error).message}`);
      }
    }

    if (Date.now() > deadline) {
      throw new Error(`视频生成超时（已等待 ${Math.round(opts.timeoutMs / 1000)}s）`);
    }
    await sleep(opts.intervalMs);
  }
}

interface FinalizeAttemptResult {
  target: string;
  qcFailed: boolean;
  qc: Awaited<ReturnType<typeof runSegmentQc>> | null;
}

async function finalizeAttempt(
  projectId: string,
  segmentId: string,
  attempt: string,
  mediaSig: string,
): Promise<FinalizeAttemptResult> {
  let qc: Awaited<ReturnType<typeof runSegmentQc>> | null = null;
  try {
    qc = await runSegmentQc({ projectId, segmentId, videoPath: attempt });
  } catch {
    qc = null;
  }
  const vendor = getProject(projectId)?.vendor ?? "custom";
  const ext = path.extname(attempt).replace(".", "").toLowerCase() || "mp4";
  const target = getSegmentVideoPath(projectId, vendor, segmentId, ext);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(attempt, target);
  commitVideo(projectId, segmentId, target, mediaSig);
  return { target, qcFailed: Boolean(qc?.hardFail), qc };
}

/** 同步版本：提交 → 轮询 → 落槽，供脚本 / 需要立即拿到结果的场景。 */
export async function generateSegmentVideo(projectId: string, segmentId: string): Promise<GenerateVideoResult> {
  const settings = getGenerationSettings();
  const jobId = startJob(projectId, JOB_KIND, { replaceRunning: false });
  try {
    const prep = await prepare(projectId, segmentId, settings);
    const promptId = await prep.client.queuePrompt(prep.workflow, prep.objectInfo);
    recordSnapshot(projectId, segmentId, jobId, prep);
    updateSegmentGen(projectId, segmentId, { taskId: promptId, status: "queued" });
    const stopped = () =>
      segmentGenStatus(projectId, segmentId) === "cancelled" ||
      jobStatus(projectId, jobId) !== "running";
    const item = await waitForVideo(prep.client, promptId, {
      intervalMs: 8_000,
      timeoutMs: settings.videoTimeoutMs,
      isCancelled: stopped,
    });
    const attempt = await downloadToSegment(prep.client, projectId, segmentId, item);
    const finalized = await finalizeAttempt(projectId, segmentId, attempt, prep.mediaSig);
    if (finalized.qcFailed) {
      updateSegmentGen(projectId, segmentId, { taskId: promptId, status: "qc_failed" });
      finishJob(
        projectId,
        jobId,
        "succeeded",
        `已生成视频；QC 未通过（${finalized.qc?.score ?? 0} 分）：${finalized.qc?.issues
          .filter((issue) => issue.level === "hard")
          .map((issue) => issue.message)
          .join("；")}`,
      );
      return {
        jobId,
        promptId,
        mode: prep.mode,
        refCount: prep.refCount,
        videoPath: finalized.target,
      };
    }
    try {
      await captureAndAdoptTail(projectId, segmentId);
    } catch {
      // 尾帧失败不影响视频落槽。
    }
    updateSegmentGen(projectId, segmentId, { taskId: promptId, status: "completed" });
    finishJob(projectId, jobId, "succeeded", "已生成视频");
    return {
      jobId,
      promptId,
      mode: prep.mode,
      refCount: prep.refCount,
      videoPath: finalized.target,
    };
  } catch (error) {
    const cancelled =
      segmentGenStatus(projectId, segmentId) === "cancelled" ||
      jobStatus(projectId, jobId) !== "running";
    const qcFailed = segmentGenStatus(projectId, segmentId) === "qc_failed";
    updateSegmentGen(projectId, segmentId, {
      status: cancelled ? "cancelled" : qcFailed ? "qc_failed" : "failed",
    });
    finishJob(projectId, jobId, "failed", cancelled ? "已取消" : (error as Error).message);
    throw error;
  }
}

/** 读取任务条状态；用于顺序执行期间判断整批是否已被取消。 */
function jobStatus(projectId: string, jobId: string): string | null {
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

export interface SequentialRunResult {
  jobId: string;
  total: number;
}

interface StoryboardEntry {
  scene: ReturnType<typeof getStoryboard>[number];
  segment: ReturnType<typeof getStoryboard>[number]["segments"][number];
  index: number;
  previous: ReturnType<typeof getStoryboard>[number]["segments"][number] | null;
  isFirstOfScene: boolean;
}

function storyboardEntries(projectId: string): StoryboardEntry[] {
  return getStoryboard(projectId).flatMap((scene) =>
    scene.segments.map((segment, index) => ({
      scene,
      segment,
      index,
      previous: index > 0 ? scene.segments[index - 1] : null,
      isFirstOfScene: index === 0,
    })),
  );
}

/**
 * 保证本段有起始画面：
 * - 连续段优先接上一段尾帧（不算出图费用）；
 * - autoStartFrames=true 时，硬切/场首/尾帧不可用才补一张 AI 首帧；
 * - 关闭时保持无首帧，直接走无关键帧生成（T2VA），避免额外费用。
 */
async function ensureSegmentStartFrame(
  projectId: string,
  entry: StoryboardEntry,
  autoStartFrames: boolean,
): Promise<void> {
  if (entry.segment.firstFrameId) {
    if (!entry.segment.stale) return;
    // 人工指定的起始画面永远不覆盖。
    if (entry.segment.firstFrameOrigin === "manual") return;
    const previous = entry.previous;
    const continuous =
      !entry.isFirstOfScene && !entry.segment.hardCut && Boolean(previous);
    // 自动来源的尾帧可以重新接上一段的新尾帧；这不算“补首帧”，
    // 即使关闭自动补帧也应生效。
    if (entry.segment.firstFrameOrigin === "auto" && continuous && previous) {
      const last = getFrames(projectId, previous.id).find(
        (frame) => frame.kind === "last",
      );
      if (last) {
        setSegmentFirstFrame(projectId, entry.segment.id, last.id, "auto");
        return;
      }
    }
    // 用户没有勾选自动补帧时，保留旧起始画面，避免静默删除锚点；
    // 勾选后才清掉过期画面并重新生成。
    if (!autoStartFrames) return;
    setSegmentFirstFrame(projectId, entry.segment.id, null, null);
  }
  if (!entry.isFirstOfScene && !entry.segment.hardCut && entry.previous) {
    const last = getFrames(projectId, entry.previous.id).find(
      (frame) => frame.kind === "last",
    );
    if (last) {
      setSegmentFirstFrame(projectId, entry.segment.id, last.id, "auto");
      return;
    }
  }
  if (!autoStartFrames) return;
  await generateSegmentStartFrame(projectId, entry.segment.id);
}

/**
 * 一键生成：整批一个任务，按场次/段顺序**逐段**生成（不并发）。
 * 每段出片后，若是连续段的上一段，自动截尾帧并接为下一段的起始画面。
 * 默认跳过已有视频的段落。
 */
export async function startSequentialVideoRun(
  projectId: string,
  opts?: { onlyMissing?: boolean; autoStartFrames?: boolean },
): Promise<SequentialRunResult> {
  assertH3Project(projectId);
  assertVideoGenerationConfigured();
  const onlyMissing = opts?.onlyMissing !== false;
  // 一键生成默认不自动补关键帧，避免静默产生出图费用；
  // 用户在分镜设置里勾选后，才为硬切/场首缺少起始画面的段落补图。
  // 连续段仍会直接接上一段尾帧，不产生额外出图费用。
  const autoStartFrames = opts?.autoStartFrames === true;
  const entries = storyboardEntries(projectId);
  const needsWork = (entry: StoryboardEntry) =>
    !entry.segment.videoPath || entry.segment.stale;
  const total = onlyMissing
    ? entries.filter(needsWork).length
    : entries.length;
  if (total === 0) {
    throw new Error("没有可生成的段落（可能都已有视频）");
  }
  const targets = onlyMissing ? entries.filter(needsWork) : entries;
  // 先把待生成段落标为排队中；后台逐段开始时再置为 running。
  markSegmentsQueued(
    projectId,
    targets.map((entry) => entry.segment.id),
  );
  const jobId = startJob(projectId, BATCH_JOB_KIND);
  void runSequentialJob(projectId, jobId, onlyMissing, entries, autoStartFrames);
  return { jobId, total };
}

async function runSequentialJob(
  projectId: string,
  jobId: string,
  onlyMissing: boolean,
  entries: StoryboardEntry[],
  autoStartFrames: boolean,
): Promise<void> {
  const settings = getGenerationSettings();
  const stopped = () => jobStatus(projectId, jobId) !== "running";

  let done = 0;
  let skipped = 0;
  let failed = 0;
  let qcFailedCount = 0;
  let frameWarnings = 0;
  let firstError: string | null = null;

  for (const entry of entries) {
    const segment = entry.segment;
    if (stopped()) {
      finishJob(projectId, jobId, "failed", "已取消");
      return;
    }
    if (onlyMissing && segment.videoPath && !segment.stale) {
      skipped += 1;
      continue;
    }

    // 起始画面：连续段优先接上一段尾帧；硬切/场首自动补一张。
    // 补帧失败不阻断出片——没有关键帧时仍可退化为无首帧生成，
    // 但会在任务摘要里明确提示。
    try {
      await ensureSegmentStartFrame(projectId, entry, autoStartFrames);
    } catch (error) {
      frameWarnings += 1;
      if (!firstError) firstError = `补首帧失败：${(error as Error).message}`;
    }

    // 单段失败自动重试一次（手动取消不重试）。
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (stopped()) {
        finishJob(projectId, jobId, "failed", "已取消");
        return;
      }
      try {
        const prep = await prepare(projectId, segment.id, settings);
        const promptId = await prep.client.queuePrompt(
          prep.workflow,
          prep.objectInfo,
        );
        recordSnapshot(projectId, segment.id, jobId, prep);
        updateSegmentGen(projectId, segment.id, { taskId: promptId, status: "running" });
        const item = await waitForVideo(prep.client, promptId, {
          intervalMs: 8_000,
          timeoutMs: settings.videoTimeoutMs,
          isCancelled: () =>
            stopped() || segmentGenStatus(projectId, segment.id) === "cancelled",
        });
        const attempt = await downloadToSegment(prep.client, projectId, segment.id, item);
        const finalized = await finalizeAttempt(
          projectId,
          segment.id,
          attempt,
          prep.mediaSig,
        );
        if (finalized.qcFailed) {
          updateSegmentGen(projectId, segment.id, {
            taskId: promptId,
            status: "qc_failed",
          });
          done += 1;
          qcFailedCount += 1;
          lastError = null;
          break;
        }
        updateSegmentGen(projectId, segment.id, { taskId: promptId, status: "completed" });
        done += 1;
        lastError = null;
        // 尾帧只服务下一段的连续性，失败不应让已完成的视频重跑。
        try {
          await captureAndAdoptTail(projectId, segment.id);
        } catch {
          // 忽略尾帧失败。
        }
        break;
      } catch (error) {
        const cancelled =
          stopped() || segmentGenStatus(projectId, segment.id) === "cancelled";
        if (cancelled) {
          updateSegmentGen(projectId, segment.id, { status: "cancelled" });
          finishJob(projectId, jobId, "failed", "已取消");
          return;
        }
        lastError = error as Error;
        if (attempt < 2) {
          updateSegmentGen(projectId, segment.id, { status: "retrying" });
          await new Promise((r) => setTimeout(r, 3_000));
        }
      }
    }
    if (lastError) {
      updateSegmentGen(projectId, segment.id, { status: "failed" });
      failed += 1;
      if (!firstError) firstError = lastError.message;
    }
  }

  const summary = `顺序生成完成：成功 ${done} 段${
    qcFailedCount ? `（QC 未通过 ${qcFailedCount} 段）` : ""
  }，跳过 ${skipped} 段${failed ? `，失败 ${failed} 段` : ""}${
    frameWarnings ? `，${frameWarnings} 段未补到首帧` : ""
  }${firstError ? `（首个错误：${firstError}）` : ""}`;
  finishJob(projectId, jobId, done > 0 ? "succeeded" : "failed", summary);
}

/**
 * 取消本项目正在排队/执行的视频生成。
 * 步骤：标记段落 gen_status=cancelled（后台轮询读到即停止）→ 结束任务条 → 尽力中断实例并清云端队列。
 * 任务条必须先结束：ComfyUI 可能已经连不上/卡住，不能让它阻塞取消，
 * 否则界面会一直显示「生成中」，用户也点不掉。
 */
export async function cancelProjectVideos(
  projectId: string,
): Promise<{ cancelled: number; jobs: number }> {
  const db = getProjectDb(projectId);
  // retrying 是顺序生成两次尝试之间的短暂状态，也必须能取消。
  const rows = db
    .prepare(
      "SELECT id, gen_task_id FROM segment WHERE project_id = ? AND gen_status IN ('queued','running','retrying')",
    )
    .all(projectId) as { id: string; gen_task_id: string | null }[];

  const promptIds = rows
    .map((r) => r.gen_task_id)
    .filter((v): v is string => !!v);

  for (const r of rows) {
    updateSegmentGen(projectId, r.id, {
      taskId: r.gen_task_id,
      status: "cancelled",
    });
  }

  // 无论有没有匹配到段，都要结束正在跑的任务条：服务重启后段状态可能已丢，
  // 但 job 还在，否则界面永远停不下来。
  const jobs =
    cancelRunningJobs(projectId, JOB_KIND, "已取消") +
    cancelRunningJobs(projectId, BATCH_JOB_KIND, "已取消");

  // 中断实例 + 清云端队列是尽力而为：网络失败不影响"已取消"的结果。
  if (rows.length > 0) {
    try {
      const settings = getGenerationSettings();
      if (settings.comfyUrl.trim()) {
        const client = makeClient(settings);
        await client.interrupt();
        if (promptIds.length) await client.queueDelete(promptIds);
      }
    } catch {
      // 引擎不可达/已崩溃：段已标记取消、任务条已结束，忽略。
    }
  }

  return { cancelled: rows.length, jobs };
}
