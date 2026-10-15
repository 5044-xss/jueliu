import fs from "node:fs";
import path from "node:path";
import { getWorkspaceRoot, ensureWorkspace } from "@/lib/paths";

export interface LibraryFile<T> {
  items: T[];
}

function libraryDir(): string {
  return path.join(getWorkspaceRoot(), "library");
}

export function libraryPath(fileName: string): string {
  return path.join(libraryDir(), fileName);
}

export function readLibrary<T>(fileName: string, fallback: T[]): T[] {
  const file = libraryPath(fileName);
  if (!fs.existsSync(file)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as LibraryFile<T>;
    if (Array.isArray(parsed.items)) return parsed.items;
    backupCorruptFile(file);
    return fallback;
  } catch {
    // 解析失败不要静默当空：备份坏文件，避免随后一次写入把用户库覆盖没了。
    backupCorruptFile(file);
    return fallback;
  }
}

export function writeLibrary<T>(fileName: string, items: T[]): void {
  ensureWorkspace();
  const dir = libraryDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, fileName);
  // 先写临时文件再原子替换，避免并发/中断写出半个 JSON。
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify({ items }, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function backupCorruptFile(file: string): void {
  try {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}.bak`);
  } catch {
    // 备份失败也不阻断读取
  }
}

export function newLibraryId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
