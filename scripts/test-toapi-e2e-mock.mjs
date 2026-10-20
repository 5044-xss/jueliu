#!/usr/bin/env node
/**
 * Toapi 全链路回归（本地模拟上游，不访问真实 Toapi、不产生费用、不生成真实图片）。
 *
 * 覆盖：设置保存/打码 → 连接自检 → 提交起始画面 → 后台轮询/下载/落槽 →
 *       任务失败 → 取消。
 *
 * 前置：
 *   - 已启动服务，并建议用独立 WORKSPACE_DIR（避免污染真实工作区）
 *   - 项目厂商为 h3，且至少有一个没有起始画面的段落
 *
 * 用法：
 *   node scripts/test-toapi-e2e-mock.mjs --base=http://127.0.0.1:3100 --project=<id>
 *
 * 注意：会把该工作区的 generation.baseUrl 指向本地模拟服务，apiKey 改为 test-key。
 */

import http from "node:http";

const BASE = (
  process.argv.find((a) => a.startsWith("--base="))?.slice(7) ||
  process.env.BASE_URL ||
  "http://127.0.0.1:3000"
).replace(/\/+$/, "");
const PROJECT_ID =
  process.argv.find((a) => a.startsWith("--project="))?.slice(10) ||
  process.env.PROJECT_ID ||
  "";

if (!PROJECT_ID) {
  console.error("缺少 --project=<项目/剧集 id>");
  process.exit(1);
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

let mode = "ok";
let createCount = 0;
let busyFailures = 0;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    // 非 JSON 保留 text
  }
  return { res, json, text };
}

async function getJson(path) {
  const { res, json, text } = await request(path);
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

function sendJson(method, path, body) {
  return request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function projectPath(suffix) {
  return `/api/projects/${enc(PROJECT_ID)}${suffix}`;
}

function allSegments(storyboard) {
  return storyboard.scenes.flatMap((scene) =>
    scene.segments.map((segment) => ({ scene, segment })),
  );
}

function findSegment(storyboard, segmentId) {
  return allSegments(storyboard).find((x) => x.segment.id === segmentId)?.segment ?? null;
}

async function loadStoryboard() {
  return getJson(projectPath("/storyboard"));
}

async function loadJobs() {
  const data = await getJson(projectPath("/jobs"));
  return data.jobs ?? [];
}

async function waitFor(predicate, timeoutMs = 20_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(intervalMs);
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function startMock() {
  const tasks = new Map();
  let seq = 0;

  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(req.url, origin);
    await readBody(req);

    const send = (status, payload, headers = {}) => {
      const isBuffer = Buffer.isBuffer(payload);
      res.writeHead(status, {
        "Content-Type": isBuffer ? "image/png" : "application/json",
        ...headers,
      });
      res.end(isBuffer ? payload : JSON.stringify(payload));
    };

    if (
      req.method === "GET" &&
      (url.pathname.startsWith("/files/") || url.pathname === "/result.png")
    ) {
      return send(200, PNG, { "Content-Type": "image/png" });
    }

    if (!/^Bearer test-key$/.test(req.headers.authorization ?? "")) {
      return send(401, { message: "unauthorized" });
    }

    if (req.method === "GET" && url.pathname === "/v1/models") {
      return send(200, { object: "list", data: [{ id: "gpt-image-2" }] });
    }

    if (req.method === "POST" && url.pathname === "/v1/uploads/images") {
      return send(200, {
        success: true,
        data: { url: `${origin}/files/ref-${seq += 1}.png` },
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/images/generations") {
      const id = `task-${seq += 1}`;
      createCount += 1;
      tasks.set(id, { polls: 0 });
      return send(200, {
        id,
        object: "image.generation",
        status: "queued",
        created_at: Date.now(),
      });
    }

    if (
      req.method === "GET" &&
      url.pathname.startsWith("/v1/images/generations/")
    ) {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const task = tasks.get(id);
      if (!task) return send(404, { message: "task not found" });
      task.polls += 1;

      if (mode === "slow") {
        return send(200, { id, status: "in_progress", progress: 10 });
      }
      if (mode === "busy" && task.polls >= 2 && busyFailures < 1) {
        busyFailures += 1;
        return send(200, {
          id,
          status: "failed",
          error: { message: "service_busy（模拟限流）" },
        });
      }
      if (mode === "fail" && task.polls >= 2) {
        return send(200, {
          id,
          status: "failed",
          error: { message: "service_busy（模拟限流）" },
        });
      }
      if (task.polls < 3) {
        return send(200, {
          id,
          status: task.polls === 1 ? "queued" : "in_progress",
          progress: task.polls * 10,
        });
      }
      return send(200, {
        id,
        status: "completed",
        progress: 100,
        result: { data: [{ url: `${origin}/result.png?id=${id}` }] },
      });
    }

    return send(404, { message: `unknown route ${req.method} ${url.pathname}` });
  });

  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const server = await startMock();
const mockBase = `http://127.0.0.1:${server.address().port}/v1`;

try {
  section("0. 环境检查");
  const project = await getJson(projectPath(""));
  eq(project.project?.id, PROJECT_ID, "项目存在");
  eq(project.project?.vendor, "h3", "项目厂商为 h3");

  const settingsBefore = await getJson("/api/settings/generation");
  check(Boolean(settingsBefore.settings), "读取生成设置");

  section("1. 设置保存 / 打码 / 连接自检");
  const saved = await sendJson("PUT", "/api/settings/generation", {
    baseUrl: mockBase,
    apiKey: "test-key",
    pollIntervalMs: 500,
  });
  check(saved.res.ok, "保存模拟 Toapi 配置", `HTTP ${saved.res.status}`);
  const settingsAfter = await getJson("/api/settings/generation");
  eq(settingsAfter.settings?.baseUrl, mockBase, "baseUrl 已生效");
  check(
    settingsAfter.settings?.apiKey && settingsAfter.settings.apiKey !== "test-key",
    "apiKey 读取时已打码",
  );

  const conn = await sendJson("POST", "/api/settings/generation/test", {});
  check(conn.res.ok, "连接自检 HTTP 200", `HTTP ${conn.res.status}`);
  eq(conn.json?.ok, true, "连接自检 ok=true");

  const storyboard = await loadStoryboard();
  const candidates = allSegments(storyboard)
    .map((x) => x.segment)
    .filter((segment) => !segment.firstFrameId && segment.shots?.length);
  check(candidates.length >= 5, "至少有 5 个可测的未出图段落", String(candidates.length));
  if (candidates.length < 5) throw new Error("测试数据不足：需要至少 5 个未出图段落");

  section("2. 成功链路：提交 → 轮询 → 下载 → 落槽");
  const target = candidates[0];
  mode = "ok";
  const submitted = await sendJson(
    "POST",
    projectPath(`/segments/${enc(target.id)}/generate-image`),
  );
  check(submitted.res.ok, "提交起始画面任务", `HTTP ${submitted.res.status} ${submitted.text.slice(0, 200)}`);
  check(Boolean(submitted.json?.jobId), "返回 jobId");
  check(Boolean(submitted.json?.taskId), "返回 taskId");

  const succeeded = await waitFor(async () => {
    const jobs = await loadJobs();
    const job = jobs.find((j) => j.id === submitted.json?.jobId);
    return job && job.status !== "running" ? job : null;
  }, 30_000);
  eq(succeeded?.status, "succeeded", "任务最终成功");
  check(/已生成起始画面/.test(succeeded?.message ?? ""), "成功消息正确", succeeded?.message);

  const after = await loadStoryboard();
  const targetAfter = findSegment(after, target.id);
  eq(targetAfter?.genStatus, "completed", "segment.gen_status = completed");
  check(Boolean(targetAfter?.firstFrameId), "segment.firstFrameId 已写入");
  eq(targetAfter?.firstFrameOrigin, "manual", "起始画面来源为 manual");

  const frames = await getJson(projectPath(`/segments/${enc(target.id)}/frames`));
  const startFrame = (frames.frames ?? []).find(
    (frame) => frame.id === targetAfter?.firstFrameId,
  );
  eq(startFrame?.kind, "start", "帧 kind = start");

  if (targetAfter?.firstFrameId) {
    const image = await fetch(
      `${BASE}${projectPath(`/frames/${enc(targetAfter.firstFrameId)}/image`)}`,
    );
    const bytes = Buffer.from(await image.arrayBuffer());
    eq(image.status, 200, "帧图接口 HTTP 200");
    eq(image.headers.get("content-type"), "image/png", "帧图 Content-Type");
    check(bytes.length > 0 && bytes.subarray(1, 4).toString() === "PNG", "帧图是 PNG");
    const deleted = await request(
      projectPath(`/frames/${enc(targetAfter.firstFrameId)}`),
      { method: "DELETE" },
    );
    check(deleted.res.ok, "清理测试帧", `HTTP ${deleted.res.status}`);
  }

  section("3. 失败链路：上游任务失败");
  const failTarget = candidates[1];
  mode = "fail";
  const failSubmit = await sendJson(
    "POST",
    projectPath(`/segments/${enc(failTarget.id)}/generate-image`),
  );
  check(failSubmit.res.ok, "提交失败场景任务", `HTTP ${failSubmit.res.status}`);

  const failJob = await waitFor(async () => {
    const jobs = await loadJobs();
    const job = jobs.find((j) => j.id === failSubmit.json?.jobId);
    return job && job.status !== "running" ? job : null;
  }, 30_000);
  eq(failJob?.status, "failed", "失败任务最终状态 failed");
  check(
    /service_busy/.test(failJob?.message ?? ""),
    "失败消息透传上游原因",
    failJob?.message,
  );

  const failAfter = findSegment(await loadStoryboard(), failTarget.id);
  eq(failAfter?.genStatus, "failed", "segment.gen_status = failed");
  eq(failAfter?.firstFrameId ?? null, null, "失败时未写入起始画面");

  section("4. 取消链路");
  const cancelTarget = candidates[2];
  mode = "slow";
  const cancelSubmit = await sendJson(
    "POST",
    projectPath(`/segments/${enc(cancelTarget.id)}/generate-image`),
  );
  check(cancelSubmit.res.ok, "提交取消场景任务", `HTTP ${cancelSubmit.res.status}`);

  const running = await waitFor(async () => {
    const jobs = await loadJobs();
    return jobs.find(
      (j) => j.id === cancelSubmit.json?.jobId && j.status === "running",
    );
  }, 15_000);
  check(Boolean(running), "任务进入 running");

  const cancelled = await sendJson("POST", projectPath("/segments/cancel-images"));
  check(cancelled.res.ok, "调用取消接口", `HTTP ${cancelled.res.status}`);
  check(
    (cancelled.json?.cancelled ?? 0) >= 1 || (cancelled.json?.jobs ?? 0) >= 1,
    "取消接口报告已中断任务",
    JSON.stringify(cancelled.json),
  );

  const cancelJob = await waitFor(async () => {
    const jobs = await loadJobs();
    const job = jobs.find((j) => j.id === cancelSubmit.json?.jobId);
    return job && job.status !== "running" ? job : null;
  }, 15_000);
  eq(cancelJob?.status, "failed", "取消后任务终止为 failed");
  check(/取消/.test(cancelJob?.message ?? ""), "取消消息明确", cancelJob?.message);

  const cancelAfter = await waitFor(async () => {
    const segment = findSegment(await loadStoryboard(), cancelTarget.id);
    return ["cancelled", "failed"].includes(segment?.genStatus ?? "")
      ? segment
      : null;
  }, 10_000);
  check(
    cancelAfter !== null,
    "取消后 segment.gen_status 已终止",
    String(findSegment(await loadStoryboard(), cancelTarget.id)?.genStatus),
  );
  eq(cancelAfter?.firstFrameId ?? null, null, "取消时未写入起始画面");

  section("5. 重复提交去重");
  const dedupeTarget = candidates[3];
  mode = "slow";
  const createsBefore = createCount;
  const dedupePath = projectPath(`/segments/${enc(dedupeTarget.id)}/generate-image`);
  const [first, second] = await Promise.all([
    sendJson("POST", dedupePath),
    sendJson("POST", dedupePath),
  ]);
  check(
    first.res.ok && second.res.ok,
    "并发重复提交均成功响应",
    `${first.res.status}/${second.res.status}`,
  );
  const results = [first.json, second.json];
  eq(
    results.filter((result) => result?.reused === true).length,
    1,
    "只有一次真正提交，另一次复用",
  );
  check(
    Boolean(results[0]?.taskId) && results[0]?.taskId === results[1]?.taskId,
    "两次返回同一个 taskId",
    `${results[0]?.taskId} / ${results[1]?.taskId}`,
  );
  eq(createCount - createsBefore, 1, "只创建了 1 个 Toapi 任务");

  const third = await sendJson("POST", dedupePath);
  eq(third.json?.reused, true, "生成过程中再次提交直接复用");
  eq(createCount - createsBefore, 1, "复用不会新建任务");

  const dedupeJobId = results[0]?.jobId;
  const dedupeCancel = await sendJson("POST", projectPath("/segments/cancel-images"));
  check(dedupeCancel.res.ok, "清理去重测试任务", `HTTP ${dedupeCancel.res.status}`);
  await waitFor(async () => {
    const jobs = await loadJobs();
    const job = jobs.find((j) => j.id === dedupeJobId);
    return job && job.status !== "running" ? job : null;
  }, 15_000);
  await waitFor(async () => {
    const segment = findSegment(await loadStoryboard(), dedupeTarget.id);
    return ["cancelled", "failed"].includes(segment?.genStatus ?? "") ? true : null;
  }, 10_000);

  section("6. 繁忙/限流自动重试");
  const retryTarget = candidates[4];
  mode = "busy";
  busyFailures = 0;
  const retryCreatesBefore = createCount;
  const retrySubmit = await sendJson(
    "POST",
    projectPath(`/segments/${enc(retryTarget.id)}/generate-image`),
  );
  check(retrySubmit.res.ok, "提交重试场景任务", `HTTP ${retrySubmit.res.status}`);

  const retryJob = await waitFor(async () => {
    const jobs = await loadJobs();
    const job = jobs.find((j) => j.id === retrySubmit.json?.jobId);
    return job && job.status !== "running" ? job : null;
  }, 60_000);
  eq(retryJob?.status, "succeeded", "繁忙后自动重试成功", retryJob?.message);
  check(
    createCount - retryCreatesBefore >= 2,
    "重试确实新建了任务",
    String(createCount - retryCreatesBefore),
  );

  const retryAfter = findSegment(await loadStoryboard(), retryTarget.id);
  eq(retryAfter?.genStatus, "completed", "重试后 gen_status = completed");
  check(Boolean(retryAfter?.firstFrameId), "重试后写入起始画面");
  if (retryAfter?.firstFrameId) {
    const deleted = await request(
      projectPath(`/frames/${enc(retryAfter.firstFrameId)}`),
      { method: "DELETE" },
    );
    check(deleted.res.ok, "清理重试测试帧", `HTTP ${deleted.res.status}`);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(`\n=== Result ===`);
console.log(`  passed: ${passed}`);
console.log(`  failed: ${failed}`);
if (failures.length) {
  console.log("  failures:");
  for (const failure of failures) console.log(`   - ${failure}`);
}
process.exitCode = failed === 0 ? 0 : 1;
