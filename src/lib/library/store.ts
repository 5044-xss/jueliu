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
    return Array.isArray(parsed.items) ? parsed.items : fallback;
  } catch {
    return fallback;
  }
}

export function writeLibrary<T>(fileName: string, items: T[]): void {
  ensureWorkspace();
  const dir = libraryDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, fileName),
    JSON.stringify({ items }, null, 2),
    "utf8",
  );
}

export function newLibraryId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
