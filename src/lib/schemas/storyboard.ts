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
  side: z.enum(["left", "right", ""]).default(""),
});

export const refRoleSchema = z.enum([
  "first_frame",
  "character",
  "scene",
  "prop",
]);

// 一句台词必须带说话人，避免多角色台词混在一个分镜里、模型不知道谁在说。
export const dialogueLineSchema = z.object({
  character: z.string().default(""),
  text: z.string().default(""),
});

export const shotDraftSchema = z.object({
  durationMs: z.number().int().nonnegative().default(0),
  camera: cameraSchema.catch({
    focal: "",
    shotSize: "",
    angle: "",
    movement: "",
    side: "",
  }),
  lighting: z.string().default(""),
  action: z.string().default(""),
  dialogue: z.array(dialogueLineSchema).default([]),
  expression: z.string().default(""),
  subjectNodeIds: z.array(z.string()).default([]),
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
  // 本段与上一段是否硬切（换机位/时间跳/闪回）。false=连续镜头，需用上一段尾帧做首帧。
  // 场次首段由系统视为硬切，此字段只描述同一场内的段间关系。
  hardCut: z.boolean().default(false),
  // 平台硬约束：每段最多 3 个分镜。超过会解析失败并触发重试，强制模型拆段。
  shots: z.array(shotDraftSchema).min(1).max(3),
});

export const sceneStoryboardDraftSchema = z.object({
  sceneIndex: z.string(),
  blocking: blockingSchema,
  segments: z.array(segmentDraftSchema).default([]),
});

export const storyboardDraftSchema = z.object({
  scenes: z.array(sceneStoryboardDraftSchema),
});

export const segmentRepairSchema = z.object({
  shots: z.array(shotDraftSchema).min(1).max(3),
});

export type BlockingNode = z.infer<typeof blockingNodeSchema>;
export type Blocking = z.infer<typeof blockingSchema>;
export type Camera = z.infer<typeof cameraSchema>;
export type RefRole = z.infer<typeof refRoleSchema>;
export type DialogueLine = z.infer<typeof dialogueLineSchema>;
export type ShotDraft = z.infer<typeof shotDraftSchema>;
export type SegmentDraft = z.infer<typeof segmentDraftSchema>;
export type SceneStoryboardDraft = z.infer<typeof sceneStoryboardDraftSchema>;
export type StoryboardDraft = z.infer<typeof storyboardDraftSchema>;
export type SegmentRepair = z.infer<typeof segmentRepairSchema>;

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
  dialogue: DialogueLine[];
  expression: string;
  subjectNodeIds: string[];
  refs: StoredRef[];
  hasOriginal: boolean;
}

export interface StoredSegment {
  id: string;
  sceneId: string;
  index: number;
  generationMode: "multi-shot" | "per-shot";
  targetMs: number;
  firstFrameId: string | null;
  hardCut: boolean;
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
