import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getProjectDbPath, ensureProjectDirs } from "@/lib/paths";
import { SCHEMA_SQL, SCHEMA_VERSION } from "@/lib/db/schema";

type Db = Database.Database;

const globalForDb = globalThis as unknown as {
  __mangaDbCache?: Map<string, Db>;
};

const cache: Map<string, Db> = globalForDb.__mangaDbCache ?? new Map();
globalForDb.__mangaDbCache = cache;

function migrate(db: Db): void {
  db.exec(SCHEMA_SQL);
  const columns = db.prepare("PRAGMA table_info(project)").all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === "style_id")) {
    db.exec("ALTER TABLE project ADD COLUMN style_id TEXT");
  }
  const current = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  if (!current) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(
      String(SCHEMA_VERSION),
    );
  }
}

export function getProjectDb(projectId: string): Db {
  const cached = cache.get(projectId);
  if (cached) return cached;

  ensureProjectDirs(projectId);
  const dbPath = getProjectDbPath(projectId);
  const db = new Database(dbPath);
  migrate(db);
  cache.set(projectId, db);
  return db;
}

export function closeProjectDb(projectId: string): void {
  const db = cache.get(projectId);
  if (db) {
    db.close();
    cache.delete(projectId);
  }
}

export function deleteProjectData(projectId: string): void {
  closeProjectDb(projectId);
  const dbPath = getProjectDbPath(projectId);
  const dir = path.dirname(dbPath);
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
