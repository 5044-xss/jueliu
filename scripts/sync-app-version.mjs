import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;

const [major = 0, minor = 0, patch = 0] = String(version)
  .split(".")
  .map((part) => Number.parseInt(part, 10) || 0);
const versionCode = major * 10000 + minor * 100 + patch;

const gradlePath = path.join(root, "android", "app", "build.gradle");
if (fs.existsSync(gradlePath)) {
  const gradle = fs
    .readFileSync(gradlePath, "utf8")
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
  fs.writeFileSync(gradlePath, gradle);
}

const pbxPath = path.join(root, "ios", "App", "App.xcodeproj", "project.pbxproj");
if (fs.existsSync(pbxPath)) {
  const pbx = fs
    .readFileSync(pbxPath, "utf8")
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${versionCode};`);
  fs.writeFileSync(pbxPath, pbx);
}

console.log(`✓ 已同步移动端版本号：${version}（versionCode ${versionCode}）`);
