export interface LibraryStyle {
  id: string;
  name: string;
  prompt: string;
  builtin: boolean;
}

export interface LibraryTemplate {
  id: string;
  platform: "doubao" | "custom" | string;
  name: string;
  version: string;
  bodyTemplate: string;
  paramsTemplate: string;
  legendTemplate: string;
  variables: string[];
  builtin: boolean;
  /** 内置模板的版本号；与当前内置版本不一致时自动刷新（用户改过的除外）。 */
  builtinVersion?: number;
  /** 用户是否改过内置模板；改过则不再随内置版本自动刷新。 */
  edited?: boolean;
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
