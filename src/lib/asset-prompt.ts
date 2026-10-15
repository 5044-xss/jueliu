// 资产提示词只存「画面内容」，项目风格不写死在里面，而是在展示/复制时拼接。
// 这样切换风格能即时生效，也不会出现「水墨风 + 可见毛孔」这类风格自相矛盾。
import type { AssetType } from "@/lib/schemas/assets";

export function stripStyle(text: string, style: string): string {
  const target = style.trim();
  if (!text || !target) return text;
  let out = text.split(target).join("");
  out = out.replace(/[，,、]\s*(?:[，,、]\s*)+/g, "，");
  out = out.replace(/^[\s，,、]+|[\s，,、]+$/g, "");
  return out;
}

export function composeAssetPrompt(prompt: string, style: string): string {
  const base = (prompt ?? "").trim();
  if (!base) return "";
  const target = style?.trim() ?? "";
  if (!target) return base;
  const stripped = stripStyle(base, target).trim();
  return stripped ? `${stripped}，${target}` : target;
}

// 参考图的「构图文案」由代码统一添加（不再由 LLM 写进 view.prompt）。
// 这样调整构图（四视图比例 / 场景俯瞰 / 道具三视图）是改代码，改完立即生效，无需重新生成资产。
export function assetViewLayout(type: AssetType, viewLabel: string): string {
  const label = (viewLabel ?? "").trim();
  if (type === "character") {
    return "同一张图内呈现正面、侧面、背面、45°四个角度并排，纯色背景，全身，五官、发型、服装完全一致，横版 16:9 构图";
  }
  if (type === "scene") {
    if (label.includes("俯瞰")) {
      return "从正上方垂直向下看的平面俯视空镜（鸟瞰，无透视倾斜），只画该空间的主要地标与开阔区域的相对位置关系，纯空镜无人物，横版 16:9";
    }
    if (label.includes("反打")) {
      return "从轴线另一侧看同一空间的反打空镜，空间结构、陈设、材质、光源方向与全景完全一致，只是观察方向相反，纯空镜无人物，横版 16:9";
    }
    return "干净的横版 16:9 场景全景空镜，展示空间结构、主要陈设、材质主色调与光源方向，纯空镜无人物";
  }
  // 道具
  if (label.includes("三视")) {
    return "同一道具的正面、侧面、背面三个视角并排，纯白背景，均匀柔光，三个视角等大且材质颜色完全一致，正方形 1:1";
  }
  return "道具正面，纯白背景，均匀柔光，正方形 1:1";
}

export interface AssetViewPromptInput {
  type: AssetType;
  viewLabel: string;
  /** 资产锚点（不变项）。 */
  basePrompt: string;
  /** 该变体的变化项（服装/时段/形态），可空。 */
  variantPrompt?: string;
  style: string;
}

// 拼接最终「可直接文生图」的参考图提示词 = 内容(锚点+变化) + 构图(代码) + 风格(代码)。
export function composeAssetViewPrompt(input: AssetViewPromptInput): string {
  const content = [input.basePrompt.trim(), (input.variantPrompt ?? "").trim()]
    .filter(Boolean)
    .join("，");
  const layout = assetViewLayout(input.type, input.viewLabel);
  const body = [content, layout].filter(Boolean).join("，");
  return composeAssetPrompt(body, input.style);
}
