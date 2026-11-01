import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

try {
  run("node", ["scripts/gen-icon.mjs"]);
  run("node", ["scripts/fetch-electron.mjs"]);
  run("npm", ["run", "build:app:desktop"]);
  run("npx", [
    "--no-install",
    "electron-builder",
    "--config",
    "electron-builder.local.yml",
    "--win",
    "--x64",
  ]);
  console.log("\n✓ 本地版桌面端打包完成：release-local/");
} catch (error) {
  console.error(`\n✗ ${error.message || error}`);
  process.exit(1);
}
