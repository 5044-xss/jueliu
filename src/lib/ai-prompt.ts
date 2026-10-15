// 「分镜 → AI 提示词」的缓存与签名。
// 签名覆盖所有会改变翻译结果的输入：渲染正文 + 厂商翻译提示词 + 模型。
// 任一项变化 → 签名失效 → 重新生成。
import { createHash } from "node:crypto";
import { getProjectDb } from "@/lib/db";
import { getProject } from "@/lib/projects";
import { renderSegment } from "@/lib/render";
import { getVendor, getVendors } from "@/lib/library/vendors";
import { DEFAULT_GENERIC_COMPILE_PROMPT } from "@/lib/orchestration/vendors";
import { readGlobalSettings } from "@/lib/settings";
import type { ManifestItem, RenderedPrompt } from "@/lib/render-types";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** 命中当前平台的厂商，取其翻译提示词；缺省回退通用提示词。 */
export function resolveCompilePrompt(
  projectId: string,
  platform: string,
): string {
  const project = getProject(projectId);
  const vendor =
    getVendors().find((v) => v.platform === platform) ??
    getVendor(project?.vendor);
  return vendor.compilePrompt?.trim() || DEFAULT_GENERIC_COMPILE_PROMPT;
}

export interface AiPromptSignature {
  rendered: RenderedPrompt;
  compilePrompt: string;
  sig: string;
}

/** 渲染正文并计算签名；段落不存在时返回 null。 */
export function buildAiPromptSignature(
  projectId: string,
  segmentId: string,
  platform: string,
): AiPromptSignature | null {
  const rendered = renderSegment(projectId, segmentId, platform);
  if (!rendered) return null;
  const compilePrompt = resolveCompilePrompt(projectId, platform);
  const model = readGlobalSettings().llm.model;
  const sig = sha256(
    [rendered.body, rendered.legend, rendered.params, compilePrompt, model].join(
      "\u0000",
    ),
  );
  return { rendered, compilePrompt, sig };
}

/** 读取命中签名的缓存提示词；签名不符或无缓存返回 null。 */
export function getCachedAiPrompt(
  projectId: string,
  segmentId: string,
  sig: string,
): string | null {
  const db = getProjectDb(projectId);
  const row = db
    .prepare("SELECT ai_prompt, ai_prompt_sig FROM segment WHERE id = ?")
    .get(segmentId) as
    | { ai_prompt: string | null; ai_prompt_sig: string | null }
    | undefined;
  if (!row || !row.ai_prompt || row.ai_prompt_sig !== sig) return null;
  return row.ai_prompt;
}

/**
 * 帧锚定兜底：清单里若有「本段起始画面」，确定性地在最前面补一行「首帧为图片N」，
 * 不依赖 LLM 是否服从规则。会清掉模型可能写错/重复的首帧行。
 */
export function withFirstFrameLine(
  text: string,
  manifest: ManifestItem[],
): string {
  const start = manifest.find((m) => m.role === "start");
  if (!start) return text;
  const body = text
    .split("\n")
    .filter((line) => !/^首帧为图片\d+/.test(line.trim()))
    .join("\n")
    .replace(/^\s*\n+/, "");
  return `首帧为图片${start.slot}\n${body}`;
}

/** 写入缓存（只更新提示词与签名，不动 updated_at）。 */
export function saveAiPrompt(
  projectId: string,
  segmentId: string,
  sig: string,
  prompt: string,
): void {
  const db = getProjectDb(projectId);
  db.prepare(
    "UPDATE segment SET ai_prompt = ?, ai_prompt_sig = ? WHERE id = ?",
  ).run(prompt, sig, segmentId);
}
