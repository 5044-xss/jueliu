import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  getProjectDbPath,
  getProjectDir,
  getWorkspaceRoot,
  ensureProjectDirs,
} from "@/lib/paths";
import { SCHEMA_SQL, SCHEMA_VERSION } from "@/lib/db/schema";

type Db = Database.Database;

// 每次新增/修改迁移语句时递增；用于让已缓存的连接在下次访问时重新执行 migrate，
// 避免必须重启 dev 服务才能应用新列。
const MIGRATION_SIGNATURE = "7";

const globalForDb = globalThis as unknown as {
  __mangaDbCache?: Map<string, Db>;
  __mangaDbMigrated?: Map<string, string>;
};

const cache: Map<string, Db> = globalForDb.__mangaDbCache ?? new Map();
globalForDb.__mangaDbCache = cache;
const migrated: Map<string, string> = globalForDb.__mangaDbMigrated ?? new Map();
globalForDb.__mangaDbMigrated = migrated;

function addColumnIfMissing(
  db: Db,
  table: string,
  column: string,
  ddl: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function migrate(db: Db): void {
  db.exec(SCHEMA_SQL);
  const columns = db.prepare("PRAGMA table_info(project)").all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === "style_id")) {
    db.exec("ALTER TABLE project ADD COLUMN style_id TEXT");
  }
  addColumnIfMissing(
    db,
    "project",
    "vendor",
    "vendor TEXT NOT NULL DEFAULT 'doubao'",
  );
  addColumnIfMissing(db, "asset", "original_name", "original_name TEXT");
  addColumnIfMissing(
    db,
    "asset",
    "original_base_prompt",
    "original_base_prompt TEXT",
  );
  addColumnIfMissing(db, "variant", "original_label", "original_label TEXT");
  addColumnIfMissing(
    db,
    "variant",
    "original_prompt",
    "original_prompt TEXT",
  );
  addColumnIfMissing(db, "view", "original_label", "original_label TEXT");
  addColumnIfMissing(db, "view", "original_prompt", "original_prompt TEXT");
  addColumnIfMissing(
    db,
    "segment",
    "hard_cut",
    "hard_cut INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(db, "segment", "ai_prompt", "ai_prompt TEXT");
  addColumnIfMissing(db, "segment", "ai_prompt_sig", "ai_prompt_sig TEXT");
  addColumnIfMissing(db, "shot", "original_json", "original_json TEXT");
  addColumnIfMissing(
    db,
    "shot",
    "ideal_ms",
    "ideal_ms INTEGER",
  );
  addColumnIfMissing(
    db,
    "shot",
    "continues_prev",
    "continues_prev INTEGER NOT NULL DEFAULT 0",
  );
  // 回填理想时长：老数据没有 ideal_ms，用当前 duration_ms 兜底。
  db.prepare("UPDATE shot SET ideal_ms = duration_ms WHERE ideal_ms IS NULL").run();
  addColumnIfMissing(
    db,
    "shot",
    "subject_node_ids_json",
    "subject_node_ids_json TEXT NOT NULL DEFAULT '[]'",
  );
  addColumnIfMissing(
    db,
    "shot",
    "dialogue_json",
    "dialogue_json TEXT NOT NULL DEFAULT '[]'",
  );
  // 旧数据迁移：把纯文本台词转成 [{character:"",text}]，迁移后清空旧列避免重复回填。
  const legacyDialogue = db
    .prepare(
      `SELECT id, dialogue FROM shot
       WHERE (dialogue_json IS NULL OR dialogue_json = '' OR dialogue_json = '[]')
         AND dialogue IS NOT NULL AND trim(dialogue) <> ''`,
    )
    .all() as { id: string; dialogue: string }[];
  if (legacyDialogue.length > 0) {
    const backfill = db.prepare(
      "UPDATE shot SET dialogue_json = ?, dialogue = '' WHERE id = ?",
    );
    for (const row of legacyDialogue) {
      backfill.run(
        JSON.stringify([{ character: "", text: row.dialogue }]),
        row.id,
      );
    }
  }
  addColumnIfMissing(
    db,
    "composition",
    "transition",
    "transition TEXT NOT NULL DEFAULT 'fade'",
  );
  addColumnIfMissing(
    db,
    "composition",
    "transition_ms",
    "transition_ms INTEGER NOT NULL DEFAULT 500",
  );
  addColumnIfMissing(
    db,
    "composition",
    "status",
    "status TEXT NOT NULL DEFAULT 'ready'",
  );
  addColumnIfMissing(db, "composition", "error", "error TEXT");
  addColumnIfMissing(db, "composition", "duration_ms", "duration_ms INTEGER");
  // 始终同步 schema_version，避免 meta 里的版本号永远停在首个值。
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(SCHEMA_VERSION));
}

export function getProjectDb(projectId: string): Db {
  const cached = cache.get(projectId);
  if (cached) {
    if (migrated.get(projectId) !== MIGRATION_SIGNATURE) {
      migrate(cached);
      migrated.set(projectId, MIGRATION_SIGNATURE);
    }
    return cached;
  }

  // 只打开已存在的项目：不存在的 id 不再隐式创建目录/空库（避免"读一下就造出项目"）。
  if (!fs.existsSync(getProjectDir(projectId))) {
    throw new Error("项目不存在");
  }
  ensureProjectDirs(projectId);
  const dbPath = getProjectDbPath(projectId);
  const db = new Database(dbPath);
  migrate(db);
  migrated.set(projectId, MIGRATION_SIGNATURE);
  cache.set(projectId, db);
  return db;
}

export function closeProjectDb(projectId: string): void {
  const db = cache.get(projectId);
  if (db) {
    db.close();
    cache.delete(projectId);
    migrated.delete(projectId);
  }
}

export function deleteProjectData(projectId: string): void {
  closeProjectDb(projectId);
  const dbPath = getProjectDbPath(projectId);
  const dir = path.resolve(path.dirname(dbPath));
  const root = path.resolve(getWorkspaceRoot());
  // 双保险：解析后必须严格位于工作区内部，绝不删除工作区根或外部目录。
  if (dir === root || !dir.startsWith(root + path.sep)) {
    return;
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = dbPath + suffix;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export type { Db };
