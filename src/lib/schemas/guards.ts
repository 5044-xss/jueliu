import { scriptSchema, type Script } from "@/lib/schemas/script";
import { assetsDraftSchema, type AssetsDraft } from "@/lib/schemas/assets";
import {
  storyboardDraftSchema,
  type StoryboardDraft,
} from "@/lib/schemas/storyboard";

export function isScript(value: unknown): value is Script {
  return scriptSchema.safeParse(value).success;
}

export function isAssetsDraft(value: unknown): value is AssetsDraft {
  return assetsDraftSchema.safeParse(value).success;
}

export function isStoryboardDraft(value: unknown): value is StoryboardDraft {
  return storyboardDraftSchema.safeParse(value).success;
}
