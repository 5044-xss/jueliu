import { z } from "zod";
import { generateText } from "@/lib/llm/structured";
import { DEFAULT_NEGATIVE_TEXT } from "@/lib/templates-defaults";
import { DEFAULT_GENERIC_COMPILE_PROMPT } from "@/lib/orchestration/vendors";
import {
  buildAiPromptSignature,
  saveAiPrompt,
  withFirstFrameLine,
} from "@/lib/ai-prompt";
import type { SkillDefinition } from "@/lib/skills/types";

const inputSchema = z.object({
  segmentId: z.string().min(1),
  platform: z.string().default("doubao"),
});

type Input = z.infer<typeof inputSchema>;

export const storyboardToAiPromptSkill: SkillDefinition<Input, string> = {
  id: "storyboard-to-ai-prompt",
  name: "分镜 → AI 提示词",
  description: "把给人看的分镜提示词编译成 AI 图/视频生成可执行提示词",
  version: "2",
  systemPrompt: DEFAULT_GENERIC_COMPILE_PROMPT,
  inputSchema,
  outputSchema: z.string(),
  async run(ctx, input) {
    // 翻译提示词按厂商隔离；签名覆盖正文 + 翻译提示词 + 模型，用于缓存失效。
    const info = buildAiPromptSignature(
      ctx.projectId,
      input.segmentId,
      input.platform,
    );
    if (!info) {
      throw new Error("段落不存在，请刷新分镜后重试。");
    }
    const { rendered, compilePrompt, sig } = info;

    const humanPrompt = [
      rendered.body,
      "",
      "【图片清单】",
      rendered.legend,
      "",
      "【生成参数】",
      rendered.params,
    ].join("\n");
    const user = [
      `【项目风格】${ctx.project.style || "未指定"}`,
      `【画面比例】${ctx.project.aspectRatio}`,
      `【负面约束基础项】${DEFAULT_NEGATIVE_TEXT}`,
      "",
      "【给人看的分镜提示词（待编译）】",
      humanPrompt,
      "",
      "请按格式输出 AI 可执行分镜提示词。",
    ].join("\n");

    const result = await generateText({
      system: compilePrompt,
      user,
    });
    if (!result.trim() || result.trim().length < 20) {
      throw new Error("AI 提示词生成结果为空，请重试或检查模型设置。");
    }
    // 帧锚定：LLM 常不服从“首帧”规则，这里确定性地在最前面补「首帧为图片N」。
    // MiniMax H3 用官方英文对齐句（由厂商编译器产出），不再叠加中文首帧行。
    const text =
      rendered.platform === "h3"
        ? result
        : withFirstFrameLine(result, rendered.manifest);

    saveAiPrompt(ctx.projectId, input.segmentId, sig, text);
    return text;
  },
};
