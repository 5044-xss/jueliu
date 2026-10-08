import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { curlDownload } from "./curl-download.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronDir = path.join(root, "node_modules", "electron");
const distDir = path.join(electronDir, "dist");
const exePath = path.join(distDir, "electron.exe");
const pathTxt = path.join(electronDir, "path.txt");

function electronVersion() {
  return require(path.join(electronDir, "package.json")).version;
}

function main() {
  if (fs.existsSync(exePath)) {
    console.log(`✓ Electron 已就绪：${exePath}`);
    if (!fs.existsSync(pathTxt)) fs.writeFileSync(pathTxt, "electron.exe", "utf8");
    return;
  }

  const version = electronVersion();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "electron-"));
  const zipPath = path.join(tmpDir, "electron.zip");
  const url = `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-win32-x64.zip`;

  console.log(`正在下载 Electron v${version}（约 100MB）…`);
  curlDownload(url, zipPath);

  console.log("正在解压…");
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  const result = spawnSync("tar.exe", ["-xf", zipPath, "-C", distDir], {
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("解压 Electron 失败");

  fs.writeFileSync(pathTxt, "electron.exe", "utf8");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`✓ Electron 就绪：${exePath}`);
}

try {
  main();
} catch (error) {
  console.error(`✗ ${error.message || error}`);
  process.exit(1);
}
