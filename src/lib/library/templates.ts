import { readLibrary, writeLibrary, newLibraryId } from "@/lib/library/store";
import type { LibraryTemplate } from "@/lib/library/types";
import {
  DEFAULT_TEMPLATES,
  DEFAULT_BODY_TEMPLATE,
  DEFAULT_PARAMS_TEMPLATE,
  DEFAULT_LEGEND_TEMPLATE,
  TEMPLATE_VARIABLES,
  BUILTIN_TEMPLATE_VERSION,
} from "@/lib/templates-defaults";

const FILE = "templates.json";

const DEFAULT_LIBRARY_TEMPLATES: LibraryTemplate[] = DEFAULT_TEMPLATES.map(
  (tpl, i) => ({
    ...tpl,
    id: `tpl_${tpl.platform}_${i + 1}`,
    builtin: true,
    builtinVersion: BUILTIN_TEMPLATE_VERSION,
    edited: false,
  }),
);

function defaultByPlatform(platform: string) {
  return DEFAULT_TEMPLATES.find((t) => t.platform === platform) ?? null;
}

export function getTemplates(): LibraryTemplate[] {
  const stored = readLibrary<LibraryTemplate>(FILE, []);
  if (stored.length === 0) {
    writeLibrary(FILE, DEFAULT_LIBRARY_TEMPLATES);
    return DEFAULT_LIBRARY_TEMPLATES;
  }
  let changed = false;
  // 旧版本会内置即梦(jimeng)模板，现已下线，读取时自动清理。
  let items = stored.filter((t) => {
    if (t.platform === "jimeng") {
      changed = true;
      return false;
    }
    return true;
  });
  // 未被用户改动过的内置模板，按版本自动刷新到最新内置正文。
  items = items.map((t) => {
    if (!t.builtin || t.edited) return t;
    if (t.builtinVersion === BUILTIN_TEMPLATE_VERSION) return t;
    const def = defaultByPlatform(t.platform);
    if (!def) return t;
    changed = true;
    return {
      ...t,
      bodyTemplate: def.bodyTemplate,
      paramsTemplate: def.paramsTemplate,
      legendTemplate: def.legendTemplate,
      variables: def.variables,
      builtinVersion: BUILTIN_TEMPLATE_VERSION,
    };
  });
  // 补齐后来新增的内置平台模板（如 H3），避免老项目拿不到。
  const present = new Set(items.map((t) => t.platform));
  const missing = DEFAULT_LIBRARY_TEMPLATES.filter(
    (t) => !present.has(t.platform),
  );
  if (missing.length) {
    items = [...items, ...missing];
    changed = true;
  }
  if (changed) writeLibrary(FILE, items);
  return items;
}

export function getTemplateByPlatform(platform: string): LibraryTemplate {
  const templates = getTemplates();
  return (
    templates.find((t) => t.platform === platform) ??
    templates.find((t) => t.platform === "custom") ??
    templates[0]
  );
}

export function createTemplate(input: {
  platform: string;
  name: string;
}): LibraryTemplate {
  const templates = getTemplates();
  const tpl: LibraryTemplate = {
    id: newLibraryId("tpl"),
    platform: input.platform,
    name: input.name.trim() || "新模板",
    version: "1",
    bodyTemplate: DEFAULT_BODY_TEMPLATE,
    paramsTemplate: DEFAULT_PARAMS_TEMPLATE,
    legendTemplate: DEFAULT_LEGEND_TEMPLATE,
    variables: TEMPLATE_VARIABLES,
    builtin: false,
  };
  writeLibrary(FILE, [...templates, tpl]);
  return tpl;
}

export function updateTemplate(
  id: string,
  patch: Partial<
    Pick<
      LibraryTemplate,
      "name" | "bodyTemplate" | "paramsTemplate" | "legendTemplate" | "version"
    >
  >,
): LibraryTemplate | null {
  const templates = getTemplates();
  const index = templates.findIndex((t) => t.id === id);
  if (index < 0) return null;
  const current = templates[index];
  // 内置模板一旦被用户改动，就标记 edited，后续不再随版本自动覆盖。
  const edited = current.builtin ? true : current.edited;
  const next = { ...current, ...patch, edited };
  templates[index] = next;
  writeLibrary(FILE, templates);
  return next;
}

export function deleteTemplate(id: string): boolean {
  const templates = getTemplates();
  const next = templates.filter((t) => t.id !== id);
  if (next.length === templates.length) return false;
  writeLibrary(FILE, next);
  return true;
}
