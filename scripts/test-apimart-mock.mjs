#!/usr/bin/env node
/**
 * APIMart 客户端离线自测：本地起一个模拟 HTTP 服务，不访问真实 APIMart、不产生费用。
 *
 * 覆盖：
 *  - 构造参数校验（baseUrl / apiKey）
 *  - 连接自检（GET /models）
 *  - 上传参考图（响应为扁平 { url }）
 *  - 提交任务（data[0].task_id，reference_images → image_urls）
 *  - 轮询（pending → processing → completed，结果在 data.result.images[0].url[0]）
 *  - 任务失败、轮询超时、外部取消
 *
 * 用法：node scripts/test-apimart-mock.mjs
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ApimartClient } from "../src/lib/generation/apimart.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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

async function expectReject(fn, pattern, name) {
  try {
    await fn();
    check(false, name, "expected rejection, got success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(pattern.test(message), name, message);
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const submitted = [];

function startMock() {
  const tasks = new Map();
  let seq = 0;

  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(req.url, origin);
    const body = await readBody(req);

    const send = (status, payload) => {
      const text =
        typeof payload === "string" || Buffer.isBuffer(payload)
          ? payload
          : JSON.stringify(payload);
      res.writeHead(status, {
        "Content-Type": Buffer.isBuffer(payload)
          ? "image/png"
          : "application/json",
      });
      res.end(text);
    };

    if (req.method === "GET" && url.pathname === "/result.png") {
      return send(200, PNG);
    }

    if (!/^Bearer test-key$/.test(req.headers.authorization ?? "")) {
      return send(401, {
        error: { message: "unauthorized", type: "invalid_request_error" },
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/models") {
      return send(200, { success: true, object: "list", data: [] });
    }

    if (req.method === "POST" && url.pathname === "/v1/uploads/images") {
      if (body.includes(Buffer.from("UPLOAD_FAIL"))) {
        return send(400, { error: { message: "failed to upload image" } });
      }
      return send(200, {
        url: `${origin}/files/ref-${(seq += 1)}.png`,
        filename: "ref.png",
        content_type: "image/png",
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/images/generations") {
      let payload;
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        return send(400, { error: { message: "invalid json" } });
      }
      submitted.push(payload);
      const id = `task_${(seq += 1)}`;
      tasks.set(id, { prompt: String(payload.prompt ?? ""), polls: 0 });
      return send(200, {
        code: 200,
        data: [{ status: "submitted", task_id: id }],
      });
    }

    if (req.method === "GET" && url.pathname.startsWith("/v1/tasks/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const task = tasks.get(id);
      if (!task) {
        return send(404, { code: 404, error: { message: "task not found" } });
      }

      task.polls += 1;
      if (task.prompt.includes("FAIL")) {
        return send(200, {
          code: 200,
          data: {
            id,
            status: "failed",
            progress: 100,
            error: { code: "task_failed", message: "内容违规（模拟）" },
          },
        });
      }
      if (task.prompt.includes("TIMEOUT") || task.polls < 3) {
        return send(200, {
          code: 200,
          data: {
            id,
            status: task.polls === 1 ? "pending" : "processing",
            progress: task.polls * 10,
          },
        });
      }
      return send(200, {
        code: 200,
        data: {
          id,
          status: "completed",
          progress: 100,
          result: {
            images: [{ url: [`${origin}/result.png?id=${id}`], expires_at: 0 }],
          },
        },
      });
    }

    return send(404, {
      error: { message: `unknown route ${req.method} ${url.pathname}` },
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const server = await startMock();
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jueman-apimart-"));
const refPath = path.join(tmpDir, "ref.png");
const badRefPath = path.join(tmpDir, "UPLOAD_FAIL.png");
fs.writeFileSync(refPath, PNG);
fs.writeFileSync(badRefPath, Buffer.from("UPLOAD_FAIL"));

try {
  section("1. 构造参数校验");
  let constructorError = "";
  try {
    new ApimartClient({ baseUrl: "", apiKey: "test-key" });
  } catch (error) {
    constructorError = error.message;
  }
  check(/baseUrl|接口地址/.test(constructorError), "缺 baseUrl 被拒绝", constructorError);

  constructorError = "";
  try {
    new ApimartClient({ baseUrl, apiKey: "  " });
  } catch (error) {
    constructorError = error.message;
  }
  check(/API Key/.test(constructorError), "缺 apiKey 被拒绝", constructorError);

  const client = new ApimartClient({
    baseUrl: `${baseUrl.replace(/\/+$/, "")}/`,
    apiKey: "test-key",
    timeoutMs: 10_000,
  });

  section("2. 连接自检与上传");
  const conn = await client.testConnection();
  eq(conn.ok, true, "testConnection ok");
  eq(conn.status, 200, "testConnection status 200");

  const refUrl = await client.uploadImage(refPath);
  check(/\/files\/ref-\d+\.png$/.test(refUrl), "uploadImage 返回参考图 URL", refUrl);
  await expectReject(
    () => client.uploadImage(badRefPath),
    /上传参考图失败/,
    "uploadImage 失败时抛明确错误",
  );

  const badAuth = new ApimartClient({ baseUrl, apiKey: "wrong-key", timeoutMs: 5_000 });
  const badConn = await badAuth.testConnection();
  eq(badConn.ok, false, "testConnection 鉴权失败返回 ok=false");
  eq(badConn.status, 401, "testConnection 鉴权失败 status 401");

  section("3. 提交与轮询");
  const task = await client.createImageTask({
    model: "gpt-image-2",
    prompt: "一只熊猫",
    size: "9:16",
    resolution: "2k",
    reference_images: [refUrl],
  });
  check(Boolean(task.id), "createImageTask 返回任务 id", task.id);
  eq(task.status, "queued", "初始状态 queued");
  check(
    JSON.stringify(submitted.at(-1)?.image_urls) === JSON.stringify([refUrl]) &&
      !("reference_images" in submitted.at(-1)),
    "reference_images 已转换为 image_urls",
  );

  const progress = [];
  const imageUrl = await client.waitForImage(task.id, {
    intervalMs: 50,
    timeoutMs: 5_000,
    onProgress: (t) => progress.push(t.status),
  });
  check(/\/result\.png/.test(imageUrl), "waitForImage 返回结果 URL", imageUrl);
  check(progress.includes("in_progress"), "onProgress 收到中间状态", progress.join(","));
  eq(progress.at(-1), "completed", "最后一次进度为 completed");

  const buf = await client.downloadImage(imageUrl);
  eq(Buffer.compare(buf, PNG), 0, "downloadImage 下载到正确字节");

  section("4. 失败 / 超时 / 取消");
  const failedTask = await client.createImageTask({
    model: "gpt-image-2",
    prompt: "FAIL",
  });
  await expectReject(
    () => client.waitForImage(failedTask.id, { intervalMs: 20, timeoutMs: 2_000 }),
    /内容违规（模拟）/,
    "任务失败时抛出上游错误信息",
  );

  const timeoutTask = await client.createImageTask({
    model: "gpt-image-2",
    prompt: "TIMEOUT",
  });
  await expectReject(
    () => client.waitForImage(timeoutTask.id, { intervalMs: 30, timeoutMs: 300 }),
    /超时/,
    "轮询超时抛出超时错误",
  );

  const cancelTask = await client.createImageTask({
    model: "gpt-image-2",
    prompt: "TIMEOUT",
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 80);
  await expectReject(
    () =>
      client.waitForImage(cancelTask.id, {
        intervalMs: 20,
        timeoutMs: 10_000,
        signal: controller.signal,
      }),
    /已取消|aborted/i,
    "外部取消能中断轮询",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n=== Result ===`);
console.log(`  passed: ${passed}`);
console.log(`  failed: ${failed}`);
if (failures.length) {
  console.log("  failures:");
  for (const failure of failures) console.log(`   - ${failure}`);
}
process.exitCode = failed === 0 ? 0 : 1;
