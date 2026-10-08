import {
  getStoryboard,
  getContinuityRules,
  dialogueToText,
} from "@/lib/storyboard";
import { getStoredScript } from "@/lib/script";
import { getAssets } from "@/lib/assets";
import { getProject } from "@/lib/projects";
import {
  MIN_SEGMENT_MS,
  MAX_PROP_ASSETS,
  MAX_REF_IMAGES,
} from "@/lib/templates-defaults";

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

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

// 宽松匹配：去掉空白、引号、标点后比较，且允许包含关系。
// 场景资产名常是「街角彩票店门口」，而场次地点可能是「街角彩票店门口 / 梧桐树下」，
// 二者应视为一致，否则会产生大量无法修复的误报。
function looseKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s“”"'「」『』（）()·,，。、/\\\-—_]/g, "");
}

function looselyMatches(a: string, b: string): boolean {
  const x = looseKey(a);
  const y = looseKey(b);
  if (!x || !y) return true;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  // 同一地点常有不同说法（如「谜酒吧卡座」vs「谜酒吧内部」），
  // 共享 3 个以上连续汉字即视为同一地点，避免大量无法修复的误报。
  return longestCommonSubstringLength(x, y) >= 3;
}

function longestCommonSubstringLength(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > best) best = curr[j];
      }
    }
    prev = curr;
  }
  return best;
}

// 场次地点可能是「A / B」多地点写法，任一片段匹配到场景资产即视为命中。
function locationMatchesAsset(location: string, assetName: string): boolean {
  if (looselyMatches(location, assetName)) return true;
  const parts = location
    .split(/[/、,，]/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.some((p) => looselyMatches(p, assetName));
}

// 画外音/电话/旁白这类不出镜角色不需要参考图，也不该报「没有角色资产」。
function isOffscreenCharacter(name: string): boolean {
  return /电话|画外|旁白|广播|声音|播报|新闻/.test(name);
}

// 台词比对用：去掉括号内舞台提示与所有标点/空白，便于判断某句剧本台词是否出现在分镜里。
function dialogueCore(text: string): string {
  return text
    .replace(/[（(][^）)]*[）)]/g, "")
    .toLowerCase()
    .replace(/[\s“”"'「」『』（）()·,，。、！？!?：:；;…—\-_/\\]/g, "");
}

function isNightText(value: string): boolean {
  return /夜|晚/.test(value);
}

function isDayText(value: string): boolean {
  return /日|白天|晨|午/.test(value);
}

function timeVariantMismatch(timeOfDay: string, variantLabel: string): boolean {
  if (!timeOfDay.trim() || !variantLabel.trim()) return false;
  const sceneNight = isNightText(timeOfDay);
  const sceneDay = isDayText(timeOfDay);
  const variantNight = isNightText(variantLabel);
  const variantDay = isDayText(variantLabel);
  if (sceneNight && variantDay && !variantNight) return true;
  if (sceneDay && variantNight) return true;
  return false;
}

export function validateContinuity(projectId: string): ContinuityWarning[] {
  const rules = getContinuityRules();
  const scenes = getStoryboard(projectId);
  const warnings: ContinuityWarning[] = [];
  const pushed = new Set<string>();

  function push(warning: ContinuityWarning) {
    const key = `${warning.sceneIndex}|${warning.segmentIndex ?? ""}|${warning.message}`;
    if (pushed.has(key)) return;
    pushed.add(key);
    warnings.push(warning);
  }

  const script = getStoredScript(projectId);
  const maxSegmentMs = getProject(projectId)?.defaultSegmentMs ?? 10000;
  const scriptSceneByIndex = new Map(
    (script?.scenes ?? []).map((s) => [s.index, s]),
  );
  const allAssets = getAssets(projectId);
  const characterAssets = new Set(
    allAssets
      .filter((a) => a.type === "character")
      .map((a) => normalize(a.name)),
  );
  const sceneAssetNames = allAssets
    .filter((a) => a.type === "scene")
    .map((a) => a.name);

  // 资产层约束（全剧一次）：
  // 1) 道具资产过多会挤爆参考图槽位，只应保留「跨镜复用且外观一致」的关键道具；
  // 2) 场景资产名必须是单一主地点，不能带分隔符/时间词，否则分镜匹配不到本场地点。
  const propAssets = allAssets.filter((a) => a.type === "prop");
  if (propAssets.length > MAX_PROP_ASSETS) {
    push({
      level: "warning",
      sceneIndex: "全剧",
      message: `道具资产共 ${propAssets.length} 个，偏多（建议 ≤ ${MAX_PROP_ASSETS}）。只有「跨镜复用、外观必须一致」的关键道具才需要参考图；一次性道具（现金、饮料、杯子等）请删除，只在分镜动作里描述。`,
    });
  }
  const sceneNamePattern = /[\/、,，]|(白天|夜晚|黄昏|清晨|凌晨|深夜|雨天|雪天|晴天)|[-\s][日夜]$/;
  for (const name of sceneAssetNames) {
    if (sceneNamePattern.test(name)) {
      push({
        level: "warning",
        sceneIndex: "全剧",
        message: `场景资产名「${name}」不规范：应只取一个主地点，不要含「/、，」等分隔符或时间/天气词（时间/天气放变体），否则分镜可能匹配不到本场地点。`,
      });
    }
  }

  // 同一地点跨场站位一致性：同地点多场必须共用一套站位，否则同一张场景图下
  // 人物每场换座，观感上就是「场景一致但座位乱」。
  const blockingAnchor = new Map<
    string,
    Map<string, { x: number; y: number; facing: number }>
  >();
  for (const scene of scenes) {
    if (!scene.blocking || scene.blocking.nodes.length === 0) continue;
    const key = looseKey(scene.location);
    if (!key) continue;
    const anchor = blockingAnchor.get(key);
    if (!anchor) {
      const map = new Map<string, { x: number; y: number; facing: number }>();
      for (const n of scene.blocking.nodes) {
        map.set(normalize(n.label), { x: n.pos.x, y: n.pos.y, facing: n.facing });
      }
      blockingAnchor.set(key, map);
      continue;
    }
    const mismatched: string[] = [];
    for (const n of scene.blocking.nodes) {
      const ref = anchor.get(normalize(n.label));
      if (
        ref &&
        (ref.x !== n.pos.x || ref.y !== n.pos.y || ref.facing !== n.facing)
      ) {
        mismatched.push(n.label);
      }
    }
    if (mismatched.length > 0) {
      push({
        level: "warning",
        sceneIndex: scene.sceneIndex,
        message: `本场与同地点其他场次的站位不一致（${mismatched.join("、")}）：同一地点应共用一套站位，否则座位会乱。可在「编辑站位」里对齐，或重新生成分镜自动归一。`,
      });
    }
  }

  for (const scene of scenes) {
    // blocking 由「剧本→分镜」生成时写入；尚未生成分镜的场次不校验站位，
    // 否则会在分镜页对每个场次误报「缺少 blocking」。
    if (rules.blockingLock && !scene.blocking && scene.segments.length > 0) {
      push({
        level: "warning",
        sceneIndex: scene.sceneIndex,
        message: "本场缺少 blocking（站位/轴线），站位无法锁定。",
      });
    }

    // 场景资产覆盖：本场地点必须在资产里有对应场景资产，否则分镜引不到场景参考图。
    // 只对已生成分镜的场次提示，避免在还没生成分镜时刷屏。
    if (scene.segments.length > 0 && scene.location.trim()) {
      const hasSceneAsset = sceneAssetNames.some((name) =>
        locationMatchesAsset(scene.location, name),
      );
      if (!hasSceneAsset) {
        push({
          level: "warning",
          sceneIndex: scene.sceneIndex,
          message: `本场地点「${scene.location}」没有对应的场景资产，分镜无法引用场景参考图，请先在资产页补充该场景。`,
        });
      }
    }

    const scriptScene = scriptSceneByIndex.get(scene.sceneIndex);
    // 场次 1:1：剧本本场有内容，但分镜一段都没有 → 说明这一场被漏掉了。
    if (scriptScene && scriptScene.beats.length > 0 && scene.segments.length === 0) {
      push({
        level: "warning",
        sceneIndex: scene.sceneIndex,
        message: "本场尚未生成分镜（剧本本场有内容），分镜可能漏了这场。",
      });
    }
    if (scriptScene) {
      for (const name of scriptScene.characters) {
        const key = normalize(name);
        if (!key || isOffscreenCharacter(name)) continue;
        if (!characterAssets.has(key)) {
          push({
            level: "warning",
            sceneIndex: scene.sceneIndex,
            message: `本场角色「${name}」没有对应的角色资产，分镜将无法引用参考图。`,
          });
        }
      }
    }

    // 说明：blocking 覆盖检查只针对「分镜里真正引用了的角色」，见下方逐镜检查。
    // 不用剧本的 characters 字段，因为它常把本场未实际出镜的人也算进去，会造成误报。

    // 台词覆盖：剧本本场的每句台词都必须落到分镜里（防止为了控制镜数而整句漏掉）。
    if (scriptScene && scene.segments.length > 0) {
      const storyboardDialogue = dialogueCore(
        scene.segments
          .flatMap((seg) =>
            seg.shots.map((sh) => dialogueToText(sh.dialogue)),
          )
          .join("\n"),
      );
      const lastSegment = scene.segments[scene.segments.length - 1];
      for (const beat of scriptScene.beats) {
        if (beat.type !== "dialogue") continue;
        const core = dialogueCore(beat.text);
        if (core.length < 2) continue;
        if (!storyboardDialogue.includes(core)) {
          push({
            level: "warning",
            sceneIndex: scene.sceneIndex,
            segmentIndex: lastSegment?.index,
            message: `剧本台词「${beat.character ? `${beat.character}：` : ""}${beat.text}」未出现在本场分镜中，内容被漏掉。`,
          });
        }
      }
    }

    // 同一场次内同一角色必须用同一变体（服装一致），跨场可换装。
    if (scene.segments.length > 0) {
      const variantsByCharacter = new Map<string, Set<string>>();
      for (const seg of scene.segments) {
        for (const shot of seg.shots) {
          for (const ref of shot.refs) {
            if (ref.role !== "character" || !ref.assetName.trim()) continue;
            const key = ref.assetName.trim();
            const set = variantsByCharacter.get(key) ?? new Set<string>();
            set.add(ref.variantLabel.trim() || "（未指定变体）");
            variantsByCharacter.set(key, set);
          }
        }
      }
      const lastSegment = scene.segments[scene.segments.length - 1];
      for (const [name, set] of variantsByCharacter) {
        if (set.size > 1) {
          push({
            level: "warning",
            sceneIndex: scene.sceneIndex,
            segmentIndex: lastSegment?.index,
            message: `角色「${name}」在本场使用了多个变体（${[...set].join("、")}），同场服装可能不一致。`,
          });
        }
      }
    }

    scene.segments.forEach((segment, segmentIdx) => {
      const label = `第${segment.index}段`;

      if (
        segment.generationMode === "multi-shot" &&
        segment.shots.length > 3
      ) {
        push({
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
          push({
            level: "warning",
            sceneIndex: scene.sceneIndex,
            segmentIndex: segment.index,
            message: `${label} 分镜时长之和 ${sum}ms 与段目标 ${segment.targetMs}ms 偏差超过 10%。`,
          });
        }
      }

      if (segment.targetMs > maxSegmentMs) {
        push({
          level: "warning",
          sceneIndex: scene.sceneIndex,
          segmentIndex: segment.index,
          message: `${label} 目标时长 ${segment.targetMs}ms 超过上限 ${maxSegmentMs}ms，建议拆成两段。`,
        });
      }
      if (segment.targetMs > 0 && segment.targetMs < MIN_SEGMENT_MS) {
        push({
          level: "warning",
          sceneIndex: scene.sceneIndex,
          segmentIndex: segment.index,
          message: `${label} 目标时长 ${segment.targetMs}ms 低于下限 ${MIN_SEGMENT_MS}ms，建议并入上一段。`,
        });
      }

      const contentChars =
        segment.shots.reduce(
          (acc, s) =>
            acc + dialogueCore(dialogueToText(s.dialogue)).length + s.action.length,
          0,
        );
      if (
        segment.targetMs >= maxSegmentMs * 0.95 &&
        contentChars < 40 &&
        segment.shots.length > 0
      ) {
        push({
          level: "info",
          sceneIndex: scene.sceneIndex,
          segmentIndex: segment.index,
          message: `${label} 内容较少但目标时长接近上限，可能被硬撑，建议缩短或与相邻段合并。`,
        });
      }

      // 参考图槽位预算：首帧 + 去重后的角色/场景/道具视角数。
      const viewSlots = new Set<string>();
      let hasFirstFrameRef = false;
      for (const sh of segment.shots) {
        for (const ref of sh.refs) {
          if (ref.role === "first_frame") hasFirstFrameRef = true;
          else if (ref.viewId) viewSlots.add(ref.viewId);
        }
      }
      const totalRefs = viewSlots.size + (hasFirstFrameRef ? 1 : 0);
      if (totalRefs > MAX_REF_IMAGES) {
        push({
          level: "warning",
          sceneIndex: scene.sceneIndex,
          segmentIndex: segment.index,
          message: `${label} 需要 ${totalRefs} 张参考图，超过建议上限 ${MAX_REF_IMAGES} 张，平台可能丢弃多余图片导致角色没有参考图。请减少本段出场角色/道具，或把角色参考图拼成一张。`,
        });
      }

      if (rules.firstFrameAnchor) {
        const hasAnchor = segment.shots[0]?.refs.some(
          (r) => r.role === "first_frame",
        );
        if (segmentIdx > 0 && !segment.hardCut && !hasAnchor) {
          push({
            level: "warning",
            sceneIndex: scene.sceneIndex,
            segmentIndex: segment.index,
            message: `${label} 未设置首帧锚定（first_frame 引用），跨段可能不连续。`,
          });
        }
        // 场次首段 / 硬切段是独立镜头，不应带首帧锚定。
        if ((segmentIdx === 0 || segment.hardCut) && hasAnchor) {
          push({
            level: "warning",
            sceneIndex: scene.sceneIndex,
            segmentIndex: segment.index,
            message: `${label} 是${segmentIdx === 0 ? "本场首段" : "硬切段"}，不应设置首帧锚定（场次切换/硬切是独立镜头）。`,
          });
        }
      }

      if (rules.focalLogic) {
        for (let i = 1; i < segment.shots.length; i += 1) {
          const prev = focalNumber(segment.shots[i - 1].camera.focal);
          const curr = focalNumber(segment.shots[i].camera.focal);
          if (prev && curr && Math.max(prev, curr) / Math.min(prev, curr) > 3) {
            push({
              level: "info",
              sceneIndex: scene.sceneIndex,
              segmentIndex: segment.index,
              message: `${label} 镜${i}→镜${i + 1} 焦段从 ${prev}mm 跳到 ${curr}mm，变化较大。`,
            });
          }
        }
      }

      segment.shots.forEach((shot) => {
        const speakers = new Set(
          shot.dialogue.map((line) => line.character.trim()).filter(Boolean),
        );
        if (speakers.size > 1) {
          push({
            level: "warning",
            sceneIndex: scene.sceneIndex,
            segmentIndex: segment.index,
            message: `${label} 镜${shot.index + 1} 含多个角色的台词（${[...speakers].join("、")}），视频模型无法分辨谁在说，必须拆成不同分镜。`,
          });
        }
        const hasCharacter = shot.refs.some((r) => r.role === "character");
        if (rules.wardrobeProp && shot.action && !hasCharacter) {
          push({
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
            push({
              level: "warning",
              sceneIndex: scene.sceneIndex,
              segmentIndex: segment.index,
              message: `${label} 镜${shot.index + 1} 引用了「${ref.assetName || "未知资产"}」但未匹配到具体视角。`,
            });
          } else if (
            (ref.role === "character" ||
              ref.role === "scene" ||
              ref.role === "prop") &&
            ref.viewId &&
            !ref.viewLabel
          ) {
            push({
              level: "warning",
              sceneIndex: scene.sceneIndex,
              segmentIndex: segment.index,
              message: `${label} 镜${shot.index + 1}「${ref.assetName || "资产"}」的参考图引用已失效（资产可能已重新生成），请重新生成分镜。`,
            });
          }

          if (ref.role === "scene" && ref.assetName.trim()) {
            if (
              scene.location.trim() &&
              !locationMatchesAsset(scene.location, ref.assetName)
            ) {
              push({
                level: "warning",
                sceneIndex: scene.sceneIndex,
                segmentIndex: segment.index,
                message: `引用的场景「${ref.assetName}」与本场地点「${scene.location}」不一致。`,
              });
            }
            if (timeVariantMismatch(scene.timeOfDay, ref.variantLabel)) {
              push({
                level: "warning",
                sceneIndex: scene.sceneIndex,
                segmentIndex: segment.index,
                message: `本场时间为「${scene.timeOfDay}」，却引用了场景变体「${ref.variantLabel}」，时间可能不一致。`,
              });
            }
          }
        }

        if (scene.blocking) {
          const nodeIds = new Set(scene.blocking.nodes.map((n) => n.id));
          const nodeLabels = new Set(
            scene.blocking.nodes.map((n) => normalize(n.label)),
          );
          if (
            rules.axis180 &&
            shot.camera.side &&
            scene.blocking.cameraSide &&
            shot.camera.side !== scene.blocking.cameraSide
          ) {
            push({
              level: "warning",
              sceneIndex: scene.sceneIndex,
              segmentIndex: segment.index,
              message: `${label} 镜${shot.index + 1} 机位在轴线${shot.camera.side === "left" ? "左" : "右"}侧，与本场锁定的${scene.blocking.cameraSide === "left" ? "左" : "右"}侧不一致（可能越轴）。`,
            });
          }
          for (const nodeId of shot.subjectNodeIds) {
            if (nodeId && !nodeIds.has(nodeId)) {
              push({
                level: "warning",
                sceneIndex: scene.sceneIndex,
                segmentIndex: segment.index,
                message: `${label} 镜${shot.index + 1} 引用了不存在的站位节点「${nodeId}」。`,
              });
            }
          }
          for (const ref of shot.refs) {
            if (
              ref.role === "character" &&
              ref.assetName.trim() &&
              !nodeLabels.has(normalize(ref.assetName))
            ) {
              push({
                level: "warning",
                sceneIndex: scene.sceneIndex,
                segmentIndex: segment.index,
                message: `${label} 镜${shot.index + 1} 角色「${ref.assetName}」未在本场 blocking 站位中，站位可能不一致。`,
              });
            }
          }
        }
      });
    });
  }

  return warnings;
}
