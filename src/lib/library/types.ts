export interface LibraryStyle {
  id: string;
  name: string;
  prompt: string;
  builtin: boolean;
}

export interface LibraryTemplate {
  id: string;
  platform: "doubao" | "jimeng" | "custom" | string;
  name: string;
  version: string;
  bodyTemplate: string;
  paramsTemplate: string;
  legendTemplate: string;
  variables: string[];
  builtin: boolean;
}

export interface LibrarySkillOverride {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  promptTemplate: string;
  modelParams: { temperature?: number };
  builtin: boolean;
}
