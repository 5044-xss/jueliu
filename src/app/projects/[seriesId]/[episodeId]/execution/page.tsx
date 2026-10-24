"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadErrorState, LoadingState } from "@/components/load-state";
import {
  Chip,
  EmptyHint,
  FinalVisual,
  OrchestrationVisual,
  PromptDocument,
  RawDetails,
  RenderVisual,
  ScriptVisual,
  StatRow,
  StoryboardVisual,
  ThreeLayers,
  TraceIssues,
  ValidationVisual,
  type VisualScene,
} from "@/components/pipeline-visuals";
import { readError } from "@/lib/http";
import { cn } from "@core/client/utils";
import type {
  PipelineTrace,
  TraceStage,
  TraceStageStatus,
} from "@core/shared/pipeline-trace";
import type { StoredScript } from "@core/shared/script";

const STEPS = [
  { title: "剧本", hint: "解析结果" },
  { title: "生成分镜", hint: "LLM 记录" },
  { title: "编排", hint: "确定性" },
  { title: "渲染", hint: "确定性" },
  { title: "编译", hint: "厂商方言" },
  { title: "校验", hint: "确定性" },
  { title: "最终提示词", hint: "提交" },
] as const;

const STAGE_IDS: (string | null)[] = [
  null,
  "storyboard",
  "orchestration",
  "render",
  "compile",
  "validate",
  "final",
];

const STATUS_DOT: Record<TraceStageStatus, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-destructive",
  empty: "bg-muted-foreground/30",
};

interface GenerationSnapshot {
  id: string;
  segmentId: string;
  jobId: string | null;
  humanPrompt: string;
  compiledPrompt: string;
  promptSig: string | null;
  mediaSig: string | null;
  videoPath: string | null;
  createdAt: string;
}

interface TraceResponse {
  trace: PipelineTrace;
  script: StoredScript | null;
  snapshot: GenerationSnapshot | null;
}

function getBlock(
  stage: TraceStage | null | undefined,
  side: "inputs" | "outputs",
  key: string,
): string {
  if (!stage) return "";
  const blocks = side === "inputs" ? stage.inputs : stage.outputs;
  return blocks.find((block) => block.key === key)?.text ?? "";
}

function parseObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function display(value: unknown, fallback = "—"): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return fallback;
}

function cleanPrompt(text: string, placeholder: string): string {
  return text.startsWith(placeholder) ? "" : text;
}

export default function ExecutionPage() {
  const { seriesId, episodeId: id } = useParams<{
    seriesId: string;
    episodeId: string;
  }>();
  const [trace, setTrace] = useState<PipelineTrace | null>(null);
  const [script, setScript] = useState<StoredScript | null>(null);
  const [snapshot, setSnapshot] = useState<GenerationSnapshot | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState(id);

  if (sessionId !== id) {
    setSessionId(id);
    setLoaded(false);
    setError(null);
  }

  const fetchTrace = useCallback(
    async (segmentId?: string | null, platform?: string | null) => {
      const params = new URLSearchParams();
      if (segmentId) params.set("segmentId", segmentId);
      if (platform) params.set("platform", platform);
      const query = params.toString();
      const res = await fetch(
        `/api/projects/${id}/pipeline-trace${query ? `?${query}` : ""}`,
      );
      if (!res.ok) throw new Error(await readError(res, "读取执行记录失败"));
      return (await res.json()) as TraceResponse;
    },
    [id],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTrace();
        if (cancelled) return;
        setTrace(data.trace);
        setScript(data.script);
        setSnapshot(data.snapshot);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchTrace]);

  async function selectSegment(nextId: string) {
    setLoading(true);
    try {
      const data = await fetchTrace(nextId, trace?.platform ?? null);
      setTrace(data.trace);
      setScript(data.script);
      setSnapshot(data.snapshot);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      const data = await fetchTrace(
        trace?.segmentId ?? null,
        trace?.platform ?? null,
      );
      setTrace(data.trace);
      setScript(data.script);
      setSnapshot(data.snapshot);
      toast.success("已刷新执行记录");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const stages = trace?.stages ?? [];
  const stageOf = (stageId: string | null) =>
    stageId ? stages.find((stage) => stage.id === stageId) ?? null : null;
  const storyboardStage = stageOf("storyboard");
  const orchestrationStage = stageOf("orchestration");
  const renderStage = stageOf("render");
  const compileStage = stageOf("compile");
  const validateStage = stageOf("validate");
  const finalStage = stageOf("final");

  const storyboardJson = getBlock(storyboardStage, "outputs", "storyboard");
  const storedScenes = (() => {
    try {
      const value = JSON.parse(storyboardJson) as unknown;
      return Array.isArray(value) ? (value as VisualScene[]) : [];
    } catch {
      return [] as VisualScene[];
    }
  })();

  const planJson = getBlock(orchestrationStage, "outputs", "plan");
  const manifestJson = getBlock(renderStage, "outputs", "manifest");
  const renderBody = getBlock(renderStage, "outputs", "render-body");
  const renderLegend = getBlock(renderStage, "outputs", "render-legend");
  const renderParams = getBlock(renderStage, "outputs", "render-params");
  const renderInput = parseObject(
    getBlock(renderStage, "inputs", "render-input"),
  );
  const orchestrationInput = parseObject(
    getBlock(orchestrationStage, "inputs", "orchestration-input"),
  );
  const storyboardParams = parseObject(
    getBlock(storyboardStage, "inputs", "storyboard-params"),
  );
  const compileParams = parseObject(
    getBlock(compileStage, "inputs", "compile-params"),
  );
  const compileMeta = parseObject(
    getBlock(compileStage, "outputs", "compile-meta"),
  );
  const validationInput = parseObject(
    getBlock(validateStage, "inputs", "validation-input"),
  );
  const finalInput = parseObject(
    getBlock(finalStage, "inputs", "final-input"),
  );

  const compileSystem = getBlock(compileStage, "inputs", "compile-system");
  const compileUser = getBlock(compileStage, "inputs", "compile-user");
  const compilePrompt = cleanPrompt(
    getBlock(compileStage, "outputs", "compile-prompt"),
    "（尚未编译）",
  );
  const checksJson = getBlock(validateStage, "outputs", "checks");
  const finalPrompt = cleanPrompt(
    getBlock(finalStage, "outputs", "final-prompt"),
    "（尚无）",
  );
  const finalLegend = getBlock(finalStage, "outputs", "final-legend");
  const finalPostprocess = getBlock(
    finalStage,
    "inputs",
    "final-postprocess",
  );

  const segmentItems = (trace?.segments ?? []).map((segment) => ({
    value: segment.id,
    label: segment.label,
  }));
  const beatCount =
    script?.scenes.reduce((sum, scene) => sum + scene.beats.length, 0) ?? 0;
  const hasTrace = Boolean(trace);
  const hasScenes = (trace?.segments?.length ?? 0) > 0;

  function statusOfStep(index: number): TraceStageStatus {
    if (index === 0) return script ? "ok" : "empty";
    return stageOf(STAGE_IDS[index])?.status ?? "empty";
  }

  function renderStep(): {
    input: ReactNode;
    process: ReactNode;
    output: ReactNode;
  } {
    switch (step) {
      case 0:
        return {
          input: (
            <div className="flex flex-col gap-2">
              <StatRow
                items={[
                  { label: "场次", value: String(script?.scenes.length ?? 0) },
                  { label: "beats", value: String(beatCount) },
                  {
                    label: "平台",
                    value: display(trace?.platform),
                  },
                  {
                    label: "厂商",
                    value: display(trace?.vendor),
                  },
                ]}
              />
              <p className="text-xs leading-6 text-muted-foreground">
                这是落库剧本，分镜、编排、渲染都从这份解析结果派生。
              </p>
            </div>
          ),
          process: (
            <ul className="list-disc space-y-1 pl-4 text-xs leading-6 text-muted-foreground">
              <li>识别 `第N场 地点 时间 内外`、`人物：…`</li>
              <li>`角色：「台词」` 记为台词，其余行按动作处理</li>
              <li>台词逐字进入 beats，是后续覆盖校验的依据</li>
            </ul>
          ),
          output: script ? (
            <ScriptVisual script={script} />
          ) : (
            <EmptyHint>还没有剧本，请先在「剧本」页生成。</EmptyHint>
          ),
        };

      case 1:
        return {
          input: (
            <div className="flex flex-col gap-2">
              <StatRow
                items={[
                  { label: "场次", value: String(script?.scenes.length ?? 0) },
                  { label: "beats", value: String(beatCount) },
                  { label: "平台", value: display(trace?.platform) },
                  {
                    label: "段落",
                    value: String(trace?.segments.length ?? 0),
                  },
                ]}
              />
              <RawDetails
                title="发给 LLM 的用户消息"
                text={getBlock(storyboardStage, "inputs", "storyboard-user")}
              />
            </div>
          ),
          process: (
            <div className="flex flex-col gap-2">
              <StatRow
                items={[
                  {
                    label: "模型",
                    value: display(storyboardParams?.model, "未读取"),
                  },
                  {
                    label: "温度",
                    value: display(storyboardParams?.temperature, "默认"),
                  },
                  { label: "输出", value: "storyboardDraftSchema" },
                ]}
              />
              <p className="text-xs leading-6 text-muted-foreground">
                LLM 只产出镜序列；代码强制 JSON 契约，并用 beat
                覆盖校验 + 一次重试，最后做运镜多样化。
              </p>
              <RawDetails
                title="系统提示词"
                text={getBlock(
                  storyboardStage,
                  "inputs",
                  "storyboard-system",
                )}
              />
            </div>
          ),
          output: storedScenes.length > 0 ? (
            <div className="flex flex-col gap-2">
              <StoryboardVisual scenes={storedScenes} />
              {storyboardStage && (
                <TraceIssues issues={storyboardStage.issues} />
              )}
            </div>
          ) : (
            <EmptyHint>还没有落库分镜，请先在「分镜」页生成。</EmptyHint>
          ),
        };

      case 2:
        return {
          input: (
            <div className="flex flex-col gap-2">
              <StatRow
                items={[
                  {
                    label: "厂商",
                    value: display(
                      (orchestrationInput?.vendor as
                        | { name?: string }
                        | undefined)?.name,
                      trace?.vendor ?? "—",
                    ),
                  },
                  {
                    label: "每段最多镜",
                    value: display(
                      (orchestrationInput?.vendor as
                        | { maxShotsPerSegment?: number }
                        | undefined)?.maxShotsPerSegment,
                    ),
                  },
                  {
                    label: "段时长",
                    value: (() => {
                      const vendorInput = orchestrationInput?.vendor as
                        | { minSegmentMs?: number; maxSegmentMs?: number }
                        | undefined;
                      if (!vendorInput?.maxSegmentMs) return "—";
                      return `${(vendorInput.minSegmentMs ?? 0) / 1000}–${
                        vendorInput.maxSegmentMs / 1000
                      }s`;
                    })(),
                  },
                  {
                    label: "参考图上限",
                    value: display(
                      (orchestrationInput?.vendor as
                        | { maxRefImages?: number }
                        | undefined)?.maxRefImages,
                    ),
                  },
                ]}
              />
              <RawDetails
                title="编排输入（镜序列 + 厂商能力）"
                text={getBlock(
                  orchestrationStage,
                  "inputs",
                  "orchestration-input",
                )}
              />
            </div>
          ),
          process: (
            <ul className="list-disc space-y-1 pl-4 text-xs leading-6 text-muted-foreground">
              <li>packSceneV2：按厂商镜数 / 时长 / 参考图上限切段</li>
              <li>shotBudget：按台词与动作估算每镜 min / ideal / max</li>
              <li>人物聚类 + 台词说话人：避免不相干角色并段</li>
              <li>硬切判定：场次首段 / 不连续 / 无共同人物 / 机位跳变</li>
              <li>段时长按厂商档位取整，并输出 warnings</li>
            </ul>
          ),
          output: hasScenes ? (
            <div className="flex flex-col gap-2">
              <OrchestrationVisual planText={planJson} />
              {orchestrationStage && (
                <TraceIssues issues={orchestrationStage.issues} />
              )}
            </div>
          ) : (
            <EmptyHint>先生成分镜。</EmptyHint>
          ),
        };

      case 3:
        return {
          input: (
            <div className="flex flex-col gap-2">
              <StatRow
                items={[
                  {
                    label: "平台",
                    value: display(
                      (renderInput?.renderOptions as
                        | { platform?: string }
                        | undefined)?.platform,
                    ),
                  },
                  {
                    label: "镜数",
                    value: display(
                      (renderInput?.shots as unknown[] | undefined)?.length,
                    ),
                  },
                  {
                    label: "目标时长",
                    value: (() => {
                      const target = (
                        renderInput?.segment as
                          | { targetMs?: number }
                          | undefined
                      )?.targetMs;
                      return target ? `${(target / 1000).toFixed(1)}s` : "—";
                    })(),
                  },
                  {
                    label: "参考图上限",
                    value: display(
                      (renderInput?.renderOptions as
                        | { maxRefImages?: number }
                        | undefined)?.maxRefImages,
                    ),
                  },
                ]}
              />
              <RawDetails
                title="渲染输入（段落 / 场次 / 镜 / 选项）"
                text={getBlock(renderStage, "inputs", "render-input")}
              />
            </div>
          ),
          process: (
            <ul className="list-disc space-y-1 pl-4 text-xs leading-6 text-muted-foreground">
              <li>按平台选模板，把段落渲染成「给人看的分镜提示词」</li>
              <li>构建 manifest：起始画面优先，参考图按槽位上限截断</li>
              <li>图N 的含义在这里确定，后续编译器只能照此绑定</li>
              <li>角色锁定 / 轴线 / 承接锚点 / 光线连续写入正文</li>
            </ul>
          ),
          output: hasTrace && hasScenes ? (
            <div className="flex flex-col gap-2">
              <RenderVisual
                manifestText={manifestJson}
                body={renderBody}
                legend={renderLegend}
                params={renderParams}
              />
              {renderStage && <TraceIssues issues={renderStage.issues} />}
            </div>
          ) : (
            <EmptyHint>先生成分镜。</EmptyHint>
          ),
        };

      case 4:
        return {
          input: (
            <div className="flex flex-col gap-2">
              <RawDetails
                title="待编译的用户消息（正文 + 清单 + 参数）"
                text={compileUser}
              />
              <RawDetails title="图片清单" text={renderLegend} />
            </div>
          ),
          process: (
            <div className="flex flex-col gap-2">
              <StatRow
                items={[
                  {
                    label: "模式",
                    value: display(compileParams?.mode, "未读取"),
                  },
                  {
                    label: "模型",
                    value: display(compileParams?.model, "未读取"),
                  },
                  {
                    label: "温度",
                    value: display(compileParams?.temperature, "默认"),
                  },
                  {
                    label: "编译器",
                    value: display(compileParams?.compilerVersion, "—"),
                  },
                ]}
              />
              <p className="text-xs leading-6 text-muted-foreground">
                H3 走结构化 IR：LLM 只写 visual/sound，台词、逐镜站位、首帧对齐由代码注入；
                其他平台走通用文本编译，保存前补「首帧为图片N」。
              </p>
              <RawDetails title="厂商方言规则（system）" text={compileSystem} />
            </div>
          ),
          output: compilePrompt ? (
            <div className="flex flex-col gap-2">
              <StatRow
                items={[
                  {
                    label: "状态",
                    value: compileMeta?.cached ? "缓存命中" : "已过期",
                  },
                  {
                    label: "长度",
                    value: `${display(compileMeta?.length, "0")} 字`,
                  },
                  {
                    label: "签名",
                    value: display(compileMeta?.sig, "—").slice(0, 10),
                  },
                ]}
              />
              <PromptDocument prompt={compilePrompt} />
              {compileStage && <TraceIssues issues={compileStage.issues} />}
            </div>
          ) : (
            <EmptyHint>
              本段还没有编译结果；生成视频或在「分镜」页编译后会落到这里。
            </EmptyHint>
          ),
        };

      case 5:
        return {
          input: (
            <div className="flex flex-col gap-2">
              <StatRow
                items={[
                  {
                    label: "段落",
                    value: display(validationInput?.segmentId, "—").slice(0, 8),
                  },
                  {
                    label: "平台",
                    value: display(validationInput?.platform, "—"),
                  },
                  {
                    label: "有提示词",
                    value: validationInput?.hasPrompt ? "是" : "否",
                  },
                ]}
              />
              <RawDetails
                title="校验输入"
                text={getBlock(validateStage, "inputs", "validation-input")}
              />
            </div>
          ),
          process: (
            <ul className="list-disc space-y-1 pl-4 text-xs leading-6 text-muted-foreground">
              <li>Preflight：人物 / 参考图 / 段时长 / 镜头数 / 轴线</li>
              <li>台词逐字覆盖（H3：&lt;d&gt; 正文）</li>
              <li>图号是否越界、首帧锚定行是否存在</li>
              <li>subjectNodeIds 是否混入非角色节点</li>
              <li>段时长步进、视频风格特效词、签名时效</li>
            </ul>
          ),
          output: hasTrace ? (
            <ValidationVisual
              checksText={checksJson}
              issues={validateStage?.issues ?? []}
            />
          ) : (
            <EmptyHint>先生成分镜并编译。</EmptyHint>
          ),
        };

      default:
        return {
          input: (
            <div className="flex flex-col gap-2">
              <StatRow
                items={[
                  {
                    label: "平台",
                    value: display(finalInput?.renderPlatform, "—"),
                  },
                  {
                    label: "厂商",
                    value: display(finalInput?.projectVendor, "—"),
                  },
                  {
                    label: "画幅",
                    value: display(finalInput?.aspectRatio, "—"),
                  },
                  {
                    label: "编译长度",
                    value: `${display(finalInput?.compiledLength, "0")} 字`,
                  },
                ]}
              />
              <div className="rounded-lg border bg-background p-3 text-xs leading-6">
                {finalPostprocess || "（无后处理说明）"}
              </div>
              {snapshot && (
                <div className="flex flex-col gap-2 rounded-lg border bg-background p-3">
                  <p className="text-xs font-medium">最近一次视频生成快照</p>
                  <StatRow
                    items={[
                      {
                        label: "时间",
                        value: new Date(snapshot.createdAt).toLocaleString(),
                      },
                      {
                        label: "视频",
                        value: snapshot.videoPath ? "已回传" : "未回传",
                      },
                      {
                        label: "签名",
                        value: snapshot.promptSig?.slice(0, 10) ?? "—",
                      },
                    ]}
                  />
                  <RawDetails
                    title="提交生成时使用的编译提示词"
                    text={snapshot.compiledPrompt}
                  />
                </div>
              )}
            </div>
          ),
          process: (
            <div className="flex flex-col gap-2">
              <p className="text-xs leading-6 text-muted-foreground">
                最终提示词 = 编译输出 + 确定性后处理。上游分镜 / 参考图 / 参数
                任一改动都会让签名失配并标记过期。
              </p>
              <StatRow
                items={[
                  {
                    label: "状态",
                    value: finalStage?.status === "ok" ? "可提交" : "需检查",
                  },
                  {
                    label: "签名",
                    value: display(finalInput?.sig, "—").slice(0, 10),
                  },
                ]}
              />
            </div>
          ),
          output: finalPrompt ? (
            <div className="flex flex-col gap-2">
              <FinalVisual prompt={finalPrompt} legend={finalLegend} />
              {finalStage && <TraceIssues issues={finalStage.issues} />}
            </div>
          ) : (
            <EmptyHint>还没有最终提示词。</EmptyHint>
          ),
        };
    }
  }

  if (!loaded) {
    return error ? (
      <LoadErrorState
        message={error}
        onRetry={() => {
          setLoaded(false);
          setError(null);
          (async () => {
            try {
              const data = await fetchTrace();
              setTrace(data.trace);
              setScript(data.script);
              setSnapshot(data.snapshot);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setLoaded(true);
            }
          })();
        }}
      />
    ) : (
      <LoadingState />
    );
  }

  const content = renderStep();
  const currentStage = stageOf(STAGE_IDS[step]);

  if (!hasScenes) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 pb-4">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl bg-block-cream p-5">
          <div>
            <h2 className="text-base font-medium">分镜执行记录</h2>
            <p className="text-sm text-muted-foreground">
              按步骤查看本集「剧本 → 分镜 → 编排 → 渲染 → 编译 → 校验 →
              最终提示词」的实际输入与产物。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading || !trace}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            刷新记录
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <EmptyState
          icon={ClipboardList}
          tone="cream"
          title="还没有执行记录"
          description="在「分镜」页生成分镜并编译提示词后，这里会按步骤展示剧本、分镜、编排、渲染、编译、校验与最终提示词的实际输入和产物。"
          action={
            <Button
              nativeButton={false}
              render={<Link href={`/projects/${seriesId}/${id}/storyboard`} />}
            >
              <ClipboardList className="size-4" />
              去生成分镜
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 pb-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl bg-block-cream p-5">
        <div>
          <h2 className="text-base font-medium">分镜执行记录</h2>
          <p className="text-sm text-muted-foreground">
            按步骤查看本集「剧本 → 分镜 → 编排 → 渲染 → 编译 → 校验 →
            最终提示词」的实际输入与产物。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading || !trace}
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          刷新记录
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {segmentItems.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-2xl border bg-card px-4 py-2.5">
          <span className="text-xs text-muted-foreground">当前段落</span>
          <Select
            value={trace?.segmentId ?? undefined}
            onValueChange={(value) => selectSegment(value as string)}
            items={segmentItems}
            disabled={loading}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="选择段落" />
            </SelectTrigger>
            <SelectContent>
              {segmentItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            平台 {trace?.platform} · 厂商 {trace?.vendor}
            {trace?.generatedAt &&
              ` · 读取于 ${new Date(trace.generatedAt).toLocaleTimeString()}`}
          </span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="flex shrink-0 items-stretch gap-1 overflow-x-auto rounded-2xl border bg-card p-2 lg:min-h-0 lg:flex-col lg:overflow-y-auto">
          {STEPS.map((item, index) => {
            const status = statusOfStep(index);
            const active = step === index;
            return (
              <button
                key={item.title}
                type="button"
                onClick={() => setStep(index)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors lg:w-full",
                  active
                    ? "border-foreground/15 bg-muted text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    active
                      ? "bg-foreground text-background"
                      : "bg-muted-foreground/10",
                  )}
                >
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium">
                    {item.title}
                  </span>
                  <span className="hidden truncate text-[10px] lg:block">
                    {item.hint}
                  </span>
                </span>
                <span
                  className={cn(
                    "ml-auto size-1.5 shrink-0 rounded-full",
                    STATUS_DOT[status],
                  )}
                  title={status}
                />
              </button>
            );
          })}
        </aside>

        <section className="flex min-h-0 flex-col gap-3">
          <div className="shrink-0 rounded-2xl border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-medium">
                  {STEPS[step].title}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {STEPS[step].hint}
                  </span>
                </h3>
                {currentStage?.summary && (
                  <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                    {currentStage.summary}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {(currentStage?.meta ?? []).map((item) => (
                  <Chip key={item.label}>
                    {item.label} {item.value}
                  </Chip>
                ))}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card">
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 xl:overflow-hidden">
              <ThreeLayers
                scroll
                input={content.input}
                process={content.process}
                output={content.output}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3">
            <Button
              variant="outline"
              onClick={() => setStep((value) => Math.max(0, value - 1))}
              disabled={step === 0}
            >
              <ChevronLeft className="size-4" />
              上一步
            </Button>
            <span className="text-xs text-muted-foreground">
              第 {step + 1} / {STEPS.length} 步 · {STEPS[step].title}
            </span>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((value) => value + 1)}>
                下一步
                <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setStep(0)}>
                回到开头
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
