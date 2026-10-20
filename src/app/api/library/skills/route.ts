import { NextResponse } from "next/server";
import { z } from "zod";
import { listSkills } from "@core/server/skills/registry";
import {
  getSkills,
  getSkillKinds,
  createSkill,
  isSkillKind,
} from "@core/server/library/skills";

function schemaToJson(schema: z.ZodType): unknown {
  try {
    return z.toJSONSchema(schema);
  } catch {
    return null;
  }
}

export async function GET() {
  const registry = new Map(listSkills().map((s) => [s.id, s]));
  const kinds = getSkillKinds().map((meta) => {
    const skill = registry.get(meta.kind);
    return {
      ...meta,
      defaultPrompt: skill?.systemPrompt ?? "",
      inputSchema: skill ? schemaToJson(skill.inputSchema) : null,
      outputSchema: skill ? schemaToJson(skill.outputSchema) : null,
    };
  });
  return NextResponse.json({ skills: getSkills(), kinds });
}

const createSchema = z.object({
  kind: z.string(),
  name: z.string().min(1, "名称不能为空"),
  prompt: z.string().default(""),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数不合法" },
      { status: 400 },
    );
  }
  if (!isSkillKind(parsed.data.kind)) {
    return NextResponse.json({ error: "技能类型不存在" }, { status: 400 });
  }
  return NextResponse.json(
    { skill: createSkill(parsed.data) },
    { status: 201 },
  );
}
