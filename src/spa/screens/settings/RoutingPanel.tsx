"use client";

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
  CAPABILITY_DESCRIPTIONS,
  CAPABILITY_LABELS,
  DEFAULT_BINDING,
  defaultModelOf,
  defaultParamsFor,
  modelsOf,
  presetOf,
  type Capability,
  type CapabilityBinding,
  type ProviderSettings,
} from "@/lib/settings/providers";

const CAPS: Capability[] = ["llm"];

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

  function resetParams(cap: Capability) {
    patchBinding(cap, defaultParamsFor(cap));
  }

  function switchTarget(cap: Capability, patch: Partial<CapabilityBinding>) {
    patchBinding(cap, { ...patch, ...defaultParamsFor(cap) });
    toast.info(`${CAPABILITY_LABELS[cap]}参数已恢复为默认值`);
  }

  const usable = settings.connections.filter(
    (conn) => presetOf(conn.type, "llm")?.implemented,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {CAPS.map((cap) => {
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
                      placeholder="选择模型"
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
                </div>

                <p className="text-xs text-muted-foreground">
                  {selected
                    ? `参数属于当前「${selected.name} · ${binding.model || "未选择模型"}」；切换服务商或模型会恢复默认。`
                    : "先在「服务商」里添加连接。"}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {usable.length === 0
          ? "先在「服务商」里添加一个连接，这里会自动选好服务商和模型。"
          : "服务商、模型和参数都保存在「文本」能力上。"}
      </p>
    </div>
  );
}
