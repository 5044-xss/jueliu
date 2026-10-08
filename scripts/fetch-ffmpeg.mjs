import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { curlDownload } from "./curl-download.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = path.join(root, "resources", "ffmpeg");
const targetExe = path.join(targetDir, "ffmpeg.exe");

const URL =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";



function findFfmpegExe(dir) {
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === "ffmpeg.exe") return full;
    }
  }
  return null;
}

async function main() {
  if (fs.existsSync(targetExe)) {
    console.log(`✓ ffmpeg 已存在：${targetExe}`);
    return;
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-"));
  const zipPath = path.join(tmpDir, "ffmpeg.zip");

  console.log("正在下载 ffmpeg（约 200MB）…");
  curlDownload(URL, zipPath);

  console.log("正在解压…");
  const result = spawnSync("tar.exe", ["-xf", zipPath, "-C", tmpDir], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("解压 ffmpeg 失败");
  }

  const found = findFfmpegExe(tmpDir);
  if (!found) throw new Error("解压后未找到 ffmpeg.exe");
  fs.copyFileSync(found, targetExe);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`✓ ffmpeg 就绪：${targetExe}`);
}

main().catch((error) => {
  console.error(`✗ ${error.message || error}`);
  process.exit(1);
});
