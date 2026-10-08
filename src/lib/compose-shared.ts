export interface TransitionOption {
  value: string;
  label: string;
}

export type CompositionStatus = "running" | "ready" | "failed";

export interface ComposableSegment {
  segmentId: string;
  sceneIndex: string;
  sceneSlug: string;
  index: number;
  targetMs: number;
  status: string;
  hardCut: boolean;
  hasVideo: boolean;
}

export interface CompositionInfo {
  id: string;
  name: string;
  segmentIds: string[];
  transition: string;
  transitionMs: number;
  status: CompositionStatus;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  hasExport: boolean;
}

// value 直接对应 ffmpeg xfade 的 transition 名；none 表示硬切（不走 xfade）
export const TRANSITIONS: TransitionOption[] = [
  { value: "fade", label: "淡入淡出" },
  { value: "fadeblack", label: "黑场过渡" },
  { value: "fadewhite", label: "白场过渡" },
  { value: "dissolve", label: "溶解" },
  { value: "slideleft", label: "向左滑动" },
  { value: "slideright", label: "向右滑动" },
  { value: "slideup", label: "向上滑动" },
  { value: "slidedown", label: "向下滑动" },
  { value: "wipeleft", label: "向左擦除" },
  { value: "wiperight", label: "向右擦除" },
  { value: "circleopen", label: "圆形展开" },
  { value: "circleclose", label: "圆形收拢" },
  { value: "radial", label: "径向" },
  { value: "none", label: "硬切（无转场）" },
];

export const TRANSITION_VALUES = TRANSITIONS.map((t) => t.value);

export const TRANSITION_DURATIONS_MS = [300, 500, 800, 1000, 1500];

// 默认硬切：连续段之间已用尾帧/首帧无缝接续，硬切段之间也应是切点，
// 默认叠加淡入淡出会穿帮；只有显式选择转场时才走 xfade。
export const DEFAULT_TRANSITION = "none";
export const DEFAULT_TRANSITION_MS = 500;

export function isTransitionValue(value: unknown): value is string {
  return typeof value === "string" && TRANSITION_VALUES.includes(value);
}

export function transitionLabel(value: string): string {
  return TRANSITIONS.find((t) => t.value === value)?.label ?? value;
}
