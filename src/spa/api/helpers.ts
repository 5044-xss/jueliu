import type { Project } from "@core/shared/projects";
import type {
  AssetDraft,
  StoredAsset,
  StoredVariant,
  StoredView,
} from "@core/shared/schemas/assets";
import {
  CHARACTER_VIEW_SPEC,
  inferViewKind,
  type AssetType,
  type CharacterViewMode,
} from "@core/shared/schemas/assets";
import type {
  StoredRef,
  StoredSceneStoryboard,
  StoredSegment,
  StoredShot,
} from "@core/shared/schemas/storyboard";
import type { RefOverrideItem } from "@core/shared/render-types";
import type { LibraryStoryboardStrategy } from "@core/shared/library/storyboard-strategies";
import type { LibraryVendor } from "@core/shared/library/vendors";
import { projectRepository } from "../storage/projects";
import type { ProjectDoc, ProjectRecord } from "../storage/types";
import { libraryRepository } from "../storage/library";

export function now(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function findScene(
  doc: ProjectDoc,
  sceneId: string,
): StoredSceneStoryboard | undefined {
  return doc.storyboard.find((scene) => scene.sceneId === sceneId);
}

export function findSegment(
  doc: ProjectDoc,
  segmentId: string,
): { scene: StoredSceneStoryboard; segment: StoredSegment; index: number } | null {
  for (const scene of doc.storyboard) {
    const index = scene.segments.findIndex(
      (segment) => segment.id === segmentId,
    );
    if (index >= 0) return { scene, segment: scene.segments[index], index };
  }
  return null;
}

export function findShot(
  doc: ProjectDoc,
  shotId: string,
): {
  scene: StoredSceneStoryboard;
  segment: StoredSegment;
  shot: StoredShot;
} | null {
  for (const scene of doc.storyboard) {
    for (const segment of scene.segments) {
      const shot = segment.shots.find((item) => item.id === shotId);
      if (shot) return { scene, segment, shot };
    }
  }
  return null;
}

export function findAsset(
  doc: ProjectDoc,
  assetId: string,
): StoredAsset | undefined {
  return doc.assets.find((asset) => asset.id === assetId);
}

export function findVariantById(
  doc: ProjectDoc,
  variantId: string,
): { asset: StoredAsset; variant: StoredVariant } | null {
  for (const asset of doc.assets) {
    const variant = asset.variants.find((item) => item.id === variantId);
    if (variant) return { asset, variant };
  }
  return null;
}

export function findViewById(
  doc: ProjectDoc,
  viewId: string,
): { asset: StoredAsset; variant: StoredVariant; view: StoredView } | null {
  for (const asset of doc.assets) {
    for (const variant of asset.variants) {
      const view = variant.views.find((item) => item.id === viewId);
      if (view) return { asset, variant, view };
    }
  }
  return null;
}

function defaultViewSpecs(
  type: AssetType,
  characterMode: CharacterViewMode,
): { kind: StoredView["kind"]; label: string }[] {
  if (type === "scene") return [{ kind: "master", label: "全景" }];
  if (type === "prop") return [{ kind: "sheet", label: "三视图" }];
  return [{ ...CHARACTER_VIEW_SPEC[characterMode] }];
}

function makeView(
  spec: { kind: StoredView["kind"]; label: string; prompt?: string },
  original = true,
): StoredView {
  return {
    id: newId(),
    label: spec.label,
    prompt: spec.prompt ?? "",
    kind: spec.kind ?? inferViewKind(spec.label),
    imagePath: null,
    originalLabel: original ? spec.label : null,
    originalPrompt: original ? (spec.prompt ?? "") : null,
  };
}

function mergeCharacterDrafts(drafts: AssetDraft[]): AssetDraft[] {
  const baseName = (name: string) =>
    name
      .replace(/[（(【[][^）)】\]]*[）)】\]]\s*$/g, "")
      .replace(
        /[·•\-—]\s*(?:现代|古代|少年|成年|孩童|青年|老年|礼服|日常|受伤|战损|便装|官服|常服|睡衣|湿身).*$/g,
        "",
      )
      .trim();
  const groups = new Map<string, AssetDraft[]>();
  for (const draft of drafts) {
    if (draft.type !== "character") continue;
    const key = baseName(draft.name) || draft.name.trim();
    const list = groups.get(key);
    if (list) list.push(draft);
    else groups.set(key, [draft]);
  }
  const emitted = new Set<string>();
  const merged: AssetDraft[] = [];
  for (const draft of drafts) {
    if (draft.type !== "character") {
      merged.push(draft);
      continue;
    }
    const key = baseName(draft.name) || draft.name.trim();
    if (emitted.has(key)) continue;
    emitted.add(key);
    const group = groups.get(key) ?? [draft];
    const primary = group.find((item) => item.name.trim() === key) ?? group[0];
    const variants = [];
    const used = new Set<string>();
    for (const item of [primary, ...group.filter((x) => x !== primary)]) {
      for (const variant of item.variants) {
        let label = variant.label.trim() || "造型";
        if (used.has(label)) {
          const suffix = item.name.trim() || key;
          label = `${label}·${suffix}`;
          let n = 2;
          while (used.has(label)) label = `${label}${n++}`;
        }
        used.add(label);
        variants.push({ ...variant, label });
      }
    }
    merged.push({ ...primary, name: key, variants });
  }
  return merged;
}

export async function seedAssetImagesFromLibrary(
  record: ProjectRecord,
): Promise<ProjectDoc> {
  const items = await libraryRepository.listAssets("project", record.seriesId);
  if (items.length === 0) return record.doc;
  const doc: ProjectDoc = {
    ...record.doc,
    assets: record.doc.assets.map((asset) => ({
      ...asset,
      variants: asset.variants.map((variant, index) => {
        if (index !== 0) return variant;
        return {
          ...variant,
          views: variant.views.map((view, viewIndex) => {
            if (viewIndex !== 0 || view.imagePath) return view;
            const match = items.find(
              (item) =>
                item.type === asset.type &&
                item.name === asset.name &&
                (item.variantLabel ?? "") === (index === 0 ? "" : variant.label),
            );
            return match?.mediaId
              ? { ...view, imagePath: match.mediaId }
              : view;
          }),
        };
      }),
    })),
  };
  await projectRepository.saveProject(doc);
  return doc;
}

export function assetsFromDrafts(drafts: AssetDraft[]): StoredAsset[] {
  return mergeCharacterDrafts(drafts).map((draft) => {
    const characterMode: CharacterViewMode = "single";
    return {
      id: newId(),
      type: draft.type,
      name: draft.name,
      basePrompt: draft.basePrompt,
      interiorExterior:
        draft.type === "scene" ? (draft.interiorExterior ?? "") : "",
      characterViewMode: characterMode,
      variants: draft.variants.map((variant) => {
        const views =
          draft.type === "character"
            ? [{ ...CHARACTER_VIEW_SPEC[characterMode], prompt: "" }]
            : variant.views.length > 0
              ? variant.views
              : defaultViewSpecs(draft.type, characterMode).map((view) => ({
                  ...view,
                  prompt: "",
                }));
        return {
          id: newId(),
          label: variant.label,
          prompt: variant.prompt,
          originalLabel: variant.label,
          originalPrompt: variant.prompt,
          views: views.map((view) =>
            makeView({
              label: view.label,
              prompt: view.prompt ?? "",
              kind: view.kind ?? inferViewKind(view.label),
            }),
          ),
        };
      }),
      originalName: draft.name,
      originalBasePrompt: draft.basePrompt,
    };
  });
}

export function ensureDefaultViews(
  assets: StoredAsset[],
  type?: AssetType,
): { assets: StoredAsset[]; changed: number } {
  let changed = 0;
  const next = assets.map((asset) => {
    if (type && asset.type !== type) return asset;
    return {
      ...asset,
      variants: asset.variants.map((variant) => {
        if (variant.views.length > 0) return variant;
        changed += 1;
        return {
          ...variant,
          views: defaultViewSpecs(
            asset.type,
            asset.characterViewMode,
          ).map((spec) => makeView({ ...spec, prompt: "" }, false)),
        };
      }),
    };
  });
  return { assets: next, changed };
}

export function restoreAssets(
  assets: StoredAsset[],
  scope: { assetId?: string; variantId?: string; viewId?: string },
): StoredAsset[] {
  return assets.map((asset) => {
    if (scope.assetId && asset.id !== scope.assetId) return asset;
    const base: StoredAsset = {
      ...asset,
      name: asset.originalName ?? asset.name,
      basePrompt: asset.originalBasePrompt ?? asset.basePrompt,
      variants: asset.variants.map((variant) => {
        if (scope.variantId && variant.id !== scope.variantId) return variant;
        return {
          ...variant,
          label: variant.originalLabel ?? variant.label,
          prompt: variant.originalPrompt ?? variant.prompt,
          views: variant.views.map((view) => {
            if (scope.viewId && view.id !== scope.viewId) return view;
            return {
              ...view,
              label: view.originalLabel ?? view.label,
              prompt: view.originalPrompt ?? view.prompt,
            };
          }),
        };
      }),
    };
    return base;
  });
}

export function enrichStoryboardRefs(
  scenes: StoredSceneStoryboard[],
  assets: StoredAsset[],
): StoredSceneStoryboard[] {
  const resolve = (ref: StoredRef): StoredRef => {
    const asset =
      assets.find(
        (item) => item.name === ref.assetName && item.type === ref.role,
      ) ?? assets.find((item) => item.name === ref.assetName);
    const variant =
      asset?.variants.find((item) => item.label === ref.variantLabel) ??
      asset?.variants[0];
    const view =
      variant?.views.find((item) => item.label === ref.viewLabel) ??
      variant?.views[0];
    return {
      ...ref,
      assetId: asset?.id ?? null,
      variantId: variant?.id ?? null,
      viewId: view?.id ?? null,
      imagePath: view?.imagePath ?? null,
    };
  };
  return scenes.map((scene) => ({
    ...scene,
    segments: scene.segments.map((segment) => ({
      ...segment,
      shots: segment.shots.map((shot) => ({
        ...shot,
        refs: shot.refs.map(resolve),
      })),
    })),
  }));
}

function roundToStep(value: number, step: number): number {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

export function orchestrateScene(
  scene: StoredSceneStoryboard,
  vendor: LibraryVendor | null,
  defaultSegmentMs: number,
): StoredSceneStoryboard {
  const shots = scene.segments.flatMap((segment) => segment.shots);
  if (shots.length === 0) return { ...scene, segments: [] };
  const maxShots = Math.max(1, vendor?.maxShotsPerSegment ?? 3);
  const minMs = Math.max(1000, vendor?.minSegmentMs ?? 4000);
  const maxMs = Math.max(minMs, vendor?.maxSegmentMs ?? 10000);
  const step = Math.max(0, vendor?.durationStepMs ?? 0);

  const groups: StoredShot[][] = [];
  let current: StoredShot[] = [];
  let currentMs = 0;
  for (const shot of shots) {
    const shotMs = Math.max(500, shot.durationMs || 0);
    const wouldExceed =
      current.length >= maxShots || currentMs + shotMs > maxMs;
    if (current.length > 0 && wouldExceed) {
      groups.push(current);
      current = [];
      currentMs = 0;
    }
    current.push(shot);
    currentMs += shotMs;
  }
  if (current.length > 0) groups.push(current);

  const segments: StoredSegment[] = groups.map((group, index) => {
    const total = group.reduce(
      (sum, shot) => sum + Math.max(500, shot.durationMs || 0),
      0,
    );
    const targetMs = Math.min(
      maxMs,
      Math.max(minMs, roundToStep(total || defaultSegmentMs, step)),
    );
    const first = group[0];
    const hardCut = index === 0 || first.continuesPrev === false;
    return {
      id: newId(),
      sceneId: scene.sceneId,
      index: index + 1,
      generationMode:
        group.length > 1 ? "multi-shot" : "per-shot",
      targetMs,
      firstFrameId: null,
      firstFrameOrigin: null,
      mediaSig: null,
      refOverride: null,
      stale: false,
      hardCut,
      linkMode: hardCut ? "hard-cut" : "tail-frame",
      seamReason: null,
      status: "draft",
      videoPath: null,
      genStatus: null,
      genProgress: null,
      genProgressCurrent: null,
      shots: group.map((shot, shotIndex) => ({
        ...shot,
        index: shotIndex + 1,
      })),
    };
  });
  return { ...scene, segments };
}

export async function orchestrateProject(record: ProjectRecord): Promise<number> {
  const vendor = await libraryRepository.getVendor(record.doc.project.vendor);
  const scenes = record.doc.storyboard.map((scene) =>
    orchestrateScene(scene, vendor, record.doc.project.defaultSegmentMs),
  );
  const next: ProjectDoc = {
    ...record.doc,
    storyboard: scenes,
    videoBindings: {},
    aiPrompts: {},
    frames: [],
    qc: {},
    refs: {},
    refUploads: {},
    mediaSigs: {},
  };
  await projectRepository.saveProject(next);
  return scenes.reduce((sum, scene) => sum + scene.segments.length, 0);
}

export function buildManifest(
  doc: ProjectDoc,
  segment: StoredSegment,
  scene: StoredSceneStoryboard,
  keyframeOnly: boolean,
): {
  manifest: {
    slot: number;
    role: "start" | "character" | "scene" | "prop" | "upload";
    label: string;
    imagePath: string | null;
    viewId: string | null;
    frameId: string | null;
    viewUrl: string | null;
    uploadId?: string | null;
  }[];
  characterLabels: string[];
} {
  const items: {
    role: "start" | "character" | "scene" | "prop" | "upload";
    label: string;
    viewId: string | null;
    frameId: string | null;
    imagePath: string | null;
    uploadId?: string | null;
  }[] = [];
  const seen = new Set<string>();

  const startFrame = segment.firstFrameId
    ? doc.frames?.find((frame) => frame.id === segment.firstFrameId)
    : null;
  if (startFrame) {
    items.push({
      role: "start",
      label: "起始画面",
      viewId: null,
      frameId: startFrame.id,
      imagePath: startFrame.imagePath,
    });
  }

  const override: RefOverrideItem[] | null =
    segment.refOverride ?? doc.refs?.[segment.id] ?? null;
  if (override) {
    for (const item of override) {
      items.push({
        role: item.role,
        label: item.label,
        viewId: item.viewId,
        frameId: item.frameId,
        uploadId: item.uploadId ?? null,
        imagePath:
          item.viewId
            ? findViewById(doc, item.viewId)?.view.imagePath ?? null
            : item.frameId
              ? doc.frames?.find((frame) => frame.id === item.frameId)
                  ?.imagePath ?? null
              : null,
      });
    }
  } else {
    for (const shot of segment.shots) {
      for (const ref of shot.refs) {
        if (!ref.assetName.trim()) continue;
        const key = `${ref.role}|${ref.assetName}|${ref.variantLabel}|${ref.viewLabel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          role: ref.role,
          label: [ref.assetName, ref.variantLabel, ref.viewLabel]
            .filter(Boolean)
            .join("·"),
          viewId: ref.viewId,
          frameId: null,
          imagePath: ref.viewId
            ? (findViewById(doc, ref.viewId)?.view.imagePath ?? ref.imagePath)
            : ref.imagePath,
        });
      }
    }
    if (!items.some((item) => item.role === "scene") && scene.location) {
      const asset = doc.assets.find(
        (item) => item.type === "scene" && item.name === scene.location,
      );
      const variant = asset?.variants[0];
      const view =
        variant?.views.find((item) => item.label === "全景") ??
        variant?.views[0];
      if (asset) {
        items.push({
          role: "scene",
          label: [asset.name, variant?.label, view?.label]
            .filter(Boolean)
            .join("·"),
          viewId: view?.id ?? null,
          frameId: null,
          imagePath: view?.imagePath ?? null,
        });
      }
    }
  }

  const filtered = keyframeOnly
    ? items.filter((item) => item.role === "start")
    : items;
  return {
    manifest: filtered.map((item, index) => ({
      slot: index + 1,
      role: item.role,
      label: item.label,
      imagePath: item.imagePath,
      viewId: item.viewId,
      frameId: item.frameId,
      viewUrl: null,
      uploadId: item.uploadId ?? null,
    })),
    characterLabels: filtered
      .filter((item) => item.role === "character")
      .map((item) => item.label),
  };
}

export function resolveStrategy(
  strategies: LibraryStoryboardStrategy[],
  id: string | null | undefined,
): LibraryStoryboardStrategy {
  return (
    strategies.find((strategy) => strategy.id === id) ??
    strategies.find((strategy) => strategy.isDefault) ??
    strategies[0]
  );
}

export function projectVendorName(
  project: Project,
  vendors: LibraryVendor[],
): string {
  return (
    vendors.find((vendor) => vendor.id === project.vendor)?.name ??
    project.vendor
  );
}
