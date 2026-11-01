import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

function run(cmd, args, cwd = root) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd,
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`命令失败：${cmd} ${args.join(" ")}`);
  }
}

if (process.platform !== "darwin") {
  console.error("\n✗ iOS 打包需要在 macOS 上运行");
  process.exit(1);
}

const derivedData = path.join(os.tmpdir(), `jueliu-ios-derived-${Date.now()}`);
const payloadDir = path.join(os.tmpdir(), `jueliu-ios-payload-${Date.now()}`);

try {
  run("node", ["scripts/sync-app-version.mjs"]);
  run("node", ["scripts/gen-mobile-icons.mjs"]);
  run("npm", ["run", "build:app:mobile"]);
  run("npx", ["cap", "sync", "ios"]);

  run("xcodebuild", [
    "-project",
    "ios/App/App.xcodeproj",
    "-scheme",
    "App",
    "-configuration",
    "Release",
    "-sdk",
    "iphoneos",
    "-derivedDataPath",
    derivedData,
    "CODE_SIGN_IDENTITY=",
    "CODE_SIGNING_REQUIRED=NO",
    "CODE_SIGNING_ALLOWED=NO",
    "build",
  ]);

  const productsDir = path.join(
    derivedData,
    "Build",
    "Products",
    "Release-iphoneos",
  );
  if (!fs.existsSync(productsDir)) {
    throw new Error(`未找到应用产物目录：${productsDir}`);
  }
  const appName = fs
    .readdirSync(productsDir)
    .find((name) => name.endsWith(".app"));
  if (!appName) {
    throw new Error(`未找到 .app 产物：${productsDir}`);
  }

  fs.mkdirSync(path.join(payloadDir, "Payload"), { recursive: true });
  fs.cpSync(path.join(productsDir, appName), path.join(payloadDir, "Payload", appName), {
    recursive: true,
  });

  const outDir = path.join(root, "release-local");
  fs.mkdirSync(outDir, { recursive: true });
  const ipaOut = path.join(outDir, `掘流-${version}-ios.ipa`);
  fs.rmSync(ipaOut, { force: true });
  run("zip", ["-qry", ipaOut, "Payload"], payloadDir);
  console.log(`\n✓ iOS IPA：${ipaOut}`);
} catch (error) {
  console.error(`\n✗ ${error.message || error}`);
  process.exit(1);
} finally {
  fs.rmSync(derivedData, { recursive: true, force: true });
  fs.rmSync(payloadDir, { recursive: true, force: true });
}
