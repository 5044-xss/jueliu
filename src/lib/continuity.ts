import { getStoryboard, getContinuityRules } from "@/lib/storyboard";

export interface ContinuityWarning {
  level: "warning" | "info";
  sceneIndex: string;
  segmentIndex?: number;
  message: string;
}

function focalNumber(focal: string): number | null {
  const match = focal.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

export function validateContinuity(projectId: string): ContinuityWarning[] {
  const rules = getContinuityRules(projectId);
  const scenes = getStoryboard(projectId);
  const warnings: ContinuityWarning[] = [];

  for (const scene of scenes) {
    if (rules.blockingLock && !scene.blocking) {
      warnings.push({
        level: "warning",
        sceneIndex: scene.sceneIndex,
        message: "本场缺少 blocking（站位/轴线），站位无法锁定。",
      });
    }

    scene.segments.forEach((segment, segmentIdx) => {
      const label = `第${segment.index}段`;

      if (
        segment.generationMode === "multi-shot" &&
        segment.shots.length > 3
      ) {
        warnings.push({
          level: "warning",
          sceneIndex: scene.sceneIndex,
          segmentIndex: segment.index,
          message: `${label} 含 ${segment.shots.length} 个分镜，超过平台默认上限 3 个。`,
        });
      }

      const sum = segment.shots.reduce((acc, s) => acc + s.durationMs, 0);
      if (segment.targetMs > 0) {
        const diff = Math.abs(sum - segment.targetMs) / segment.targetMs;
        if (diff > 0.1) {
          warnings.push({
            level: "warning",
            sceneIndex: scene.sceneIndex,
            segmentIndex: segment.index,
            message: `${label} 分镜时长之和 ${sum}ms 与段目标 ${segment.targetMs}ms 偏差超过 10%。`,
          });
        }
      }

      if (rules.firstFrameAnchor && segmentIdx > 0) {
        const hasAnchor = segment.shots[0]?.refs.some(
          (r) => r.role === "first_frame",
        );
        if (!hasAnchor) {
          warnings.push({
            level: "warning",
            sceneIndex: scene.sceneIndex,
            segmentIndex: segment.index,
            message: `${label} 未设置首帧锚定（first_frame 引用），跨段可能不连续。`,
          });
        }
      }

      if (rules.focalLogic) {
        for (let i = 1; i < segment.shots.length; i += 1) {
          const prev = focalNumber(segment.shots[i - 1].camera.focal);
          const curr = focalNumber(segment.shots[i].camera.focal);
          if (prev && curr && Math.max(prev, curr) / Math.min(prev, curr) > 3) {
            warnings.push({
              level: "info",
              sceneIndex: scene.sceneIndex,
              segmentIndex: segment.index,
              message: `${label} 镜${i}→镜${i + 1} 焦段从 ${prev}mm 跳到 ${curr}mm，变化较大。`,
            });
          }
        }
      }

      segment.shots.forEach((shot) => {
        const hasCharacter = shot.refs.some((r) => r.role === "character");
        if (rules.wardrobeProp && shot.action && !hasCharacter) {
          warnings.push({
            level: "info",
            sceneIndex: scene.sceneIndex,
            segmentIndex: segment.index,
            message: `${label} 镜${shot.index + 1} 有动作描述但未引用角色参考图。`,
          });
        }
        for (const ref of shot.refs) {
          if (
            (ref.role === "character" ||
              ref.role === "scene" ||
              ref.role === "prop") &&
            !ref.viewId
          ) {
            warnings.push({
              level: "warning",
              sceneIndex: scene.sceneIndex,
              segmentIndex: segment.index,
              message: `${label} 镜${shot.index + 1} 引用了「${ref.assetName || "未知资产"}」但未匹配到具体视角。`,
            });
          }
        }
      });
    });
  }

  return warnings;
}
