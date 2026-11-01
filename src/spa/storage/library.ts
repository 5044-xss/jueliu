import { db } from "./db";
import type { LibraryStyle, LibraryTemplate } from "@core/shared/library/types";
import type { LibrarySkill } from "@core/shared/library/skills";
import { SKILL_KINDS } from "@core/shared/library/skills";
import type { LibraryVendor } from "@core/shared/library/vendors";
import {
  BUILTIN_STORYBOARD_STRATEGIES,
  BUILTIN_STORYBOARD_STRATEGY_VERSION,
  cloneStoryboardStrategyParams,
  cloneStoryboardStrategyTexts,
  type LibraryStoryboardStrategy,
} from "@core/shared/library/storyboard-strategies";
import {
  DEFAULT_TEMPLATES,
  BUILTIN_TEMPLATE_VERSION,
} from "@core/shared/templates-defaults";
import {
  DEFAULT_VENDOR,
  DEFAULT_VENDORS,
} from "@core/shared/orchestration/vendors";
import type { LibraryAssetItem } from "@core/shared/library/assets";
import {
  BUILTIN_SKILL_PROMPTS,
  BUILTIN_SKILL_VERSION,
} from "@core/server/skills/prompts";
import { DEFAULT_STYLES } from "../library/default-styles";

export type StoredLibraryAsset = LibraryAssetItem & {
  mediaId?: string | null;
};

const KEYS = {
  styles: "library:styles",
  skills: "library:skills",
  vendors: "library:vendors",
  strategies: "library:storyboard-strategies",
  templates: "library:templates",
} as const;

function now(): string {
  return new Date().toISOString();
}

export function newLibraryId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function readRaw<T>(key: string): Promise<T | null> {
  const record = await db.settings.get(key);
  return (record?.value as T | undefined) ?? null;
}

async function writeRaw<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value, updatedAt: now() });
}

async function readList<T>(key: string, seed: () => T[]): Promise<T[]> {
  const stored = await readRaw<T[]>(key);
  if (stored === null) {
    const items = seed();
    await writeRaw(key, items);
    return items;
  }
  return Array.isArray(stored) ? stored : [];
}

function seedSkills(): LibrarySkill[] {
  return SKILL_KINDS.map((meta) => ({
    id: `sk_builtin_${meta.kind}`,
    kind: meta.kind,
    name: "内置默认",
    prompt: BUILTIN_SKILL_PROMPTS[meta.kind] ?? "",
    temperature: null,
    isDefault: true,
    builtin: true,
    builtinVersion: BUILTIN_SKILL_VERSION,
  }));
}

function seedVendors(): LibraryVendor[] {
  return DEFAULT_VENDORS.map((vendor) => ({
    ...vendor,
    builtin: true,
    isDefault: vendor.id === DEFAULT_VENDOR,
    builtinVersion: 4,
    edited: false,
  }));
}

function seedStrategies(): LibraryStoryboardStrategy[] {
  return BUILTIN_STORYBOARD_STRATEGIES.map((strategy) => ({
    ...strategy,
    params: cloneStoryboardStrategyParams(strategy.params),
    texts: cloneStoryboardStrategyTexts(strategy.texts),
  }));
}

function seedTemplates(): LibraryTemplate[] {
  return DEFAULT_TEMPLATES.map((template, index) => ({
    ...template,
    id: `tpl_${template.platform}_${index + 1}`,
    builtin: true,
    builtinVersion: BUILTIN_TEMPLATE_VERSION,
    edited: false,
  }));
}

export const libraryRepository = {
  async getStyles(): Promise<LibraryStyle[]> {
    return readList(KEYS.styles, () => DEFAULT_STYLES.map((s) => ({ ...s })));
  },
  async saveStyles(styles: LibraryStyle[]): Promise<void> {
    await writeRaw(KEYS.styles, styles);
  },
  async createStyle(input: {
    name: string;
    prompt?: string;
    videoStyle?: string;
  }): Promise<LibraryStyle> {
    const styles = await this.getStyles();
    const style: LibraryStyle = {
      id: newLibraryId("style"),
      name: input.name.trim() || "新风格",
      prompt: input.prompt ?? "",
      videoStyle: input.videoStyle ?? "",
      builtin: false,
    };
    await this.saveStyles([...styles, style]);
    return style;
  },
  async updateStyle(
    id: string,
    patch: Partial<Pick<LibraryStyle, "name" | "prompt" | "videoStyle">>,
  ): Promise<LibraryStyle | null> {
    const styles = await this.getStyles();
    const index = styles.findIndex((style) => style.id === id);
    if (index < 0) return null;
    const next = { ...styles[index], ...patch };
    styles[index] = next;
    await this.saveStyles(styles);
    return next;
  },
  async deleteStyle(id: string): Promise<boolean> {
    const styles = await this.getStyles();
    const next = styles.filter((style) => style.id !== id);
    if (next.length === styles.length) return false;
    await this.saveStyles(next);
    return true;
  },

  async getSkills(): Promise<LibrarySkill[]> {
    return readList(KEYS.skills, seedSkills);
  },
  async saveSkills(skills: LibrarySkill[]): Promise<void> {
    await writeRaw(KEYS.skills, skills);
  },
  async createSkill(input: {
    kind: string;
    name: string;
    prompt?: string;
  }): Promise<LibrarySkill> {
    const skills = await this.getSkills();
    const skill: LibrarySkill = {
      id: newLibraryId("sk"),
      kind: input.kind,
      name: input.name.trim() || "新技能",
      prompt: input.prompt ?? "",
      temperature: null,
      isDefault: false,
      builtin: false,
    };
    await this.saveSkills([...skills, skill]);
    return skill;
  },
  async updateSkill(
    id: string,
    patch: Partial<Pick<LibrarySkill, "name" | "prompt" | "temperature">>,
  ): Promise<LibrarySkill | null> {
    const skills = await this.getSkills();
    const index = skills.findIndex((skill) => skill.id === id);
    if (index < 0) return null;
    const current = skills[index];
    const next: LibrarySkill = {
      ...current,
      ...patch,
      edited: current.builtin ? true : current.edited,
    };
    skills[index] = next;
    await this.saveSkills(skills);
    return next;
  },
  async deleteSkill(id: string): Promise<boolean> {
    const skills = await this.getSkills();
    const target = skills.find((skill) => skill.id === id);
    if (!target || target.builtin) return false;
    await this.saveSkills(skills.filter((skill) => skill.id !== id));
    return true;
  },
  async setDefaultSkill(id: string): Promise<LibrarySkill | null> {
    const skills = await this.getSkills();
    const target = skills.find((skill) => skill.id === id);
    if (!target) return null;
    const next = skills.map((skill) =>
      skill.kind === target.kind
        ? { ...skill, isDefault: skill.id === id }
        : skill,
    );
    await this.saveSkills(next);
    return next.find((skill) => skill.id === id) ?? null;
  },
  async getActiveSkill(kind: string): Promise<LibrarySkill | null> {
    const skills = (await this.getSkills()).filter(
      (skill) => skill.kind === kind,
    );
    return skills.find((skill) => skill.isDefault) ?? skills[0] ?? null;
  },

  async getVendors(): Promise<LibraryVendor[]> {
    return readList(KEYS.vendors, seedVendors);
  },
  async saveVendors(vendors: LibraryVendor[]): Promise<void> {
    await writeRaw(KEYS.vendors, vendors);
  },
  async getVendor(id: string): Promise<LibraryVendor | null> {
    const vendors = await this.getVendors();
    return (
      vendors.find((vendor) => vendor.id === id) ??
      vendors.find((vendor) => vendor.isDefault) ??
      vendors.find((vendor) => vendor.id === DEFAULT_VENDOR) ??
      vendors[0] ??
      null
    );
  },
  async getDefaultVendor(): Promise<LibraryVendor | null> {
    const vendors = await this.getVendors();
    return (
      vendors.find((vendor) => vendor.isDefault) ??
      vendors.find((vendor) => vendor.id === DEFAULT_VENDOR) ??
      vendors[0] ??
      null
    );
  },
  async createVendor(input: {
    name: string;
    platform?: string;
    note?: string;
    maxShotsPerSegment?: number;
    supportMultiShot?: boolean;
    maxRefImages?: number;
    minSegmentMs?: number;
    maxSegmentMs?: number;
    durationStepMs?: number;
    supportFirstFrame?: boolean;
    supportLastFrame?: boolean;
    compilePrompt?: string;
  }): Promise<LibraryVendor> {
    const vendors = await this.getVendors();
    const platform = input.platform?.trim() || "custom";
    const preset = DEFAULT_VENDORS.find((item) => item.platform === platform);
    const vendor: LibraryVendor = {
      id: newLibraryId("vend"),
      name: input.name.trim() || "新厂商",
      platform,
      maxShotsPerSegment: input.maxShotsPerSegment ?? 1,
      supportMultiShot: input.supportMultiShot ?? false,
      maxRefImages: input.maxRefImages ?? 3,
      minSegmentMs: input.minSegmentMs ?? 4000,
      maxSegmentMs: input.maxSegmentMs ?? 10000,
      durationStepMs: input.durationStepMs ?? 0,
      supportFirstFrame: input.supportFirstFrame ?? true,
      supportLastFrame: input.supportLastFrame ?? false,
      note: input.note?.trim() || "",
      compilePrompt: input.compilePrompt ?? preset?.compilePrompt ?? "",
      builtin: false,
      isDefault: false,
    };
    await this.saveVendors([...vendors, vendor]);
    return vendor;
  },
  async updateVendor(
    id: string,
    patch: Partial<LibraryVendor>,
  ): Promise<LibraryVendor | null> {
    const vendors = await this.getVendors();
    const index = vendors.findIndex((vendor) => vendor.id === id);
    if (index < 0) return null;
    const current = vendors[index];
    const next: LibraryVendor = {
      ...current,
      ...patch,
      id: current.id,
      builtin: current.builtin,
      edited: current.builtin ? true : current.edited,
    };
    vendors[index] = next;
    await this.saveVendors(vendors);
    return next;
  },
  async deleteVendor(id: string): Promise<boolean> {
    const vendors = await this.getVendors();
    const target = vendors.find((vendor) => vendor.id === id);
    if (!target || target.builtin) return false;
    await this.saveVendors(vendors.filter((vendor) => vendor.id !== id));
    return true;
  },
  async setDefaultVendor(id: string): Promise<LibraryVendor | null> {
    const vendors = await this.getVendors();
    const target = vendors.find((vendor) => vendor.id === id);
    if (!target) return null;
    const next = vendors.map((vendor) => ({
      ...vendor,
      isDefault: vendor.id === id,
    }));
    await this.saveVendors(next);
    return next.find((vendor) => vendor.id === id) ?? null;
  },

  async getStrategies(): Promise<LibraryStoryboardStrategy[]> {
    return readList(KEYS.strategies, seedStrategies);
  },
  async saveStrategies(strategies: LibraryStoryboardStrategy[]): Promise<void> {
    await writeRaw(KEYS.strategies, strategies);
  },
  async createStrategy(input: {
    name: string;
    description?: string;
    params?: Partial<LibraryStoryboardStrategy["params"]>;
    texts?: Partial<LibraryStoryboardStrategy["texts"]>;
  }): Promise<LibraryStoryboardStrategy> {
    const strategies = await this.getStrategies();
    const strategy: LibraryStoryboardStrategy = {
      id: newLibraryId("sbs"),
      name: input.name.trim() || "新策略",
      description: input.description ?? "",
      version: 1,
      params: {
        ...cloneStoryboardStrategyParams(
          BUILTIN_STORYBOARD_STRATEGIES[0].params,
        ),
        ...(input.params ?? {}),
      },
      texts: {
        ...cloneStoryboardStrategyTexts(BUILTIN_STORYBOARD_STRATEGIES[0].texts),
        ...(input.texts ?? {}),
      },
      builtin: false,
      builtinVersion: BUILTIN_STORYBOARD_STRATEGY_VERSION,
      isDefault: false,
    };
    await this.saveStrategies([...strategies, strategy]);
    return strategy;
  },
  async updateStrategy(
    id: string,
    patch: Partial<LibraryStoryboardStrategy>,
  ): Promise<LibraryStoryboardStrategy | null> {
    const strategies = await this.getStrategies();
    const index = strategies.findIndex((strategy) => strategy.id === id);
    if (index < 0) return null;
    const current = strategies[index];
    const next: LibraryStoryboardStrategy = {
      ...current,
      ...patch,
      id: current.id,
      builtin: current.builtin,
      edited: current.builtin ? true : current.edited,
    };
    strategies[index] = next;
    await this.saveStrategies(strategies);
    return next;
  },
  async deleteStrategy(id: string): Promise<boolean> {
    const strategies = await this.getStrategies();
    const target = strategies.find((strategy) => strategy.id === id);
    if (!target || target.builtin) return false;
    await this.saveStrategies(
      strategies.filter((strategy) => strategy.id !== id),
    );
    return true;
  },
  async setDefaultStrategy(id: string): Promise<LibraryStoryboardStrategy | null> {
    const strategies = await this.getStrategies();
    const target = strategies.find((strategy) => strategy.id === id);
    if (!target) return null;
    const next = strategies.map((strategy) => ({
      ...strategy,
      isDefault: strategy.id === id,
    }));
    await this.saveStrategies(next);
    return next.find((strategy) => strategy.id === id) ?? null;
  },

  async getTemplates(): Promise<LibraryTemplate[]> {
    return readList(KEYS.templates, seedTemplates);
  },
  async saveTemplates(templates: LibraryTemplate[]): Promise<void> {
    await writeRaw(KEYS.templates, templates);
  },
  async updateTemplate(
    id: string,
    patch: Partial<
      Pick<
        LibraryTemplate,
        "name" | "bodyTemplate" | "paramsTemplate" | "legendTemplate" | "version"
      >
    >,
  ): Promise<LibraryTemplate | null> {
    const templates = await this.getTemplates();
    const index = templates.findIndex((template) => template.id === id);
    if (index < 0) return null;
    const current = templates[index];
    const next: LibraryTemplate = {
      ...current,
      ...patch,
      edited: current.builtin ? true : current.edited,
    };
    templates[index] = next;
    await this.saveTemplates(templates);
    return next;
  },
  async getTemplateByPlatform(platform: string): Promise<LibraryTemplate | null> {
    const templates = await this.getTemplates();
    return (
      templates.find((template) => template.platform === platform) ??
      templates.find((template) => template.platform === "custom") ??
      templates[0] ??
      null
    );
  },

  async listAssets(
    scope: "global" | "project",
    seriesId: string | null,
  ): Promise<StoredLibraryAsset[]> {
    const key =
      scope === "global"
        ? "library:assets:global"
        : `library:assets:project:${seriesId ?? ""}`;
    return readList<StoredLibraryAsset>(key, () => []);
  },
  async saveAssets(
    scope: "global" | "project",
    seriesId: string | null,
    items: StoredLibraryAsset[],
  ): Promise<void> {
    const key =
      scope === "global"
        ? "library:assets:global"
        : `library:assets:project:${seriesId ?? ""}`;
    await writeRaw(key, items);
  },
};
