"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
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
  const [testingLlm, setTestingLlm] = useState(false);
  const [llmTest, setLlmTest] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [machine, setMachine] = useState<{ code: string; display: string } | null>(
    null,
  );
  const [appVersion, setAppVersion] = useState("");
  const [ffmpegAdvanced, setFfmpegAdvanced] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<CheckUpdateResult | null>(null);
  const isDesktop = typeof window !== "undefined" && !!window.licenseAPI;

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data.settings);
        setFfmpeg(data.ffmpeg);
      })
      .catch(() => toast.error("读取设置失败"));
  }, []);

  useEffect(() => {
    if (!window.licenseAPI) return;
    window.licenseAPI
      .getMachineId()
      .then(setMachine)
      .catch(() => undefined);
    window.licenseAPI
      .getVersion()
      .then(setAppVersion)
      .catch(() => undefined);
  }, []);

  function copyMachineCode() {
    if (!machine) return;
    navigator.clipboard.writeText(machine.display);
    toast.success("已复制机器码");
  }

  async function checkUpdate() {
    if (!window.licenseAPI) return;
    setChecking(true);
    setUpdateResult(null);
    try {
      const result = await window.licenseAPI.checkUpdate();
      setUpdateResult(result);
      if (!result.ok) toast.error(`检查更新失败：${result.error ?? "未知错误"}`);
      else if (result.hasUpdate) toast.success(`发现新版本 ${result.latest}`);
      else toast.success(result.note ?? "已是最新版本");
    } catch {
      toast.error("检查更新失败");
    } finally {
      setChecking(false);
    }
  }

  async function reactivate() {
    if (!window.licenseAPI) return;
    await window.licenseAPI.resetLicense();
  }

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

  async function testLlm() {
    if (!settings) return;
    setTestingLlm(true);
    setLlmTest(null);
    try {
      const res = await fetch("/api/settings/llm-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseURL: settings.llm.baseURL,
          model: settings.llm.model,
          temperature: settings.llm.temperature,
          ...(apiKeyTouched ? { apiKey: apiKeyInput } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "连接失败");
      }
      setLlmTest({
        ok: true,
        message: `连接成功 · ${data.model} · ${data.latencyMs}ms${
          data.reply ? ` · 返回「${data.reply}」` : ""
        }`,
      });
      toast.success("LLM 连接成功");
    } catch (error) {
      setLlmTest({ ok: false, message: (error as Error).message });
      toast.error("LLM 连接失败");
    } finally {
      setTestingLlm(false);
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
      <PageHeader
        eyebrow="Settings"
        accent="mint"
        title="设置"
        description="配置 LLM 供应商与本地 ffmpeg。配置保存在 workspace/settings.json。"
      />

      <div className="rounded-2xl bg-block-cream p-4 text-sm leading-relaxed">
        模型 API Key 由你自备、按量自费；ffmpeg 已随软件内置，通常无需配置。
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            授权与版本
          </CardTitle>
          <CardDescription>
            离线签名授权，一码一机，永久有效。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              {isDesktop ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  <span>已激活</span>
                </>
              ) : (
                <span className="text-muted-foreground">浏览器预览模式（未打包）</span>
              )}
            </div>
            <span className="text-sm text-muted-foreground">
              当前版本 {appVersion || "—"}
            </span>
          </div>

          <div className="grid gap-2">
            <Label>本机机器码</Label>
            <div className="flex gap-2">
              <Input readOnly value={machine?.display ?? "—"} />
              <Button
                type="button"
                variant="outline"
                onClick={copyMachineCode}
                disabled={!machine}
              >
                <Copy className="size-4" />
                复制
              </Button>
            </div>
          </div>

          <Separator />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={checkUpdate}
              disabled={checking || !isDesktop}
            >
              {checking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              检查更新
            </Button>
            {updateResult?.hasUpdate && updateResult.url && (
              <Button
                type="button"
                onClick={() => window.licenseAPI?.openExternal(updateResult.url!)}
              >
                <Download className="size-4" />
                前往下载 v{updateResult.latest}
              </Button>
            )}
            {updateResult?.ok && !updateResult.hasUpdate && (
              <span className="flex items-center gap-1.5 text-sm text-emerald-600">
                <CheckCircle2 className="size-4" />
                {updateResult.note ?? "已是最新版本"}
              </span>
            )}
            {updateResult && !updateResult.ok && (
              <span className="flex items-center gap-1.5 text-sm text-destructive">
                <XCircle className="size-4" />
                {updateResult.error}
              </span>
            )}
          </div>

          {isDesktop && (
            <>
              <Separator />
              <div>
                <Button type="button" variant="outline" onClick={reactivate}>
                  重新激活
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

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

          <Separator />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={testLlm}
              disabled={testingLlm}
            >
              {testingLlm ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Zap className="size-4" />
              )}
              测试连接
            </Button>
            {llmTest && (
              <span
                className={`flex items-center gap-1.5 text-sm ${
                  llmTest.ok ? "text-emerald-600" : "text-destructive"
                }`}
              >
                {llmTest.ok ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <XCircle className="size-4" />
                )}
                {llmTest.message}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ffmpeg</CardTitle>
          <CardDescription>
            用于截取尾帧与合成视频。软件已内置，通常无需修改。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
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

          <div className="grid gap-2">
            <Label>实际使用的路径</Label>
            <div className="flex gap-2">
              <Input value={ffmpeg?.path ?? settings.ffmpeg.path} readOnly />
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

          <div>
            <button
              type="button"
              onClick={() => setFfmpegAdvanced((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {ffmpegAdvanced ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              高级：使用自定义 ffmpeg
            </button>
          </div>

          {ffmpegAdvanced && (
            <div className="grid gap-2">
              <Label htmlFor="ffmpegPath">自定义路径</Label>
              <Input
                id="ffmpegPath"
                value={settings.ffmpeg.path}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    ffmpeg: { path: e.target.value },
                  })
                }
                placeholder="例如 D:/tools/ffmpeg/bin/ffmpeg.exe"
              />
              <p className="text-xs text-muted-foreground">
                填可执行文件路径或命令名；留空则使用内置版本。改完点「检测」确认，再点底部「保存设置」。
              </p>
            </div>
          )}
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
