import type { Db } from "@/lib/db";
import { newId, nowIso } from "@/lib/db";

export const DEFAULT_CONTINUITY_RULES = {
  axis180: true,
  eyelineMatch: true,
  lightingContinuity: true,
  focalLogic: true,
  wardrobeProp: true,
  blockingLock: true,
  actionMatch: true,
  firstFrameAnchor: true,
};

export const BUILTIN_SKILLS = [
  {
    name: "story-to-script",
    description: "故事 → 结构化剧本（场次/对白/动作）",
    version: "1",
  },
  {
    name: "script-to-assets",
    description: "剧本 → 角色/场景/道具 + 四视图提示词 + 变体建议",
    version: "1",
  },
  {
    name: "script-to-storyboard",
    description: "剧本 + 资产 + 连续性规则 → 段/分镜/参考图引用/blocking",
    version: "1",
  },
];

export function seedProjectDefaults(db: Db, projectId: string): void {
  const hasRules = db
    .prepare("SELECT id FROM continuity_rule_set WHERE project_id = ? LIMIT 1")
    .get(projectId);
  if (!hasRules) {
    db.prepare(
      `INSERT INTO continuity_rule_set (id, project_id, rules_json, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(
      newId(),
      projectId,
      JSON.stringify(DEFAULT_CONTINUITY_RULES),
      nowIso(),
    );
  }

  for (const skill of BUILTIN_SKILLS) {
    const exists = db
      .prepare("SELECT id FROM skill WHERE name = ? LIMIT 1")
      .get(skill.name);
    if (!exists) {
      db.prepare(
        `INSERT INTO skill (id, name, description, version, enabled, config_json)
         VALUES (?, ?, ?, ?, 1, '{}')`,
      ).run(newId(), skill.name, skill.description, skill.version);
    }
  }
}
