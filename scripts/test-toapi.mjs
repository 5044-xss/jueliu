#!/usr/bin/env node
// Toapi 图像生成链路自测：上传参考图 → 提交任务 → 轮询 → 下载结果。
// 用法：
//   node scripts/test-toapi.mjs "一只熊猫，电影感光线"
//   node scripts/test-toapi.mjs --ref a.png --ref b.jpg --size 9:16 --resolution 1k "赛博朋克城市夜景"
// 环境变量：
//   TOAPIS_API_KEY   必填
//   TOAPIS_BASE_URL  可选，默认 https://toapis.cn/v1
//   TOAPIS_MODEL     可选，默认 gpt-image-2

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const refs = [];
let prompt = "";
let size = "1:1";
let resolution = "1k";
let outDir = path.join(process.cwd(), "tmp", "toapi-test");

for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === "--ref") refs.push(args[++i]);
  else if (a === "--size") size = args[++i];
  else if (a === "--resolution") resolution = args[++i];
  else if (a === "--out") outDir = args[++i];
  else prompt = prompt ? `${prompt} ${a}` : a;
}

const API_KEY = process.env.TOAPIS_API_KEY || process.env.TOAPI_API_KEY || "";
const BASE = (process.env.TOAPIS_BASE_URL || "https://toapis.cn/v1").replace(/\/+$/, "");
const MODEL = process.env.TOAPIS_MODEL || "gpt-image-2";

if (!API_KEY) {
  console.error("缺少 TOAPIS_API_KEY 环境变量");
  process.exit(1);
}
if (!prompt) prompt = "一只可爱的熊猫，电影感光线，高细节";

const auth = { Authorization: `Bearer ${API_KEY}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadImage(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" }[ext] || "image/png";
  const form = new FormData();
  form.append("file", new Blob([buf], { type: mime }), path.basename(filePath));
  const res = await fetch(`${BASE}/uploads/images`, { method: "POST", headers: auth, body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success || !body?.data?.url) {
    throw new Error(`上传失败(HTTP ${res.status})：${JSON.stringify(body)}`);
  }
  console.log(`  ↑ 已上传 ${path.basename(filePath)} → ${body.data.url}`);
  return body.data.url;
}

async function createTask(refUrls) {
  const payload = { model: MODEL, prompt, size, resolution, n: 1, response_format: "url" };
  if (refUrls.length) payload.reference_images = refUrls;
  const res = await fetch(`${BASE}/images/generations`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.id) {
    throw new Error(`提交失败(HTTP ${res.status})：${JSON.stringify(body)}`);
  }
  return body;
}

async function waitFor(taskId) {
  const deadline = Date.now() + 10 * 60 * 1000;
  for (;;) {
    const res = await fetch(`${BASE}/images/generations/${encodeURIComponent(taskId)}`, { headers: auth });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new Error(`查询失败(HTTP ${res.status})`);
    process.stdout.write(`\r  轮询：${body.status} ${body.progress ?? 0}%   `);
    if (body.status === "completed") {
      const url = body.result?.data?.find?.((d) => d.url)?.url;
      if (!url) throw new Error(`完成但无 URL：${JSON.stringify(body)}`);
      return url;
    }
    if (body.status === "failed") {
      throw new Error(`任务失败：${JSON.stringify(body.error || body.fail_reason || body)}`);
    }
    if (Date.now() > deadline) throw new Error("轮询超时");
    await sleep(3000);
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败(HTTP ${res.status})`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

(async () => {
  console.log(`Toapi 自测 → ${BASE} · model=${MODEL} · size=${size} · ${resolution}`);
  console.log(`prompt: ${prompt}`);
  const refUrls = [];
  for (const r of refs) refUrls.push(await uploadImage(r));

  const task = await createTask(refUrls);
  console.log(`  → 任务已创建：${task.id}（${task.status}）`);

  const imageUrl = await waitFor(task.id);
  process.stdout.write("\n");

  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, `toapi-${task.id}.png`);
  await download(imageUrl, dest);
  console.log(`  ✓ 完成：${imageUrl}`);
  console.log(`  ✓ 已保存：${dest}`);
})().catch((err) => {
  console.error(`\n✗ 失败：${err.message}`);
  process.exit(1);
});
