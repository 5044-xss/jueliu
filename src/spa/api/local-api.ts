import type { StoredFrame } from "@core/shared/frames";
import type { ComposableSegment, CompositionInfo } from "@core/shared/compose-shared";
import type { SegmentQcRecord } from "@core/shared/qc";
import { evaluateSegmentQc, type QcProbe } from "@core/shared/qc";
import { runPreflight } from "@core/shared/preflight";
import { SKILL_KINDS } from "@core/shared/library/skills";
import type { StoredAsset } from "@core/shared/schemas/assets";
import { CHARACTER_VIEW_SPEC } from "@core/shared/schemas/assets";
import type { ProjectDoc, ProjectRecord } from "../storage/types";
import { db } from "../storage/db";
import { jobRepository, toJobInfo } from "../storage/jobs";
import { mediaRepository } from "../storage/media";
import { projectRepository } from "../storage/projects";
import { libraryRepository } from "../storage/library";
import {
  getActiveLlmConfig,
  getConnection,
  getMaskedProviderSettings,
  getProviderSettings,
  saveProviderSettings,
} from "../storage/providers";
import { settingsRepository } from "../storage/settings";
import { buildSeriesArchive, importSeriesArchive } from "../storage/transfer";
import { generateScript } from "../workflow/story-to-script";
import { generateAssets } from "../workflow/script-to-assets";
import { generateStoryboard } from "../workflow/script-to-storyboard";
import { buildSegmentPrompt } from "../workflow/segment-prompt";
import {
  assetsFromDrafts,
  buildManifest,
  enrichStoryboardRefs,
  ensureDefaultViews,
  findAsset,
  findScene,
  findSegment,
  findShot,
  findVariantById,
  findViewById,
  newId,
  now,
  orchestrateProject,
  restoreAssets,
  seedAssetImagesFromLibrary,
} from "./helpers";
import {
  directMediaUrl,
  invalidateSegmentVideoUrls,
  mediaBlob,
  mediaResponse,
  resolveMediaPath,
} from "./media";
import { BUILTIN_SKILL_PROMPTS } from "@core/server/skills/prompts";
import { llmFetch } from "../llm/http";
import { isNativeMobile } from "../platform/runtime";
import { acquireScreenWakeLock } from "../platform/wake-lock";
import {
  maskApiKeyValue,
  resolveEndpoint,
  type ProviderConnection,
} from "@/lib/settings/providers";

interface RouteContext {
  url: URL;
  request: Request;
  method: string;
}

type Handler = (ctx: RouteContext, params: string[]) => Promise<Response> | Response;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function body<T = unknown>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function recordOf(projectId: string): Promise<ProjectRecord | null> {
  return projectRepository.getProject(projectId);
}

async function assertJobActive(jobId: string): Promise<void> {
  if (!(await jobRepository.isActive(jobId))) {
    throw new Error("任务已被新的生成取代或已取消，本次结果已丢弃");
  }
}

async function withJob(
  projectId: string,
  kind: string,
  run: (jobId: string) => Promise<Response>,
): Promise<Response> {
  const jobId = await jobRepository.startJob(projectId, kind);
  const stopHeartbeat = jobRepository.startHeartbeat(jobId);
  const releaseWakeLock = isNativeMobile()
    ? await acquireScreenWakeLock()
    : () => undefined;
  try {
    const response = await run(jobId);
    if (response.ok) {
      await jobRepository.finishJob(jobId, "succeeded");
    } else {
      const data = (await response
        .clone()
        .json()
        .catch(() => null)) as { error?: string } | null;
      await jobRepository.finishJob(
        jobId,
        "failed",
        data?.error || `执行失败（HTTP ${response.status}）`,
      );
    }
    return response;
  } catch (cause) {
    await jobRepository.finishJob(
      jobId,
      "failed",
      (cause as Error).message || "技能执行失败",
    );
    throw cause;
  } finally {
    stopHeartbeat();
    releaseWakeLock();
  }
}

async function saveDoc(doc: ProjectDoc): Promise<void> {
  await projectRepository.saveProject(doc);
}

function frameOf(doc: ProjectDoc, frameId: string): StoredFrame | undefined {
  return doc.frames?.find((frame) => frame.id === frameId);
}

function clearStoryboardState(doc: ProjectDoc): ProjectDoc {
  return {
    ...doc,
    storyboard: [],
    videoBindings: {},
    aiPrompts: {},
    frames: [],
    firstFrameIds: {},
    qc: {},
    refs: {},
    refUploads: {},
    mediaSigs: {},
    compositions: [],
  };
}

function clearAssetsState(doc: ProjectDoc): ProjectDoc {
  return {
    ...doc,
    assets: [],
    storyboard: [],
    videoBindings: {},
    aiPrompts: {},
    frames: [],
    firstFrameIds: {},
    qc: {},
    refs: {},
    refUploads: {},
    mediaSigs: {},
    compositions: [],
  };
}

function episodeThumbnail(doc: ProjectDoc): { segmentId: string } | null {
  for (const scene of doc.storyboard) {
    for (const segment of scene.segments) {
      if (doc.videoBindings?.[segment.id] || segment.videoPath) {
        return { segmentId: segment.id };
      }
    }
  }
  return null;
}

async function frameFromVideo(
  projectId: string,
  segmentId: string,
  kind: "first" | "last",
): Promise<StoredFrame> {
  const record = await recordOf(projectId);
  if (!record) throw new Error("项目不存在");
  const found = findSegment(record.doc, segmentId);
  if (!found) throw new Error("段落不存在");
  const mediaId = record.doc.videoBindings?.[segmentId] ?? found.segment.videoPath;
  if (!mediaId) throw new Error("该段尚未回传视频，无法截帧。");
  const media = await db.media.get(mediaId);
  if (!media) throw new Error("视频文件不存在，请重新回传。");
  const url = await directMediaUrl(media);
  if (!url) throw new Error("无法读取视频文件");
  const blob = await new Promise<Blob>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.crossOrigin = "anonymous";
    video.src = url;
    const fail = (message: string) => {
      video.remove();
      reject(new Error(message));
    };
    video.onerror = () => fail("视频解码失败，请换一个 mp4 文件");
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target = kind === "last" ? Math.max(0, duration - 0.06) : 0;
      const draw = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("无法创建画布");
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (result) => {
              video.remove();
              if (result) resolve(result);
              else reject(new Error("截帧失败"));
            },
            "image/png",
            0.92,
          );
        } catch (error) {
          fail((error as Error).message || "截帧失败");
        }
      };
      if (Math.abs(video.currentTime - target) < 0.01) {
        draw();
      } else {
        video.onseeked = draw;
        video.currentTime = target;
      }
    };
    setTimeout(() => fail("截帧超时，请重试"), 30_000);
  });
  const ext = blob.type.includes("jpeg") ? "jpg" : "png";
  const file = new File([blob], `${segmentId}-${kind}.${ext}`, {
    type: blob.type || "image/png",
  });
  const saved = await mediaRepository.put(projectId, file, "image");
  const doc = record.doc;
  const frame: StoredFrame = {
    id: newId(),
    segmentId,
    kind,
    imagePath: saved.id,
    confirmed: kind === "first",
    createdAt: now(),
    adoptedBy: null,
  };
  const frames = [
    ...(doc.frames ?? []).filter(
      (item) => !(item.segmentId === segmentId && item.kind === kind),
    ),
    frame,
  ];
  await saveDoc({ ...doc, frames });
  return frame;
}

function qcRecordFromResult(
  projectId: string,
  segmentId: string,
  probe: QcProbe,
  targetMs: number,
  shotCount: number,
  aspectRatio: string,
  attempt: number,
  videoPath: string | null,
): SegmentQcRecord {
  const result = evaluateSegmentQc(probe, {
    targetMs,
    shotCount,
    aspectRatio,
    durationTolerance: 0.3,
    aspectTolerance: 0.08,
  });
  return {
    id: newId(),
    projectId,
    segmentId,
    attempt,
    status: result.status,
    hardFail: result.hardFail,
    score: result.score,
    issues: result.issues,
    videoPath,
    createdAt: now(),
  };
}

async function probeDesktop(
  mediaId: string,
): Promise<{ probe: QcProbe; warning: string | null } | null> {
  const media = await db.media.get(mediaId);
  if (!media) return null;
  const api = window.desktopAPI?.qc;
  if (api && media.relativePath) {
    const result = await api.run({ relativePath: media.relativePath });
    return {
      probe: {
        decodable: result.ok,
        durationMs: result.durationMs,
        width: result.width,
        height: result.height,
        fps: result.fps,
        blackSegments: [],
        freezeSegments: [],
        detectedCuts: 0,
      },
      warning: result.error ?? (result.warnings.join("；") || null),
    };
  }
  const url = await directMediaUrl(media);
  if (!url) return null;
  const meta = await new Promise<{
    durationMs: number | null;
    width: number | null;
    height: number | null;
  } | null>((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    video.onloadedmetadata = () => {
      resolve({
        durationMs: Number.isFinite(video.duration)
          ? Math.round(video.duration * 1000)
          : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      });
      video.remove();
    };
    video.onerror = () => resolve(null);
    setTimeout(() => resolve(null), 15_000);
  });
  if (!meta) {
    return {
      probe: {
        decodable: false,
        durationMs: null,
        width: null,
        height: null,
        fps: null,
        blackSegments: [],
        freezeSegments: [],
        detectedCuts: 0,
      },
      warning: "浏览器无法读取视频元数据",
    };
  }
  return {
    probe: {
      decodable: true,
      durationMs: meta.durationMs,
      width: meta.width,
      height: meta.height,
      fps: null,
      blackSegments: [],
      freezeSegments: [],
      detectedCuts: 0,
    },
    warning: null,
  };
}

async function runQcForSegment(
  projectId: string,
  segmentId: string,
): Promise<SegmentQcRecord> {
  const record = await recordOf(projectId);
  if (!record) throw new Error("项目不存在");
  const found = findSegment(record.doc, segmentId);
  if (!found) throw new Error("段落不存在");
  const mediaId =
    record.doc.videoBindings?.[segmentId] ?? found.segment.videoPath;
  if (!mediaId) throw new Error("该段尚未回传视频，无法质检。");
  const probed = await probeDesktop(mediaId);
  if (!probed) throw new Error("视频文件不存在");
  const previous = record.doc.qc?.[segmentId];
  const qc = qcRecordFromResult(
    projectId,
    segmentId,
    {
      ...probed.probe,
      detectedCuts: Math.max(0, found.segment.shots.length - 1),
    },
    found.segment.targetMs,
    found.segment.shots.length,
    record.doc.project.aspectRatio,
    (previous?.attempt ?? 0) + 1,
    mediaId,
  );
  if (probed.warning && qc.issues.length === 0) {
    qc.issues = [
      {
        level: "soft",
        code: "decode",
        message: probed.warning,
      },
    ];
    qc.status = "needs_review";
    qc.score = Math.max(0, (qc.score ?? 100) - 5);
  }
  await saveDoc({
    ...record.doc,
    qc: { ...(record.doc.qc ?? {}), [segmentId]: qc },
  });
  return qc;
}

function segmentForCompose(
  doc: ProjectDoc,
  scene: ProjectDoc["storyboard"][number],
  segment: ProjectDoc["storyboard"][number]["segments"][number],
): ComposableSegment {
  const hasVideo = Boolean(
    doc.videoBindings?.[segment.id] || segment.videoPath,
  );
  return {
    segmentId: segment.id,
    sceneIndex: scene.sceneIndex,
    sceneSlug: scene.sceneSlug,
    index: segment.index,
    targetMs: segment.targetMs,
    status: segment.status,
    hardCut: segment.hardCut,
    linkMode: segment.linkMode,
    seamReason: segment.seamReason,
    hasVideo,
    stale: Boolean(segment.stale),
  };
}

async function cloneMediaForProject(
  sourceProjectId: string,
  targetProjectId: string,
): Promise<Map<string, string>> {
  const records = await db.media
    .where("projectId")
    .equals(sourceProjectId)
    .toArray();
  const map = new Map<string, string>();
  for (const record of records) {
    const blob = await mediaBlob(record);
    if (!blob) continue;
    const nextId = newId();
    await db.media.add({
      ...record,
      id: nextId,
      projectId: targetProjectId,
      storage: "indexeddb",
      relativePath: undefined,
      blob,
    });
    map.set(record.id, nextId);
  }
  return map;
}

function remapMediaRefs(
  doc: ProjectDoc,
  map: Map<string, string>,
): ProjectDoc {
  const remap = (id: string | null | undefined): string | null =>
    id ? (map.get(id) ?? id) : null;
  return {
    ...doc,
    videoBindings: Object.fromEntries(
      Object.entries(doc.videoBindings ?? {}).map(([key, value]) => [
        key,
        remap(value) ?? value,
      ]),
    ),
    assets: doc.assets.map((asset) => ({
      ...asset,
      variants: asset.variants.map((variant) => ({
        ...variant,
        views: variant.views.map((view) => ({
          ...view,
          imagePath: remap(view.imagePath),
        })),
      })),
    })),
    storyboard: doc.storyboard.map((scene) => ({
      ...scene,
      segments: scene.segments.map((segment) => ({
        ...segment,
        videoPath: remap(segment.videoPath),
        shots: segment.shots.map((shot) => ({
          ...shot,
          refs: shot.refs.map((ref) => ({
            ...ref,
            imagePath: remap(ref.imagePath),
          })),
        })),
      })),
    })),
    frames: (doc.frames ?? []).map((frame) => ({
      ...frame,
      imagePath: remap(frame.imagePath) ?? frame.imagePath,
    })),
    refUploads: Object.fromEntries(
      Object.entries(doc.refUploads ?? {}).map(([key, value]) => [
        key,
        remap(value) ?? value,
      ]),
    ),
    compositions: (doc.compositions ?? []).map((composition) => ({
      ...composition,
      mediaId: remap(composition.mediaId),
    })),
  };
}

async function resolveManifestUrls(
  manifest: ReturnType<typeof buildManifest>["manifest"],
  doc: ProjectDoc,
): Promise<ReturnType<typeof buildManifest>["manifest"]> {
  return Promise.all(
    manifest.map(async (item) => {
      let mediaId: string | null = item.imagePath;
      if (item.uploadId) mediaId = doc.refUploads?.[item.uploadId] ?? null;
      if (!mediaId) return item;
      const media = await db.media.get(mediaId);
      if (!media) return item;
      return { ...item, viewUrl: await directMediaUrl(media) };
    }),
  );
}

async function compilePromptText(
  doc: ProjectDoc,
  scene: ProjectDoc["storyboard"][number],
  segment: ProjectDoc["storyboard"][number]["segments"][number],
): Promise<string> {
  const text = buildSegmentPrompt({
    project: doc.project,
    scene,
    segment,
    assets: doc.assets,
  });
  return text;
}

function vendorForPreflight(
  vendors: Awaited<ReturnType<typeof libraryRepository.getVendors>>,
  vendorId: string,
) {
  return (
    vendors.find((vendor) => vendor.id === vendorId) ??
    vendors.find((vendor) => vendor.isDefault) ??
    vendors[0]
  );
}

function buildComposeCues(
  doc: ProjectDoc,
  segmentIds: string[],
): { startMs: number; endMs: number; text: string }[] {
  const cues: { startMs: number; endMs: number; text: string }[] = [];
  let cursor = 0;
  for (const id of segmentIds) {
    const found = findSegment(doc, id);
    if (!found) continue;
    const totalShotMs = found.segment.shots.reduce(
      (sum, shot) => sum + Math.max(0, shot.durationMs),
      0,
    );
    const segmentStart = cursor;
    const scale =
      totalShotMs > 0 ? found.segment.targetMs / totalShotMs : 1;
    let shotCursor = segmentStart;
    for (const shot of found.segment.shots) {
      const shotMs = Math.max(0, shot.durationMs) * scale;
      const lines = shot.dialogue.filter((line) => line.text.trim());
      lines.forEach((line, index) => {
        const start = shotCursor + (shotMs * index) / lines.length;
        const end = shotCursor + (shotMs * (index + 1)) / lines.length;
        cues.push({
          startMs: start,
          endMs: end,
          text: line.character ? `${line.character}：${line.text}` : line.text,
        });
      });
      shotCursor += shotMs;
    }
    cursor = segmentStart + found.segment.targetMs;
  }
  return cues;
}

function composeCanvas(aspectRatio: string): { width: number; height: number } {
  if (aspectRatio.includes("21:9")) return { width: 1680, height: 720 };
  if (aspectRatio.includes("16:9")) return { width: 1280, height: 720 };
  if (aspectRatio.includes("4:3")) return { width: 1024, height: 768 };
  if (aspectRatio.includes("3:4")) return { width: 768, height: 1024 };
  if (aspectRatio.includes("1:1")) return { width: 1080, height: 1080 };
  return { width: 720, height: 1280 };
}

export async function handleLocalApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/")) return null;
  const method = request.method.toUpperCase();

  try {
    if (path === "/api/jobs" && method === "GET") {
      const [seriesList, records] = await Promise.all([
        projectRepository.listSeries(),
        jobRepository.listRecentJobs(),
      ]);
      const projects = new Map<
        string,
        { episodeName: string; seriesId: string; seriesName: string }
      >();
      for (const series of seriesList) {
        for (const episode of series.episodes) {
          projects.set(episode.id, {
            episodeName: episode.name,
            seriesId: series.id,
            seriesName: series.name,
          });
        }
      }
      const keepMs = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const order: Record<string, number> = {
        running: 0,
        failed: 1,
        succeeded: 2,
      };
      const jobs = records
        .filter((record) => {
          if (record.status === "running") return true;
          if (!record.finishedAt) return false;
          const finishedAt = Date.parse(record.finishedAt);
          return Number.isFinite(finishedAt) && now - finishedAt <= keepMs;
        })
        .flatMap((record) => {
          const meta = projects.get(record.projectId);
          if (!meta) return [];
          return [
            {
              ...toJobInfo(record),
              projectId: record.projectId,
              ...meta,
            },
          ];
        })
        .sort(
          (a, b) =>
            (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
            b.startedAt.localeCompare(a.startedAt),
        )
        .slice(0, 40);
      return json({ jobs });
    }

    if (path === "/api/projects") {
      if (method === "GET") return json({ series: await projectRepository.listSeries() });
      if (method === "POST") {
        const payload = await body<{
          name?: string;
          style?: string;
          videoStyle?: string;
          styleId?: string | null;
          aspectRatio?: string;
        }>(request);
        if (!payload?.name?.trim()) return error("项目名不能为空");
        const series = await projectRepository.createSeries({
          name: payload.name,
          style: payload.style,
          videoStyle: payload.videoStyle,
          styleId: payload.styleId,
          aspectRatio: payload.aspectRatio,
        });
        return json({ series }, 201);
      }
    }

    if (path === "/api/projects/import" && method === "POST") {
      const blob = await request.blob();
      const file = new File([blob], "import.zip", {
        type: blob.type || "application/zip",
      });
      const series = await importSeriesArchive(file);
      return json({ series });
    }

    let match = path.match(/^\/api\/projects\/([^/]+)$/);
    if (match) {
      const projectId = match[1];
      const record = await recordOf(projectId);
      if (!record) return error("子集不存在", 404);
      if (method === "GET") return json({ project: record.doc.project });
      if (method === "PATCH") {
        const payload = await body<Record<string, unknown>>(request);
        if (!payload) return error("参数不合法");
        const project = record.doc.project;
        const touchingStyle =
          (payload.style !== undefined && payload.style !== project.style) ||
          (payload.styleId !== undefined &&
            (payload.styleId ?? null) !== project.styleId);
        if (touchingStyle && record.doc.assets.length > 0) {
          return error(
            "已按剧本生成资产，风格已锁定，不能再切换（避免素材风格串味）。如需换风格请新建项目。",
            409,
          );
        }
        const nextProject = {
          ...project,
          ...(typeof payload.name === "string" ? { name: payload.name } : {}),
          ...(typeof payload.style === "string" ? { style: payload.style } : {}),
          ...(typeof payload.videoStyle === "string"
            ? { videoStyle: payload.videoStyle }
            : {}),
          ...("styleId" in payload
            ? { styleId: payload.styleId as string | null }
            : {}),
          ...(typeof payload.aspectRatio === "string"
            ? { aspectRatio: payload.aspectRatio }
            : {}),
          ...(typeof payload.vendor === "string"
            ? { vendor: payload.vendor }
            : {}),
          ...(typeof payload.storyboardStrategyId === "string"
            ? { storyboardStrategyId: payload.storyboardStrategyId }
            : {}),
          updatedAt: now(),
        };
        const nextDoc = { ...record.doc, project: nextProject };
        await saveDoc(nextDoc);
        if (nextProject.vendor !== project.vendor) {
          await orchestrateProject({ ...record, doc: nextDoc });
        }
        return json({ project: nextProject });
      }
      if (method === "DELETE") {
        await mediaRepository.removeProject(projectId);
        await projectRepository.deleteProject(projectId);
        return json({ ok: true });
      }
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/copy$/);
    if (match && method === "POST") {
      const payload = await body<{ name?: string }>(request);
      const source = await recordOf(match[1]);
      if (!source) return error("项目不存在", 404);
      const copied = await projectRepository.copyProject(
        match[1],
        payload?.name?.trim() || `${source.name} 副本`,
      );
      const mediaMap = await cloneMediaForProject(match[1], copied.id);
      const sourceDoc = JSON.parse(JSON.stringify(source.doc)) as ProjectDoc;
      const doc = remapMediaRefs(
        {
          ...sourceDoc,
          project: {
            ...sourceDoc.project,
            id: copied.id,
            name: copied.name,
            createdAt: copied.doc.project.createdAt,
            updatedAt: copied.doc.project.updatedAt,
          },
          updatedAt: now(),
        },
        mediaMap,
      );
      await saveDoc(doc);
      return json({ project: doc.project }, 201);
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/story$/);
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      if (method === "GET") return json({ content: record.doc.story });
      if (method === "PUT") {
        const payload = await body<{ content?: string }>(request);
        if (typeof payload?.content !== "string") return error("参数不合法");
        await saveDoc({ ...record.doc, story: payload.content });
        return json({ ok: true });
      }
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/script$/);
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      if (method === "GET") return json({ script: record.doc.script });
      if (method === "DELETE") {
        await saveDoc(clearAssetsState({ ...record.doc, script: null }));
        return json({ ok: true });
      }
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/jobs$/);
    if (match && method === "GET") {
      const jobs = await jobRepository.listProjectJobs(match[1]);
      return json({ jobs });
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/assets$/);
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      if (method === "GET") return json({ assets: record.doc.assets });
      if (method === "PUT") {
        const payload = await body<{ assets?: unknown }>(request);
        if (!Array.isArray(payload?.assets)) return error("参数不合法");
        const assets = assetsFromDrafts(
          payload.assets as Parameters<typeof assetsFromDrafts>[0],
        );
        const next = {
          ...clearStoryboardState(record.doc),
          assets,
        };
        await saveDoc(next);
        const seeded = await seedAssetImagesFromLibrary({
          ...record,
          doc: next,
        });
        return json({ assets: seeded.assets });
      }
      if (method === "DELETE") {
        await saveDoc(clearAssetsState(record.doc));
        return json({ ok: true });
      }
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/assets\/ensure-views$/);
    if (match && method === "POST") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const payload = await body<{ type?: string }>(request);
      const { assets, changed } = ensureDefaultViews(
        record.doc.assets,
        payload?.type as never,
      );
      await saveDoc({ ...record.doc, assets });
      return json({ changed, assets });
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/assets\/restore$/);
    if (match && method === "POST") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const payload =
        (await body<{
          assetId?: string;
          variantId?: string;
          viewId?: string;
        }>(request)) ?? {};
      const assets = restoreAssets(record.doc.assets, payload);
      await saveDoc({ ...record.doc, assets });
      return json({ assets });
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/assets\/([^/]+)$/);
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const asset = findAsset(record.doc, match[2]);
      if (!asset) return error("资产不存在", 404);
      if (method === "PATCH") {
        const payload = await body<Record<string, unknown>>(request);
        const mode =
          typeof payload?.characterViewMode === "string"
            ? (payload.characterViewMode as StoredAsset["characterViewMode"])
            : null;
        const assets = record.doc.assets.map((item) => {
          if (item.id !== asset.id) return item;
          const next: StoredAsset = {
            ...item,
            ...(typeof payload?.name === "string"
              ? { name: payload.name }
              : {}),
            ...(typeof payload?.basePrompt === "string"
              ? { basePrompt: payload.basePrompt }
              : {}),
            ...(typeof payload?.interiorExterior === "string"
              ? { interiorExterior: payload.interiorExterior as never }
              : {}),
            ...(mode ? { characterViewMode: mode } : {}),
          };
          if (mode && item.type === "character") {
            const spec = CHARACTER_VIEW_SPEC[mode];
            next.variants = next.variants.map((variant) => ({
              ...variant,
              views: variant.views.map((view, index) =>
                index === 0
                  ? {
                      ...view,
                      label: spec.label,
                      kind: spec.kind,
                      originalLabel: spec.label,
                    }
                  : view,
              ),
            }));
          }
          return next;
        });
        await saveDoc({ ...record.doc, assets });
        return json({ ok: true });
      }
      if (method === "DELETE") {
        const assets = record.doc.assets.filter((item) => item.id !== asset.id);
        await saveDoc({ ...record.doc, assets });
        for (const variant of asset.variants) {
          for (const view of variant.views) {
            if (view.imagePath) {
              await mediaRepository
                .remove(view.imagePath)
                .catch(() => undefined);
            }
          }
        }
        return json({ ok: true });
      }
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/assets\/([^/]+)\/variants$/);
    if (match && method === "POST") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const asset = findAsset(record.doc, match[2]);
      if (!asset) return error("资产不存在", 404);
      const payload = await body<{ label?: string; prompt?: string }>(request);
      if (!payload?.label?.trim()) return error("参数不合法");
      const variant = {
        id: newId(),
        label: payload.label.trim(),
        prompt: payload.prompt ?? "",
        originalLabel: payload.label.trim(),
        originalPrompt: payload.prompt ?? "",
        views: [],
      };
      const assets = ensureDefaultViews(
        record.doc.assets.map((item) =>
          item.id === asset.id
            ? { ...item, variants: [...item.variants, variant] }
            : item,
        ),
      ).assets;
      await saveDoc({ ...record.doc, assets });
      return json({ asset: assets.find((item) => item.id === asset.id) });
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/assets\/variants\/([^/]+)$/,
    );
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const found = findVariantById(record.doc, match[2]);
      if (!found) return error("变体不存在", 404);
      if (method === "PATCH") {
        const payload = await body<{ label?: string; prompt?: string }>(request);
        const assets = record.doc.assets.map((asset) => ({
          ...asset,
          variants: asset.variants.map((variant) =>
            variant.id === found.variant.id
              ? {
                  ...variant,
                  ...(typeof payload?.label === "string"
                    ? { label: payload.label }
                    : {}),
                  ...(typeof payload?.prompt === "string"
                    ? { prompt: payload.prompt }
                    : {}),
                }
              : variant,
          ),
        }));
        await saveDoc({ ...record.doc, assets });
        return json({ ok: true });
      }
      if (method === "DELETE") {
        const assets = record.doc.assets.map((asset) => ({
          ...asset,
          variants: asset.variants.filter(
            (variant) => variant.id !== found.variant.id,
          ),
        }));
        await saveDoc({ ...record.doc, assets });
        return json({ ok: true });
      }
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/assets\/variants\/([^/]+)\/views$/,
    );
    if (match && method === "POST") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const found = findVariantById(record.doc, match[2]);
      if (!found) return error("变体不存在", 404);
      const payload = await body<{
        label?: string;
        prompt?: string;
        kind?: string;
      }>(request);
      if (!payload?.label?.trim()) return error("参数不合法");
      const view = {
        id: newId(),
        label: payload.label.trim(),
        prompt: payload.prompt ?? "",
        kind: (payload.kind ?? "detail") as never,
        imagePath: null,
        originalLabel: payload.label.trim(),
        originalPrompt: payload.prompt ?? "",
      };
      const assets = record.doc.assets.map((asset) => ({
        ...asset,
        variants: asset.variants.map((variant) =>
          variant.id === found.variant.id
            ? { ...variant, views: [...variant.views, view] }
            : variant,
        ),
      }));
      await saveDoc({ ...record.doc, assets });
      const next = assets
        .flatMap((asset) => asset.variants)
        .find((variant) => variant.id === found.variant.id);
      return json({ variant: next });
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/assets\/views\/([^/]+)$/);
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const found = findViewById(record.doc, match[2]);
      if (!found) return error("视角不存在", 404);
      if (method === "PATCH") {
        const payload = await body<{
          label?: string;
          prompt?: string;
          kind?: string;
        }>(request);
        const assets = record.doc.assets.map((asset) => ({
          ...asset,
          variants: asset.variants.map((variant) => ({
            ...variant,
            views: variant.views.map((view) =>
              view.id === found.view.id
                ? {
                    ...view,
                    ...(typeof payload?.label === "string"
                      ? { label: payload.label }
                      : {}),
                    ...(typeof payload?.prompt === "string"
                      ? { prompt: payload.prompt }
                      : {}),
                    ...(typeof payload?.kind === "string"
                      ? { kind: payload.kind as never }
                      : {}),
                  }
                : view,
            ),
          })),
        }));
        await saveDoc({ ...record.doc, assets });
        return json({ ok: true });
      }
      if (method === "DELETE") {
        const assets = record.doc.assets.map((asset) => ({
          ...asset,
          variants: asset.variants.map((variant) => ({
            ...variant,
            views: variant.views.filter((view) => view.id !== found.view.id),
          })),
        }));
        await saveDoc({ ...record.doc, assets });
        return json({ ok: true });
      }
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/assets\/views\/([^/]+)\/image$/,
    );
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const found = findViewById(record.doc, match[2]);
      if (!found) return error("视角不存在", 404);
      if (method === "GET") {
        const mediaId = found.view.imagePath;
        if (!mediaId) return error("图片不存在", 404);
        const media = await db.media.get(mediaId);
        if (!media) return error("图片不存在", 404);
        return mediaResponse(media, request);
      }
      if (method === "POST") {
        const form = await request.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File)) return error("缺少文件");
        const previous = found.view.imagePath;
        const saved = await mediaRepository.put(match[1], file, "image");
        const assets = record.doc.assets.map((asset) => ({
          ...asset,
          variants: asset.variants.map((variant) => ({
            ...variant,
            views: variant.views.map((view) =>
              view.id === found.view.id
                ? { ...view, imagePath: saved.id }
                : view,
            ),
          })),
        }));
        await saveDoc({ ...record.doc, assets });
        if (previous && previous !== saved.id) {
          await mediaRepository.remove(previous).catch(() => undefined);
        }
        return json({ imagePath: saved.id });
      }
      if (method === "DELETE") {
        const previous = found.view.imagePath;
        const assets = record.doc.assets.map((asset) => ({
          ...asset,
          variants: asset.variants.map((variant) => ({
            ...variant,
            views: variant.views.map((view) =>
              view.id === found.view.id ? { ...view, imagePath: null } : view,
            ),
          })),
        }));
        await saveDoc({ ...record.doc, assets });
        if (previous) await mediaRepository.remove(previous).catch(() => undefined);
        return json({ ok: true });
      }
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/storyboard$/);
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      if (method === "GET") {
        const vendors = await libraryRepository.getVendors();
        const vendor = vendorForPreflight(vendors, record.doc.project.vendor);
        const preflight = record.doc.storyboard.flatMap((scene) =>
          runPreflight({
            scene: { index: scene.sceneIndex, blocking: scene.blocking },
            segments: scene.segments,
            vendor,
            enforceErrors: false,
          }),
        );
        const qc = Object.values(record.doc.qc ?? {}).sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        );
        return json({ scenes: record.doc.storyboard, preflight, qc });
      }
      if (method === "DELETE") {
        await saveDoc(clearStoryboardState(record.doc));
        return json({ ok: true });
      }
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/orchestrate$/);
    if (match && method === "POST") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const payload = await body<{ vendor?: string }>(request);
      const next = payload?.vendor
        ? {
            ...record.doc,
            project: {
              ...record.doc.project,
              vendor: payload.vendor,
              updatedAt: now(),
            },
          }
        : record.doc;
      if (next !== record.doc) await saveDoc(next);
      const count = await orchestrateProject({ ...record, doc: next });
      return json({ segments: count });
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/segments\/([^/]+)\/frames$/,
    );
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const found = findSegment(record.doc, match[2]);
      if (!found) return error("段落不存在", 404);
      if (method === "GET") {
        return json({
          frames: (record.doc.frames ?? []).filter(
            (frame) => frame.segmentId === found.segment.id,
          ),
          videoPath:
            record.doc.videoBindings?.[found.segment.id] ??
            found.segment.videoPath,
          firstFrameId: found.segment.firstFrameId,
          status: found.segment.status,
        });
      }
      if (method === "POST") {
        const payload = await body<{ kind?: "first" | "last" }>(request);
        if (payload?.kind !== "first" && payload?.kind !== "last") {
          return error("参数不合法");
        }
        const frame = await frameFromVideo(
          match[1],
          found.segment.id,
          payload.kind,
        );
        return json({ frame });
      }
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/frames\/([^/]+)$/);
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const frame = frameOf(record.doc, match[2]);
      if (!frame) return error("帧不存在", 404);
      if (method === "PATCH") {
        const payload = await body<{ confirmed?: boolean }>(request);
        const frames = (record.doc.frames ?? []).map((item) =>
          item.id === frame.id
            ? { ...item, confirmed: payload?.confirmed === true }
            : item,
        );
        await saveDoc({ ...record.doc, frames });
        return json({ ok: true });
      }
      if (method === "DELETE") {
        const frames = (record.doc.frames ?? []).filter(
          (item) => item.id !== frame.id,
        );
        const storyboard = record.doc.storyboard.map((scene) => ({
          ...scene,
          segments: scene.segments.map((segment) => ({
            ...segment,
            firstFrameId:
              segment.firstFrameId === frame.id ? null : segment.firstFrameId,
            firstFrameOrigin:
              segment.firstFrameId === frame.id ? null : segment.firstFrameOrigin,
          })),
        }));
        await saveDoc({ ...record.doc, frames, storyboard });
        if (frame.imagePath) {
          await mediaRepository.remove(frame.imagePath).catch(() => undefined);
        }
        return json({ ok: true });
      }
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/frames\/([^/]+)\/image$/);
    if (match && method === "GET") {
      const record = await recordOf(match[1]);
      const frame = record ? frameOf(record.doc, match[2]) : null;
      if (!frame?.imagePath) return error("帧图不存在", 404);
      const media = await db.media.get(frame.imagePath);
      if (!media) return error("帧图不存在", 404);
      return mediaResponse(media, request);
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/segments\/([^/]+)\/first-frame$/,
    );
    if (match && method === "PUT") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const payload = await body<{ frameId?: string | null }>(request);
      const frameId = payload?.frameId ?? null;
      const storyboard = record.doc.storyboard.map((scene) => ({
        ...scene,
        segments: scene.segments.map((segment) =>
          segment.id === match![2]
            ? {
                ...segment,
                firstFrameId: frameId,
                firstFrameOrigin: frameId ? ("manual" as const) : null,
              }
            : segment,
        ),
      }));
      const frames = (record.doc.frames ?? []).map((frame) => ({
        ...frame,
        adoptedBy:
          frame.id === frameId
            ? { segmentId: match![2], origin: "manual" as const }
            : frame.adoptedBy?.segmentId === match![2]
              ? null
              : frame.adoptedBy,
      }));
      await saveDoc({ ...record.doc, storyboard, frames });
      return json({ ok: true });
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/segments\/([^/]+)\/first-frame-image$/,
    );
    if (match && method === "POST") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const found = findSegment(record.doc, match[2]);
      if (!found) return error("段落不存在", 404);
      const form = await request.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return error("缺少文件");
      if (!file.type.startsWith("image/")) return error("请上传图片文件");
      const saved = await mediaRepository.put(match[1], file, "image");
      const frame: StoredFrame = {
        id: newId(),
        segmentId: found.segment.id,
        kind: "start",
        imagePath: saved.id,
        confirmed: true,
        createdAt: now(),
        adoptedBy: {
          segmentId: found.segment.id,
          origin: "manual",
        },
      };
      const storyboard = record.doc.storyboard.map((scene) => ({
        ...scene,
        segments: scene.segments.map((segment) =>
          segment.id === found.segment.id
            ? {
                ...segment,
                firstFrameId: frame.id,
                firstFrameOrigin: "manual" as const,
              }
            : segment,
        ),
      }));
      const frames = [...(record.doc.frames ?? []), frame];
      await saveDoc({ ...record.doc, frames, storyboard });
      return json({ frame });
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/segments\/([^/]+)\/video$/,
    );
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const found = findSegment(record.doc, match[2]);
      if (!found) return error("段落不存在", 404);
      if (method === "GET") {
        const mediaId =
          record.doc.videoBindings?.[found.segment.id] ??
          found.segment.videoPath;
        if (!mediaId) return error("视频不存在", 404);
        const media = await db.media.get(mediaId);
        if (!media) return error("视频不存在", 404);
        return mediaResponse(media, request);
      }
      if (method === "POST") {
        const form = await request.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File)) return error("缺少文件");
        const saved = await mediaRepository.put(match[1], file, "video");
        const previous =
          record.doc.videoBindings?.[found.segment.id] ??
          found.segment.videoPath;
        const storyboard = record.doc.storyboard.map((scene) => ({
          ...scene,
          segments: scene.segments.map((segment) =>
            segment.id === found.segment.id
              ? {
                  ...segment,
                  videoPath: saved.id,
                  status: "returned" as const,
                  stale: false,
                  mediaSig: null,
                }
              : segment,
          ),
        }));
        const next: ProjectDoc = {
          ...record.doc,
          storyboard,
          videoBindings: {
            ...(record.doc.videoBindings ?? {}),
            [found.segment.id]: saved.id,
          },
        };
        await saveDoc(next);
        invalidateSegmentVideoUrls(match[1], found.segment.id);
        if (previous && previous !== saved.id) {
          await mediaRepository.remove(previous).catch(() => undefined);
        }
        let qc: SegmentQcRecord | null = null;
        try {
          qc = await runQcForSegment(match[1], found.segment.id);
        } catch {
          qc = null;
        }
        return json({
          videoPath: saved.id,
          status: "returned",
          tail: { captured: false },
          qc,
        });
      }
      if (method === "DELETE") {
        const previous =
          record.doc.videoBindings?.[found.segment.id] ??
          found.segment.videoPath;
        const storyboard = record.doc.storyboard.map((scene) => ({
          ...scene,
          segments: scene.segments.map((segment) =>
            segment.id === found.segment.id
              ? {
                  ...segment,
                  videoPath: null,
                  status: "generated" as const,
                  stale: false,
                }
              : segment,
          ),
        }));
        const bindings = { ...(record.doc.videoBindings ?? {}) };
        delete bindings[found.segment.id];
        await saveDoc({ ...record.doc, storyboard, videoBindings: bindings });
        invalidateSegmentVideoUrls(match[1], found.segment.id);
        if (previous) await mediaRepository.remove(previous).catch(() => undefined);
        return json({ ok: true });
      }
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/segments\/([^/]+)\/qc$/,
    );
    if (match) {
      if (method === "GET") {
        const record = await recordOf(match[1]);
        if (!record) return error("项目不存在", 404);
        return json({
          qc: record.doc.qc?.[match[2]] ?? null,
          all: Object.values(record.doc.qc ?? {}),
        });
      }
      if (method === "POST") {
        const qc = await runQcForSegment(match[1], match[2]);
        return json({ qc });
      }
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/segments\/([^/]+)\/refs$/,
    );
    if (match && method === "PATCH") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const payload = await body<{ refs?: unknown }>(request);
      const found = findSegment(record.doc, match[2]);
      if (!found) return error("段落不存在", 404);
      const refs = Array.isArray(payload?.refs)
        ? (payload.refs as never[])
        : null;
      const storyboard = record.doc.storyboard.map((scene) => ({
        ...scene,
        segments: scene.segments.map((segment) =>
          segment.id === found.segment.id
            ? { ...segment, refOverride: refs }
            : segment,
        ),
      }));
      await saveDoc({ ...record.doc, storyboard });
      return json({ ok: true });
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/segments\/([^/]+)\/ref-uploads$/,
    );
    if (match && method === "POST") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const form = await request.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return error("缺少文件");
      if (!file.type.startsWith("image/")) return error("请上传图片文件");
      if (file.size > 20 * 1024 * 1024) return error("图片不能超过 20MB");
      const saved = await mediaRepository.put(match[1], file, "image");
      const label =
        String(form?.get("label") ?? "").trim() || file.name || "本地参考图";
      await saveDoc({
        ...record.doc,
        refUploads: { ...(record.doc.refUploads ?? {}), [saved.id]: saved.id },
      });
      return json({
        upload: { id: saved.id, label, createdAt: saved.createdAt },
      });
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/segments\/([^/]+)\/ai-prompt$/,
    );
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      if (method === "GET") {
        const prompt = record.doc.aiPrompts?.[match[2]] ?? null;
        return json({ prompt, stale: false, cached: Boolean(prompt) });
      }
      if (method === "PATCH") {
        const payload = await body<{ prompt?: string }>(request);
        if (!payload?.prompt?.trim()) return error("提示词不能为空");
        await saveDoc({
          ...record.doc,
          aiPrompts: {
            ...(record.doc.aiPrompts ?? {}),
            [match[2]]: payload.prompt,
          },
        });
        return json({ prompt: payload.prompt });
      }
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/segments\/([^/]+)\/restore$/,
    );
    if (match && method === "POST") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const found = findSegment(record.doc, match[2]);
      if (!found) return error("段落不存在", 404);
      const storyboard = record.doc.storyboard.map((scene) => ({
        ...scene,
        segments: scene.segments.map((segment) =>
          segment.id === found.segment.id
            ? { ...segment, stale: false }
            : segment,
        ),
      }));
      await saveDoc({ ...record.doc, storyboard });
      return json({ ok: true });
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/segments\/([^/]+)\/regenerate$/,
    );
    if (match && method === "POST") {
      return error("当前本地版暂不支持单段 AI 重写，请在分镜页重新生成整份分镜。", 501);
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/segments\/([^/]+)\/repair$/,
    );
    if (match && method === "POST") {
      return error("当前本地版暂不支持 AI 修复，请手动调整分镜后重编译提示词。", 501);
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/segments\/([^/]+)$/);
    if (match && method === "PATCH") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const payload = await body<{ hardCut?: boolean; targetMs?: number }>(
        request,
      );
      const found = findSegment(record.doc, match[2]);
      if (!found) return error("段落不存在", 404);
      const storyboard = record.doc.storyboard.map((scene) => ({
        ...scene,
        segments: scene.segments.map((segment) =>
          segment.id === found.segment.id
            ? {
                ...segment,
                ...(typeof payload?.hardCut === "boolean"
                  ? {
                      hardCut: payload.hardCut,
                      linkMode: payload.hardCut ? "hard-cut" : segment.linkMode,
                    }
                  : {}),
                ...(typeof payload?.targetMs === "number"
                  ? { targetMs: payload.targetMs }
                  : {}),
              }
            : segment,
        ),
      }));
      await saveDoc({ ...record.doc, storyboard });
      return json({ ok: true });
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)$/);
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const found = findShot(record.doc, match[2]);
      if (!found) return error("分镜不存在", 404);
      if (method === "PATCH") {
        const payload = await body<Record<string, unknown>>(request);
        const original = (record.doc.shotOriginals ?? {})[found.shot.id];
        const shotOriginals = original
          ? record.doc.shotOriginals
          : { ...(record.doc.shotOriginals ?? {}), [found.shot.id]: found.shot };
        const storyboard = record.doc.storyboard.map((scene) => ({
          ...scene,
          segments: scene.segments.map((segment) => ({
            ...segment,
            shots: segment.shots.map((shot) =>
              shot.id === found.shot.id
                ? { ...shot, ...(payload ?? {}), hasOriginal: true }
                : shot,
            ),
          })),
        }));
        await saveDoc({ ...record.doc, storyboard, shotOriginals });
        return json({ ok: true });
      }
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/restore$/);
    if (match && method === "POST") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const original = (record.doc.shotOriginals ?? {})[match[2]];
      if (!original) return error("没有可还原的原始分镜", 400);
      const storyboard = record.doc.storyboard.map((scene) => ({
        ...scene,
        segments: scene.segments.map((segment) => ({
          ...segment,
          shots: segment.shots.map((shot) =>
            shot.id === original.id ? { ...original, hasOriginal: true } : shot,
          ),
        })),
      }));
      await saveDoc({ ...record.doc, storyboard });
      return json({ ok: true });
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/scenes\/([^/]+)$/);
    if (match && method === "PATCH") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const payload = await body<{ blocking?: unknown }>(request);
      const scene = findScene(record.doc, match[2]);
      if (!scene) return error("场次不存在", 404);
      const storyboard = record.doc.storyboard.map((item) =>
        item.sceneId === scene.sceneId
          ? { ...item, blocking: payload?.blocking as never }
          : item,
      );
      await saveDoc({ ...record.doc, storyboard });
      return json({ ok: true });
    }

    match = path.match(/^\/api\/projects\/([^/]+)\/compositions$/);
    if (match) {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      if (method === "GET") {
        const segments = record.doc.storyboard.flatMap((scene) =>
          scene.segments.map((segment) =>
            segmentForCompose(record.doc, scene, segment),
          ),
        );
        return json({
          segments,
          compositions: record.doc.compositions ?? [],
        });
      }
      if (method === "POST") {
        const payload = await body<{
          segmentIds?: string[];
          transition?: string;
          transitionMs?: number;
          subtitles?: boolean;
        }>(request);
        const ids = Array.isArray(payload?.segmentIds)
          ? payload.segmentIds
          : [];
        if (ids.length === 0) return error("请至少选择一个段落");
        const items: { relativePath: string }[] = [];
        for (const id of ids) {
          const found = findSegment(record.doc, id);
          if (!found) return error("段落不存在", 404);
          const mediaId =
            record.doc.videoBindings?.[id] ?? found.segment.videoPath;
          if (!mediaId) return error("请先回传所有选中段落的视频");
          const stored = await db.media.get(mediaId);
          if (!stored) {
            return error(
              window.desktopAPI
                ? "视频文件缺失，请重新回传"
                : "浏览器预览模式不支持合成导出，请在桌面客户端中使用",
            );
          }
          const media = await mediaRepository.ensureDesktopFile(stored);
          if (!media.relativePath) {
            return error(
              window.desktopAPI
                ? "视频文件缺失，请重新回传"
                : "浏览器预览模式不支持合成导出，请在桌面客户端中使用",
            );
          }
          items.push({ relativePath: media.relativePath });
        }
        const api = window.desktopAPI?.compose;
        if (!api) {
          return error("当前环境不支持合成导出，请在桌面客户端中使用");
        }
        const canvas = composeCanvas(record.doc.project.aspectRatio);
        const imported = await api.run({
          projectId: match[1],
          items,
          transition: payload?.transition ?? "none",
          transitionMs: payload?.transitionMs ?? 500,
          subtitles: payload?.subtitles === true,
          cues:
            payload?.subtitles === true
              ? buildComposeCues(record.doc, ids)
              : [],
          width: canvas.width,
          height: canvas.height,
        });
        const mediaRecord = {
          ...imported,
          projectId: match[1],
          kind: "video" as const,
          storage: "file" as const,
        };
        await mediaRepository.registerFile(mediaRecord);
        const composition: CompositionInfo & { mediaId: string } = {
          id: imported.id,
          name: imported.name,
          segmentIds: ids,
          transition: payload?.transition ?? "none",
          transitionMs: payload?.transitionMs ?? 500,
          subtitles: payload?.subtitles === true,
          status: "ready",
          error: null,
          durationMs: null,
          createdAt: imported.createdAt,
          hasExport: true,
          mediaId: imported.id,
        };
        await saveDoc({
          ...record.doc,
          compositions: [...(record.doc.compositions ?? []), composition],
        });
        return json({
          compositions: [...(record.doc.compositions ?? []), composition],
        });
      }
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/compositions\/([^/]+)$/,
    );
    if (match && method === "DELETE") {
      const record = await recordOf(match[1]);
      if (!record) return error("项目不存在", 404);
      const composition = (record.doc.compositions ?? []).find(
        (item) => item.id === match![2],
      );
      if (!composition) return error("成片不存在", 404);
      await saveDoc({
        ...record.doc,
        compositions: (record.doc.compositions ?? []).filter(
          (item) => item.id !== composition.id,
        ),
      });
      if (composition.mediaId) {
        await mediaRepository.remove(composition.mediaId).catch(() => undefined);
      }
      return json({ ok: true });
    }

    match = path.match(
      /^\/api\/projects\/([^/]+)\/compositions\/([^/]+)\/video$/,
    );
    if (match && method === "GET") {
      const record = await recordOf(match[1]);
      const composition = record?.doc.compositions?.find(
        (item) => item.id === match![2],
      );
      if (!composition?.mediaId) return error("成片不存在", 404);
      const media = await db.media.get(composition.mediaId);
      if (!media) return error("成片不存在", 404);
      return mediaResponse(media, request);
    }

    match = path.match(/^\/api\/series\/([^/]+)$/);
    if (match) {
      const series = await projectRepository.getSeries(match[1]);
      if (!series) return error("项目不存在", 404);
      if (method === "GET") {
        const episodes = await projectRepository.listEpisodes(match[1]);
        const enriched = [];
        for (const episode of episodes) {
          const record = await recordOf(episode.id);
          enriched.push({
            ...episode,
            thumbnail: record ? episodeThumbnail(record.doc) : null,
          });
        }
        return json({ series, episodes: enriched });
      }
      if (method === "PATCH") {
        const payload = await body<{ name?: string }>(request);
        if (!payload?.name?.trim()) return error("项目名不能为空");
        await projectRepository.renameSeries(match[1], payload.name);
        return json({ series: await projectRepository.getSeries(match[1]) });
      }
      if (method === "DELETE") {
        const episodes = await projectRepository.listEpisodes(match[1]);
        for (const episode of episodes) {
          await mediaRepository.removeProject(episode.id).catch(() => undefined);
        }
        await projectRepository.deleteSeries(match[1]);
        await libraryRepository
          .saveAssets("project", match[1], [])
          .catch(() => undefined);
        return json({ ok: true });
      }
    }

    match = path.match(/^\/api\/series\/([^/]+)\/copy$/);
    if (match && method === "POST") {
      const payload = await body<{ name?: string }>(request);
      const source = await projectRepository.getSeries(match[1]);
      if (!source) return error("项目不存在", 404);
      const copied = await projectRepository.createSeries({
        name: payload?.name?.trim() || `${source.name} 副本`,
        style: source.style,
        videoStyle: source.videoStyle,
        styleId: source.styleId,
        aspectRatio: source.aspectRatio,
      });
      const episodes = await projectRepository.listEpisodes(match[1]);
      const allMedia = new Map<string, string>();
      for (const episode of episodes) {
        const original = await recordOf(episode.id);
        if (!original) continue;
        const created = await projectRepository.createEpisode(copied.id, {
          name: episode.name,
          style: original.doc.project.style,
          videoStyle: original.doc.project.videoStyle,
          styleId: original.doc.project.styleId,
          aspectRatio: original.doc.project.aspectRatio,
          vendor: original.doc.project.vendor,
        });
        const mediaMap = await cloneMediaForProject(
          episode.id,
          created.id,
        );
        for (const [from, to] of mediaMap) allMedia.set(from, to);
        const cloned = JSON.parse(
          JSON.stringify(original.doc),
        ) as ProjectDoc;
        cloned.project = {
          ...cloned.project,
          id: created.id,
          name: episode.name,
          createdAt: created.doc.project.createdAt,
          updatedAt: now(),
        };
        cloned.updatedAt = now();
        await saveDoc(remapMediaRefs(cloned, mediaMap));
      }
      const libraryItems = await libraryRepository.listAssets(
        "project",
        match[1],
      );
      if (libraryItems.length > 0) {
        await libraryRepository.saveAssets(
          "project",
          copied.id,
          libraryItems.map((item) => ({
            ...item,
            id: `asset_${newId().replace(/-/g, "").slice(0, 12)}`,
            seriesId: copied.id,
            createdAt: now(),
            mediaId: item.mediaId
              ? (allMedia.get(item.mediaId) ?? item.mediaId)
              : item.mediaId,
          })),
        );
      }
      return json({ series: copied }, 201);
    }

    match = path.match(/^\/api\/series\/([^/]+)\/export$/);
    if (match && method === "GET") {
      const mode = url.searchParams.get("mode") === "full" ? "full" : "slim";
      const { blob, fileName } = await buildSeriesArchive(match[1], mode);
      return new Response(blob, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename=\"project.zip\"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "Cache-Control": "no-store",
        },
      });
    }

    match = path.match(/^\/api\/series\/([^/]+)\/episodes$/);
    if (match) {
      if (method === "GET") {
        return json({
          episodes: await projectRepository.listEpisodes(match[1]),
        });
      }
      if (method === "POST") {
        const payload = await body<{
          name?: string;
          style?: string;
          videoStyle?: string;
          styleId?: string | null;
          aspectRatio?: string;
        }>(request);
        if (!payload?.name?.trim()) return error("子集名不能为空");
        const created = await projectRepository.createEpisode(match[1], {
          name: payload.name,
          style: payload.style,
          videoStyle: payload.videoStyle,
          styleId: payload.styleId,
          aspectRatio: payload.aspectRatio,
        });
        return json({ project: created.doc.project }, 201);
      }
    }

    if (path === "/api/library/styles") {
      if (method === "GET") {
        return json({ styles: await libraryRepository.getStyles() });
      }
      if (method === "POST") {
        const payload = await body<{
          name?: string;
          prompt?: string;
          videoStyle?: string;
        }>(request);
        if (!payload?.name?.trim()) return error("名称不能为空");
        return json(
          { style: await libraryRepository.createStyle(payload as never) },
          201,
        );
      }
    }

    match = path.match(/^\/api\/library\/styles\/([^/]+)$/);
    if (match) {
      if (method === "PATCH") {
        const payload = await body<{
          name?: string;
          prompt?: string;
          videoStyle?: string;
        }>(request);
        const style = await libraryRepository.updateStyle(
          match[1],
          payload ?? {},
        );
        if (!style) return error("风格不存在", 404);
        return json({ style });
      }
      if (method === "DELETE") {
        const ok = await libraryRepository.deleteStyle(match[1]);
        if (!ok) return error("风格不存在", 404);
        return json({ ok: true });
      }
    }

    if (path === "/api/library/skills") {
      if (method === "GET") {
        const kinds = SKILL_KINDS.map((meta) => ({
          ...meta,
          defaultPrompt: BUILTIN_SKILL_PROMPTS[meta.kind] ?? "",
          inputSchema: null,
          outputSchema: null,
        }));
        return json({ skills: await libraryRepository.getSkills(), kinds });
      }
      if (method === "POST") {
        const payload = await body<{
          kind?: string;
          name?: string;
          prompt?: string;
        }>(request);
        if (!payload?.kind || !payload?.name?.trim()) return error("参数不合法");
        return json(
          { skill: await libraryRepository.createSkill(payload as never) },
          201,
        );
      }
    }

    match = path.match(/^\/api\/library\/skills\/([^/]+)$/);
    if (match) {
      if (method === "PATCH") {
        const payload = await body<{
          name?: string;
          prompt?: string;
          temperature?: number | null;
          isDefault?: boolean;
        }>(request);
        if (payload?.isDefault === true) {
          const skill = await libraryRepository.setDefaultSkill(match[1]);
          if (!skill) return error("技能不存在", 404);
          return json({ skill });
        }
        const skill = await libraryRepository.updateSkill(
          match[1],
          payload ?? {},
        );
        if (!skill) return error("技能不存在", 404);
        return json({ skill });
      }
      if (method === "DELETE") {
        const ok = await libraryRepository.deleteSkill(match[1]);
        if (!ok) return error("技能不存在或为内置技能", 400);
        return json({ ok: true });
      }
    }

    match = path.match(/^\/api\/library\/skills\/([^/]+)\/default$/);
    if (match && method === "POST") {
      const skill = await libraryRepository.setDefaultSkill(match[1]);
      if (!skill) return error("技能不存在", 404);
      return json({ skill });
    }

    if (path === "/api/library/vendors") {
      if (method === "GET") {
        return json({ vendors: await libraryRepository.getVendors() });
      }
      if (method === "POST") {
        const payload = await body<{ name?: string; platform?: string; note?: string }>(
          request,
        );
        if (!payload?.name?.trim()) return error("名称不能为空");
        return json(
          { vendor: await libraryRepository.createVendor(payload as never) },
          201,
        );
      }
    }

    match = path.match(/^\/api\/library\/vendors\/([^/]+)$/);
    if (match) {
      if (method === "PATCH") {
        const payload = await body<Record<string, unknown>>(request);
        if (payload?.isDefault === true) {
          const vendor = await libraryRepository.setDefaultVendor(match[1]);
          if (!vendor) return error("厂商不存在", 404);
          return json({ vendor });
        }
        const vendor = await libraryRepository.updateVendor(
          match[1],
          (payload ?? {}) as never,
        );
        if (!vendor) return error("厂商不存在", 404);
        return json({ vendor });
      }
      if (method === "DELETE") {
        const ok = await libraryRepository.deleteVendor(match[1]);
        if (!ok) return error("厂商不存在或为内置厂商", 400);
        return json({ ok: true });
      }
    }

    if (path === "/api/library/templates") {
      if (method === "GET") {
        return json({ templates: await libraryRepository.getTemplates() });
      }
      if (method === "POST") {
        return error("本地版暂不支持新增模板", 501);
      }
    }

    match = path.match(/^\/api\/library\/templates\/([^/]+)$/);
    if (match && method === "PATCH") {
      const payload = await body<Record<string, unknown>>(request);
      const template = await libraryRepository.updateTemplate(
        match[1],
        payload as never,
      );
      if (!template) return error("模板不存在", 404);
      return json({ template });
    }

    if (path === "/api/library/storyboard-strategies") {
      if (method === "GET") {
        return json({
          strategies: await libraryRepository.getStrategies(),
        });
      }
      if (method === "POST") {
        const payload = await body<{
          name?: string;
          description?: string;
          params?: Record<string, unknown>;
          texts?: Record<string, unknown>;
        }>(request);
        if (!payload?.name?.trim()) return error("名称不能为空");
        return json(
          {
            strategy: await libraryRepository.createStrategy(
              payload as never,
            ),
          },
          201,
        );
      }
    }

    match = path.match(/^\/api\/library\/storyboard-strategies\/([^/]+)$/);
    if (match) {
      if (method === "PATCH") {
        const payload = await body<Record<string, unknown>>(request);
        const strategy = await libraryRepository.updateStrategy(
          match[1],
          payload as never,
        );
        if (!strategy) return error("策略不存在", 404);
        return json({ strategy });
      }
      if (method === "DELETE") {
        const ok = await libraryRepository.deleteStrategy(match[1]);
        if (!ok) return error("策略不存在或为内置策略", 400);
        return json({ ok: true });
      }
    }

    if (path === "/api/library/assets") {
      const scope = url.searchParams.get("scope") === "project" ? "project" : "global";
      const seriesId = url.searchParams.get("seriesId");
      if (method === "GET") {
        if (scope === "project" && !seriesId) return error("缺少项目标识");
        const items = await libraryRepository.listAssets(scope, seriesId);
        const withNames = await Promise.all(
          items.map(async (item) => {
            if (scope !== "global" || !item.sourceSeriesId) return item;
            const source = await projectRepository.getSeries(
              item.sourceSeriesId,
            );
            return { ...item, sourceSeriesName: source?.name ?? null };
          }),
        );
        return json({ assets: withNames });
      }
      if (method === "POST") {
        const payload = await body<{
          scope?: "global" | "project";
          seriesId?: string;
          projectId?: string;
          viewId?: string;
        }>(request);
        if (!payload?.projectId || !payload?.viewId) return error("参数不合法");
        const targetScope = payload.scope === "project" ? "project" : "global";
        const targetSeriesId = targetScope === "project" ? payload.seriesId : null;
        if (targetScope === "project" && !targetSeriesId) {
          return error("缺少项目标识");
        }
        const record = await recordOf(payload.projectId);
        if (!record) return error("项目不存在", 404);
        const found = findViewById(record.doc, payload.viewId);
        if (!found) return error("视角不存在", 404);
        if (!found.view.imagePath) return error("该视角尚未回传图片");
        const items = await libraryRepository.listAssets(
          targetScope,
          targetSeriesId ?? null,
        );
        const variantLabel =
          found.asset.variants[0]?.id === found.variant.id
            ? null
            : found.variant.label;
        const prompt =
          found.asset.variants[0]?.id === found.variant.id
            ? found.asset.basePrompt
            : found.variant.prompt || found.asset.basePrompt;
        const existing = items.find(
          (item) =>
            item.sourceViewId === payload.viewId ||
            (!item.sourceViewId &&
              item.type === found.asset.type &&
              item.name === found.asset.name &&
              item.variantLabel === variantLabel &&
              item.prompt === prompt),
        );
        if (existing) {
          return error("该资产已在资产库中，无需重复添加", 409);
        }
        const sourceMedia = await db.media.get(found.view.imagePath);
        const blob = sourceMedia ? await mediaBlob(sourceMedia) : null;
        let libraryMediaId = found.view.imagePath;
        if (blob) {
          libraryMediaId = newId();
          await db.media.add({
            id: libraryMediaId,
            projectId: `library:${targetScope}`,
            kind: "image",
            name: `${found.asset.name}.png`,
            mime: sourceMedia?.mime || blob.type || "image/png",
            size: blob.size,
            createdAt: now(),
            storage: "indexeddb",
            blob,
            libraryScope: targetScope,
            librarySeriesId: targetSeriesId ?? null,
          });
        }
        const item = {
          id: `asset_${newId().replace(/-/g, "").slice(0, 12)}`,
          scope: targetScope,
          seriesId: targetSeriesId ?? null,
          type: found.asset.type,
          name: found.asset.name,
          variantLabel,
          prompt,
          fileName: `${libraryMediaId}.png`,
          createdAt: now(),
          sourceViewId: payload.viewId,
          sourceSeriesId:
            targetScope === "global" ? record.seriesId : null,
          mediaId: libraryMediaId,
        };
        await libraryRepository.saveAssets(targetScope, targetSeriesId ?? null, [
          ...items,
          item,
        ] as never);
        return json({ item }, 201);
      }
    }

    match = path.match(/^\/api\/library\/assets\/([^/]+)\/copy$/);
    if (match && method === "POST") {
      const payload = await body<{ seriesId?: string }>(request);
      if (!payload?.seriesId) return error("缺少项目标识");
      const source = (await libraryRepository.listAssets("global", null)).find(
        (item) => item.id === match![1],
      );
      if (!source) return error("全局资产不存在");
      const items = await libraryRepository.listAssets(
        "project",
        payload.seriesId,
      );
      const existing = items.find(
        (item) =>
          (source.sourceViewId && item.sourceViewId === source.sourceViewId) ||
          (!item.sourceViewId &&
            item.type === source.type &&
            item.name === source.name &&
            item.variantLabel === source.variantLabel &&
            item.prompt === source.prompt),
      );
      if (existing) return error("该项目资产库已有此资产", 409);
      const item = {
        ...source,
        id: `asset_${newId().replace(/-/g, "").slice(0, 12)}`,
        scope: "project" as const,
        seriesId: payload.seriesId,
        createdAt: now(),
      };
      await libraryRepository.saveAssets("project", payload.seriesId, [
        ...items,
        item,
      ] as never);
      return json({ item }, 201);
    }

    match = path.match(/^\/api\/library\/assets\/([^/]+)\/image$/);
    if (match && method === "GET") {
      const scope = url.searchParams.get("scope") === "project" ? "project" : "global";
      const seriesId = url.searchParams.get("seriesId");
      const item = (await libraryRepository.listAssets(scope, seriesId)).find(
        (entry) => entry.id === match![1],
      );
      if (!item?.mediaId) return error("资源不存在", 404);
      const media = await db.media.get(item.mediaId);
      if (!media) return error("图片不存在", 404);
      return mediaResponse(media, request);
    }

    match = path.match(/^\/api\/library\/assets\/([^/]+)$/);
    if (match && method === "DELETE") {
      const scope = url.searchParams.get("scope") === "project" ? "project" : "global";
      const seriesId = url.searchParams.get("seriesId");
      const items = await libraryRepository.listAssets(scope, seriesId);
      const next = items.filter((item) => item.id !== match![1]);
      if (next.length === items.length) return error("资源不存在", 404);
      await libraryRepository.saveAssets(scope, seriesId, next);
      return json({ ok: true });
    }

    if (path === "/api/skills/run" && method === "POST") {
      const payload = await body<{
        skillId?: string;
        projectId?: string;
        input?: Record<string, unknown>;
      }>(request);
      const skillId = payload?.skillId;
      const projectId = payload?.projectId;
      if (!skillId || !projectId) return error("参数不合法");
      const record = await recordOf(projectId);
      if (!record) return error("项目不存在", 404);
      const config = await getActiveLlmConfig();
      if (!config.apiKey.trim()) return error("请先在设置中填写 API Key");
      const input = payload?.input ?? {};
      try {
        if (skillId === "story-to-script") {
          return withJob(projectId, skillId, async (jobId) => {
            const activeSkill =
              await libraryRepository.getActiveSkill("story-to-script");
            const script = await generateScript({
              story: record.doc.story,
              style: record.doc.project.style,
              aspectRatio: record.doc.project.aspectRatio,
              extraInstructions: String(input.extraInstructions ?? ""),
              config,
              systemPrompt: activeSkill?.prompt,
              temperature: activeSkill?.temperature ?? undefined,
            });
            await assertJobActive(jobId);
            await saveDoc(
              clearStoryboardState({ ...clearAssetsState(record.doc), script }),
            );
            return json({ result: script, cleared: ["assets", "storyboard"] });
          });
        }
        if (skillId === "script-to-assets") {
          const script = record.doc.script;
          if (!script) return error("请先生成剧本");
          return withJob(projectId, skillId, async (jobId) => {
            const activeSkill =
              await libraryRepository.getActiveSkill("script-to-assets");
            const assets = await generateAssets({
              script,
              style: record.doc.project.style,
              extraInstructions: String(input.extraInstructions ?? ""),
              config,
              systemPrompt: activeSkill?.prompt,
              temperature: activeSkill?.temperature ?? undefined,
            });
            await assertJobActive(jobId);
            const next: ProjectDoc = {
              ...clearStoryboardState(record.doc),
              assets,
            };
            await saveDoc(next);
            const seeded = await seedAssetImagesFromLibrary({
              ...record,
              doc: next,
            });
            return json({ result: seeded.assets, cleared: ["storyboard"] });
          });
        }
        if (skillId === "script-to-storyboard") {
          const script = record.doc.script;
          if (!script) return error("请先生成剧本");
          return withJob(projectId, skillId, async (jobId) => {
            const strategies = await libraryRepository.getStrategies();
            const selectedStrategy =
              strategies.find(
                (item) =>
                  item.id ===
                  String(
                    input.strategyId ??
                      record.doc.project.storyboardStrategyId ??
                      "",
                  ),
              ) ??
              strategies.find((item) => item.isDefault) ??
              strategies[0];
            const activeSkill =
              await libraryRepository.getActiveSkill("script-to-storyboard");
            const storyboard = await generateStoryboard({
              script,
              assets: record.doc.assets,
              style: record.doc.project.style,
              aspectRatio: record.doc.project.aspectRatio,
              extraInstructions: String(input.extraInstructions ?? ""),
              config,
              systemPrompt: activeSkill?.prompt,
              temperature: activeSkill?.temperature ?? undefined,
              strategy: selectedStrategy
                ? {
                    params: selectedStrategy.params,
                    texts: selectedStrategy.texts,
                  }
                : undefined,
            });
            await assertJobActive(jobId);
            const rich = enrichStoryboardRefs(storyboard, record.doc.assets);
            const vendor = await libraryRepository.getVendor(
              record.doc.project.vendor,
            );
            const scenes = rich.map((scene) => ({
              ...scene,
              segments: scene.segments,
            }));
            const next: ProjectDoc = {
              ...clearStoryboardState(record.doc),
              project: {
                ...record.doc.project,
                storyboardStrategyId:
                  selectedStrategy?.id ??
                  record.doc.project.storyboardStrategyId ??
                  "universal",
                updatedAt: now(),
              },
              storyboard: scenes,
            };
            await saveDoc(next);
            const count = await orchestrateProject({ ...record, doc: next });
            const refreshed = (await recordOf(projectId))!;
            const outputShots = storyboard.reduce(
              (sum, scene) =>
                sum +
                scene.segments.reduce(
                  (inner, segment) => inner + segment.shots.length,
                  0,
                ),
              0,
            );
            const totalDurationMs = refreshed.doc.storyboard.reduce(
              (sum, scene) =>
                sum +
                scene.segments.reduce(
                  (inner, segment) => inner + segment.targetMs,
                  0,
                ),
              0,
            );
            return json({
              result: refreshed.doc.storyboard,
              strategy: {
                id: selectedStrategy?.id ?? "universal",
                name: selectedStrategy?.name ?? "通用",
                version: selectedStrategy?.version ?? 1,
              },
              assembly: { outputShots, totalDurationMs },
              orchestration: { segments: count, vendor: vendor?.id ?? null },
            });
          });
        }
        if (skillId === "storyboard-to-ai-prompt") {
          const segmentId = String(input.segmentId ?? "");
          const found = findSegment(record.doc, segmentId);
          if (!found) return error("段落不存在", 404);
          const text = await compilePromptText(
            record.doc,
            found.scene,
            found.segment,
          );
          await saveDoc({
            ...record.doc,
            aiPrompts: { ...(record.doc.aiPrompts ?? {}), [segmentId]: text },
          });
          return json({ result: text });
        }
        if (skillId === "storyboard-prompt-repair") {
          const currentPrompt = String(input.currentPrompt ?? "");
          const issue = String(input.issue ?? "").trim();
          if (!currentPrompt.trim() || !issue) return error("参数不合法");
          const response = await llmFetch(
            `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.apiKey}`,
              },
              body: JSON.stringify({
                model: config.model,
                temperature: 0.2,
                messages: [
                  {
                    role: "system",
                    content:
                      "你是视频提示词修复助手。只修改用户给出的提示词，保留原有结构与信息，只解决用户指出的问题。直接输出修改后的完整提示词，不要解释。",
                  },
                  {
                    role: "user",
                    content: `【当前提示词】\n${currentPrompt}\n\n【需要修改】\n${issue}`,
                  },
                ],
              }),
            },
          );
          if (!response.ok) {
            return error(`提示词修改失败（HTTP ${response.status}）`, 500);
          }
          const data = (await response.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          return json({ result: data.choices?.[0]?.message?.content ?? "" });
        }
        return error("技能不存在", 404);
      } catch (cause) {
        return error((cause as Error).message || "技能执行失败", 500);
      }
    }

    if (path === "/api/render/platform" && method === "POST") {
      const payload = await body<{
        projectId?: string;
        segmentId?: string;
        platform?: string;
        keyframeOnly?: boolean;
      }>(request);
      if (!payload?.projectId || !payload.segmentId) return error("参数不合法");
      const record = await recordOf(payload.projectId);
      if (!record) return error("项目不存在", 404);
      const found = findSegment(record.doc, payload.segmentId);
      if (!found) return error("段落不存在", 404);
      const keyframeOnly =
        payload.keyframeOnly === true ||
        found.segment.shots.length === 0;
      const built = buildManifest(
        record.doc,
        found.segment,
        found.scene,
        keyframeOnly,
      );
      const manifest = await resolveManifestUrls(built.manifest, record.doc);
      const bodyText = buildSegmentPrompt({
        project: record.doc.project,
        scene: found.scene,
        segment: found.segment,
        assets: record.doc.assets,
      });
      const items = manifest
        .map(
          (item) =>
            `图${item.slot}：${item.label}${item.viewUrl ? "" : "（缺失）"}`,
        )
        .join("\n");
      return json({
        platform: payload.platform ?? "h3",
        body: bodyText,
        legend: items,
        params: `画面比例：${record.doc.project.aspectRatio}\n段时长：约 ${(found.segment.targetMs / 1000).toFixed(1)} 秒`,
        manifest,
        shotCount: found.segment.shots.length,
      });
    }

    if (path === "/api/settings") {
      if (method === "GET") {
        const legacy =
          (await settingsRepository.get<Record<string, unknown>>("global")) ??
          {};
        const llm = await getActiveLlmConfig();
        const maskedKey = llm.apiKey
          ? llm.apiKey.length <= 8
            ? "*".repeat(llm.apiKey.length)
            : `${llm.apiKey.slice(0, 4)}${"*".repeat(Math.min(8, llm.apiKey.length - 8))}${llm.apiKey.slice(-4)}`
          : "";
        return json({
          settings: {
            llm: {
              provider: "custom",
              baseURL: llm.baseUrl,
              apiKey: maskedKey,
              model: llm.model,
              temperature: llm.temperature,
            },
            ffmpeg: {
              path: String((legacy.ffmpeg as { path?: string })?.path ?? ""),
            },
            autoGenerateAiPrompt:
              (legacy.autoGenerateAiPrompt as boolean | undefined) ?? true,
          },
          ffmpeg: {
            available: Boolean(window.desktopAPI),
            path: "",
            version: undefined,
          },
          presets: {},
        });
      }
      if (method === "PUT") {
        const payload = await body<{
          ffmpeg?: { path?: string };
          autoGenerateAiPrompt?: boolean;
        }>(request);
        const legacy =
          (await settingsRepository.get<Record<string, unknown>>("global")) ??
          {};
        await settingsRepository.set("global", {
          ...legacy,
          ffmpeg: {
            path: payload?.ffmpeg?.path ?? (legacy.ffmpeg as { path?: string })?.path ?? "",
          },
          autoGenerateAiPrompt:
            payload?.autoGenerateAiPrompt ??
            (legacy.autoGenerateAiPrompt as boolean | undefined) ??
            true,
        });
        return json({ settings: payload, ffmpeg: { available: true, path: "" } });
      }
    }

    if (path === "/api/settings/providers") {
      if (method === "GET") {
        return json({ settings: await getMaskedProviderSettings() });
      }
      if (method === "PUT") {
        const payload = await body<{ settings?: never }>(request);
        if (!payload?.settings) return error("参数不合法");
        const saved = await saveProviderSettings(payload.settings);
        return json({ settings: await getMaskedProviderSettings(), saved });
      }
    }

    if (path === "/api/settings/providers/test" && method === "POST") {
      const payload = await body<{
        connectionId?: string;
        connection?: {
          id?: string;
          type?: string;
          apiKey?: string;
          baseUrls?: Record<string, string>;
          models?: string[];
          modelsByCapability?: Record<string, string[]>;
        };
      }>(request);
      const settings = await getProviderSettings();
      let conn: ProviderConnection | undefined = payload?.connection as
        | ProviderConnection
        | undefined;
      if (conn?.id) {
        const saved = await getConnection(conn.id);
        if (saved) {
          conn = {
            ...conn,
            apiKey:
              conn.apiKey?.trim() &&
              conn.apiKey.trim() !== maskApiKeyValue(saved.apiKey)
                ? conn.apiKey
                : saved.apiKey,
          };
        }
      } else if (payload?.connectionId) {
        conn = await getConnection(payload.connectionId);
      }
      if (!conn) return error("连接不存在", 404);
      void settings;
      const baseUrl = resolveEndpoint(conn, "llm");
      if (!baseUrl) return error("未填写接口地址");
      if (!conn.apiKey?.trim()) {
        return json({
          connectionId: conn.id,
          results: {
            llm: { ok: false, implemented: true, message: "未填写 API Key" },
          },
        });
      }
      try {
        const res = await llmFetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
          headers: { Authorization: `Bearer ${conn.apiKey.trim()}` },
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 404 || res.status === 405) {
          return json({
            connectionId: conn.id,
            results: {
              llm: {
                ok: true,
                implemented: true,
                message: "服务可达 · 该网关不支持 /models（未发起计费请求）",
              },
            },
          });
        }
        if (!res.ok) {
          return json({
            connectionId: conn.id,
            results: {
              llm: {
                ok: false,
                implemented: true,
                message: `HTTP ${res.status}`,
              },
            },
          });
        }
        return json({
          connectionId: conn.id,
          results: {
            llm: { ok: true, implemented: true, message: "连接成功" },
          },
        });
      } catch (error) {
        return json({
          connectionId: conn.id,
          results: {
            llm: {
              ok: false,
              implemented: true,
              message: (error as Error).message || "连接失败",
            },
          },
        });
      }
    }

    if (path === "/api/system/ffmpeg" && method === "POST") {
      return json({
        available: Boolean(window.desktopAPI),
        path: "",
        error: window.desktopAPI ? undefined : "浏览器预览模式不支持 ffmpeg",
      });
    }

    if (path === "/api/clipboard/images" && method === "POST") {
      return error("当前环境暂不支持批量复制参考图到剪贴板", 501);
    }

    if (path.startsWith("/api/projects/")) {
      match = path.match(/^\/api\/projects\/([^/]+)\/pipeline-trace$/);
      if (match && method === "GET") return json({ trace: [] });
    }

    return null;
  } catch (cause) {
    const message = (cause as Error)?.message || "操作失败";
    return error(message, 500);
  }
}

export async function maybeServeMedia(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  const record = await resolveMediaPath(url.pathname, url.searchParams);
  if (!record) return null;
  return mediaResponse(record, request);
}

export type { Handler };
