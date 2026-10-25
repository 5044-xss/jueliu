"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SelectField } from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-dialog";
import { readError } from "@/lib/http";
import {
  CAPABILITY_LABELS,
  CAPABILITY_MODEL_LABELS,
  CONNECTION_PRESETS,
  CONNECTION_TYPES,
  capabilitiesOf,
  maskApiKeyValue,
  modelsByCapabilityOf,
  presetModelsByCapability,
  presetOf,
  resolveEndpoint,
  withAutoBindings,
  withoutConnection,
  type Capability,
  type ConnectionType,
  type ProviderConnection,
  type ProviderSettings,
} from "@/lib/settings/providers";

type TestResult = {
  ok: boolean;
  implemented: boolean;
  message: string;
};

function blankConnection(type: ConnectionType): ProviderConnection {
  return {
    id: "",
    type,
    name: CONNECTION_PRESETS[type].label,
    apiKey: "",
    models: [],
    modelsByCapability: presetModelsByCapability(type),
    baseUrls: {},
    imageConcurrency: 2,
    videoConcurrency: 1,
    imageTimeoutMs: 600_000,
    videoTimeoutMs: 1_800_000,
  };
}

function needsEndpoint(type: ConnectionType): boolean {
  if (type === "comfyui") return true;
  return capabilitiesOf(type).some(
    (cap) => presetOf(type, cap)?.implemented && !presetOf(type, cap)?.baseUrl,
  );
}

function keyText(conn: ProviderConnection): string {
  if (conn.type === "comfyui") {
    return resolveEndpoint(conn, "video") || "未填写实例地址";
  }
  return conn.apiKey ? maskApiKeyValue(conn.apiKey) : "未填写 API Key";
}

function isConfigured(conn: ProviderConnection): boolean {
  return conn.type === "comfyui"
    ? Boolean(resolveEndpoint(conn, "video"))
    : Boolean(conn.apiKey);
}

function ConnectionDialog({
  draft,
  isNew,
  onClose,
  onSubmit,
}: {
  draft: ProviderConnection;
  isNew: boolean;
  onClose: () => void;
  onSubmit: (conn: ProviderConnection) => void;
}) {
  const [name, setName] = useState(draft.name);
  const [type, setType] = useState<ConnectionType>(draft.type);
  const [apiKey, setApiKey] = useState("");
  const [modelGroups, setModelGroups] = useState<
    Partial<Record<Capability, string[]>>
  >(() => modelsByCapabilityOf(draft));
  const [modelDrafts, setModelDrafts] = useState<
    Partial<Record<Capability, string>>
  >({});
  const [endpoint, setEndpoint] = useState(
    draft.type === "comfyui"
      ? draft.baseUrls.video ?? ""
      : Object.values(draft.baseUrls)[0] ?? "",
  );
  const preset = CONNECTION_PRESETS[type];
  const showEndpoint = needsEndpoint(type);
  const caps = capabilitiesOf(type);

  function changeType(next: ConnectionType) {
    const previousPreset = presetModelsByCapability(type);
    const isDefault =
      caps.every(
        (cap) =>
          (modelGroups[cap] ?? []).join("\n") ===
          (previousPreset[cap] ?? []).join("\n"),
      ) || caps.every((cap) => (modelGroups[cap] ?? []).length === 0);
    setType(next);
    if (!name.trim() || CONNECTION_TYPES.some((t) => CONNECTION_PRESETS[t].label === name)) {
      setName(CONNECTION_PRESETS[next].label);
    }
    if (isDefault) {
      setModelGroups(presetModelsByCapability(next));
      return;
    }
    const nextCaps = capabilitiesOf(next);
    setModelGroups(
      Object.fromEntries(
        nextCaps.map((cap) => [cap, modelGroups[cap] ?? []]),
      ) as Partial<Record<Capability, string[]>>,
    );
  }

  function addModel(cap: Capability) {
    const entries = (modelDrafts[cap] ?? "")
      .split(/[\n,，]+/)
      .map((model) => model.trim())
      .filter(Boolean);
    if (entries.length === 0) return;
    setModelGroups((current) => ({
      ...current,
      [cap]: [...new Set([...(current[cap] ?? []), ...entries])],
    }));
    setModelDrafts((current) => ({ ...current, [cap]: "" }));
  }

  function removeModel(cap: Capability, model: string) {
    setModelGroups((current) => ({
      ...current,
      [cap]: (current[cap] ?? []).filter((item) => item !== model),
    }));
  }

  function fillPresetModels(cap: Capability) {
    setModelGroups((current) => ({
      ...current,
      [cap]: [...new Set([...(current[cap] ?? []), ...(presetModelsByCapability(type)[cap] ?? [])])],
    }));
  }

  function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("请填写名称");
      return;
    }
    if (isNew && preset.requiresKey && !apiKey.trim()) {
      toast.error("请填写 API Key");
      return;
    }
    if (showEndpoint && !endpoint.trim()) {
      toast.error(type === "comfyui" ? "请填写实例地址" : "请填写接口地址");
      return;
    }

    const baseUrls: Record<string, string> = showEndpoint
      ? Object.fromEntries(caps.map((cap) => [cap, endpoint.trim()]))
      : draft.baseUrls;
    const scopedModels = Object.fromEntries(
      caps.map((cap) => [
        cap,
        [...new Set((modelGroups[cap] ?? []).map((model) => model.trim()).filter(Boolean))],
      ]),
    ) as Partial<Record<Capability, string[]>>;
    const models = [...new Set(caps.flatMap((cap) => scopedModels[cap] ?? []))];

    onSubmit({
      ...draft,
      type,
      name: trimmedName,
      apiKey: apiKey.trim() ? apiKey.trim() : draft.apiKey,
      models,
      modelsByCapability: scopedModels,
      baseUrls,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[min(88vh,46rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "添加服务商" : "编辑连接"}</DialogTitle>
          <DialogDescription>
            {isNew
              ? "填写 API Key 即可；模型按能力分开填写，能力页只显示对应模型。"
              : "留空表示保持已保存的 Key 不变；模型按能力分开填写。"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {isNew && (
            <div className="grid gap-1.5">
              <Label>类型</Label>
              <SelectField
                value={type}
                onChange={(next) => changeType(next as ConnectionType)}
                options={CONNECTION_TYPES.map((value) => ({
                  value,
                  label: CONNECTION_PRESETS[value].label,
                }))}
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {preset.requiresKey && (
            <div className="grid gap-1.5">
              <Label>API Key</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  !isNew && draft.apiKey
                    ? `${maskApiKeyValue(draft.apiKey)}（留空不修改）`
                    : "sk-..."
                }
              />
            </div>
          )}

          {showEndpoint && (
            <div className="grid gap-1.5">
              <Label>
                {type === "comfyui" ? "实例地址" : "接口地址"}
              </Label>
              <Input
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={
                  type === "comfyui"
                    ? "https://xxxx.container.x-gpu.com"
                    : "https://..."
                }
              />
            </div>
          )}

          <div className="grid gap-3">
            {caps.map((cap) => {
              const group = modelGroups[cap] ?? [];
              const label = CAPABILITY_MODEL_LABELS[cap];
              return (
                <div
                  key={cap}
                  className="grid gap-1.5 rounded-xl border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Label>{label}</Label>
                    <button
                      type="button"
                      onClick={() => fillPresetModels(cap)}
                      className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      填入预设
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={modelDrafts[cap] ?? ""}
                      onChange={(e) =>
                        setModelDrafts((current) => ({
                          ...current,
                          [cap]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addModel(cap);
                        }
                      }}
                      placeholder={`添加${label}，回车确认`}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => addModel(cap)}
                      className="shrink-0"
                    >
                      <Plus className="size-3.5" />
                      添加
                    </Button>
                  </div>
                  {group.length > 0 ? (
                    <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                      {group.map((model) => (
                        <span
                          key={model}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs"
                        >
                          <span className="max-w-48 truncate">{model}</span>
                          <button
                            type="button"
                            onClick={() => removeModel(cap, model)}
                            title={`移除 ${model}`}
                            aria-label={`移除 ${model}`}
                            className="flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      未填写时会使用该类型的内置{label}。
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProvidersPanel({
  settings,
  onChange,
}: {
  settings: ProviderSettings;
  onChange: (next: ProviderSettings) => void;
}) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState<{
    conn: ProviderConnection;
    isNew: boolean;
  } | null>(null);
  const [testingId, setTestingId] = useState("");

  function submit(conn: ProviderConnection) {
    if (!draft) return;
    if (draft.isNew) {
      const created = { ...conn, id: `conn-${Date.now()}` };
      onChange(
        withAutoBindings(
          { ...settings, connections: [...settings.connections, created] },
          created,
        ),
      );
    } else {
      onChange({
        ...settings,
        connections: settings.connections.map((item) =>
          item.id === conn.id ? conn : item,
        ),
      });
    }
    setDraft(null);
    toast.success("已更新，点右上角「保存设置」生效");
  }

  async function remove(conn: ProviderConnection) {
    const ok = await confirm({
      title: `删除「${conn.name}」？`,
      description: "引用它的能力会自动切换到其它可用服务商。",
      confirmText: "删除",
      destructive: true,
    });
    if (!ok) return;
    onChange(withoutConnection(settings, conn.id));
  }

  async function runTest(conn: ProviderConnection) {
    setTestingId(conn.id);
    try {
      const res = await fetch("/api/settings/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection: conn }),
      });
      if (!res.ok) throw new Error(await readError(res, "测试失败"));
      const data = (await res.json()) as {
        results: Partial<Record<Capability, TestResult>>;
      };
      const entries = Object.entries(data.results) as [Capability, TestResult][];
      const active = entries.filter(([, result]) => result.implemented);
      const failed = active.filter(([, result]) => !result.ok);
      if (active.length === 0) {
        toast.info("该连接暂无可测试的能力");
      } else if (failed.length === 0) {
        toast.success(
          `连接正常 · ${active.map(([cap]) => CAPABILITY_LABELS[cap]).join(" / ")}`,
        );
      } else {
        const summary = active
          .map(
            ([cap, result]) =>
              `${CAPABILITY_LABELS[cap]}：${result.ok ? "通过" : result.message}`,
          )
          .join("；");
        toast.warning(`部分能力未通过 · ${summary}`, { duration: 10_000 });
      }
    } catch (error) {
      toast.error((error as Error).message || "测试失败");
    } finally {
      setTestingId("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {settings.connections.map((conn) => {
          const configured = isConfigured(conn);
          return (
            <Card key={conn.id} size="sm">
              <CardHeader className="gap-1">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate">{conn.name}</CardTitle>
                  <Badge variant={configured ? "secondary" : "outline"}>
                    {configured ? "已配置" : "未配置"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {keyText(conn)}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    title="测试连接"
                    onClick={() => runTest(conn)}
                    disabled={testingId === conn.id}
                  >
                    {testingId === conn.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Zap />
                    )}
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    title="编辑"
                    onClick={() => setDraft({ conn, isNew: false })}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    title="删除"
                    onClick={() => remove(conn)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        <button
          type="button"
          onClick={() =>
            setDraft({ conn: blankConnection("toapis"), isNew: true })
          }
          className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <Plus className="size-4" />
          添加服务商
        </button>
      </div>

      {draft && (
        <ConnectionDialog
          draft={draft.conn}
          isNew={draft.isNew}
          onClose={() => setDraft(null)}
          onSubmit={submit}
        />
      )}
    </div>
  );
}
