import { z } from "zod";

export const blockingNodeTypeSchema = z.enum([
  "character",
  "prop",
  "screen",
  "landmark",
]);

export const pointSchema = z.object({ x: z.number(), y: z.number() });

export const blockingNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: blockingNodeTypeSchema,
  pos: pointSchema,
  facing: z.number(),
});

export const blockingSchema = z.object({
  axis: z.object({ from: z.string(), to: z.string() }),
  cameraSide: z.enum(["left", "right"]),
  nodes: z.array(blockingNodeSchema).default([]),
  paths: z
    .array(
      z.object({
        nodeId: z.string(),
        points: z.array(pointSchema).default([]),
      }),
    )
    .default([]),
});

export const cameraSchema = z.object({
  focal: z.string().default(""),
  shotSize: z.string().default(""),
  angle: z.string().default(""),
  movement: z.string().default(""),
});

export const refRoleSchema = z.enum([
  "first_frame",
  "character",
  "scene",
  "prop",
]);

export const shotDraftSchema = z.object({
  durationMs: z.number().int().nonnegative().default(0),
  camera: cameraSchema.catch({
    focal: "",
    shotSize: "",
    angle: "",
    movement: "",
  }),
  lighting: z.string().default(""),
  action: z.string().default(""),
  dialogue: z.string().default(""),
  expression: z.string().default(""),
  refs: z
    .array(
      z.object({
        role: refRoleSchema,
        assetName: z.string().default(""),
        variantLabel: z.string().default(""),
        viewLabel: z.string().default(""),
      }),
    )
    .default([]),
});

export const segmentDraftSchema = z.object({
  index: z.number().int(),
  generationMode: z.enum(["multi-shot", "per-shot"]).default("multi-shot"),
  targetMs: z.number().int().positive().default(10000),
  shots: z.array(shotDraftSchema).min(1),
});

export const sceneStoryboardDraftSchema = z.object({
  sceneIndex: z.string(),
  blocking: blockingSchema,
  segments: z.array(segmentDraftSchema).default([]),
});

export const storyboardDraftSchema = z.object({
  scenes: z.array(sceneStoryboardDraftSchema),
});

export type BlockingNode = z.infer<typeof blockingNodeSchema>;
export type Blocking = z.infer<typeof blockingSchema>;
export type Camera = z.infer<typeof cameraSchema>;
export type RefRole = z.infer<typeof refRoleSchema>;
export type ShotDraft = z.infer<typeof shotDraftSchema>;
export type SegmentDraft = z.infer<typeof segmentDraftSchema>;
export type SceneStoryboardDraft = z.infer<typeof sceneStoryboardDraftSchema>;
export type StoryboardDraft = z.infer<typeof storyboardDraftSchema>;

export interface StoredRef {
  id: string;
  role: RefRole;
  assetId: string | null;
  variantId: string | null;
  viewId: string | null;
  assetName: string;
  variantLabel: string;
  viewLabel: string;
  imagePath: string | null;
}

export interface StoredShot {
  id: string;
  index: number;
  durationMs: number;
  camera: Camera;
  lighting: string;
  action: string;
  dialogue: string;
  expression: string;
  refs: StoredRef[];
}

export interface StoredSegment {
  id: string;
  sceneId: string;
  index: number;
  generationMode: "multi-shot" | "per-shot";
  targetMs: number;
  firstFrameId: string | null;
  status: "draft" | "generated" | "returned" | "composed";
  videoPath: string | null;
  shots: StoredShot[];
}

export interface StoredSceneStoryboard {
  sceneId: string;
  sceneIndex: string;
  sceneSlug: string;
  location: string;
  timeOfDay: string;
  interiorExterior: string;
  blocking: Blocking | null;
  segments: StoredSegment[];
}
