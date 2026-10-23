"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LlmKeyNotice, useLlmConfigured } from "@/components/llm-notice";
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
import { ASPECT_OPTIONS, DEFAULT_ASPECT_RATIO } from "@/lib/aspect";
import { cn } from "@core/client/utils";
import type { LibraryStyle } from "@core/shared/library/types";
import type { LibraryVendor } from "@core/shared/library/vendors";
import type {
  TestPipelineState,
  TraceStage,
  TraceStageStatus,
} from "@core/shared/pipeline-trace";
import type { StoredScript } from "@core/shared/script";

const SAMPLE_SCRIPT = `第1场 婚礼现场 日 外
人物：陈平生、陈婉儿、小厮
概述：陈平生在喜轿前扫地，小厮送来一枚金元。
陈平生：（停下扫帚，抬头望向喜轿）
小厮：「拿着吧，主家赏的。」
陈平生：「不必。」
（金元被高高抛起，划出一道弧线，落入左侧大红喜轿。）
陈婉儿：「你这是做什么！」`;

const STEPS = [
  { title: "输入剧本", hint: "解析文本" },
  { title: "生成分镜", hint: "LLM" },
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

function scriptToReadable(script: StoredScript): string {
  const lines: string[] = [];
  if (script.title) lines.push(script.title, "");
  for (const scene of script.scenes) {
    lines.push(
      [
        `第${scene.index}场`,
        scene.slug || scene.location,
        scene.timeOfDay,
        scene.interiorExterior,
      ]
        .filter(Boolean)
        .join(" "),
    );
    if (scene.characters.length > 0) {
      lines.push(`人物：${scene.characters.join("、")}`);
    }
    if (scene.summary) lines.push(`概述：${scene.summary}`);
    for (const beat of scene.beats) {
      if (beat.type === "dialogue") {
        lines.push(`${beat.character || "旁白"}：「${beat.text}」`);
      } else {
        lines.push(beat.text);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
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

export default function PipelineTestPage() {
  const [styles, setStyles] = useState<LibraryStyle[]>([]);
  const [vendors, setVendors] = useState<LibraryVendor[]>([]);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  const [segmentSeconds, setSegmentSeconds] = useState(10);
  const [scriptText, setScriptText] = useState(SAMPLE_SCRIPT);
  const [parsed, setParsed] = useState<StoredScript | null>(null);
  const [state, setState] = useState<TestPipelineState | null>(null);
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [storyboardView, setStoryboardView] = useState<"draft" | "stored">(
    "draft",
  );
  const [parsing, setParsing] = useState(false);
  const [running, setRunning] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [loadingState, setLoadingState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const llmMissing = useLlmConfigured() === "missing";

  const fetchState = useCallback(
    async (segment?: string | null, platform?: string | null) => {
      const params = new URLSearchParams();
      if (segment) params.set("segmentId", segment);
      if (platform) params.set("platform", platform);
      const query = params.toString();
      const res = await fetch(`/api/test/trace${query ? `?${query}` : ""}`);
      if (!res.ok) throw new Error(await readError(res, "读取调试状态失败"));
      return (await res.json()) as TestPipelineState;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [stylesRes, vendorsRes, stateRes] = await Promise.all([
          fetch("/api/library/styles"),
          fetch("/api/library/vendors"),
          fetch("/api/test/trace"),
        ]);
        const stylesData = stylesRes.ok
          ? ((await stylesRes.json()) as { styles?: LibraryStyle[] })
          : { styles: [] };
        const vendorsData = vendorsRes.ok
          ? ((await vendorsRes.json()) as { vendors?: LibraryVendor[] })
          : { vendors: [] };
        const initialState = stateRes.ok
          ? ((await stateRes.json()) as TestPipelineState)
          : null;
        if (cancelled) return;

        const styleList = stylesData.styles ?? [];
        const vendorList = vendorsData.vendors ?? [];
        setStyles(styleList);
        setVendors(vendorList);
        setStyleId((prev) => prev ?? styleList[0]?.id ?? null);
        setVendorId(
          (prev) =>
            prev ??
            vendorList.find((vendor) => vendor.isDefault)?.id ??
            vendorList[0]?.id ??
            null,
        );
        if (initialState) {
          setState(initialState);
          setParsed(initialState.script);
          setScriptText(
            initialState.input ||
              (initialState.script
                ? scriptToReadable(initialState.script)
                : ""),
          );
          setSegmentId(initialState.trace?.segmentId ?? null);
          if (initialState.settings) {
            setStyleId(initialState.settings.styleId ?? null);
            setVendorId(initialState.settings.vendor);
            setAspectRatio(initialState.settings.aspectRatio);
            setSegmentSeconds(
              Math.round(initialState.settings.defaultSegmentMs / 1000),
            );
          }
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function parseScript(): Promise<StoredScript | null> {
    if (!scriptText.trim()) {
      toast.error("请先输入剧本");
      return null;
    }
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/test/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptText }),
      });
      const data = (await res.json().catch(() => null)) as {
        script?: StoredScript;
        error?: string;
      } | null;
      if (!res.ok || !data?.script) {
        throw new Error(data?.error || "剧本解析失败");
      }
      setParsed(data.script);
      toast.success(
        `解析成功：${data.script.scenes.length} 场 / ${data.script.scenes.reduce(
          (sum, scene) => sum + scene.beats.length,
          0,
        )} beats`,
      );
      return data.script;
    } catch (err) {
      const message = (err as Error).message || "剧本解析失败";
      setError(message);
      toast.error(message);
      return null;
    } finally {
      setParsing(false);
    }
  }

  async function runGeneration() {
    if (!scriptText.trim()) {
      toast.error("请先输入剧本");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/test/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptText,
          styleId,
          aspectRatio,
          vendor: vendorId,
          defaultSegmentMs: Math.round(segmentSeconds * 1000),
          compile: false,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | TestPipelineState
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error || "生成分镜失败",
        );
      }
      const next = data as TestPipelineState;
      setState(next);
      setParsed(next.script);
      setSegmentId(next.trace?.segmentId ?? null);
      setStoryboardView("draft");
      if (next.compileError) {
        toast.error(`编译失败：${next.compileError}`);
      } else {
        toast.success(
          next.trace?.segments.length
            ? `分镜已生成：${next.trace.segments.length} 段`
            : "分镜已生成",
        );
      }
    } catch (err) {
      const message = (err as Error).message || "生成分镜失败";
      setError(message);
      toast.error(message);
    } finally {
      setRunning(false);
    }
  }

  async function compileSelected() {
    if (!segmentId) return;
    setCompiling(true);
    try {
      const res = await fetch("/api/test/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segmentId,
          platform: state?.trace?.platform,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | TestPipelineState
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error || "编译失败",
        );
      }
      const next = data as TestPipelineState;
      setState(next);
      setSegmentId(next.trace?.segmentId ?? segmentId);
      if (next.compileError) {
        toast.error(`编译失败：${next.compileError}`);
      } else {
        toast.success("编译完成");
      }
    } catch (err) {
      toast.error((err as Error).message || "编译失败");
    } finally {
      setCompiling(false);
    }
  }

  async function selectSegment(nextId: string) {
    setSegmentId(nextId);
    setLoadingState(true);
    try {
      const next = await fetchState(
        nextId,
        state?.trace?.platform ?? null,
      );
      setState(next);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingState(false);
    }
  }

  async function refresh() {
    if (!segmentId) return;
    setLoadingState(true);
    try {
      const next = await fetchState(
        segmentId,
        state?.trace?.platform ?? null,
      );
      setState(next);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingState(false);
    }
  }

  const stages = state?.trace?.stages ?? [];
  const stageOf = (id: string | null) =>
    id ? stages.find((stage) => stage.id === id) ?? null : null;
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
  const parsedSceneByIndex = new Map(
    (parsed?.scenes ?? []).map((scene) => [scene.index, scene]),
  );
  const draftScenes: VisualScene[] = (state?.draft?.scenes ?? []).map(
    (scene) => {
      const meta = parsedSceneByIndex.get(scene.sceneIndex);
      return {
        sceneIndex: scene.sceneIndex,
        sceneSlug:
          meta?.slug || meta?.location || `第${scene.sceneIndex}场`,
        location: meta?.location,
        timeOfDay: meta?.timeOfDay,
        interiorExterior: meta?.interiorExterior,
        shots: scene.shots.map((shot, index) => ({
          ...shot,
          index: index + 1,
        })),
      };
    },
  );

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

  const segmentItems = (state?.trace?.segments ?? []).map((segment) => ({
    value: segment.id,
    label: segment.label,
  }));
  const styleName =
    styles.find((style) => style.id === styleId)?.name ?? "默认风格";
  const vendor = vendors.find((item) => item.id === vendorId);
  const beatCount =
    parsed?.scenes.reduce((sum, scene) => sum + scene.beats.length, 0) ?? 0;
  const hasTrace = Boolean(state?.trace);
  const dirty = Boolean(state?.input) && scriptText !== state?.input;

  function statusOfStep(index: number): TraceStageStatus {
    if (index === 0) return parsed ? "ok" : "empty";
    return stageOf(STAGE_IDS[index])?.status ?? "empty";
  }

  function canEnter(index: number): boolean {
    if (index === 0) return true;
    if (index === 1) return scriptText.trim().length > 0 || hasTrace;
    return hasTrace;
  }

  async function next() {
    if (step === 0) {
      const script = parsed ?? (await parseScript());
      if (script) setStep(1);
      return;
    }
    if (!hasTrace) {
      toast.error("请先生成分镜");
      return;
    }
    setStep((value) => Math.min(STEPS.length - 1, value + 1));
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
            <div className="flex flex-col gap-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">风格</span>
                  <Select
                    value={styleId}
                    onValueChange={(value) => setStyleId(value as string)}
                    items={styles.map((style) => ({
                      value: style.id,
                      label: style.name,
                    }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择风格" />
                    </SelectTrigger>
                    <SelectContent>
                      {styles.map((style) => (
                        <SelectItem key={style.id} value={style.id}>
                          {style.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">厂商</span>
                  <Select
                    value={vendorId}
                    onValueChange={(value) => setVendorId(value as string)}
                    items={vendors.map((item) => ({
                      value: item.id,
                      label: `${item.name}（${item.platform}）`,
                    }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择厂商" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}（{item.platform}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">画幅</span>
                  <Select
                    value={aspectRatio}
                    onValueChange={(value) => setAspectRatio(value as string)}
                    items={ASPECT_OPTIONS.map((value) => ({
                      value,
                      label: value,
                    }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASPECT_OPTIONS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">
                    默认段时长（秒）
                  </span>
                  <Input
                    type="number"
                    min={4}
                    max={60}
                    value={segmentSeconds}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value)) setSegmentSeconds(value);
                    }}
                  />
                </label>
              </div>
              <Textarea
                value={scriptText}
                onChange={(event) => {
                  setScriptText(event.target.value);
                  setParsed(null);
                }}
                className="min-h-72 font-mono text-xs leading-6"
                placeholder="第1场 婚礼现场 日 外&#10;人物：陈平生、陈婉儿&#10;陈平生：「……」"
              />
              {dirty && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  剧本已修改；下方结果仍是上一次运行，请重新解析并生成。
                </p>
              )}
            </div>
          ),
          process: (
            <div className="flex flex-col gap-2 text-xs leading-6 text-muted-foreground">
              <p>
                解析器识别 `第N场 地点 时间 内外`、`人物：…`、`角色：「台词」`，
                其余行按动作；也可以直接粘贴结构化剧本 JSON。
              </p>
              <p>
                台词规则：带引号的说话行优先按台词；`角色：（动作）` 视为舞台指示。
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={parseScript}
                  disabled={parsing}
                >
                  {parsing ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  解析剧本
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setScriptText(SAMPLE_SCRIPT);
                    setParsed(null);
                  }}
                  disabled={parsing}
                >
                  <RotateCcw className="size-3.5" />
                  填入示例
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setScriptText("");
                    setParsed(null);
                  }}
                  disabled={parsing}
                >
                  清空
                </Button>
              </div>
              {error && <p className="text-destructive">{error}</p>}
            </div>
          ),
          output: parsed ? (
            <div className="flex flex-col gap-2">
              <StatRow
                items={[
                  { label: "场次", value: String(parsed.scenes.length) },
                  { label: "beats", value: String(beatCount) },
                  { label: "风格", value: styleName },
                  { label: "厂商", value: vendor?.name ?? "—" },
                ]}
              />
              <ScriptVisual script={parsed} />
            </div>
          ) : (
            <EmptyHint>点击「解析剧本」查看结构化结果。</EmptyHint>
          ),
        };

      case 1:
        return {
          input: (
            <div className="flex flex-col gap-2">
              <StatRow
                items={[
                  { label: "场次", value: String(parsed?.scenes.length ?? 0) },
                  { label: "beats", value: String(beatCount) },
                  { label: "风格", value: styleName },
                  { label: "厂商", value: vendor?.name ?? "—" },
                ]}
              />
              <RawDetails
                title="发给 LLM 的用户消息"
                text={getBlock(
                  storyboardStage,
                  "inputs",
                  "storyboard-user",
                )}
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
                LLM 只产出镜序列；代码强制 JSON 契约，并用 beat 覆盖校验 +
                一次重试，最后做运镜多样化。
              </p>
              <RawDetails
                title="系统提示词"
                text={getBlock(
                  storyboardStage,
                  "inputs",
                  "storyboard-system",
                )}
              />
              <Button
                onClick={runGeneration}
                disabled={running || llmMissing || !scriptText.trim()}
              >
                {running ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Wand2 className="size-4" />
                )}
                {running
                  ? "生成中…"
                  : hasTrace
                    ? "重新生成分镜并编排"
                    : "生成分镜并编排"}
              </Button>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          ),
          output: state?.draft || hasTrace ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant={storyboardView === "draft" ? "default" : "outline"}
                  onClick={() => setStoryboardView("draft")}
                >
                  LLM 原始 draft
                </Button>
                <Button
                  size="sm"
                  variant={storyboardView === "stored" ? "default" : "outline"}
                  onClick={() => setStoryboardView("stored")}
                >
                  落库分镜
                </Button>
                {state?.attempts && state.attempts.length > 1 && (
                  <Chip tone="amber">
                    覆盖校验 {state.attempts.length} 次
                  </Chip>
                )}
              </div>
              <StoryboardVisual
                scenes={
                  storyboardView === "draft" ? draftScenes : storedScenes
                }
              />
              {storyboardStage && (
                <TraceIssues issues={storyboardStage.issues} />
              )}
            </div>
          ) : (
            <EmptyHint>点击左侧「生成分镜并编排」。</EmptyHint>
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
                      (orchestrationInput?.vendor as { name?: string } | undefined)
                        ?.name,
                      vendor?.name ?? "—",
                    ),
                  },
                  {
                    label: "每段最多镜",
                    value: display(
                      (orchestrationInput?.vendor as { maxShotsPerSegment?: number } | undefined)
                        ?.maxShotsPerSegment,
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
                      (orchestrationInput?.vendor as { maxRefImages?: number } | undefined)
                        ?.maxRefImages,
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
          output: hasTrace ? (
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
                      (renderInput?.renderOptions as { platform?: string } | undefined)
                        ?.platform,
                    ),
                  },
                  {
                    label: "镜数",
                    value: display(
                      (renderInput?.segment as { index?: number } | undefined)
                        ?.index
                        ? String(
                            (renderInput?.shots as unknown[] | undefined)
                              ?.length ?? 0,
                          )
                        : undefined,
                    ),
                  },
                  {
                    label: "目标时长",
                    value: (() => {
                      const target = (
                        renderInput?.segment as { targetMs?: number } | undefined
                      )?.targetMs;
                      return target ? `${(target / 1000).toFixed(1)}s` : "—";
                    })(),
                  },
                  {
                    label: "keyframeOnly",
                    value:
                      (renderInput?.renderOptions as { keyframeOnly?: boolean } | undefined)
                        ?.keyframeOnly
                        ? "是"
                        : "否",
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
          output: hasTrace ? (
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
              <Button
                onClick={compileSelected}
                disabled={compiling || running || !segmentId}
              >
                {compiling ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                {compiling ? "编译中…" : "编译本段到最终提示词"}
              </Button>
              {state?.compileError && (
                <p className="text-xs break-words text-destructive">
                  编译失败：{state.compileError}
                </p>
              )}
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
            <EmptyHint>本段还没有编译结果；点击左侧「编译本段」。</EmptyHint>
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
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={compileSelected}
                  disabled={compiling || !segmentId}
                >
                  {compiling ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  重新编译本段
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStep(0);
                    setStoryboardView("draft");
                  }}
                >
                  回到开头
                </Button>
              </div>
            </div>
          ),
          output: finalPrompt ? (
            <div className="flex flex-col gap-2">
              <FinalVisual prompt={finalPrompt} legend={finalLegend} />
              {finalStage && <TraceIssues issues={finalStage.issues} />}
            </div>
          ) : (
            <EmptyHint>还没有最终提示词；请在「编译」步骤编译本段。</EmptyHint>
          ),
        };
    }
  }

  const content = renderStep();

  return (
    <div className="flex flex-col gap-4 pb-10">
      <div className="rounded-2xl bg-block-cream p-5">
        <h1 className="text-base font-medium">提示词链路调试台</h1>
        <p className="text-sm text-muted-foreground">
          按步骤查看「输入 → 通过什么 → 输出」：剧本解析、分镜生成、编排、
          确定性渲染、厂商编译、校验、最终视频提示词。
        </p>
      </div>

      <LlmKeyNotice />

      <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
        {STEPS.map((item, index) => {
          const status = statusOfStep(index);
          const active = step === index;
          const enabled = canEnter(index);
          return (
            <button
              key={item.title}
              type="button"
              onClick={() => {
                if (enabled) setStep(index);
              }}
              disabled={!enabled}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : enabled
                    ? "text-muted-foreground hover:text-foreground"
                    : "cursor-not-allowed text-muted-foreground/50",
              )}
            >
              <span className="font-mono text-[10px] opacity-60">
                {index}
              </span>
              {item.title}
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  STATUS_DOT[status],
                )}
                title={status}
              />
            </button>
          );
        })}
      </div>

      {hasTrace && segmentItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-background px-4 py-2">
          <span className="text-xs text-muted-foreground">当前段落</span>
          <Select
            value={segmentId}
            onValueChange={(value) => selectSegment(value as string)}
            items={segmentItems}
            disabled={loadingState || compiling}
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
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loadingState || !segmentId}
          >
            <RefreshCw
              className={cn("size-3.5", loadingState && "animate-spin")}
            />
            刷新
          </Button>
          <span className="text-xs text-muted-foreground">
            平台 {state?.trace?.platform} · 厂商 {state?.trace?.vendor}
          </span>
        </div>
      )}

      {!loaded ? (
        <p className="text-sm text-muted-foreground">读取调试状态…</p>
      ) : (
        <>
          <div className="rounded-2xl border bg-background p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-medium">
                  {step}. {STEPS[step].title}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {STEPS[step].hint}
                  </span>
                </h2>
                {stageOf(STAGE_IDS[step]) && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {stageOf(STAGE_IDS[step])?.summary}
                  </p>
                )}
              </div>
              {stageOf(STAGE_IDS[step]) && (
                <div className="flex flex-wrap items-center gap-1">
                  {stageOf(STAGE_IDS[step])?.meta.map((item) => (
                    <Chip key={item.label}>
                      {item.label} {item.value}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
            <ThreeLayers
              input={content.input}
              process={content.process}
              output={content.output}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
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
              <Button
                onClick={next}
                disabled={
                  parsing ||
                  running ||
                  (step === 1 && !hasTrace) ||
                  (step > 1 && !hasTrace)
                }
              >
                下一步
                <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setStep(0);
                  setStoryboardView("draft");
                }}
              >
                回到开头
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
