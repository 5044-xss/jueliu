import { readLibrary, writeLibrary, newLibraryId } from "@/lib/library/store";
import {
  DEFAULT_VENDOR,
  DEFAULT_VENDORS,
  type VendorId,
  type VendorProfile,
} from "@/lib/orchestration/vendors";

export type { VendorId, VendorProfile };

// 厂商能力档案库（可编辑）。内置两家（豆包/H3）作为种子，用户可增删改。
export interface LibraryVendor extends VendorProfile {
  builtin: boolean;
  /** 内置档案版本；未被用户改动的内置项会随版本自动刷新到最新默认值。 */
  builtinVersion?: number;
  /** 用户是否改过内置厂商；改过则不再随版本自动刷新。 */
  edited?: boolean;
}

const FILE = "vendors.json";
// 每次修改内置厂商默认能力时递增，让未编辑过的内置厂商自动刷新。
const BUILTIN_VENDOR_VERSION = 2;

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function seed(): LibraryVendor[] {
  return DEFAULT_VENDORS.map((v) => ({
    ...v,
    builtin: true,
    builtinVersion: BUILTIN_VENDOR_VERSION,
    edited: false,
  }));
}

export function getVendors(): LibraryVendor[] {
  const stored = readLibrary<LibraryVendor>(FILE, []);
  if (stored.length === 0) {
    const items = seed();
    writeLibrary(FILE, items);
    return items;
  }
  let changed = false;
  const items = stored.map((v) => {
    const next: LibraryVendor = { ...v, builtin: Boolean(v.builtin) };
    const def = DEFAULT_VENDORS.find(
      (d) => d.platform === next.platform || d.id === next.id,
    );
    // 未被用户改动的内置厂商，按版本自动刷新能力与翻译提示词。
    if (next.builtin && !next.edited && def) {
      if (next.builtinVersion !== BUILTIN_VENDOR_VERSION) {
        next.name = def.name;
        next.platform = def.platform;
        next.maxShotsPerSegment = def.maxShotsPerSegment;
        next.supportMultiShot = def.supportMultiShot;
        next.maxRefImages = def.maxRefImages;
        next.minSegmentMs = def.minSegmentMs;
        next.maxSegmentMs = def.maxSegmentMs;
        next.durationStepMs = def.durationStepMs;
        next.supportFirstFrame = def.supportFirstFrame;
        next.supportLastFrame = def.supportLastFrame;
        next.note = def.note;
        next.compilePrompt = def.compilePrompt;
        next.builtinVersion = BUILTIN_VENDOR_VERSION;
        changed = true;
      }
    }
    // 回填：老数据从未设置过 compilePrompt（undefined）时，用内置默认补齐。
    if (next.compilePrompt === undefined) {
      next.compilePrompt = def?.compilePrompt ?? "";
      changed = true;
    }
    return next;
  });
  // 内置厂商不可删除：缺失就补回，保证豆包/H3 始终存在。
  for (const def of DEFAULT_VENDORS) {
    const exists = items.some(
      (v) => v.id === def.id || v.platform === def.platform,
    );
    if (!exists) {
      items.push({
        ...def,
        builtin: true,
        builtinVersion: BUILTIN_VENDOR_VERSION,
        edited: false,
      });
      changed = true;
    }
  }
  if (changed) writeLibrary(FILE, items);
  return items;
}

export function getVendor(id: string | null | undefined): LibraryVendor {
  const vendors = getVendors();
  return (
    vendors.find((v) => v.id === id) ??
    vendors.find((v) => v.id === DEFAULT_VENDOR) ??
    vendors[0]
  );
}

export function isVendorId(value: unknown): value is string {
  return typeof value === "string" && getVendors().some((v) => v.id === value);
}

export function createVendor(
  input: Partial<VendorProfile> & { name: string },
): LibraryVendor {
  const vendors = getVendors();
  const platform = input.platform?.trim() || "custom";
  const def = DEFAULT_VENDORS.find((d) => d.platform === platform);
  const vendor: LibraryVendor = {
    id: newLibraryId("vend"),
    name: input.name.trim() || "新厂商",
    platform,
    maxShotsPerSegment: toInt(input.maxShotsPerSegment, 1, 1, 20),
    supportMultiShot: input.supportMultiShot ?? false,
    maxRefImages: toInt(input.maxRefImages, 3, 1, 32),
    minSegmentMs: toInt(input.minSegmentMs, 4000, 500, 60000),
    maxSegmentMs: toInt(input.maxSegmentMs, 10000, 1000, 120000),
    durationStepMs: toInt(input.durationStepMs, 0, 0, 60000),
    supportFirstFrame: input.supportFirstFrame ?? true,
    supportLastFrame: input.supportLastFrame ?? false,
    note: input.note?.trim() || "",
    compilePrompt: input.compilePrompt ?? def?.compilePrompt ?? "",
    builtin: false,
  };
  writeLibrary(FILE, [...vendors, vendor]);
  return vendor;
}

export function updateVendor(
  id: string,
  patch: Partial<Omit<VendorProfile, "id">>,
): LibraryVendor | null {
  const vendors = getVendors();
  const index = vendors.findIndex((v) => v.id === id);
  if (index < 0) return null;
  const cur = vendors[index];
  const next: LibraryVendor = {
    ...cur,
    name: patch.name !== undefined ? patch.name.trim() || cur.name : cur.name,
    platform:
      patch.platform !== undefined
        ? patch.platform.trim() || cur.platform
        : cur.platform,
    maxShotsPerSegment:
      patch.maxShotsPerSegment !== undefined
        ? toInt(patch.maxShotsPerSegment, cur.maxShotsPerSegment, 1, 20)
        : cur.maxShotsPerSegment,
    supportMultiShot: patch.supportMultiShot ?? cur.supportMultiShot,
    maxRefImages:
      patch.maxRefImages !== undefined
        ? toInt(patch.maxRefImages, cur.maxRefImages, 1, 32)
        : cur.maxRefImages,
    minSegmentMs:
      patch.minSegmentMs !== undefined
        ? toInt(patch.minSegmentMs, cur.minSegmentMs, 500, 60000)
        : cur.minSegmentMs,
    maxSegmentMs:
      patch.maxSegmentMs !== undefined
        ? toInt(patch.maxSegmentMs, cur.maxSegmentMs, 1000, 120000)
        : cur.maxSegmentMs,
    durationStepMs:
      patch.durationStepMs !== undefined
        ? toInt(patch.durationStepMs, cur.durationStepMs, 0, 60000)
        : cur.durationStepMs,
    supportFirstFrame: patch.supportFirstFrame ?? cur.supportFirstFrame,
    supportLastFrame: patch.supportLastFrame ?? cur.supportLastFrame,
    note: patch.note !== undefined ? patch.note.trim() : cur.note,
    compilePrompt:
      patch.compilePrompt !== undefined ? patch.compilePrompt : cur.compilePrompt,
    // 改动过的内置厂商不再随内置版本自动刷新，避免覆盖用户设置。
    edited: cur.builtin ? true : cur.edited,
  };
  vendors[index] = next;
  writeLibrary(FILE, vendors);
  return next;
}

export function deleteVendor(id: string): boolean {
  const vendors = getVendors();
  const target = vendors.find((v) => v.id === id);
  // 内置厂商不允许删除。
  if (!target || target.builtin) return false;
  const next = vendors.filter((v) => v.id !== id);
  if (next.length === vendors.length) return false;
  writeLibrary(FILE, next);
  return true;
}
