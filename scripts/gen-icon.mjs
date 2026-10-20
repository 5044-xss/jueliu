import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "public", "appicon.png");
const outDir = path.join(root, "build-resources");
const outFile = path.join(outDir, "icon.ico");

const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  if (!fs.existsSync(src)) throw new Error(`源图标不存在：${src}`);
  fs.mkdirSync(outDir, { recursive: true });

  const buffers = await Promise.all(
    SIZES.map((size) =>
      sharp(src).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
    ),
  );
  const ico = await pngToIco(buffers);
  fs.writeFileSync(outFile, ico);
  console.log(`✓ 已生成 ${outFile}（${SIZES.join("/")}）`);
}

main().catch((error) => {
  console.error(`✗ ${error.message || error}`);
  process.exit(1);
});
