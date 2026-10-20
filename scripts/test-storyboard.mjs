/**
 * 分镜链路自动化冒烟测试（HTTP 级，直接打运行中的 Next 服务）。
 *
 * 覆盖：
 *  1. 分镜数据完整性（场/段/镜/引用/站位/帧/视频文件）
 *  2. 编辑镜 → 视频「已过期」→ 还原（media_sig 口径）
 *  3. 切换厂商（h3 → doubao → h3）后镜不丢、视频可还原
 *  4. 视频回传 / 尾帧自动接下一段 / 删除回传
 *  5. 可选：真实提交一段视频生成 → 生成中禁止编排 → 等完成并校验产物（--with-generation）
 *     或提交后取消（--cancel-generation，更快，只验证取消链路）
 *
 * 用法：
 *   node scripts/test-storyboard.mjs [projectId] [--base=http://127.0.0.1:3000] [--with-generation|--cancel-generation]
 *
 * 默认使用「第二集(自动化测试)」，除第 5 项外都可重复执行并自动还原测试改动。
 */

const BASE = (process.argv.find((a) => a.startsWith("--base=")) ?? "").slice(7) ||
  process.env.BASE_URL ||
  "http://127.0.0.1:3000";
const CANCEL_GENERATION = process.argv.includes("--cancel-generation");
const WITH_GENERATION =
  process.argv.includes("--with-generation") || CANCEL_GENERATION;
const DEFAULT_PROJECT_ID = "5393133f-5f6e-45a1-80e4-b58da0769852";
const PROJECT_ID =
  process.argv.find((a) => a.startsWith("--project="))?.slice(10) ||
  process.env.PROJECT_ID ||
  DEFAULT_PROJECT_ID;

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, name, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } else {
    failed += 1;
    failures.push(detail ? `${name} (${detail})` : name);
    console.log(`  [FAIL] ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

function eq(actual, expected, name) {
  check(
    Object.is(actual, expected),
    name,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function enc(value) {
  return encodeURIComponent(value);
}

async function request(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // 非 JSON 响应保留 text
  }
  return { res, json, text };
}

async function getJson(path) {
  const { res, json, text } = await request(path);
  if (!res.ok) {
    throw new Error(`GET ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

async function sendJson(method, path, body) {
  const { res, json, text } = await request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { res, json, text };
}

function projectPath(suffix) {
  return `/api/projects/${enc(PROJECT_ID)}${suffix}`;
}

function allSegments(storyboard) {
  return storyboard.scenes.flatMap((scene) =>
    scene.segments.map((segment) => ({ scene, segment })),
  );
}

function allShots(storyboard) {
  return allSegments(storyboard).flatMap(({ segment }) => segment.shots);
}

function findSegment(storyboard, segmentId) {
  return allSegments(storyboard).find((x) => x.segment.id === segmentId) ?? null;
}

function findShot(storyboard, shotId) {
  for (const { segment } of allSegments(storyboard)) {
    const shot = segment.shots.find((s) => s.id === shotId);
    if (shot) return { shot, segment };
  }
  return null;
}

async function loadStoryboard() {
  const data = await getJson(projectPath("/storyboard"));
  if (!Array.isArray(data.scenes)) throw new Error("分镜响应缺少 scenes");
  return data;
}

async function loadJobs() {
  const data = await getJson(projectPath("/jobs"));
  return data.jobs ?? [];
}

async function videoProbe(segmentId) {
  const res = await fetch(
    `${BASE}${projectPath(`/segments/${enc(segmentId)}/video`)}`,
    { headers: { Range: "bytes=0-0" } },
  );
  try {
    await res.body?.cancel();
  } catch {
    // 忽略
  }
  return {
    ok: res.ok && (res.status === 200 || res.status === 206),
    status: res.status,
    contentRange: res.headers.get("content-range"),
  };
}

async function videoBuffer(segmentId) {
  const res = await fetch(
    `${BASE}${projectPath(`/segments/${enc(segmentId)}/video`)}`,
  );
  if (!res.ok) throw new Error(`读取源视频失败：HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function framesOf(segmentId) {
  const data = await getJson(projectPath(`/segments/${enc(segmentId)}/frames`));
  return data.frames ?? [];
}

function sumDurations(segment) {
  return segment.shots.reduce((sum, shot) => sum + shot.durationMs, 0);
}

function signatures(storyboard) {
  return {
    shotIds: allShots(storyboard).map((s) => s.id).sort(),
    perSceneShots: storyboard.scenes.map((scene) =>
      scene.segments.map((segment) => segment.shots.map((s) => s.id)),
    ),
    videoShotIds: allSegments(storyboard)
      .filter((x) => x.segment.videoPath)
      .map((x) => x.segment.shots[0]?.id)
      .filter(Boolean)
      .sort(),
    autoFirstShotIds: allSegments(storyboard)
      .filter((x) => x.segment.firstFrameOrigin === "auto")
      .map((x) => x.segment.shots[0]?.id)
      .filter(Boolean)
      .sort(),
  };
}

async function waitFor(predicate, { timeoutMs = 180_000, intervalMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function testIntegrity(settings) {
  section("1. Environment & storyboard integrity");

  const project = await getJson(projectPath(""));
  eq(project.project?.id, PROJECT_ID, "project exists");
  eq(project.project?.vendor, "h3", "project vendor is h3");
  check(
    typeof settings.settings?.videoTimeoutMs === "number" &&
      settings.settings.videoTimeoutMs >= 600_000,
    "videoTimeoutMs exists and is >= 10 min",
    String(settings.settings?.videoTimeoutMs),
  );

  const jobs = await loadJobs();
  const runningGeneration = jobs.filter(
    (job) =>
      job.status === "running" &&
      ["gen-image", "gen-video", "gen-videos"].includes(job.kind),
  );
  check(
    runningGeneration.length === 0,
    "no running image/video generation jobs",
    runningGeneration.map((j) => j.kind).join(","),
  );

  const storyboard = await loadStoryboard();
  check(storyboard.scenes.length > 0, "has scenes");
  const segments = allSegments(storyboard);
  const shots = allShots(storyboard);
  check(segments.length > 0, "has segments");
  check(shots.length > 0, "has shots");

  const shotIds = shots.map((s) => s.id);
  eq(new Set(shotIds).size, shotIds.length, "shot ids are unique");
  const segmentIds = segments.map((x) => x.segment.id);
  eq(new Set(segmentIds).size, segmentIds.length, "segment ids are unique");

  for (const scene of storyboard.scenes) {
    const label = `scene ${scene.sceneIndex}`;
    check(scene.segments.length > 0, `${label} has segments`);
    eq(scene.segments[0]?.hardCut, true, `${label} first segment is hard cut`);
    scene.segments.forEach((segment, index) => {
      eq(segment.index, index + 1, `${label} segment ${segment.id.slice(0, 8)} index`);
      check(segment.shots.length > 0, `${label} segment ${index + 1} has shots`);
      check(segment.targetMs > 0, `${label} segment ${index + 1} targetMs > 0`);
      eq(
        sumDurations(segment),
        segment.targetMs,
        `${label} segment ${index + 1} shot durations sum to target`,
      );
      segment.shots.forEach((shot, shotIndex) => {
        eq(shot.index, shotIndex, `${label} segment ${index + 1} shot index`);
        check(shot.durationMs > 0, `${label} segment ${index + 1} shot duration > 0`);
        check(
          shot.camera && typeof shot.camera === "object",
          `${label} segment ${index + 1} shot camera object`,
        );
        check(
          shot.dialogue.every((line) => line.text.trim().length > 0),
          `${label} segment ${index + 1} dialogue text non-empty`,
        );
        if (shot.dialogue.length) {
          check(
            shot.dialogue.every((line) => line.character.trim().length > 0),
            `${label} segment ${index + 1} dialogue has speaker`,
          );
        }
      });
    });

    const nodeIds = new Set((scene.blocking?.nodes ?? []).map((n) => n.id));
    check(Boolean(scene.blocking), `${label} has blocking`);
    if (scene.blocking) {
      check(
        nodeIds.has(scene.blocking.axis.from) && nodeIds.has(scene.blocking.axis.to),
        `${label} axis endpoints exist`,
      );
      check(
        scene.blocking.cameraSide === "left" || scene.blocking.cameraSide === "right",
        `${label} cameraSide valid`,
      );
    }
    for (const shot of scene.segments.flatMap((s) => s.shots)) {
      check(
        shot.subjectNodeIds.every((id) => nodeIds.has(id)),
        `${label} shot subjects resolve to blocking nodes`,
        shot.subjectNodeIds.filter((id) => !nodeIds.has(id)).join(","),
      );
    }
  }

  const refs = shots.flatMap((shot) => shot.refs);
  check(refs.length > 0, "has shot refs");
  check(
    refs.every((ref) => ["character", "scene", "prop"].includes(ref.role)),
    "ref roles valid",
  );
  check(
    refs.every((ref) => Boolean(ref.viewId)),
    "every ref resolves to a view",
    String(refs.filter((r) => !r.viewId).length),
  );
  check(
    refs.every((ref) => Boolean(ref.assetId) && Boolean(ref.imagePath)),
    "every ref has asset + image path",
  );

  const viewIds = [...new Set(refs.map((ref) => ref.viewId).filter(Boolean))];
  for (const viewId of viewIds) {
    const res = await fetch(
      `${BASE}/api/projects/${enc(PROJECT_ID)}/assets/views/${enc(viewId)}/image`,
    );
    try {
      await res.body?.cancel();
    } catch {
      // 忽略
    }
    check(res.ok, `view image ${viewId.slice(0, 8)} serves`, `HTTP ${res.status}`);
  }

  const videoSegments = segments.filter((x) => x.segment.videoPath);
  check(videoSegments.length > 0, "has generated/returned videos");
  for (const { segment } of videoSegments) {
    check(
      Boolean(segment.mediaSig),
      `video segment ${segment.id.slice(0, 8)} has media signature`,
    );
    check(
      segment.stale === false,
      `video segment ${segment.id.slice(0, 8)} is not stale`,
    );
    const probe = await videoProbe(segment.id);
    check(
      probe.ok,
      `video segment ${segment.id.slice(0, 8)} file serves`,
      `HTTP ${probe.status}`,
    );
  }

  const framesBySegment = new Map();
  const allFrameIds = new Set();
  for (const { segment } of segments) {
    const frames = await framesOf(segment.id);
    framesBySegment.set(segment.id, frames);
    frames.forEach((frame) => allFrameIds.add(frame.id));
  }
  for (const { segment } of segments) {
    if (!segment.firstFrameId) continue;
    check(
      allFrameIds.has(segment.firstFrameId),
      `segment ${segment.id.slice(0, 8)} first frame exists`,
    );
    check(
      ["auto", "manual"].includes(segment.firstFrameOrigin),
      `segment ${segment.id.slice(0, 8)} first frame origin valid`,
    );
  }

  console.log(
    `  summary: ${storyboard.scenes.length} scenes, ${segments.length} segments, ${shots.length} shots, ${videoSegments.length} videos`,
  );
  return { storyboard, framesBySegment };
}

async function testEditAndStale(storyboard) {
  section("2. Edit shot -> stale -> restore");

  const entry = allSegments(storyboard).find(
    ({ segment }) => segment.videoPath && segment.stale === false && segment.shots[0],
  );
  if (!entry) {
    check(false, "found a non-stale video segment to edit");
    return;
  }
  const { segment } = entry;
  const shot = segment.shots[0];
  const originalAction = shot.action;
  const originalSig = segment.mediaSig;
  const originalHardCuts = storyboard.scenes.map((scene) =>
    scene.segments.map((s) => s.hardCut),
  );
  check(true, `using segment ${segment.id.slice(0, 8)} / shot ${shot.id.slice(0, 8)}`);

  try {
    const patched = await sendJson(
      "PATCH",
      projectPath(`/shots/${enc(shot.id)}`),
      { action: `${originalAction} [AUTO-TEST]` },
    );
    check(patched.res.ok, "patch shot action", `HTTP ${patched.res.status}`);

    const afterEdit = await loadStoryboard();
    const edited = findShot(afterEdit, shot.id);
    check(
      edited?.shot.action === `${originalAction} [AUTO-TEST]`,
      "shot action changed",
    );
    const editedSegment = findSegment(afterEdit, segment.id)?.segment;
    check(
      editedSegment?.stale === true,
      "segment marked stale after shot edit",
    );
    eq(editedSegment?.mediaSig, originalSig, "stored media signature unchanged");

    const hardCutsAfter = afterEdit.scenes.map((scene) =>
      scene.segments.map((s) => s.hardCut),
    );
    eq(
      JSON.stringify(hardCutsAfter),
      JSON.stringify(originalHardCuts),
      "hard cut layout unchanged by action-only edit",
    );
  } finally {
    const restored = await sendJson(
      "PATCH",
      projectPath(`/shots/${enc(shot.id)}`),
      { action: originalAction },
    );
    check(restored.res.ok, "restore shot action", `HTTP ${restored.res.status}`);
  }

  const afterRestore = await loadStoryboard();
  const restoredSegment = findSegment(afterRestore, segment.id)?.segment;
  check(
    restoredSegment?.stale === false,
    "segment not stale after restoring original action",
  );
  eq(restoredSegment?.mediaSig, originalSig, "restored segment keeps signature");
}

async function testOrchestration(storyboard) {
  section("3. Vendor round-trip (h3 -> doubao -> h3)");

  const before = signatures(storyboard);
  const beforeVideoCount = before.videoShotIds.length;
  check(beforeVideoCount > 0, "round-trip starts with videos");

  let switched = false;
  try {
    const toDoubao = await sendJson("POST", projectPath("/orchestrate"), {
      vendor: "doubao",
    });
    check(toDoubao.res.ok, "orchestrate -> doubao", `HTTP ${toDoubao.res.status}`);
    if (!toDoubao.res.ok) {
      console.log(`    body: ${toDoubao.text.slice(0, 300)}`);
      return;
    }
    switched = true;
    eq(toDoubao.json?.vendor, "doubao", "response vendor is doubao");
    check((toDoubao.json?.segments ?? 0) > 0, "doubao produces segments");
    check(
      (toDoubao.json?.clearedVideos ?? 0) > 0,
      "switching vendor clears affected videos",
      String(toDoubao.json?.clearedVideos),
    );

    const middle = await loadStoryboard();
    eq(
      JSON.stringify(signatures(middle).shotIds),
      JSON.stringify(before.shotIds),
      "no shots lost after re-orchestration",
    );
    for (const scene of middle.scenes) {
      check(scene.segments.length > 0, `scene ${scene.sceneIndex} still has segments`);
      eq(scene.segments[0]?.hardCut, true, `scene ${scene.sceneIndex} first segment hard cut`);
      scene.segments.forEach((segment) => {
        eq(
          sumDurations(segment),
          segment.targetMs,
          `doubao segment ${segment.id.slice(0, 8)} durations sum to target`,
        );
      });
    }
  } finally {
    if (switched) {
      const back = await sendJson("POST", projectPath("/orchestrate"), {
        vendor: "h3",
      });
      check(back.res.ok, "orchestrate -> h3", `HTTP ${back.res.status}`);
      if (back.res.ok) {
        eq(back.json?.vendor, "h3", "response vendor is h3");
        eq(
          back.json?.restored,
          beforeVideoCount,
          "all cached videos restored",
        );
      }
    }
  }

  const after = await loadStoryboard();
  const afterSig = signatures(after);
  eq(
    JSON.stringify(afterSig.shotIds),
    JSON.stringify(before.shotIds),
    "shot ids preserved across round-trip",
  );
  eq(
    JSON.stringify(afterSig.perSceneShots),
    JSON.stringify(before.perSceneShots),
    "segment grouping restored per scene",
  );
  eq(
    JSON.stringify(afterSig.videoShotIds),
    JSON.stringify(before.videoShotIds),
    "video ownership restored per shot group",
  );
  eq(
    JSON.stringify(afterSig.autoFirstShotIds),
    JSON.stringify(before.autoFirstShotIds),
    "auto first frames restored",
  );

  for (const { segment } of allSegments(after)) {
    if (!segment.videoPath) continue;
    const probe = await videoProbe(segment.id);
    check(probe.ok, `restored video ${segment.id.slice(0, 8)} serves`);
    check(segment.stale === false, `restored video ${segment.id.slice(0, 8)} not stale`);
    check(
      Boolean(segment.mediaSig),
      `restored video ${segment.id.slice(0, 8)} has media signature`,
    );
  }
}

async function testVideoUpload(storyboard) {
  section("4. Video upload -> tail adoption -> delete");

  const entries = allSegments(storyboard);
  const targetEntry = entries.find(({ scene, segment }) => {
    if (segment.videoPath) return false;
    const index = scene.segments.findIndex((s) => s.id === segment.id);
    const next = scene.segments[index + 1];
    return Boolean(
      next &&
        !next.hardCut &&
        !next.videoPath &&
        next.firstFrameOrigin !== "manual" &&
        !next.firstFrameId,
    );
  });
  if (!targetEntry) {
    check(false, "found a draft segment followed by a continuous draft segment");
    return;
  }
  const { scene, segment: target } = targetEntry;
  const next =
    scene.segments[scene.segments.findIndex((s) => s.id === target.id) + 1];

  const source = entries.find(({ segment }) => segment.videoPath)?.segment;
  if (!source) {
    check(false, "found a source video to re-upload");
    return;
  }

  const targetFramesBefore = (await framesOf(target.id)).map((f) => f.id).sort();
  const nextBefore = {
    firstFrameId: next.firstFrameId,
    firstFrameOrigin: next.firstFrameOrigin,
  };
  const newFrameIds = [];
  let uploaded = false;

  try {
    const buffer = await videoBuffer(source.id);
    check(buffer.length > 0, `loaded source video bytes (${buffer.length})`);

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: "video/mp4" }),
      "auto-test.mp4",
    );
    const res = await fetch(
      `${BASE}${projectPath(`/segments/${enc(target.id)}/video`)}`,
      { method: "POST", body: form },
    );
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // 忽略
    }
    check(res.ok, "upload video", `HTTP ${res.status} ${text.slice(0, 200)}`);
    if (!res.ok) return;
    uploaded = true;

    check(json?.status === "returned", "upload response status returned");
    check(json?.tail?.captured === true, "tail frame captured for next segment", json?.tail?.reason);
    eq(json?.tail?.adoptedSegmentId, next.id, "tail adopted by next segment");

    const afterUpload = await loadStoryboard();
    const uploadedSegment = findSegment(afterUpload, target.id)?.segment;
    const nextAfter = findSegment(afterUpload, next.id)?.segment;
    check(Boolean(uploadedSegment?.videoPath), "segment video path set");
    check(uploadedSegment?.status === "returned", "segment status returned");
    check(uploadedSegment?.stale === false, "uploaded video not stale");
    check(Boolean(uploadedSegment?.mediaSig), "uploaded video has media signature");
    const probe = await videoProbe(target.id);
    check(probe.ok, "uploaded video serves", `HTTP ${probe.status}`);

    const targetFrames = await framesOf(target.id);
    const last = targetFrames.find((f) => f.kind === "last");
    check(Boolean(last), "tail frame row exists");
    check(
      nextAfter?.firstFrameId === last?.id,
      "next segment first frame points at new tail",
    );
    eq(nextAfter?.firstFrameOrigin, "auto", "next segment first frame origin is auto");
  } finally {
    if (uploaded) {
      const deleted = await sendJson(
        "DELETE",
        projectPath(`/segments/${enc(target.id)}/video`),
      );
      check(deleted.res.ok, "delete uploaded video", `HTTP ${deleted.res.status}`);
    }
    const framesNow = await framesOf(target.id);
    for (const frame of framesNow) {
      if (targetFramesBefore.includes(frame.id)) continue;
      newFrameIds.push(frame.id);
      const res = await fetch(
        `${BASE}${projectPath(`/frames/${enc(frame.id)}`)}`,
        { method: "DELETE" },
      );
      check(res.ok, `cleanup frame ${frame.id.slice(0, 8)}`, `HTTP ${res.status}`);
    }
  }

  const afterCleanup = await loadStoryboard();
  const targetAfter = findSegment(afterCleanup, target.id)?.segment;
  const nextAfterCleanup = findSegment(afterCleanup, next.id)?.segment;
  eq(targetAfter?.videoPath, null, "segment video cleared after delete");
  eq(nextAfterCleanup?.firstFrameId, nextBefore.firstFrameId, "next first frame restored");
  eq(
    nextAfterCleanup?.firstFrameOrigin,
    nextBefore.firstFrameOrigin,
    "next first frame origin restored",
  );
  const framesAfter = (await framesOf(target.id)).map((f) => f.id).sort();
  eq(
    JSON.stringify(framesAfter),
    JSON.stringify(targetFramesBefore),
    "test frames removed",
  );
}

async function testRealGeneration(storyboard) {
  section(
    CANCEL_GENERATION
      ? "5. Real video submit -> orchestrate guard -> cancel"
      : "5. Real video submit -> orchestrate guard -> complete",
  );

  if (!WITH_GENERATION) {
    console.log("  [SKIP] enable with --with-generation or --cancel-generation");
    return;
  }

  const entry = allSegments(storyboard).find(
    ({ segment }) => !segment.videoPath && segment.targetMs <= 5000,
  );
  if (!entry) {
    check(false, "found a short draft segment for generation");
    return;
  }
  const { scene, segment } = entry;
  const segmentIndex = scene.segments.findIndex((s) => s.id === segment.id);
  const next = scene.segments[segmentIndex + 1] ?? null;
  console.log(`  using segment ${segment.id.slice(0, 8)} (${segment.targetMs}ms)`);

  const framesBefore = (await framesOf(segment.id)).map((f) => f.id).sort();
  const nextBefore = next
    ? { firstFrameId: next.firstFrameId, firstFrameOrigin: next.firstFrameOrigin }
    : null;
  let jobId = null;
  let finished = false;

  const submitted = await sendJson(
    "POST",
    projectPath(`/segments/${enc(segment.id)}/generate-video`),
  );
  check(
    submitted.res.ok,
    "submit video generation",
    `HTTP ${submitted.res.status} ${submitted.text.slice(0, 300)}`,
  );
  if (!submitted.res.ok) return;
  jobId = submitted.json?.jobId ?? null;
  check(Boolean(submitted.json?.promptId), "submit returns prompt id");
  check(Boolean(jobId), "submit returns job id");

  try {
    const blocked = await sendJson("POST", projectPath("/orchestrate"), {
      vendor: "h3",
    });
    eq(blocked.res.status, 409, "orchestrate blocked while generating");

    if (CANCEL_GENERATION) {
      const queued = await waitFor(async () => {
        const sb = await loadStoryboard();
        const current = findSegment(sb, segment.id)?.segment;
        return ["queued", "running", "retrying"].includes(current?.genStatus)
          ? current
          : null;
      }, { timeoutMs: 180_000, intervalMs: 2_000 });
      check(Boolean(queued), "segment enters queued/running state");

      const cancelled = await sendJson(
        "POST",
        projectPath("/segments/cancel-videos"),
      );
      check(cancelled.res.ok, "cancel videos", `HTTP ${cancelled.res.status}`);
      check(
        (cancelled.json?.cancelled ?? 0) >= 1 ||
          (cancelled.json?.jobs ?? 0) >= 1,
        "cancel reports a cancelled run",
        JSON.stringify(cancelled.json),
      );
    }

    const terminal = await waitFor(async () => {
      const jobs = await loadJobs();
      const job = jobs.find((j) => j.id === jobId);
      return job && job.status !== "running" ? job : null;
    }, { timeoutMs: CANCEL_GENERATION ? 60_000 : 30 * 60_000, intervalMs: 3_000 });
    check(Boolean(terminal), "video job reaches terminal state");
    finished = Boolean(terminal);

    if (terminal) {
      console.log(`  job ${terminal.status}: ${terminal.message || "(no message)"}`);
    }

    const after = await loadStoryboard();
    const current = findSegment(after, segment.id)?.segment;
    const nextAfter = next ? findSegment(after, next.id)?.segment : null;

    if (CANCEL_GENERATION) {
      eq(current?.videoPath ?? null, null, "no video written after cancel");
      check(
        ["cancelled", "failed", null].includes(current?.genStatus ?? null),
        "segment generation status is not running",
        String(current?.genStatus),
      );
    } else {
      check(terminal?.status === "succeeded", "video generation succeeded", terminal?.message);
      check(Boolean(current?.videoPath), "segment video written after generation");
      eq(current?.status, "returned", "segment status returned");
      check(current?.stale === false, "generated video not stale");
      check(Boolean(current?.mediaSig), "generated video has media signature");
      if (current?.videoPath) {
        const probe = await videoProbe(segment.id);
        check(probe.ok, "generated video serves", `HTTP ${probe.status}`);
      }
      if (next && !next.hardCut && !nextBefore?.firstFrameId) {
        check(
          nextAfter?.firstFrameOrigin === "auto" || nextAfter?.firstFrameOrigin === "manual",
          "tail frame adopted by next segment",
          String(nextAfter?.firstFrameOrigin),
        );
      }
    }
  } finally {
    if (!CANCEL_GENERATION && jobId && !finished) {
      await sendJson("POST", projectPath("/segments/cancel-videos")).catch(
        () => undefined,
      );
    }
    if (!CANCEL_GENERATION) {
      const latest = await loadStoryboard().catch(() => null);
      const current = latest ? findSegment(latest, segment.id)?.segment : null;
      if (current?.videoPath) {
        const deleted = await sendJson(
          "DELETE",
          projectPath(`/segments/${enc(segment.id)}/video`),
        );
        check(deleted.res.ok, "cleanup generated video", `HTTP ${deleted.res.status}`);
      }
      const framesNow = await framesOf(segment.id).catch(() => []);
      for (const frame of framesNow) {
        if (framesBefore.includes(frame.id)) continue;
        const res = await fetch(
          `${BASE}${projectPath(`/frames/${enc(frame.id)}`)}`,
          { method: "DELETE" },
        );
        check(res.ok, `cleanup generated frame ${frame.id.slice(0, 8)}`);
      }
      if (next && nextBefore) {
        const afterCleanup = await loadStoryboard().catch(() => null);
        const nextAfterCleanup = afterCleanup
          ? findSegment(afterCleanup, next.id)?.segment
          : null;
        eq(
          nextAfterCleanup?.firstFrameId ?? null,
          nextBefore.firstFrameId,
          "next first frame restored after generation cleanup",
        );
        eq(
          nextAfterCleanup?.firstFrameOrigin ?? null,
          nextBefore.firstFrameOrigin,
          "next first frame origin restored after generation cleanup",
        );
      }
    }
  }
}

async function main() {
  console.log(`Storyboard smoke test`);
  console.log(`  base:    ${BASE}`);
  console.log(`  project: ${PROJECT_ID}`);

  const settings = await getJson("/api/settings/generation");

  let storyboard;
  try {
    const result = await testIntegrity(settings);
    storyboard = result.storyboard;
    await testEditAndStale(storyboard);
    await testOrchestration(await loadStoryboard());
    await testVideoUpload(await loadStoryboard());
    await testRealGeneration(await loadStoryboard());
  } catch (error) {
    failed += 1;
    failures.push(`uncaught: ${error.message}`);
    console.log(`\n[FAIL] uncaught error: ${error.stack ?? error.message}`);
  }

  console.log(`\n=== Result ===`);
  console.log(`  passed: ${passed}`);
  console.log(`  failed: ${failed}`);
  if (failures.length) {
    console.log(`  failures:`);
    for (const failure of failures) console.log(`   - ${failure}`);
  }
  process.exitCode = failed === 0 ? 0 : 1;
}

await main();
