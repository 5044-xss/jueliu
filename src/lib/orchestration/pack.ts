import type { VendorProfile } from "./vendors";

// 编排打包算法（纯函数，确定性）。
// 输入「一个场的镜序列 + 厂商档案」，输出「段（调用计划）」。
// 不读文件、不调 LLM，便于单测与回归。

export interface PackRefLabel {
  role: "scene" | "character" | "prop";
  /** 用于槽位预算与告警展示的名称（角色名/场景名/道具名）。 */
  label: string;
}

export interface PackShot {
  /** 理想时长（毫秒），作为权重与总时长估算。 */
  idealMs: number;
  /** 本镜的内容引用（角色/场景/道具），用于参考图槽位预算。 */
  refLabels: PackRefLabel[];
}

export interface PackedSegment {
  /** 本段包含的镜在输入数组里的下标（有序）。 */
  shotIndexes: number[];
  /** 协商后的段目标时长（毫秒）。 */
  targetMs: number;
  /** 是否与上一段硬切（场次首段由渲染层视为独立镜头）。 */
  hardCut: boolean;
  /** 本段各镜分配后的时长（与 shotIndexes 对齐，之和 == targetMs）。 */
  shotDurations: number[];
  /** 本段告警（超槽位 / 短镜补足等）。 */
  warnings: string[];
}

export interface PackResult {
  segments: PackedSegment[];
}

function negotiateDuration(
  ideal: number,
  vendor: VendorProfile,
  capMs: number,
): number {
  let target = ideal;
  if (vendor.minSegmentMs > 0) target = Math.max(target, vendor.minSegmentMs);
  if (capMs > 0) target = Math.min(target, capMs);
  if (vendor.durationStepMs > 0) {
    target = Math.ceil(target / vendor.durationStepMs) * vendor.durationStepMs;
    if (capMs > 0 && target > capMs) {
      target = Math.floor(capMs / vendor.durationStepMs) * vendor.durationStepMs;
    }
  }
  return Math.max(vendor.minSegmentMs, Math.round(target));
}

/** 把 targetMs 按权重分配给各镜，保证整数且之和 == targetMs。 */
function distribute(weights: number[], target: number): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const out = weights.map((w) => Math.max(1, Math.round((target * w) / total)));
  let diff = target - out.reduce((a, b) => a + b, 0);
  if (diff !== 0 && out.length > 0) {
    let idx = 0;
    for (let i = 1; i < out.length; i += 1) {
      if (weights[i] > weights[idx]) idx = i;
    }
    out[idx] = Math.max(1, out[idx] + diff);
    diff = target - out.reduce((a, b) => a + b, 0);
  }
  return out;
}

/**
 * 把一个场的镜序列按厂商打包成段。
 *
 * @param shots            按叙事顺序排列的镜
 * @param vendor           厂商档案
 * @param defaultSegmentMs 项目默认段时长（与厂商上限取较小值作为实际封顶）
 */
export function packScene(
  shots: PackShot[],
  vendor: VendorProfile,
  defaultSegmentMs: number,
): PackResult {
  if (shots.length === 0) return { segments: [] };

  const maxShots = Math.max(
    1,
    vendor.supportMultiShot ? vendor.maxShotsPerSegment : 1,
  );
  const capMs = Math.max(
    vendor.minSegmentMs,
    Math.min(vendor.maxSegmentMs, defaultSegmentMs || vendor.maxSegmentMs),
  );

  // 1) 贪心装段：加到「再加一镜会超过 镜数上限 或 时长上限」就断段。
  const groups: number[][] = [];
  let cur: number[] = [];
  let curMs = 0;
  for (let i = 0; i < shots.length; i += 1) {
    const ms = Math.max(1, shots[i].idealMs || 0);
    const overflow =
      cur.length > 0 &&
      (cur.length + 1 > maxShots || curMs + ms > capMs);
    if (overflow) {
      groups.push(cur);
      cur = [];
      curMs = 0;
    }
    cur.push(i);
    curMs += ms;
  }
  if (cur.length) groups.push(cur);

  // 2) 每段协商时长、分配回各镜、算槽位占用与告警。
  const segments: PackedSegment[] = groups.map((idxs) => {
    const weights = idxs.map((i) => Math.max(1, shots[i].idealMs || 0));
    const ideal = weights.reduce((a, b) => a + b, 0);
    const targetMs = negotiateDuration(ideal, vendor, capMs);
    const shotDurations = distribute(weights, targetMs);

    const slots = new Set<string>();
    for (const i of idxs) {
      for (const r of shots[i].refLabels) {
        slots.add(`${r.role}:${r.label}`);
      }
    }

    const warnings: string[] = [];
    if (slots.size > vendor.maxRefImages) {
      warnings.push(
        `本段需 ${slots.size} 张参考图，超过 ${vendor.name} 上限 ${vendor.maxRefImages} 张，多出的角色会被降级为文本锚点。`,
      );
    }
    if (
      idxs.length === 1 &&
      vendor.minSegmentMs > 0 &&
      ideal < vendor.minSegmentMs
    ) {
      warnings.push(
        `单镜理想 ${(ideal / 1000).toFixed(1)}s 低于 ${vendor.name} 下限 ${(vendor.minSegmentMs / 1000).toFixed(0)}s，已补足到该下限。`,
      );
    }

    return {
      shotIndexes: idxs,
      targetMs,
      hardCut: false,
      shotDurations,
      warnings,
    };
  });

  return { segments };
}
