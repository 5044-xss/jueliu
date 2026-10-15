// 内置模板版本：修改内置模板正文后递增，未被用户改动过的内置模板会自动刷新。
export const BUILTIN_TEMPLATE_VERSION = 4;

export interface PromptTemplateSeed {
  platform: string;
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
生成模式：{{generationMode}}
段时长：约 {{targetSeconds}} 秒（引导值，平台可能不精确执行）`;

export const DEFAULT_LEGEND_TEMPLATE = `{{items}}`;

export const DEFAULT_H3_BODY_TEMPLATE = `【基础设定】
{{style}}{{aspectRatio}}
{{sceneHeader}}

【参考图与主体锁定（每镜都必须遵守）】
{{manifestLegend}}
{{characterLocks}}
场景/环境：全程保持参考图中同一地点的空间结构、陈设、光线方向与色调一致。

【空间与站位（锁定）】
{{blockingText}}
{{anchorText}}

【分镜序列（同一段内的多镜按顺序连续生成）】
{{shotList}}

【衔接约束】
{{transitionText}}

【负面约束】
{{negativeText}}`;

// MiniMax H3 参数引导：H3 能力与推荐设置（供人看，同时作为编译器的【生成参数】输入）。
export const DEFAULT_H3_PARAMS_TEMPLATE = `画面比例：{{aspectRatio}}（可选 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16；首尾帧模式遵循输入图的原始比例）
生成模式：{{generationMode}}
段时长：约 {{targetSeconds}} 秒（H3 原生 4–15 秒；24fps；超长请分段续写并逐段衔接）
声音：音画同轨，原生 32kHz 立体声；台词、音效、配乐请写进提示词
参考素材：图片 ≤9 张（视频 ≤3 段、音频 ≤3 段，混合素材总数 ≤12）
清晰度：原生 768p（≈0.98MP）为上限；更高清走 2K 重生成或后置放大，不要靠拉高分辨率
提示词：≤7000 字符`;

export const DEFAULT_H3_LEGEND_TEMPLATE = `参考图按「图1、图2…」顺序上传；H3 按该顺序对应 <Picture N>：
{{items}}`;

// 豆包（Doubao Seedance 2.0 系列）内置模板：按官方提示词指南的进阶公式组织
// （精准主体 → 场景环境 → 空间站位 → 分镜时序 → 运镜 → 风格画质 → 约束）。
export const DEFAULT_DOUBAO_BODY_TEMPLATE = `【精准主体】
{{characterLocks}}

【场景环境】
{{sceneHeader}}

【空间与站位（锁定）】
{{blockingText}}
{{anchorText}}

【分镜时序】
按镜头顺序生成；每个镜头写清：主体动作 + 场景 + 光色 + 运镜。动作具体到手、腿、头部并写明幅度/速度/力度，情绪用具身细节外化：
{{shotList}}

【镜间衔接与运镜】
{{transitionText}}

【参考素材】
{{manifestLegend}}

【视觉风格与画质】
{{style}}高清，细节丰富，电影质感，色彩自然，光影柔和；主体面部与身体比例稳定、不变形、不穿模、无卡顿无闪烁。

【约束条件】
{{negativeText}}
保持无字幕，避免生成任何文字或字幕；不要生成 Logo；不要生成水印。`;

export const DEFAULT_DOUBAO_PARAMS_TEMPLATE = `画面比例：{{aspectRatio}}
生成模式：{{generationMode}}
生成时长：约 {{targetSeconds}} 秒（Seedance 2.0 系列原生 4–15 秒，最终以平台为准）
分辨率：720p（Seedance 2.0 Mini 仅支持 480p / 720p）
声音：音画同轨生成
画质：高清，细节丰富，电影质感，色彩自然，光影柔和
约束：保持无字幕、无 Logo、无水印`;

export const DEFAULT_DOUBAO_LEGEND_TEMPLATE = `参考图按「图1、图2…」顺序上传，正文与分镜中用 @图N 精确指代：
{{items}}`;

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
  "items",
];

export const DEFAULT_NEGATIVE_TEXT =
  "禁止：换脸/换发型/换服装、站位翻转、跳轴、多手多脚、肢体粘连、画面畸变、文字水印、场景突变、光线跳变、角色消失或重复。";

// 道具资产建议上限（内容准则，非厂商能力）。道具会占参考图槽位，
// 只应保留「跨镜复用且外观一致」的关键道具。
export const MAX_PROP_ASSETS = 6;

// 说明：单段时长下限/上限、参考图槽位、每段镜数等能力上限一律取自资源库的厂商配置
// （library/vendors.json，见 @/lib/library/vendors），不再在此处写全局常量。

export const DEFAULT_TEMPLATES: PromptTemplateSeed[] = [
  {
    platform: "doubao",
    name: "豆包 Seedance 2.0（内置）",
    version: "2",
    bodyTemplate: DEFAULT_DOUBAO_BODY_TEMPLATE,
    paramsTemplate: DEFAULT_DOUBAO_PARAMS_TEMPLATE,
    legendTemplate: DEFAULT_DOUBAO_LEGEND_TEMPLATE,
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
  {
    platform: "h3",
    name: "MiniMax H3（简版）",
    version: "1",
    bodyTemplate: DEFAULT_H3_BODY_TEMPLATE,
    paramsTemplate: DEFAULT_H3_PARAMS_TEMPLATE,
    legendTemplate: DEFAULT_H3_LEGEND_TEMPLATE,
    variables: TEMPLATE_VARIABLES,
  },
];

export const PLATFORM_LABELS: Record<string, string> = {
  custom: "默认（通用）",
  doubao: "豆包",
  h3: "MiniMax H3",
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
