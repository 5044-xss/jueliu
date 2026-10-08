export interface PromptTemplateSeed {
  platform: "doubao" | "jimeng" | "custom";
  name: string;
  version: string;
  bodyTemplate: string;
  paramsTemplate: string;
  legendTemplate: string;
  variables: string[];
}

export const DEFAULT_BODY_TEMPLATE = `【基础设定】
{{style}}{{aspectRatio}}。
{{sceneHeader}}

【角色一致性（参考图）】
{{manifestLegend}}
{{characterLocks}}

【空间与站位（锁定）】
{{blockingText}}
{{anchorText}}

【分镜序列】
{{shotList}}

【衔接约束】
{{transitionText}}

【负面约束】
{{negativeText}}`;

export const DEFAULT_PARAMS_TEMPLATE = `比例：{{aspectRatio}}
生成模式：{{generationMode}}（每段最多 3 个分镜）
段时长：约 {{targetSeconds}} 秒（引导值，平台可能不精确执行）
首帧：{{firstFrameNote}}
首尾帧锚定：{{anchorEnabled}}`;

export const DEFAULT_LEGEND_TEMPLATE = `{{items}}`;

export const TEMPLATE_VARIABLES = [
  "style",
  "aspectRatio",
  "projectName",
  "sceneHeader",
  "manifestLegend",
  "characterLocks",
  "blockingText",
  "anchorText",
  "shotList",
  "transitionText",
  "negativeText",
  "generationMode",
  "targetSeconds",
  "firstFrameNote",
  "anchorEnabled",
  "items",
];

export const DEFAULT_NEGATIVE_TEXT =
  "禁止：换脸/换发型/换服装、站位翻转、跳轴、多手多脚、肢体粘连、画面畸变、文字水印、场景突变、光线跳变、角色消失或重复。";

// 单段视频时长的下限（毫秒）。平台一次生成一般有最短时长，低于此值应并入上一段。
export const MIN_SEGMENT_MS = 3000;

// 道具资产建议上限。道具会占参考图槽位，只应保留「跨镜复用且外观一致」的关键道具。
export const MAX_PROP_ASSETS = 6;

// 单段参考图建议上限。视频平台参考图槽位有限（常见 3~4 张），
// 超出部分会被平台丢弃，导致角色没有参考图、换脸或服装不一致。
export const MAX_REF_IMAGES = 4;

export const DEFAULT_TEMPLATES: PromptTemplateSeed[] = [
  {
    platform: "doubao",
    name: "通用默认模板",
    version: "1",
    bodyTemplate: DEFAULT_BODY_TEMPLATE,
    paramsTemplate: DEFAULT_PARAMS_TEMPLATE,
    legendTemplate: DEFAULT_LEGEND_TEMPLATE,
    variables: TEMPLATE_VARIABLES,
  },
  {
    platform: "jimeng",
    name: "通用默认模板",
    version: "1",
    bodyTemplate: DEFAULT_BODY_TEMPLATE,
    paramsTemplate: DEFAULT_PARAMS_TEMPLATE,
    legendTemplate: DEFAULT_LEGEND_TEMPLATE,
    variables: TEMPLATE_VARIABLES,
  },
  {
    platform: "custom",
    name: "通用默认模板",
    version: "1",
    bodyTemplate: DEFAULT_BODY_TEMPLATE,
    paramsTemplate: DEFAULT_PARAMS_TEMPLATE,
    legendTemplate: DEFAULT_LEGEND_TEMPLATE,
    variables: TEMPLATE_VARIABLES,
  },
];

export const PLATFORM_LABELS: Record<string, string> = {
  custom: "默认（通用）",
  doubao: "豆包",
  jimeng: "即梦",
};

export const DEFAULT_PLATFORM = "custom";

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

export function sortPlatforms(platforms: string[]): string[] {
  return [...platforms].sort((a, b) => {
    if (a === DEFAULT_PLATFORM) return -1;
    if (b === DEFAULT_PLATFORM) return 1;
    return a.localeCompare(b);
  });
}
