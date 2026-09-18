"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  PROVIDER_OPTIONS,
  PROVIDER_PRESETS,
  type FfmpegStatus,
  type GlobalSettings,
  type LlmProvider,
} from "@/lib/settings-shared";

export default function SettingsPage() {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data.settings);
        setFfmpeg(data.ffmpeg);
      })
      .catch(() => toast.error("读取设置失败"));
  }, []);

  function updateLlm<K extends keyof GlobalSettings["llm"]>(
    key: K,
    value: GlobalSettings["llm"][K],
  ) {
    setSettings((prev) =>
      prev ? { ...prev, llm: { ...prev.llm, [key]: value } } : prev,
    );
  }

  function onProviderChange(provider: LlmProvider) {
    if (!settings) return;
    const preset =
      provider !== "custom"
        ? PROVIDER_PRESETS[provider as Exclude<LlmProvider, "custom">]
        : undefined;
    setSettings({
      ...settings,
      llm: {
        ...settings.llm,
        provider,
        baseURL: preset?.baseURL ?? settings.llm.baseURL,
        model: preset?.defaultModel ?? settings.llm.model,
      },
    });
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const payload = {
        llm: {
          provider: settings.llm.provider,
          baseURL: settings.llm.baseURL,
          model: settings.llm.model,
          temperature: settings.llm.temperature,
          ...(apiKeyTouched ? { apiKey: apiKeyInput } : {}),
        },
        ffmpeg: { path: settings.ffmpeg.path },
      };
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("保存失败");
      const data = await res.json();
      setSettings(data.settings);
      setFfmpeg(data.ffmpeg);
      setApiKeyTouched(false);
      setApiKeyInput("");
      toast.success("设置已保存");
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function detect() {
    if (!settings) return;
    setDetecting(true);
    try {
      const res = await fetch("/api/system/ffmpeg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: settings.ffmpeg.path }),
      });
      const status = (await res.json()) as FfmpegStatus;
      setFfmpeg(status);
      if (status.available) toast.success(`检测成功：ffmpeg ${status.version}`);
      else toast.error("未检测到 ffmpeg");
    } catch {
      toast.error("检测失败");
    } finally {
      setDetecting(false);
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载中…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">设置</h1>
        <p className="text-sm text-muted-foreground">
          配置 LLM 供应商与本地 ffmpeg。配置保存在 workspace/settings.json。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>LLM 配置</CardTitle>
          <CardDescription>
            使用 OpenAI 兼容接口。默认阿里百炼（DashScope），可切换任意兼容供应商。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="provider">供应商</Label>
            <select
              id="provider"
              value={settings.llm.provider}
              onChange={(e) => onProviderChange(e.target.value as LlmProvider)}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="baseURL">Base URL</Label>
            <Input
              id="baseURL"
              value={settings.llm.baseURL}
              onChange={(e) => updateLlm("baseURL", e.target.value)}
              placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKeyTouched ? apiKeyInput : settings.llm.apiKey}
              onFocus={() => {
                if (!apiKeyTouched) {
                  setApiKeyTouched(true);
                  setApiKeyInput("");
                }
              }}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="sk-..."
            />
            <p className="text-xs text-muted-foreground">
              留空表示不修改已保存的 Key。当前：
              {settings.llm.apiKey ? settings.llm.apiKey : "未配置"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="model">模型</Label>
              <Input
                id="model"
                value={settings.llm.model}
                onChange={(e) => updateLlm("model", e.target.value)}
                placeholder="qwen-plus"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="temperature">Temperature</Label>
              <Input
                id="temperature"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={settings.llm.temperature}
                onChange={(e) =>
                  updateLlm("temperature", Number(e.target.value))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ffmpeg</CardTitle>
          <CardDescription>
            用于截取尾帧与合成视频。填写可执行文件路径或命令名（如 ffmpeg）。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ffmpegPath">ffmpeg 路径</Label>
            <div className="flex gap-2">
              <Input
                id="ffmpegPath"
                value={settings.ffmpeg.path}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    ffmpeg: { path: e.target.value },
                  })
                }
              />
              <Button
                type="button"
                variant="outline"
                onClick={detect}
                disabled={detecting}
              >
                {detecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                检测
              </Button>
            </div>
          </div>
          <Separator />
          <div className="flex items-center gap-2 text-sm">
            {ffmpeg?.available ? (
              <>
                <CheckCircle2 className="size-4 text-emerald-500" />
                <span>可用</span>
                <Badge variant="secondary">v{ffmpeg.version}</Badge>
              </>
            ) : (
              <>
                <XCircle className="size-4 text-destructive" />
                <span>不可用</span>
                {ffmpeg?.error && (
                  <span className="text-muted-foreground">{ffmpeg.error}</span>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <div>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          保存设置
        </Button>
      </div>
    </div>
  );
}
