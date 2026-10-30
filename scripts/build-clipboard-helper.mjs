import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "resources", "clipboard-files.cs");
const target = path.join(root, "resources", "clipboard-files.exe");
const csc = path.join(
  process.env.WINDIR || "C:\\Windows",
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
  "csc.exe",
);

if (process.platform !== "win32") {
  console.warn("! 非 Windows 环境，跳过剪贴板助手编译");
  process.exit(0);
}
if (!fs.existsSync(csc)) {
  console.warn(`! 未找到 csc.exe，跳过剪贴板助手编译：${csc}`);
  process.exit(0);
}
if (!fs.existsSync(source)) {
  throw new Error(`缺少剪贴板助手源码：${source}`);
}
if (
  fs.existsSync(target) &&
  fs.statSync(target).mtimeMs >= fs.statSync(source).mtimeMs
) {
  console.log("剪贴板助手已是最新版本");
  process.exit(0);
}

const result = spawnSync(
  csc,
  [
    "/nologo",
    "/target:exe",
    `/out:${target}`,
    source,
    "/r:System.Windows.Forms.dll",
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) {
  throw new Error("剪贴板助手编译失败");
}
console.log(`已生成剪贴板助手：${path.relative(root, target)}`);
