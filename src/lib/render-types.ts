export interface ManifestItem {
  slot: number;
  role: "first_frame" | "character" | "scene" | "prop";
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
}
