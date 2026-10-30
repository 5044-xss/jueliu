import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneDir = path.join(root, ".next", "standalone");

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: root,
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`命令失败：${cmd} ${args.join(" ")}`);
  }
}

// Next 的输出追踪会把 .env* 复制进 .next/standalone，构建前临时移走以防密钥入包。
function hideEnvFiles() {
  const moved = [];
  for (const name of fs.readdirSync(root)) {
    if (!/^\.env(\..+)?$/.test(name) || name.endsWith(".desktopbak")) continue;
    const src = path.join(root, name);
    if (!fs.statSync(src).isFile()) continue;
    const dst = `${src}.desktopbak`;
    fs.renameSync(src, dst);
    moved.push([dst, src]);
  }
  return moved;
}

function restoreEnvFiles(moved) {
  for (const [dst, src] of moved) {
    if (fs.existsSync(dst)) fs.renameSync(dst, src);
  }
}

// 手写递归复制：本机 Node 22 的 fs.cpSync 在 Windows 上会崩溃（0xC0000409）。
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function copyStaticAssets() {
  const publicDst = path.join(standaloneDir, "public");
  fs.rmSync(publicDst, { recursive: true, force: true });
  copyDir(path.join(root, "public"), publicDst);

  const staticDst = path.join(standaloneDir, ".next", "static");
  fs.rmSync(staticDst, { recursive: true, force: true });
  copyDir(path.join(root, ".next", "static"), staticDst);
  console.log("\n✓ 已复制 public 与 .next/static 进 standalone");
}

// Next 会为 external 包生成指向仓库根 node_modules 的绝对软链接（打包会丢、7z 会失败），
// 这里统一解除软链接，落成真实文件。
function dereferenceStandaloneLinks(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.realpathSync(full);
      fs.rmSync(full, { recursive: true, force: true });
      if (fs.statSync(target).isDirectory()) copyDir(target, full);
      else fs.copyFileSync(target, full);
      count += 1;
      console.log(`  解除软链接：${path.relative(root, full)}`);
    } else if (entry.isDirectory()) {
      count += dereferenceStandaloneLinks(full);
    }
  }
  return count;
}

function verifyStandalone() {
  const server = path.join(standaloneDir, "server.js");
  if (!fs.existsSync(server)) {
    throw new Error(`未生成 ${server}，请确认 next.config.ts 的 output: "standalone"`);
  }
  const sqlite = path.join(standaloneDir, "node_modules", "better-sqlite3");
  if (!fs.existsSync(sqlite)) {
    console.warn("⚠ standalone 内未追踪到 better-sqlite3，请检查 serverExternalPackages 配置");
  }
}

// 安全网：即使配置失效，也强制清掉 standalone 内的敏感数据，防密钥/用户数据入包。
function purgeSensitive() {
  const forbidden = ["workspace", "keys", ".env", ".env.local", ".env.production"];
  for (const name of forbidden) {
    const target = path.join(standaloneDir, name);
    if (fs.existsSync(target)) {
      console.log(`⚠ 清理 standalone 内的敏感项：${name}`);
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  for (const entry of fs.readdirSync(standaloneDir)) {
    if (/^\.env(\..+)?$/.test(entry)) {
      console.log(`⚠ 清理 standalone 内的敏感项：${entry}`);
      fs.rmSync(path.join(standaloneDir, entry), { recursive: true, force: true });
    }
  }
}

function main() {
  run("node", ["scripts/gen-icon.mjs"]);
  run("node", ["scripts/fetch-ffmpeg.mjs"]);
  run("node", ["scripts/build-clipboard-helper.mjs"]);
  run("node", ["scripts/fetch-electron.mjs"]);

  const moved = hideEnvFiles();
  try {
    run("npm", ["run", "build"]);
  } finally {
    restoreEnvFiles(moved);
  }

  verifyStandalone();
  purgeSensitive();
  copyStaticAssets();
  const links = dereferenceStandaloneLinks(standaloneDir);
  console.log(`\n✓ 已解除 ${links} 个软链接`);

  // better-sqlite3 v13 基于 N-API 预编译（node-addon-api），跨 Node/Electron 通用，无需 ABI 重编译。
  run("npx", ["--no-install", "electron-builder", "--win", "--x64"]);
  console.log("\n✓ 打包完成：release/");
}

try {
  main();
} catch (error) {
  console.error(`\n✗ ${error.message || error}`);
  process.exit(1);
}
