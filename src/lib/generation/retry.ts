import type { QcIssue } from "@core/shared/qc";

export type RetryAction =
  | "edit-storyboard"
  | "edit-target"
  | "recompile-prompt"
  | "set-hard-cut"
  | "regenerate-video";

export interface RetrySuggestion {
  action: RetryAction;
  label: string;
  reason: string;
  autoRetry: boolean;
  seedChange: boolean;
}

const AUTO_RETRY_CODES = new Set(["decode", "black-frame", "freeze-frame"]);

export function isAutoRetryableQc(issues: QcIssue[]): boolean {
  const hard = issues.filter((issue) => issue.level === "hard");
  return hard.length > 0 && hard.every((issue) => AUTO_RETRY_CODES.has(issue.code));
}

export function suggestQcRetry(issues: QcIssue[]): RetrySuggestion[] {
  const hard = issues.filter((issue) => issue.level === "hard");
  if (hard.length === 0) {
    return [
      {
        action: "recompile-prompt",
        label: "重新编译提示词",
        reason: "QC 没有硬失败，可先重编译确认提示词与分镜一致。",
        autoRetry: false,
        seedChange: false,
      },
    ];
  }

  const suggestions: RetrySuggestion[] = [];
  const codes = new Set(hard.map((issue) => issue.code));
  if (codes.has("cut-count")) {
    suggestions.push({
      action: "edit-storyboard",
      label: "修分镜/时间码",
      reason: "切镜数与分镜不一致，先改分镜或时长，再重新编译。",
      autoRetry: false,
      seedChange: false,
    });
  }
  if (codes.has("duration") || codes.has("resolution")) {
    suggestions.push({
      action: "edit-storyboard",
      label: "修分镜/段设置",
      reason: "时长或画幅不符合预期，先改分镜/段设置，再重新编译。",
      autoRetry: false,
      seedChange: false,
    });
  }
  if (
    codes.has("decode") ||
    codes.has("black-frame") ||
    codes.has("freeze-frame")
  ) {
    suggestions.push({
      action: "regenerate-video",
      label: "换种子重生成",
      reason: "文件损坏/黑帧/冻结属于画面类失败，可直接换种子重生成。",
      autoRetry: true,
      seedChange: true,
    });
  }
  if (suggestions.length === 0) {
    suggestions.push({
      action: "recompile-prompt",
      label: "重新编译提示词",
      reason: "先重编译确认提示词，再决定是否重生成视频。",
      autoRetry: false,
      seedChange: false,
    });
  }
  return suggestions;
}
