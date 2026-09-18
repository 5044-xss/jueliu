import { readLibrary, writeLibrary, newLibraryId } from "@/lib/library/store";
import type { LibraryStyle } from "@/lib/library/types";

const FILE = "styles.json";

export const DEFAULT_STYLES: LibraryStyle[] = [
  {
    id: "style_anime_cel",
    name: "日系赛璐璐漫剧",
    prompt:
      "日系赛璐璐漫剧风格，细腻描线，干净色块，电影级布光，人物比例写实偏美化",
    builtin: true,
  },
  {
    id: "style_cn_realistic",
    name: "写实国漫",
    prompt:
      "写实国漫风格，半写实人体，精致五官，柔和厚涂阴影，电影级构图与布光",
    builtin: true,
  },
  {
    id: "style_painterly",
    name: "厚涂电影感",
    prompt:
      "厚涂插画风格，丰富笔触与体积光，高对比电影级布光，氛围感强",
    builtin: true,
  },
  {
    id: "style_ink",
    name: "国风水墨",
    prompt:
      "中国水墨画风格，留白意境，墨色浓淡晕染，淡雅配色，古典东方美学",
    builtin: true,
  },
  {
    id: "style_3d_cartoon",
    name: "3D 卡通",
    prompt:
      "3D 卡通渲染风格，皮克斯质感，圆润造型，柔和全局光照，材质细腻",
    builtin: true,
  },
  {
    id: "style_comic_ink",
    name: "热血漫画",
    prompt:
      "日式热血漫画风格，强对比黑白线稿上色，速度线与集中线，夸张透视",
    builtin: true,
  },
];

export function getStyles(): LibraryStyle[] {
  const stored = readLibrary<LibraryStyle>(FILE, []);
  if (stored.length === 0) {
    writeLibrary(FILE, DEFAULT_STYLES);
    return DEFAULT_STYLES;
  }
  return stored;
}

export function createStyle(input: { name: string; prompt: string }): LibraryStyle {
  const styles = getStyles();
  const style: LibraryStyle = {
    id: newLibraryId("style"),
    name: input.name.trim() || "未命名风格",
    prompt: input.prompt,
    builtin: false,
  };
  writeLibrary(FILE, [...styles, style]);
  return style;
}

export function updateStyle(
  id: string,
  patch: Partial<Pick<LibraryStyle, "name" | "prompt">>,
): LibraryStyle | null {
  const styles = getStyles();
  const index = styles.findIndex((s) => s.id === id);
  if (index < 0) return null;
  const next = { ...styles[index], ...patch };
  styles[index] = next;
  writeLibrary(FILE, styles);
  return next;
}

export function deleteStyle(id: string): boolean {
  const styles = getStyles();
  const next = styles.filter((s) => s.id !== id);
  if (next.length === styles.length) return false;
  writeLibrary(FILE, next);
  return true;
}

export function getStylePrompt(id: string | null | undefined): string | null {
  if (!id) return null;
  return getStyles().find((s) => s.id === id)?.prompt ?? null;
}
