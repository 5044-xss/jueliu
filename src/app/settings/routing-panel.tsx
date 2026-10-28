"use client";

import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  CAPABILITIES,
  CAPABILITY_DESCRIPTIONS,
  CAPABILITY_LABELS,
  DEFAULT_BINDING,
  IMAGE_RESOLUTIONS,
  VIDEO_ASPECTS,
  VIDEO_RESOLUTIONS,
  defaultModelOf,
  defaultParamsFor,
  modelsOf,
  presetOf,
  type Capability,
  type CapabilityBinding,
  type ProviderSettings,
  type VideoParams,
} from "@/lib/settings/providers";

export function RoutingPanel({
  settings,
  onChange,
}: {
  settings: ProviderSettings;
  onChange: (next: ProviderSettings) => void;
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

  function patchVideo(patch: Partial<VideoParams>) {
    const binding = bindingOf("video");
    patchBinding("video", {
      video: { ...binding.video, ...patch },
    });
  }

  function resetParams(cap: Capability) {
    patchBinding(cap, defaultParamsFor(cap));
  }

  function switchTarget(cap: Capability, patch: Partial<CapabilityBinding>) {
    patchBinding(cap, { ...patch, ...defaultParamsFor(cap) });
    toast.info(`${CAPABILITY_LABELS[cap]}参数已恢复为默认值`);
  }

  const usable = settings.connections.filter((conn) =>
    CAPABILITIES.some((cap) => presetOf(conn.type, cap)?.implemented),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {CAPABILITIES.map((cap) => {
          const binding = bindingOf(cap);
          const selected = settings.connections.find(
            (conn) => conn.id === binding.connectionId,
          );
          const suggestions = selected ? modelsOf(selected, cap) : [];
          const modelOptions =
            suggestions.length > 0
              ? suggestions
              : binding.model
                ? [binding.model]
                : [];
          const connectionOptions = settings.connections
            .filter((conn) => presetOf(conn.type, cap)?.implemented)
            .map((conn) => ({ value: conn.id, label: conn.name }));
          if (
            binding.connectionId &&
            !connectionOptions.some(
              (option) => option.value === binding.connectionId,
            )
          ) {
            const current = settings.connections.find(
              (conn) => conn.id === binding.connectionId,
            );
            if (current) {
              connectionOptions.unshift({
                value: current.id,
                label: `${current.name}（未支持）`,
              });
            }
          }
          const disabled = !binding.connectionId || !binding.model;

          return (
            <Card key={cap} size="sm">
              <CardHeader>
                <CardTitle>{CAPABILITY_LABELS[cap]}</CardTitle>
                <CardDescription>
                  {CAPABILITY_DESCRIPTIONS[cap]}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label>服务商</Label>
                    <SelectField
                      value={binding.connectionId}
                      onChange={(value) => {
                        if (value === binding.connectionId) return;
                        const next = settings.connections.find(
                          (conn) => conn.id === value,
                        );
                        switchTarget(cap, {
                          connectionId: value,
                          model: next ? defaultModelOf(next, cap) : "",
                        });
                      }}
                      options={[
                        { value: "", label: "未配置" },
                        ...connectionOptions,
                      ]}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>模型</Label>
                    <SelectField
                      value={binding.model}
                      disabled={disabled}
                      placeholder={
                        cap === "video" ? "minimax-h3" : "选择模型"
                      }
                      aria-label={`${CAPABILITY_LABELS[cap]}模型`}
                      onChange={(value) => {
                        if (value === binding.model) return;
                        switchTarget(cap, { model: value });
                      }}
                      options={
                        modelOptions.length > 0
                          ? modelOptions.map((model) => ({
                              value: model,
                              label: model,
                            }))
                          : [{ value: "", label: "服务商未配置模型" }]
                      }
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      模型参数
                    </span>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => resetParams(cap)}
                      disabled={disabled}
                    >
                      恢复默认
                    </Button>
                  </div>

                  {cap === "llm" && (
                    <div className="grid gap-3 sm:max-w-xs">
                      <div className="grid gap-1.5">
                        <Label>Temperature</Label>
                        <Input
                          type="number"
                          min={0}
                          max={2}
                          step={0.1}
                          disabled={disabled}
                          value={binding.temperature}
                          onChange={(e) =>
                            patchBinding("llm", {
                              temperature: Number(e.target.value),
                            })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          技能单独设置了温度时，会优先使用技能的值。
                        </p>
                      </div>
                    </div>
                  )}

                  {cap === "image" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label>分辨率</Label>
                        <SelectField
                          value={binding.imageResolution}
                          disabled={disabled}
                          onChange={(value) =>
                            patchBinding("image", {
                              imageResolution:
                                value as CapabilityBinding["imageResolution"],
                            })
                          }
                          options={IMAGE_RESOLUTIONS.map((value) => ({
                            value,
                            label: value,
                          }))}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>最多参考图张数</Label>
                        <Input
                          type="number"
                          min={0}
                          max={14}
                          disabled={disabled}
                          value={binding.maxRefImages}
                          onChange={(e) =>
                            patchBinding("image", {
                              maxRefImages: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {cap === "video" && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="grid gap-1.5">
                          <Label>清晰度</Label>
                          <SelectField
                            value={binding.video.resolution}
                            disabled={disabled}
                            onChange={(value) =>
                              patchVideo({
                                resolution:
                                  value as VideoParams["resolution"],
                              })
                            }
                            options={VIDEO_RESOLUTIONS.map((value) => ({
                              value,
                              label: value.toUpperCase(),
                            }))}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label>画幅</Label>
                          <SelectField
                            value={binding.video.aspect}
                            disabled={disabled}
                            onChange={(value) => patchVideo({ aspect: value })}
                            options={[
                              { value: "", label: "跟随项目" },
                              ...VIDEO_ASPECTS.map((value) => ({
                                value,
                                label: value,
                              })),
                            ]}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label>步数</Label>
                          <Input
                            type="number"
                            min={1}
                            max={30}
                            disabled={disabled}
                            value={binding.video.steps}
                            onChange={(e) =>
                              patchVideo({ steps: Number(e.target.value) })
                            }
                          />
                        </div>
                      </div>

                      <details className="group mt-3 rounded-lg border border-border bg-background/60 px-3 py-2">
                        <summary className="flex cursor-pointer list-none select-none items-center justify-between text-sm [&::-webkit-details-marker]:hidden">
                          H3 高级参数
                          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="grid gap-1.5">
                            <Label>Sage 预设</Label>
                            <Input
                              disabled={disabled}
                              value={binding.video.sagePreset}
                              onChange={(e) =>
                                patchVideo({ sagePreset: e.target.value })
                              }
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label>关 Sage 时长阈值（秒）</Label>
                            <Input
                              type="number"
                              min={1}
                              max={60}
                              disabled={disabled}
                              value={binding.video.sageMaxDurationSec}
                              onChange={(e) =>
                                patchVideo({
                                  sageMaxDurationSec: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label>Block swap</Label>
                            <Input
                              type="number"
                              min={0}
                              max={60}
                              disabled={disabled}
                              value={binding.video.blocksToSwap}
                              onChange={(e) =>
                                patchVideo({
                                  blocksToSwap: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={binding.video.secondPass}
                              disabled={disabled}
                              onChange={(e) =>
                                patchVideo({ secondPass: e.target.checked })
                              }
                              className="size-4 accent-primary"
                            />
                            二采（latent 放大重采样）
                          </label>
                        </div>
                      </details>
                    </>
                  )}
                </div>

                {cap === "video" && (
                  <p className="text-xs text-muted-foreground">
                    段时长、镜数、参考图上限与编译方言由项目所选厂商决定，可在
                    <a
                      href="#vendors"
                      className="mx-1 underline underline-offset-4 hover:text-foreground"
                    >
                      厂商
                    </a>
                    中查看或修改。
                  </p>
                )}

                <p className="text-xs text-muted-foreground">
                  {selected
                    ? `参数属于当前「${selected.name} · ${binding.model || "未选择模型"}」；切换服务商或模型会恢复默认。`
                    : "先在「服务商」里添加连接；并发、超时、轮询在该连接的高级设置里。"}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {usable.length === 0
          ? "先在「服务商」里添加一个连接，这里会自动选好服务商和模型。"
          : "服务商、模型和参数都保存在对应能力上；连接级的并发、超时和轮询在「服务商」编辑里。"}
      </p>
    </div>
  );
}
