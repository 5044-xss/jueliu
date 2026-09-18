import type { ZodType } from "zod";
import type { Project } from "@/lib/projects";
import type { StoredScript } from "@/lib/script";
import type { StoredAsset } from "@/lib/schemas/assets";

export interface SkillRunContext {
  projectId: string;
  project: Project;
  story: string;
  script: StoredScript | null;
  assets: StoredAsset[];
  rules: Record<string, boolean>;
}

export interface SkillDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  name: string;
  description: string;
  version: string;
  systemPrompt: string;
  inputSchema: ZodType<TInput>;
  outputSchema: ZodType<TOutput>;
  run(ctx: SkillRunContext, input: TInput): Promise<TOutput>;
}
