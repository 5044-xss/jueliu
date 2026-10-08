import { readLibrary, writeLibrary, newLibraryId } from "@/lib/library/store";
import {
  BUILTIN_SKILL_PROMPTS,
  BUILTIN_SKILL_VERSION,
} from "@/lib/skills/prompts";

export interface LibrarySkill {
  id: string;
  kind: string;
  name: string;
  prompt: string;
  temperature: number | null;
  isDefault: boolean;
  builtin: boolean;
  builtinVersion?: number;
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
  {
    kind: "storyboard-to-ai-prompt",
    label: "分镜 → AI 提示词",
    description: "把给人看的分镜提示词编译成 AI 图/视频生成可执行提示词",
  },
] as const;

export function getSkillKinds() {
  return SKILL_KINDS;
}

export function isSkillKind(kind: string): boolean {
  return SKILL_KINDS.some((k) => k.kind === kind);
}

function builtinSkill(kind: string): LibrarySkill {
  return {
    id: newLibraryId("sk"),
    kind,
    name: "内置默认",
    prompt: BUILTIN_SKILL_PROMPTS[kind] ?? "",
    temperature: null,
    isDefault: true,
    builtin: true,
    builtinVersion: BUILTIN_SKILL_VERSION,
  };
}

function normalize(raw: Partial<LibrarySkill>): {
  skill: LibrarySkill;
  changed: boolean;
} {
  const kind = typeof raw.kind === "string" ? raw.kind : "";
  const legacyBuiltin =
    raw.builtin === undefined &&
    raw.name === "内置默认" &&
    !(raw.prompt ?? "").trim();
  const builtin = raw.builtin === true || legacyBuiltin;

  let prompt = raw.prompt ?? "";
  let builtinVersion = raw.builtinVersion;
  let changed = raw.builtin === undefined || raw.id === undefined;

  if (builtin) {
    // 内置条目按版本自动刷新，保证升级提示词后能生效
    if (builtinVersion !== BUILTIN_SKILL_VERSION) {
      prompt = BUILTIN_SKILL_PROMPTS[kind] ?? prompt;
      builtinVersion = BUILTIN_SKILL_VERSION;
      changed = true;
    }
    if (!prompt.trim()) {
      prompt = BUILTIN_SKILL_PROMPTS[kind] ?? "";
      changed = true;
    }
  }

  const name = raw.name?.trim()
    ? raw.name
    : builtin
      ? "内置默认"
      : "未命名技能";
  if (name !== raw.name || prompt !== raw.prompt) changed = true;

  const skill: LibrarySkill = {
    id: raw.id ?? newLibraryId("sk"),
    kind,
    name,
    prompt,
    temperature: raw.temperature ?? null,
    isDefault: raw.isDefault === true,
    builtin,
    builtinVersion,
  };
  return { skill, changed };
}

export function getSkills(): LibrarySkill[] {
  const stored = readLibrary<Partial<LibrarySkill>>(FILE, []);
  let changed = false;
  const items: LibrarySkill[] = stored.map((raw) => {
    const { skill, changed: itemChanged } = normalize(raw);
    if (itemChanged) changed = true;
    return skill;
  });

  for (const meta of SKILL_KINDS) {
    if (!items.some((s) => s.kind === meta.kind)) {
      items.push(builtinSkill(meta.kind));
      changed = true;
    }
  }

  if (changed || items.length !== stored.length) {
    writeLibrary(FILE, items);
  }
  return items;
}

export function getSkillsByKind(kind: string): LibrarySkill[] {
  return getSkills().filter((s) => s.kind === kind);
}

export function getActiveSkill(kind: string): LibrarySkill | undefined {
  const list = getSkillsByKind(kind);
  return list.find((s) => s.isDefault) ?? list[0];
}

export function getActiveSkillPrompt(kind: string): string {
  return getActiveSkill(kind)?.prompt ?? "";
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
    builtin: false,
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
  if (!remaining.some((s) => s.kind === target.kind)) {
    remaining.push(builtinSkill(target.kind));
  }
  writeLibrary(FILE, remaining);
  return true;
}
