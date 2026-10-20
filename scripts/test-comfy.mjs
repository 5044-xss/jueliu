#!/usr/bin/env node
// ComfyUI 实例连通性自测（不提交任务，只看是否可达）。
// 用法：  COMFY_URL=https://xxxx.container.x-gpu.com node scripts/test-comfy.mjs
// 环境变量：
//   COMFY_URL  必填，实例地址

const BASE = (process.env.COMFY_URL || "").replace(/\/+$/, "");
if (!BASE) {
  console.error("缺少 COMFY_URL 环境变量，例如 https://xxxx.container.x-gpu.com");
  process.exit(1);
}

async function probe(path) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 300) };
}

(async () => {
  console.log(`ComfyUI 连通性自测 → ${BASE}`);
  for (const path of ["/system_stats", "/queue"]) {
    try {
      const r = await probe(path);
      console.log(`  ${path} → HTTP ${r.status}${r.ok ? " 可达" : ""}`);
      if (r.ok) {
        console.log(`  ✓ 完成：实例在线`);
        return;
      }
    } catch (error) {
      console.log(`  ${path} → 失败：${error.message}`);
    }
  }
  console.error("✗ 无法连接实例（可能未启动 / 地址错误 / 网络不通）");
  process.exit(1);
})();
