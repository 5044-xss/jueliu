import { readLibrary, writeLibrary, newLibraryId } from "@/lib/library/store";
import type { LibraryTemplate } from "@/lib/library/types";
import {
  DEFAULT_TEMPLATES,
  DEFAULT_BODY_TEMPLATE,
  DEFAULT_PARAMS_TEMPLATE,
  DEFAULT_LEGEND_TEMPLATE,
  TEMPLATE_VARIABLES,
} from "@/lib/templates-defaults";

const FILE = "templates.json";

const DEFAULT_LIBRARY_TEMPLATES: LibraryTemplate[] = DEFAULT_TEMPLATES.map(
  (tpl, i) => ({
    ...tpl,
    id: `tpl_${tpl.platform}_${i + 1}`,
    builtin: true,
  }),
);

export function getTemplates(): LibraryTemplate[] {
  const stored = readLibrary<LibraryTemplate>(FILE, []);
  if (stored.length === 0) {
    writeLibrary(FILE, DEFAULT_LIBRARY_TEMPLATES);
    return DEFAULT_LIBRARY_TEMPLATES;
  }
  return stored;
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
  const next = { ...templates[index], ...patch };
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
