import { z } from "zod";

export const assetTypeSchema = z.enum(["character", "scene", "prop"]);

export const assetViewDraftSchema = z.object({
  label: z.string(),
  prompt: z.string().default(""),
});

export const assetVariantDraftSchema = z.object({
  label: z.string(),
  prompt: z.string().default(""),
  views: z.array(assetViewDraftSchema).default([]),
});

export const assetDraftSchema = z.object({
  type: assetTypeSchema,
  name: z.string(),
  basePrompt: z.string().default(""),
  variants: z.array(assetVariantDraftSchema).default([]),
});

export const assetsDraftSchema = z.object({
  assets: z.array(assetDraftSchema),
});

export type AssetType = z.infer<typeof assetTypeSchema>;
export type AssetViewDraft = z.infer<typeof assetViewDraftSchema>;
export type AssetVariantDraft = z.infer<typeof assetVariantDraftSchema>;
export type AssetDraft = z.infer<typeof assetDraftSchema>;
export type AssetsDraft = z.infer<typeof assetsDraftSchema>;

export interface StoredView extends AssetViewDraft {
  id: string;
  imagePath: string | null;
}

export interface StoredVariant extends Omit<AssetVariantDraft, "views"> {
  id: string;
  views: StoredView[];
}

export interface StoredAsset {
  id: string;
  type: AssetType;
  name: string;
  basePrompt: string;
  variants: StoredVariant[];
}
