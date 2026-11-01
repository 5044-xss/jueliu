import type { LocalLicenseState } from "./service";

const LABELS: Record<string, string> = {
  active: "已授权",
  trial: "试用中",
  pending: "待生效",
  expired: "已过期",
  revoked: "已吊销",
  none: "未激活",
  invalid: "激活码无效",
  error: "连接失败",
};

export function statusLabel(
  status: LocalLicenseState["status"] | null,
  phase?: LocalLicenseState["phase"],
): string {
  if (phase === "loading") return "校验中";
  if (!status) return "未知";
  return LABELS[status] ?? status;
}

export function formatDateTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(ms))
    .replace(/\//g, "-");
}

export function formatDate(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(ms))
    .replace(/\//g, "-");
}

export function trialRemainingText(state: LocalLicenseState): string {
  if (state.trialLeftHours != null) {
    const hours = Math.max(0, Math.ceil(state.trialLeftHours));
    if (hours <= 0) return "试用已结束";
    if (hours < 24) return `试用中 · 剩余 ${hours} 小时`;
    return `试用中 · 剩余 ${Math.ceil(hours / 24)} 天`;
  }
  if (state.trialLeftDays != null) {
    const days = Math.max(0, Math.ceil(state.trialLeftDays));
    if (days <= 0) return "试用已结束";
    return `试用中 · 剩余 ${days} 天`;
  }
  return "试用中";
}
