"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@core/client/utils";
import type { TraceIssue } from "@core/shared/pipeline-trace";
import type { ManifestItem } from "@core/shared/render-types";
import type { StoredScript } from "@core/shared/script";

/* ---------------- 通用 ---------------- */

function ms(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value / 1000).toFixed(1)}s`;
}

function safeJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

export function Chip({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "dark" | "green" | "amber" | "blue";
}) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    dark: "bg-foreground text-background",
    green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    blue: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px]", tones[tone])}>
      {children}
    </span>
  );
}

export function ThreeLayers({
  input,
  process,
  output,
}: {
  input: ReactNode;
  process: ReactNode;
  output: ReactNode;
}) {
  const layers: { title: string; className: string; node: ReactNode }[] = [
    {
      title: "输入",
      className: "border-sky-500/25 bg-sky-500/[0.03]",
      node: input,
    },
    {
      title: "通过什么",
      className: "border-amber-500/25 bg-amber-500/[0.03]",
      node: process,
    },
    {
      title: "输出",
      className: "border-emerald-500/25 bg-emerald-500/[0.03]",
      node: output,
    },
  ];
  return (
    <div className="grid gap-3 xl:grid-cols-3">
      {layers.map((layer) => (
        <section
          key={layer.title}
          className={cn(
            "flex min-w-0 flex-col gap-3 rounded-xl border p-3",
            layer.className,
          )}
        >
          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {layer.title}
          </h3>
          {layer.node}
        </section>
      ))}
    </div>
  );
}

export function RawDetails({
  title,
  text,
  open = false,
}: {
  title: string;
  text: string;
  open?: boolean;
}) {
  return (
    <details className="rounded-lg border bg-background p-3" open={open}>
      <summary className="flex cursor-pointer items-center justify-between gap-2 text-xs font-medium">
        <span>{title}</span>
        <span className="text-[11px] font-normal text-muted-foreground">
          {text.length} 字
        </span>
      </summary>
      <div className="mt-2 flex justify-end">
        <CopyButton text={text} label="复制" size="xs" variant="ghost" />
      </div>
      <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-muted/40 p-2 text-xs leading-5 whitespace-pre-wrap break-words">
        {text || "（空）"}
      </pre>
    </details>
  );
}

export function StatRow({
  items,
}: {
  items: { label: string; value: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item.label}
          className="rounded-md border bg-background px-2 py-0.5 text-[11px]"
        >
          <span className="text-muted-foreground">{item.label} </span>
          {item.value}
        </span>
      ))}
    </div>
  );
}

/* ---------------- 问题列表 ---------------- */

const ISSUE_ICON = {
  info: Info,
  warning: AlertTriangle,
  error: AlertTriangle,
} as const;

export function TraceIssues({ issues }: { issues: TraceIssue[] }) {
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-3.5" />
        无问题
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {issues.map((issue, index) => {
        const Icon = ISSUE_ICON[issue.level];
        return (
          <div
            key={`${issue.code}-${index}`}
            className={cn(
              "flex items-start gap-2 rounded-lg border bg-background p-2 text-xs leading-5",
              issue.level === "error"
                ? "border-destructive/30 text-destructive"
                : issue.level === "warning"
                  ? "border-amber-500/30 text-amber-700 dark:text-amber-300"
                  : "text-muted-foreground",
            )}
          >
            <Icon className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              <span className="mr-1.5 rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                {issue.code}
              </span>
              {issue.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- 剧本 ---------------- */

export function ScriptVisual({ script }: { script: StoredScript }) {
  if (script.scenes.length === 0) {
    return <EmptyHint>没有解析到场次。</EmptyHint>;
  }
  return (
    <div className="flex flex-col gap-3">
      {script.title && <p className="text-sm font-medium">{script.title}</p>}
      {script.scenes.map((scene) => (
        <div key={scene.index} className="rounded-lg border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">第{scene.index}场</span>
            <span className="text-sm">{scene.slug}</span>
            <Chip>{scene.location || "地点未定"}</Chip>
            <Chip>{scene.timeOfDay || "时间未定"}</Chip>
            <Chip>
              {scene.interiorExterior
                ? `${scene.interiorExterior}景`
                : "内外未定"}
            </Chip>
          </div>
          {scene.characters.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {scene.characters.map((character) => (
                <Chip key={character} tone="blue">
                  {character}
                </Chip>
              ))}
            </div>
          )}
          {scene.summary && (
            <p className="mt-2 text-xs text-muted-foreground">{scene.summary}</p>
          )}
          <ol className="mt-2 flex flex-col gap-1.5">
            {scene.beats.map((beat, index) => (
              <li
                key={index}
                className="flex items-start gap-2 text-xs leading-6"
              >
                {beat.type === "dialogue" ? (
                  <>
                    <Chip tone="green">台词</Chip>
                    <span className="min-w-0 break-words">
                      <span className="font-medium">
                        {beat.character || "旁白"}：
                      </span>
                      {beat.text}
                    </span>
                  </>
                ) : (
                  <>
                    <Chip>动作</Chip>
                    <span className="min-w-0 break-words">{beat.text}</span>
                  </>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

/* ---------------- 分镜 ---------------- */

const SHOT_INTENT_LABELS: Record<string, string> = {
  establish: "环境",
  relation: "关系",
  dialogue: "对白",
  reaction: "反应",
  action: "动作",
  insert: "插入",
};

export interface VisualShot {
  index: number;
  beatIds?: string[];
  intent?: string;
  durationMs?: number;
  continuesPrev?: boolean;
  camera?: {
    focal?: string;
    shotSize?: string;
    angle?: string;
    movement?: string;
    side?: string;
  };
  lighting?: string;
  action?: string;
  dialogue?: {
    character?: string;
    text?: string;
    target?: string;
    offscreen?: boolean;
  }[];
  expression?: string;
  subjectNodeIds?: string[];
  refs?: {
    role?: string;
    assetName?: string;
    variantLabel?: string;
    viewLabel?: string;
  }[];
  stateIssues?: { message?: string }[];
}

export interface VisualScene {
  sceneIndex: string;
  sceneSlug: string;
  location?: string;
  timeOfDay?: string;
  interiorExterior?: string;
  shots?: VisualShot[];
  segments?: { index: number; shots: VisualShot[] }[];
}

function shotsOf(scene: VisualScene): VisualShot[] {
  if (Array.isArray(scene.shots)) return scene.shots;
  return (scene.segments ?? []).flatMap((segment) => segment.shots ?? []);
}

function ShotCard({ shot }: { shot: VisualShot }) {
  const camera = shot.camera ?? {};
  const cameraParts = [
    camera.shotSize,
    camera.focal,
    camera.angle,
    camera.movement,
    camera.side ? `轴线${camera.side === "left" ? "左" : "右"}侧` : "",
  ].filter(Boolean);
  const dialogue = (shot.dialogue ?? []).filter((line) => line.text?.trim());
  const refs = shot.refs ?? [];
  const issues = (shot.stateIssues ?? []).filter((item) => item.message);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium">镜 {shot.index}</span>
        <Chip tone="dark">{ms(shot.durationMs)}</Chip>
        {shot.intent && (
          <Chip tone="blue">
            {SHOT_INTENT_LABELS[shot.intent] ?? shot.intent}
          </Chip>
        )}
        {shot.continuesPrev && <Chip tone="blue">延续上一镜</Chip>}
        {(shot.beatIds ?? []).map((beatId) => (
          <Chip key={beatId}>{beatId}</Chip>
        ))}
      </div>
      {cameraParts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {cameraParts.map((part) => (
            <Chip key={part}>{part}</Chip>
          ))}
        </div>
      )}
      {shot.action && (
        <p className="text-xs leading-6 break-words">{shot.action}</p>
      )}
      {dialogue.length > 0 && (
        <div className="flex flex-col gap-1">
          {dialogue.map((line, index) => (
            <div
              key={index}
              className="rounded-md bg-muted/50 px-2 py-1 text-xs leading-5"
            >
              <span className="font-medium">{line.character || "旁白"}：</span>
              {line.text}
              {line.offscreen && (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  （画外）
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {shot.expression && (
        <p className="text-[11px] text-muted-foreground">
          表情：{shot.expression}
        </p>
      )}
      {shot.lighting && (
        <p className="text-[11px] text-muted-foreground">
          光线：{shot.lighting}
        </p>
      )}
      {(shot.subjectNodeIds ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-muted-foreground">人物</span>
          {(shot.subjectNodeIds ?? []).map((id) => (
            <Chip key={id}>{id}</Chip>
          ))}
        </div>
      )}
      {refs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-muted-foreground">参考</span>
          {refs.map((ref, index) => (
            <Chip key={index} tone="blue">
              {[ref.role, ref.assetName, ref.variantLabel, ref.viewLabel]
                .filter(Boolean)
                .join("·")}
            </Chip>
          ))}
        </div>
      )}
      {issues.length > 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          {issues.length} 条归一化提示：{issues[0]?.message}
        </p>
      )}
    </div>
  );
}

export function StoryboardVisual({ scenes }: { scenes: VisualScene[] }) {
  if (scenes.length === 0) return <EmptyHint>没有分镜数据。</EmptyHint>;
  return (
    <div className="flex flex-col gap-4">
      {scenes.map((scene) => {
        const shots = shotsOf(scene);
        return (
          <div key={`${scene.sceneIndex}-${scene.sceneSlug}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                第{scene.sceneIndex}场 · {scene.sceneSlug}
              </span>
              {scene.location && <Chip>{scene.location}</Chip>}
              {scene.timeOfDay && <Chip>{scene.timeOfDay}</Chip>}
              {scene.interiorExterior && (
                <Chip>{scene.interiorExterior}景</Chip>
              )}
              <Chip tone="dark">{shots.length} 镜</Chip>
            </div>
            {shots.length === 0 ? (
              <EmptyHint>本场没有镜。</EmptyHint>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {shots.map((shot) => (
                  <ShotCard key={shot.index} shot={shot} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- 编排 ---------------- */

interface PlanSegment {
  index: number;
  shotIndexes: number[];
  shotCount: number;
  targetMs: number;
  shotDurations: number[];
  hardCut: boolean;
  hardCutReason: string;
  warnings: string[];
}

interface PlanScene {
  sceneIndex: string;
  sceneSlug: string;
  usesV2: boolean;
  segments: PlanSegment[];
}

interface Plan {
  usesV2: boolean;
  totalSegments: number;
  totalShots: number;
  totalTargetMs: number;
  scenes: PlanScene[];
}

const HARD_CUT_LABEL: Record<string, string> = {
  first: "场次首段",
  "not-continuous": "剧情不连续",
  "no-shared-subject": "人物不重叠",
  "camera-jump": "机位跳变",
  continuous: "连续",
};

export function OrchestrationVisual({ planText }: { planText: string }) {
  const plan = safeJson<Plan | null>(planText, null);
  if (!plan || !Array.isArray(plan.scenes)) {
    return <EmptyHint>暂无编排计划。</EmptyHint>;
  }
  return (
    <div className="flex flex-col gap-3">
      <StatRow
        items={[
          { label: "算法", value: plan.usesV2 ? "packSceneV2" : "packScene" },
          { label: "段", value: String(plan.totalSegments) },
          { label: "镜", value: String(plan.totalShots) },
          { label: "总时长", value: ms(plan.totalTargetMs) },
        ]}
      />
      {plan.scenes.map((scene) => (
        <div key={scene.sceneIndex}>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              第{scene.sceneIndex}场 · {scene.sceneSlug}
            </span>
            <Chip>{scene.segments.length} 段</Chip>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {scene.segments.map((segment) => (
              <div
                key={segment.index}
                className="rounded-lg border bg-background p-3"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">
                    第 {segment.index} 段
                  </span>
                  <Chip tone="dark">{ms(segment.targetMs)}</Chip>
                  <Chip tone={segment.hardCut ? "amber" : "green"}>
                    {segment.hardCut ? "硬切" : "连续"} ·{" "}
                    {HARD_CUT_LABEL[segment.hardCutReason] ??
                      segment.hardCutReason}
                  </Chip>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {segment.shotIndexes.map((shotIndex, index) => (
                    <span key={shotIndex} className="flex items-center gap-1">
                      {index > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          →
                        </span>
                      )}
                      <Chip>镜{shotIndex}</Chip>
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  每镜时长：
                  {segment.shotDurations
                    .map((duration) => ms(duration))
                    .join(" / ")}
                </p>
                {segment.warnings.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                    {segment.warnings.map((warning, index) => (
                      <li key={index}>· {warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- 渲染 ---------------- */

const ROLE_LABEL: Record<string, string> = {
  start: "本段起始画面",
  scene: "场景",
  character: "角色",
  prop: "道具",
  upload: "上传参考",
};

function LegendVisual({ legend }: { legend: string }) {
  const lines = legend
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return <EmptyHint>没有参考图。</EmptyHint>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {lines.map((line) => (
        <Chip key={line} tone="blue">
          {line}
        </Chip>
      ))}
    </div>
  );
}

export function RenderVisual({
  manifestText,
  body,
  legend,
  params,
}: {
  manifestText: string;
  body: string;
  legend: string;
  params: string;
}) {
  const parsedManifest = safeJson<ManifestItem[]>(manifestText, []);
  const manifest = Array.isArray(parsedManifest) ? parsedManifest : [];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
          图片清单（manifest）
        </h4>
        {manifest.length === 0 ? (
          <EmptyHint>本段没有参考图。</EmptyHint>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {manifest.map((item) => (
              <div
                key={`${item.slot}-${item.viewId ?? item.frameId ?? item.label}`}
                className="flex min-w-0 items-start gap-2 rounded-lg border bg-background p-2"
              >
                <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] text-background">
                  图{item.slot}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{item.label}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {ROLE_LABEL[item.role] ?? item.role}
                    {item.viewId ? ` · ${item.viewId.slice(0, 8)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
          渲染正文
        </h4>
        <BodyVisual body={body} />
      </div>

      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
          图片清单文本
        </h4>
        <LegendVisual legend={legend} />
      </div>

      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
          生成参数
        </h4>
        <ParamsVisual params={params} />
      </div>
    </div>
  );
}

function BodyVisual({ body }: { body: string }) {
  if (!body.trim()) return <EmptyHint>正文为空。</EmptyHint>;
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-background p-3 text-xs leading-6">
      {body.split("\n").map((line, index) => {
        const text = line.trim();
        if (!text) return <div key={index} className="h-1" />;
        if (/^分镜\d+/u.test(text)) {
          return (
            <p
              key={index}
              className="mt-1 rounded bg-muted/60 px-2 py-1 font-medium"
            >
              {text}
            </p>
          );
        }
        if (/^【.+】$/u.test(text)) {
          return (
            <p
              key={index}
              className="mt-1 text-[11px] font-semibold text-muted-foreground"
            >
              {text}
            </p>
          );
        }
        return (
          <p key={index} className="break-words whitespace-pre-wrap">
            {text}
          </p>
        );
      })}
    </div>
  );
}

function ParamsVisual({ params }: { params: string }) {
  const lines = params
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return <EmptyHint>没有参数。</EmptyHint>;
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-background p-2">
      {lines.map((line, index) => {
        const match = line.match(/^([^：:]{1,12})[：:]\s*(.*)$/u);
        if (!match) {
          return (
            <p key={index} className="text-xs leading-5">
              {line}
            </p>
          );
        }
        return (
          <div
            key={index}
            className="flex items-baseline justify-between gap-3 rounded px-1 py-0.5 text-xs"
          >
            <span className="shrink-0 text-muted-foreground">{match[1]}</span>
            <span className="min-w-0 break-words text-right">{match[2]}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- 提示词文档 ---------------- */

const H3_FIELDS = new Set([
  "subject_definitions",
  "summary",
  "retention_analysis",
  "detailed_description",
  "overall_soundscape",
  "non_diegetic_music",
  "integrated_multimodal_description",
]);

function highlight(text: string) {
  const parts = text.split(
    /(\[Shot \d+\]|<Subject \d+>|<Picture \d+>|<d>[\s\S]*?<\/d>|\(S\d+(?:,S\d+)*\))/g,
  );
  return parts.map((part, index) => {
    if (/^\[Shot \d+\]$/u.test(part)) {
      return (
        <span key={index} className="rounded bg-foreground/10 px-1 font-medium">
          {part}
        </span>
      );
    }
    if (/^<(Subject|Picture) \d+>$/u.test(part)) {
      return (
        <span
          key={index}
          className="rounded bg-sky-500/10 px-1 text-sky-700 dark:text-sky-300"
        >
          {part}
        </span>
      );
    }
    if (/^<d>/.test(part)) {
      return (
        <span
          key={index}
          className="rounded bg-emerald-500/10 px-1 text-emerald-700 dark:text-emerald-300"
        >
          {part}
        </span>
      );
    }
    if (/^\(S\d/u.test(part)) {
      return (
        <span key={index} className="rounded bg-amber-500/10 px-1">
          {part}
        </span>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

export function PromptDocument({ prompt }: { prompt: string }) {
  if (!prompt.trim()) {
    return <EmptyHint>尚未生成提示词。</EmptyHint>;
  }
  const sections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } = {
    title: "提示词",
    lines: [],
  };
  for (const line of prompt.split("\n")) {
    const text = line.trim();
    const heading = text.match(/^【(.+)】$/u);
    if (heading) {
      sections.push(current);
      current = { title: heading[1], lines: [] };
      continue;
    }
    const field = text.match(/^([a-z_]+):\s*(.*)$/u);
    if (field && H3_FIELDS.has(field[1])) {
      sections.push(current);
      current = { title: field[1], lines: [field[2]] };
      continue;
    }
    current.lines.push(line);
  }
  sections.push(current);

  const visible = sections.filter((section) =>
    section.lines.some((line) => line.trim()),
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <CopyButton text={prompt} label="复制全文" size="xs" />
      </div>
      {visible.map((section, index) => (
        <div
          key={`${section.title}-${index}`}
          className="rounded-lg border bg-background p-3"
        >
          <p className="mb-1 font-mono text-[11px] font-semibold text-muted-foreground">
            {section.title}
          </p>
          <div className="flex flex-col gap-1 text-xs leading-6">
            {section.lines.map((line, lineIndex) => {
              const text = line.trim();
              if (!text) return <div key={lineIndex} className="h-1" />;
              return (
                <p key={lineIndex} className="break-words whitespace-pre-wrap">
                  {highlight(text)}
                </p>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- 校验 ---------------- */

const CHECK_LABELS: Record<string, string> = {
  preflight: "Preflight 连续性检查",
  dialogueCoverage: "台词逐字覆盖",
  pictureRefs: "图号引用",
  nonCharacterSubjects: "非角色节点混入",
  duplicateSegmentIndexes: "重复段序号",
};

interface CoverageValue {
  sourceCount?: number;
  compiledCount?: number;
  missing?: { text?: string }[];
  placeholderOnly?: boolean;
}

function CheckCard({ name, value }: { name: string; value: unknown }) {
  const label = CHECK_LABELS[name] ?? name;
  const isArray = Array.isArray(value);

  let body: ReactNode;
  if (value === undefined || value === null) {
    body = <p className="text-[11px] text-muted-foreground">未采集</p>;
  } else if (name === "dialogueCoverage" && typeof value === "object") {
    const coverage = value as CoverageValue;
    const missing = coverage.missing ?? [];
    const ok = missing.length === 0 && !coverage.placeholderOnly;
    body = (
      <div className="flex flex-col gap-1">
        <StatRow
          items={[
            { label: "源台词", value: String(coverage.sourceCount ?? 0) },
            {
              label: "编译命中",
              value: String(coverage.compiledCount ?? 0),
            },
            { label: "缺失", value: String(missing.length) },
          ]}
        />
        {!ok && (
          <p className="text-[11px] text-destructive">
            缺失：{missing.map((item) => item.text).join("；")}
          </p>
        )}
        {coverage.placeholderOnly && (
          <p className="text-[11px] text-destructive">
            只剩占位句，没有 &lt;d&gt; 正文。
          </p>
        )}
      </div>
    );
  } else if (name === "pictureRefs" && typeof value === "object") {
    const refs = value as {
      available?: number[];
      referenced?: number[];
      outOfRange?: number[];
    };
    body = (
      <div className="flex flex-wrap gap-1">
        <Chip>可用 {refs.available?.length ?? 0} 张</Chip>
        <Chip tone="blue">
          已引用 {refs.referenced?.join("、") || "—"}
        </Chip>
        {(refs.outOfRange?.length ?? 0) > 0 && (
          <Chip tone="amber">越界 {refs.outOfRange?.join("、")}</Chip>
        )}
      </div>
    );
  } else if (isArray) {
    const items = value as unknown[];
    body =
      items.length === 0 ? (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
          无异常
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 text-[11px] text-amber-700 dark:text-amber-300">
          {items.slice(0, 8).map((item, index) => (
            <li key={index} className="break-words">
              ·{" "}
              {typeof item === "string"
                ? item
                : typeof item === "object" && item
                  ? ((item as { message?: string }).message ??
                    JSON.stringify(item))
                  : String(item)}
            </li>
          ))}
        </ul>
      );
  } else if (typeof value === "string") {
    body = <p className="text-[11px] text-muted-foreground">{value}</p>;
  } else {
    body = (
      <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2 text-[11px] whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="mb-1 text-xs font-medium">{label}</p>
      {body}
    </div>
  );
}

export function ValidationVisual({
  checksText,
  issues,
}: {
  checksText: string;
  issues: TraceIssue[];
}) {
  const checks = safeJson<Record<string, unknown>>(checksText, {});
  return (
    <div className="flex flex-col gap-3">
      <TraceIssues issues={issues} />
      <div className="grid gap-2">
        {Object.entries(checks).map(([name, value]) => (
          <CheckCard key={name} name={name} value={value} />
        ))}
      </div>
    </div>
  );
}

/* ---------------- 最终 ---------------- */

export function FinalVisual({
  prompt,
  legend,
}: {
  prompt: string;
  legend: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <PromptDocument prompt={prompt} />
      <div>
        <h4 className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
          提交顺序的图片清单
        </h4>
        <LegendVisual legend={legend} />
      </div>
    </div>
  );
}
