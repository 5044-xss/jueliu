import type { SkillDefinition } from "@/lib/skills/types";
import { storyToScriptSkill } from "@/lib/skills/story-to-script";
import { scriptToAssetsSkill } from "@/lib/skills/script-to-assets";
import { scriptToStoryboardSkill } from "@/lib/skills/script-to-storyboard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry = new Map<string, SkillDefinition<any, any>>();

export function registerSkill(skill: SkillDefinition): void {
  registry.set(skill.id, skill);
}

export function getSkill(id: string): SkillDefinition | undefined {
  return registry.get(id);
}

export function listSkills(): SkillDefinition[] {
  return [...registry.values()];
}

registerSkill(storyToScriptSkill);
registerSkill(scriptToAssetsSkill);
registerSkill(scriptToStoryboardSkill);
