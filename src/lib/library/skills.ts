import { readLibrary, writeLibrary, newLibraryId } from "@/lib/library/store";

export interface LibrarySkill {
  id: string;
  kind: string;
  name: string;
  prompt: string;
  temperature: number | null;
  isDefault: boolean;
}

const FILE = "skills.json";

export const SKILL_KINDS = [
  {
    kind: "story-to-script",
    label: "故事 → 剧本",
    description: "把原始故事改编为结构化分场剧本",
  },
  {
    kind: "script-to-assets",
    label: "剧本 → 资产",
    description: "从剧本提取角色/场景/道具与四视图提示词",
  },
  {
    kind: "script-to-storyboard",
    label: "剧本 → 分镜",
    description: "生成段落、分镜、参考图引用与 blocking",
  },
] as const;

export function getSkillKinds() {
  return SKILL_KINDS;
}

export function isSkillKind(kind: string): boolean {
  return SKILL_KINDS.some((k) => k.kind === kind);
}

export function getSkills(): LibrarySkill[] {
  const stored = readLibrary<LibrarySkill>(FILE, []);
  if (stored.length === 0) {
    const seeded: LibrarySkill[] = SKILL_KINDS.map((k) => ({
      id: newLibraryId("sk"),
      kind: k.kind,
      name: "内置默认",
      prompt: "",
      temperature: null,
      isDefault: true,
    }));
    writeLibrary(FILE, seeded);
    return seeded;
  }
  return stored;
}

export function getSkillsByKind(kind: string): LibrarySkill[] {
  return getSkills().filter((s) => s.kind === kind);
}

export function getActiveSkill(kind: string): LibrarySkill | undefined {
  const list = getSkillsByKind(kind);
  return list.find((s) => s.isDefault) ?? list[0];
}

export function getActiveSkillPrompt(kind: string): string | null {
  const active = getActiveSkill(kind);
  if (!active || !active.prompt.trim()) return null;
  return active.prompt;
}

export function getActiveSkillTemperature(kind: string): number | undefined {
  return getActiveSkill(kind)?.temperature ?? undefined;
}

export function createSkill(input: {
  kind: string;
  name: string;
  prompt: string;
}): LibrarySkill {
  const skills = getSkills();
  const skill: LibrarySkill = {
    id: newLibraryId("sk"),
    kind: input.kind,
    name: input.name.trim() || "新技能",
    prompt: input.prompt,
    temperature: null,
    isDefault: false,
  };
  writeLibrary(FILE, [...skills, skill]);
  return skill;
}

export function updateSkill(
  id: string,
  patch: Partial<Pick<LibrarySkill, "name" | "prompt" | "temperature">>,
): LibrarySkill | null {
  const skills = getSkills();
  const index = skills.findIndex((s) => s.id === id);
  if (index < 0) return null;
  skills[index] = { ...skills[index], ...patch };
  writeLibrary(FILE, skills);
  return skills[index];
}

export function setDefaultSkill(id: string): LibrarySkill | null {
  const skills = getSkills();
  const target = skills.find((s) => s.id === id);
  if (!target) return null;
  const next = skills.map((s) =>
    s.kind === target.kind ? { ...s, isDefault: s.id === id } : s,
  );
  writeLibrary(FILE, next);
  return next.find((s) => s.id === id) ?? null;
}

export function deleteSkill(id: string): boolean {
  const skills = getSkills();
  const target = skills.find((s) => s.id === id);
  if (!target) return false;
  const remaining = skills.filter((s) => s.id !== id);
  if (target.isDefault) {
    const sameKind = remaining.filter((s) => s.kind === target.kind);
    if (sameKind.length > 0) {
      sameKind[0].isDefault = true;
    }
  }
  writeLibrary(FILE, remaining);
  return true;
}
