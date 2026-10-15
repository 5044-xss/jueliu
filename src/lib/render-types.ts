export interface ManifestItem {
  slot: number;
  role: "start" | "character" | "scene" | "prop";
  label: string;
  imagePath: string | null;
  viewId: string | null;
  frameId: string | null;
  viewUrl: string | null;
}

export interface RenderedPrompt {
  platform: string;
  body: string;
  legend: string;
  params: string;
  manifest: ManifestItem[];
  /** 本段分镜数（用于按厂商能力做不匹配告警）。 */
  shotCount: number;
}
