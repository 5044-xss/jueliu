"use client";

import { SelectField } from "@/components/ui/select";
import {
  CAPABILITIES,
  CAPABILITY_DESCRIPTIONS,
  CAPABILITY_LABELS,
  DEFAULT_BINDING,
  defaultModelOf,
  modelsOf,
  presetOf,
  type Capability,
  type CapabilityBinding,
  type ProviderSettings,
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

  const usable = settings.connections.filter((conn) =>
    CAPABILITIES.some((cap) => presetOf(conn.type, cap)?.implemented),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-1 rounded-2xl bg-card p-5 ring-1 ring-foreground/[0.08]">
        {CAPABILITIES.map((cap) => {
          const binding = bindingOf(cap);
          const selected = settings.connections.find(
            (conn) => conn.id === binding.connectionId,
          );
          const suggestions = selected ? modelsOf(selected, cap) : [];
          // 只展示该能力下的模型；仅在服务商没有可用模型时保留已保存值。
          const modelOptions =
            suggestions.length > 0
              ? suggestions
              : binding.model
                ? [binding.model]
                : [];
          const options = settings.connections
            .filter((conn) => presetOf(conn.type, cap)?.implemented)
            .map((conn) => ({ value: conn.id, label: conn.name }));

          return (
            <div
              key={cap}
              className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 last:pb-0 first:pt-0 sm:flex-row sm:items-center"
            >
              <div className="w-40 shrink-0">
                <div className="text-sm font-medium">{CAPABILITY_LABELS[cap]}</div>
                <div className="text-xs text-muted-foreground">
                  {CAPABILITY_DESCRIPTIONS[cap]}
                </div>
              </div>

              <div className="w-full sm:w-56">
                <SelectField
                  value={binding.connectionId}
                  onChange={(value) => {
                    const next = settings.connections.find(
                      (conn) => conn.id === value,
                    );
                    patchBinding(cap, {
                      connectionId: value,
                      model:
                        value === binding.connectionId
                          ? binding.model
                          : next
                            ? defaultModelOf(next, cap)
                            : "",
                    });
                  }}
                  options={[
                    { value: "", label: "未配置" },
                    ...options,
                  ]}
                />
              </div>

              <div className="w-full sm:w-56">
                <SelectField
                  value={binding.model}
                  disabled={!binding.connectionId}
                  placeholder={cap === "video" ? "minimax-h3" : "选择模型"}
                  aria-label={`${CAPABILITY_LABELS[cap]}模型`}
                  onChange={(value) => patchBinding(cap, { model: value })}
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
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {usable.length === 0
          ? "先在「服务商」里添加一个连接，这里会自动选好。"
          : "默认已自动选好；想换服务商或模型时再改。其余参数在「服务商」页的「生成参数」里。"}
      </p>
    </div>
  );
}
