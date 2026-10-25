"use client";

import { ChevronDown } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/ui/select";
import {
  DEFAULT_BINDING,
  type Capability,
  type CapabilityBinding,
  type ProviderConnection,
  type ProviderSettings,
} from "@/lib/settings/providers";
import type { GenerationView } from "./types";

export function AdvancedPanel({
  settings,
  onChange,
  generation,
  onGenerationChange,
}: {
  settings: ProviderSettings;
  onChange: (next: ProviderSettings) => void;
  generation: GenerationView;
  onGenerationChange: (patch: Partial<GenerationView>) => void;
}) {
  function bindingOf(cap: Capability): CapabilityBinding {
    return { ...DEFAULT_BINDING, ...(settings.bindings[cap] ?? {}) };
  }

  function patchBinding(cap: Capability, patch: Partial<CapabilityBinding>) {
    onChange({
      ...settings,
      bindings: {
        ...settings.bindings,
        [cap]: { ...bindingOf(cap), ...patch },
      },
    });
  }

  const llmConn = settings.connections.find(
    (conn) => conn.id === bindingOf("llm").connectionId,
  );
  const imageBinding = bindingOf("image");
  const imageConn = settings.connections.find(
    (conn) => conn.id === imageBinding.connectionId,
  );
  const videoConn = settings.connections.find(
    (conn) => conn.id === bindingOf("video").connectionId,
  );

  function patchConnection(id: string, patch: Partial<ProviderConnection>) {
    onChange({
      ...settings,
      connections: settings.connections.map((conn) =>
        conn.id === id ? { ...conn, ...patch } : conn,
      ),
    });
  }

  return (
    <details className="group max-w-3xl rounded-2xl bg-card p-5 ring-1 ring-foreground/[0.08]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">生成参数</span>
          <span className="text-xs text-muted-foreground">
            默认值已按能力路由选中的服务商配好；需要微调时再展开。
          </span>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="mt-4 flex flex-col gap-4">
      <Card size="sm" className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            文本 · {llmConn?.name ?? "未选择服务商"}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:max-w-xs">
          <div className="grid gap-2">
            <Label>Temperature</Label>
            <Input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={bindingOf("llm").temperature}
              onChange={(e) =>
                patchBinding("llm", { temperature: Number(e.target.value) })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            图片 · {imageConn?.name ?? "未选择服务商"}
          </CardTitle>
          {!imageConn && (
            <CardDescription>尚未在「能力路由」里选择图片服务商。</CardDescription>
          )}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label>分辨率</Label>
            <SelectField
              value={imageBinding.imageResolution}
              onChange={(value) =>
                patchBinding("image", {
                  imageResolution: value as CapabilityBinding["imageResolution"],
                })
              }
              options={[
                { value: "1k", label: "1k" },
                { value: "2k", label: "2k" },
                { value: "4k", label: "4k" },
              ]}
            />
          </div>
          <div className="grid gap-2">
            <Label>最多参考图张数</Label>
            <Input
              type="number"
              min={0}
              max={14}
              value={imageBinding.maxRefImages}
              onChange={(e) =>
                patchBinding("image", { maxRefImages: Number(e.target.value) })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>并发</Label>
            <Input
              type="number"
              min={1}
              max={8}
              disabled={!imageConn}
              value={imageConn?.imageConcurrency ?? 2}
              onChange={(e) =>
                imageConn &&
                patchConnection(imageConn.id, {
                  imageConcurrency: Number(e.target.value),
                })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>单张超时（分钟）</Label>
            <Input
              type="number"
              min={1}
              max={60}
              disabled={!imageConn}
              value={Math.max(1, Math.round((imageConn?.imageTimeoutMs ?? 600_000) / 60_000))}
              onChange={(e) =>
                imageConn &&
                patchConnection(imageConn.id, {
                  imageTimeoutMs: Math.max(1, Number(e.target.value) || 1) * 60_000,
                })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>轮询间隔（秒）</Label>
            <Input
              type="number"
              min={1}
              max={60}
              value={Math.max(1, Math.round(generation.pollIntervalMs / 1000))}
              onChange={(e) =>
                onGenerationChange({
                  pollIntervalMs: Math.max(1, Number(e.target.value) || 1) * 1000,
                })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            视频 · {videoConn?.name ?? "未选择服务商"}
          </CardTitle>
          <CardDescription>
            {videoConn
              ? "自建 ComfyUI · MiniMax H3"
              : "尚未在「能力路由」里选择视频服务商。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>单个片段超时（分钟）</Label>
              <Input
                type="number"
                min={1}
                max={360}
                disabled={!videoConn}
                value={Math.max(1, Math.round((videoConn?.videoTimeoutMs ?? 1_800_000) / 60_000))}
                onChange={(e) =>
                  videoConn &&
                  patchConnection(videoConn.id, {
                    videoTimeoutMs: Math.max(1, Number(e.target.value) || 1) * 60_000,
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>主模型</Label>
              <SelectField
                value={generation.comfyVideoModel}
                onChange={(value) =>
                  onGenerationChange({
                    comfyVideoModel: value as GenerationView["comfyVideoModel"],
                  })
                }
                options={[
                  { value: "pruned", label: "剪枝（24G）" },
                  { value: "int8", label: "非剪枝 int8（48G）" },
                ]}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>分辨率</Label>
              <SelectField
                value={generation.videoResolution}
                onChange={(value) => onGenerationChange({ videoResolution: value })}
                options={[
                  { value: "480p", label: "480P" },
                  { value: "540p", label: "540P" },
                  { value: "608p", label: "608P" },
                  { value: "768p", label: "768P" },
                ]}
              />
            </div>
            <div className="grid gap-2">
              <Label>画幅</Label>
              <SelectField
                value={generation.videoAspect}
                onChange={(value) => onGenerationChange({ videoAspect: value })}
                options={[
                  { value: "", label: "跟随项目" },
                  { value: "16:9", label: "16:9" },
                  { value: "9:16", label: "9:16" },
                  { value: "1:1", label: "1:1" },
                  { value: "4:3", label: "4:3" },
                  { value: "3:4", label: "3:4" },
                  { value: "21:9", label: "21:9" },
                ]}
              />
            </div>
            <div className="grid gap-2">
              <Label>步数</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={generation.videoSteps}
                onChange={(e) =>
                  onGenerationChange({ videoSteps: Number(e.target.value) })
                }
              />
            </div>
          </div>

          <details className="group rounded-lg border border-border bg-muted/20 px-3 py-2">
            <summary className="flex cursor-pointer list-none select-none items-center justify-between text-sm [&::-webkit-details-marker]:hidden">
              更多参数
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Block swap</Label>
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={generation.blocksToSwap}
                  onChange={(e) =>
                    onGenerationChange({ blocksToSwap: Number(e.target.value) })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>关 Sage 时长阈值（秒）</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={generation.sageMaxDurationSec}
                  onChange={(e) =>
                    onGenerationChange({
                      sageMaxDurationSec: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>输出高度 P（0=关闭）</Label>
                <Input
                  type="number"
                  min={0}
                  max={4320}
                  value={generation.videoOutHeight}
                  onChange={(e) =>
                    onGenerationChange({ videoOutHeight: Number(e.target.value) })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>放大模型</Label>
                <Input
                  value={generation.videoUpscaleModel}
                  placeholder="留空不放大"
                  onChange={(e) =>
                    onGenerationChange({ videoUpscaleModel: e.target.value })
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={generation.videoSecondPass}
                  onChange={(e) =>
                    onGenerationChange({ videoSecondPass: e.target.checked })
                  }
                  className="size-4 accent-primary"
                />
                二采（latent 放大重采样）
              </label>
            </div>
          </details>
        </CardContent>
      </Card>
      </div>
    </details>
  );
}
