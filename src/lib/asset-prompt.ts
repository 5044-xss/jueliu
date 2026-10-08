// 资产提示词只存「画面内容」，项目风格不写死在里面，而是在展示/复制时拼接。
// 这样切换风格能即时生效，也不会出现「水墨风 + 可见毛孔」这类风格自相矛盾。
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
