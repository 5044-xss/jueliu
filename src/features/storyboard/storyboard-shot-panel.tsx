"use client";

import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PreviewImage } from "@/components/preview-image";
import type {
  StoredSceneStoryboard,
  StoredShot,
} from "@core/shared/schemas/storyboard";

function cameraText(shot: StoredShot): string {
  return [
    shot.camera.shotSize,
    shot.camera.focal,
    shot.camera.angle,
    shot.camera.movement,
    shot.camera.side === "left"
      ? "轴线左"
      : shot.camera.side === "right"
        ? "轴线右"
        : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function ShotView({
  projectId,
  shot,
  onEdit,
}: {
  projectId: string;
  shot: StoredShot;
  onEdit: () => void;
}) {
  const camera = cameraText(shot);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">镜{shot.index + 1}</span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {(shot.durationMs / 1000).toFixed(1)}s
            {camera && ` · ${camera}`}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onEdit}
            title="编辑本镜"
          >
            <Pencil className="size-3" />
          </Button>
        </span>
      </div>
      {shot.lighting && (
        <p className="text-xs text-muted-foreground">光线：{shot.lighting}</p>
      )}
      {shot.action && <p className="leading-6">{shot.action}</p>}
      {shot.dialogue.length > 0 && (
        <div className="leading-6">
          <span className="text-muted-foreground">台词：</span>
          {shot.dialogue.map((line, index) => (
            <span key={index} className="block">
              {line.character ? `${line.character}：` : ""}「{line.text}」
            </span>
          ))}
        </div>
      )}
      {shot.expression && (
        <p className="text-xs text-muted-foreground">表情：{shot.expression}</p>
      )}
      {shot.refs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {shot.refs.map((ref) => (
            <span
              key={ref.id}
              className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs"
            >
              {ref.imagePath && (
                <PreviewImage
                  src={`/api/projects/${projectId}/assets/views/${ref.viewId}/image`}
                  alt={ref.assetName}
                  title={`${ref.assetName}${ref.variantLabel ? ` · ${ref.variantLabel}` : ""}${ref.viewLabel ? ` · ${ref.viewLabel}` : ""}`}
                  className="size-6 rounded object-cover"
                />
              )}
              <span>
                {`${ref.assetName}${ref.variantLabel ? `·${ref.variantLabel}` : ""}${ref.viewLabel ? `·${ref.viewLabel}` : ""}`}
                {!ref.viewId && " ⚠"}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function StoryboardShotPanel({
  projectId,
  scene,
  shots,
  onEditShot,
  onEditBlocking,
}: {
  projectId: string;
  scene: StoredSceneStoryboard;
  shots: StoredShot[];
  onEditShot: (shot: StoredShot) => void;
  onEditBlocking: () => void;
}) {
  const totalMs = shots.reduce((sum, shot) => sum + shot.durationMs, 0);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {scene.sceneSlug || `第${scene.sceneIndex}场`}
          </p>
          <p className="text-xs text-muted-foreground">
            {scene.location || "未标注地点"} · {shots.length} 镜 ·{" "}
            {(totalMs / 1000).toFixed(1)}s
          </p>
        </div>
        <Button size="xs" variant="outline" onClick={onEditBlocking}>
          编辑站位
        </Button>
      </div>
      {scene.blocking && (
        <div className="rounded-lg border bg-muted/30 p-2.5 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">本场轴线：</span>
          {scene.blocking.nodes.find(
            (node) => node.id === scene.blocking?.axis.from,
          )?.label ?? scene.blocking.axis.from}
          {" ↔ "}
          {scene.blocking.nodes.find(
            (node) => node.id === scene.blocking?.axis.to,
          )?.label ?? scene.blocking.axis.to}
          {"｜机位在轴线"}
          {scene.blocking.cameraSide === "left" ? "左" : "右"}侧
        </div>
      )}
      <div className="flex flex-col gap-2">
        {shots.map((shot) => (
          <ShotView
            key={shot.id}
            projectId={projectId}
            shot={shot}
            onEdit={() => onEditShot(shot)}
          />
        ))}
      </div>
    </div>
  );
}
