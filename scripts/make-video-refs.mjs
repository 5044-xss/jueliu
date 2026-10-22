import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const workspace = path.resolve(arg("workspace", path.join(process.cwd(), "workspace")));
const onlyProject = arg("project", "");

function projectDirs() {
  if (!fs.existsSync(workspace)) return [];
  return fs
    .readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .filter((id) => !onlyProject || id === onlyProject)
    .filter((id) => fs.existsSync(path.join(workspace, id, "project.db")));
}

async function makeVideoRef(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return false;
  const dir = path.dirname(imagePath);
  const target = path.join(dir, "video-ref.png");
  if (fs.existsSync(target)) {
    const sourceStat = fs.statSync(imagePath);
    const targetStat = fs.statSync(target);
    if (targetStat.mtimeMs >= sourceStat.mtimeMs) return false;
  }
  const meta = await sharp(imagePath).metadata();
  if (!meta.width || !meta.height) return false;
  const width = Math.max(1, Math.floor(meta.width / 4));
  await sharp(imagePath)
    .extract({ left: 0, top: 0, width, height: meta.height })
    .png()
    .toFile(target);
  return true;
}

let created = 0;
let skipped = 0;
for (const id of projectDirs()) {
  const db = new Database(path.join(workspace, id, "project.db"), { readonly: true });
  const rows = db
    .prepare(
      `SELECT vw.image_path
       FROM view vw
       JOIN variant v ON v.id = vw.variant_id
       JOIN asset a ON a.id = v.asset_id
       WHERE a.type = 'character' AND vw.kind = 'sheet' AND vw.image_path IS NOT NULL`,
    )
    .all();
  db.close();
  for (const row of rows) {
    try {
      if (await makeVideoRef(row.image_path)) {
        created += 1;
        console.log(`crop ${row.image_path}`);
      } else {
        skipped += 1;
      }
    } catch (error) {
      console.error(`failed ${row.image_path}: ${error.message}`);
    }
  }
}
console.log(`video refs: created ${created}, skipped ${skipped}`);
