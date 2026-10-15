import { getProjectDb, newId, nowIso } from "@/lib/db";
import { getStoryboard } from "@/lib/storyboard";
import { getProject } from "@/lib/projects";
import { getVendor } from "@/lib/library/vendors";
import { clearDanglingFirstFrames } from "@/lib/frames";
import type { VendorId } from "./vendors";
import { packScene, type PackShot, type PackRefLabel } from "./pack";

// 编排落地（以镜为主、非破坏式）：
// 镜（shot）是持久主线，段（segment）只是按厂商派生的分组。
// 重编排只重算分组、重分配 shot.segment_id，**不删除/重建镜的行**（镜内容与 id 稳定）。
// 段被打包变化所影响的（换过内容的）段会清空其视频（属正确语义）。

export interface OrchestrateResult {
  vendor: VendorId;
  scenes: number;
  segments: number;
  clearedVideos: number;
  notes: string[];
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function applyOrchestration(
  projectId: string,
  vendorId: VendorId,
): OrchestrateResult {
  const project = getProject(projectId);
  if (!project) throw new Error("项目不存在");
  const vendor = getVendor(vendorId);
  const scenes = getStoryboard(projectId);
  const db = getProjectDb(projectId);

  const notes: string[] = [];
  let segmentCount = 0;
  let clearedVideos = 0;

  const updateSegment = db.prepare(
    `UPDATE segment SET idx = ?, generation_mode = ?, target_ms = ?, hard_cut = ?,
       status = 'draft', video_path = NULL, first_frame_id = NULL, updated_at = ?
     WHERE id = ?`,
  );
  const insertSegment = db.prepare(
    `INSERT INTO segment
       (id, project_id, scene_id, idx, generation_mode, target_ms, first_frame_id, hard_cut, status, video_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'draft', NULL, ?, ?)`,
  );
  const reassignShot = db.prepare(
    "UPDATE shot SET segment_id = ?, idx = ?, duration_ms = ? WHERE id = ?",
  );
  const deleteSegment = db.prepare("DELETE FROM segment WHERE id = ?");
  // 段被打包变化影响时，除清空视频/起始画面外，还要清掉它已截取的帧图，
  // 否则旧尾帧会残留在页面上回显（帧行不随 video_path 清空而消失）。
  const deleteFrames = db.prepare("DELETE FROM frame WHERE segment_id = ?");
  const deleteVideoAsset = db.prepare(
    "DELETE FROM video_asset WHERE segment_id = ?",
  );

  const tx = db.transaction(() => {
    const now = nowIso();

    for (const scene of scenes) {
      const flatShots = scene.segments.flatMap((s) => s.shots);
      const existingIds = scene.segments.map((s) => s.id);
      const existingVideos = new Map(
        scene.segments.map((s) => [s.id, Boolean(s.videoPath)]),
      );
      const existingShotIds = scene.segments.map((s) => s.shots.map((x) => x.id));

      if (flatShots.length === 0) {
        for (const id of existingIds) {
          if (existingVideos.get(id)) clearedVideos += 1;
          deleteSegment.run(id);
        }
        continue;
      }

      const packShots: PackShot[] = flatShots.map((shot) => ({
        idealMs: shot.idealMs ?? shot.durationMs,
        refLabels: shot.refs.map(
          (r) => ({ role: r.role, label: r.assetName }) as PackRefLabel,
        ),
      }));

      const { segments } = packScene(packShots, vendor, project.defaultSegmentMs);

      segments.forEach((seg, i) => {
        const newShotIds = seg.shotIndexes.map((idx) => flatShots[idx].id);
        const firstShot = flatShots[seg.shotIndexes[0]];
        const isFirst = i === 0;
        const hardCut = isFirst ? false : !firstShot.continuesPrev;

        const reuseId = i < existingIds.length ? existingIds[i] : null;
        const reuseSeg = i < existingIds.length ? scene.segments[i] : null;
        const generationMode =
          seg.shotIndexes.length > 1 ? "multi-shot" : "per-shot";
        const unchanged =
          reuseId !== null &&
          sameIds(existingShotIds[i] ?? [], newShotIds) &&
          reuseSeg?.targetMs === seg.targetMs &&
          Boolean(reuseSeg?.hardCut) === hardCut &&
          reuseSeg?.generationMode === generationMode;

        let segId: string;
        if (reuseId && unchanged) {
          segId = reuseId;
        } else if (reuseId) {
          if (existingVideos.get(reuseId)) clearedVideos += 1;
          segId = reuseId;
          deleteFrames.run(segId);
          deleteVideoAsset.run(segId);
          updateSegment.run(
            i + 1,
            generationMode,
            seg.targetMs,
            hardCut ? 1 : 0,
            now,
            segId,
          );
        } else {
          segId = newId();
          insertSegment.run(
            segId,
            projectId,
            scene.sceneId,
            i + 1,
            generationMode,
            seg.targetMs,
            hardCut ? 1 : 0,
            now,
            now,
          );
        }
        segmentCount += 1;

        // 重分配镜：保留镜行与 id，只改归属、序位与归一后的时长。
        seg.shotIndexes.forEach((shotIdx, k) => {
          const shot = flatShots[shotIdx];
          reassignShot.run(
            segId,
            k,
            seg.shotDurations[k] ?? shot.durationMs,
            shot.id,
          );
        });
      });

      // 删除多余段（此时其镜已被重新分配走，级联不会误删镜）。
      for (let j = segments.length; j < existingIds.length; j += 1) {
        const id = existingIds[j];
        if (existingVideos.get(id)) clearedVideos += 1;
        deleteSegment.run(id);
      }

      for (const w of segments.flatMap((s) => s.warnings)) {
        notes.push(`${scene.sceneSlug || `第${scene.sceneIndex}场`}：${w}`);
      }
    }
  });

  tx();
  // 编排重建/删除段落后，清理指向已删帧的悬空起始画面。
  clearDanglingFirstFrames(projectId);
  return {
    vendor: vendorId,
    scenes: scenes.length,
    segments: segmentCount,
    clearedVideos,
    notes,
  };
}
