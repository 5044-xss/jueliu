"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  Film,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Terminal,
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
import { SelectField } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { OpenWorkspaceButton } from "@/components/workspace-actions";
import { readError } from "@/lib/http";
import {
  PROVIDER_OPTIONS,
  PROVIDER_PRESETS,
  type FfmpegStatus,
  type GlobalSettings,
  type LlmProvider,
} from "@core/shared/settings-shared";

// 备用下载地址：GitHub 访问不稳定时，用户可手动到此文件夹下载安装包。
const FALLBACK_DOWNLOAD_URL =
  "https://my.feishu.cn/drive/folder/BTNnfef6blmndfd4pUtcYySWnSf?from=from_copylink";

interface GenSettings {
  baseUrl: string;
  apiKey: string;
  imageModel: string;
  imageResolution: "1k" | "2k" | "4k";
  pollIntervalMs: number;
  timeoutMs: number;
  videoTimeoutMs: number;
  maxRefImages: number;
  imageConcurrency: number;
  // 生视频（自建 ComfyUI + MiniMax H3）
  comfyUrl: string;
  comfyVideoModel: "pruned" | "int8";
  videoSteps: number;
  videoResolution: "480p" | "540p" | "608p" | "768p";
  videoAspect: string;
  sagePreset: string;
  sageMaxDurationSec: number;
  blocksToSwap: number;
  videoUpscaleModel: string;
  videoOutHeight: number;
  videoSecondPass: boolean;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [llmTest, setLlmTest] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [testingFfmpeg, setTestingFfmpeg] = useState(false);
  const [machine, setMachine] = useState<{ code: string; display: string } | null>(
    null,
  );
  const [appVersion, setAppVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<CheckUpdateResult | null>(null);
  const [gen, setGen] = useState<GenSettings | null>(null);
  const [genKeyInput, setGenKeyInput] = useState("");
  const [genKeyTouched, setGenKeyTouched] = useState(false);
  const [savingGen, setSavingGen] = useState(false);
  const [testingGen, setTestingGen] = useState(false);
  const [genTest, setGenTest] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [testingComfy, setTestingComfy] = useState(false);
  const [comfyTest, setComfyTest] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const isDesktop = typeof window !== "undefined" && !!window.licenseAPI;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error(await readError(res, "读取设置失败"));
        const data = await res.json();
        setSettings(data.settings);
        setFfmpeg(data.ffmpeg ?? null);
      } catch (error) {
        toast.error((error as Error).message || "读取设置失败");
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings/generation");
        if (!res.ok) {
          throw new Error(await readError(res, "读取云端生成设置失败"));
        }
        const data = await res.json();
        setGen(data.settings);
      } catch (error) {
        toast.error((error as Error).message || "读取云端生成设置失败");
      }
    })();
  }, []);

  useEffect(() => {
    if (!settings || window.location.hash !== "#llm") return;
    document.getElementById("llm")?.scrollIntoView({ block: "start" });
  }, [settings]);

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

  function openDownload() {
    if (window.licenseAPI) {
      window.licenseAPI
        .openExternal(FALLBACK_DOWNLOAD_URL)
        .catch(() => undefined);
    } else {
      window.open(FALLBACK_DOWNLOAD_URL, "_blank", "noopener,noreferrer");
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

  function updateFfmpeg(path: string) {
    setSettings((prev) =>
      prev ? { ...prev, ffmpeg: { ...prev.ffmpeg, path } } : prev,
    );
  }

  async function testFfmpeg() {
    if (!settings) return;
    setTestingFfmpeg(true);
    try {
      const res = await fetch("/api/system/ffmpeg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: settings.ffmpeg.path }),
      });
      const data = (await res.json().catch(() => null)) as FfmpegStatus | null;
      if (!res.ok || !data) throw new Error("检测失败");
      setFfmpeg(data);
      if (data.available) {
        toast.success(`ffmpeg 可用${data.version ? ` · ${data.version}` : ""}`);
      } else {
        toast.error(
          data.error ? `ffmpeg 不可用：${data.error}` : "ffmpeg 不可用",
        );
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setTestingFfmpeg(false);
    }
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
        autoGenerateAiPrompt: settings.autoGenerateAiPrompt,
      };
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readError(res, "保存失败"));
      const data = await res.json();
      setSettings(data.settings);
      if (data.ffmpeg) setFfmpeg(data.ffmpeg);
      setApiKeyTouched(false);
      setApiKeyInput("");
      toast.success("设置已保存");
    } catch (error) {
      toast.error((error as Error).message || "保存失败");
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

  function updateGen<K extends keyof GenSettings>(
    key: K,
    value: GenSettings[K],
  ) {
    setGen((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveGen() {
    if (!gen) return;
    setSavingGen(true);
    try {
      const payload: Record<string, unknown> = { ...gen };
      delete payload.apiKey;
      if (genKeyTouched) payload.apiKey = genKeyInput;
      const res = await fetch("/api/settings/generation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "保存失败");
      setGen(data.settings);
      setGenKeyTouched(false);
      setGenKeyInput("");
      toast.success("云端生成设置已保存");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSavingGen(false);
    }
  }

  async function testGen() {
    if (!gen) return;
    setTestingGen(true);
    setGenTest(null);
    try {
      const res = await fetch("/api/settings/generation/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: gen.baseUrl,
          ...(genKeyTouched ? { apiKey: genKeyInput } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(
          data?.detail || `连接失败（HTTP ${data?.status ?? "?"}）`,
        );
      }
      setGenTest({ ok: true, message: `连接成功（HTTP ${data.status}）` });
      toast.success("Toapi 连接成功");
    } catch (error) {
      setGenTest({ ok: false, message: (error as Error).message });
      toast.error("Toapi 连接失败");
    } finally {
      setTestingGen(false);
    }
  }

  async function testComfy() {
    if (!gen) return;
    setTestingComfy(true);
    setComfyTest(null);
    try {
      const res = await fetch("/api/settings/generation/comfy-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comfyUrl: gen.comfyUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.detail || "连接失败");
      }
      setComfyTest({ ok: true, message: "实例在线" });
      toast.success("ComfyUI 连接成功");
    } catch (error) {
      setComfyTest({ ok: false, message: (error as Error).message });
      toast.error("ComfyUI 连接失败");
    } finally {
      setTestingComfy(false);
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
    <div className="flex flex-col gap-6 pb-6">
      <PageHeader
        eyebrow="Settings"
        accent="mint"
        title="设置"
        description="配置 LLM 供应商。配置保存在 workspace/settings.json。"
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-block-cream p-4 text-sm leading-relaxed">
        <span>模型 API Key 由你自备、按量自费；项目与素材保存在本机工作区。</span>
        <OpenWorkspaceButton />
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
            <Button
              type="button"
              variant="outline"
              onClick={openDownload}
              title="GitHub 打不开时，可到下载地址手动下载安装包"
            >
              <ExternalLink className="size-4" />
              下载地址
            </Button>
            {updateResult?.hasUpdate && updateResult.url && (
              <Button
                type="button"
                onClick={() => window.licenseAPI?.openExternal(updateResult.url!)}
                title={`从 GitHub 下载安装包 v${updateResult.latest}`}
              >
                <Download className="size-4" />
                立即更新
              </Button>
            )}
            {updateResult?.ok && !updateResult.hasUpdate && (
              <span className="flex items-center gap-1.5 text-sm text-emerald-600">
                <CheckCircle2 className="size-4" />
                {updateResult.note ?? "已是最新版本"}
              </span>
            )}
            {updateResult && !updateResult.ok && (
              <span className="flex items-center gap-1.5 text-sm text-amber-600">
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

      <Card id="llm" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>LLM 配置</CardTitle>
          <CardDescription>
            使用 OpenAI 兼容接口。默认阿里百炼（DashScope），可切换任意兼容供应商。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="provider">供应商</Label>
            <SelectField
              id="provider"
              value={settings.llm.provider}
              onChange={(provider) => onProviderChange(provider as LlmProvider)}
              options={PROVIDER_OPTIONS.map((opt) => ({
                value: opt.value,
                label: opt.label,
              }))}
            />
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
              已保存的 Key 仅以掩码显示；留空表示不修改。当前：
              {settings.llm.apiKey || "未配置"}
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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.autoGenerateAiPrompt}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  autoGenerateAiPrompt: e.target.checked,
                })
              }
              className="size-4 accent-primary"
            />
            打开「第三方生成」时自动生成 AI 翻译提示词
          </label>

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
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4" />
            FFmpeg（合成与截帧）
          </CardTitle>
          <CardDescription>
            用于合成成片、截取首/尾帧。打包版通常已内置，一般无需修改；合成或截帧报错时，可在此指定
            ffmpeg 可执行文件的完整路径。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ffmpeg-path">ffmpeg 路径</Label>
            <div className="flex gap-2">
              <Input
                id="ffmpeg-path"
                value={settings.ffmpeg.path}
                onChange={(e) => updateFfmpeg(e.target.value)}
                placeholder="ffmpeg 或 D:\\ffmpeg\\bin\\ffmpeg.exe"
              />
              <Button
                type="button"
                variant="outline"
                onClick={testFfmpeg}
                disabled={testingFfmpeg}
              >
                {testingFfmpeg ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Zap className="size-4" />
                )}
                检测
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              留空则按内置路径 / 系统 PATH 查找名为 ffmpeg 的可执行文件。
            </p>
          </div>
          {ffmpeg && (
            <span
              className={`flex items-center gap-1.5 text-sm ${
                ffmpeg.available ? "text-emerald-600" : "text-destructive"
              }`}
            >
              {ffmpeg.available ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <XCircle className="size-4" />
              )}
              {ffmpeg.available
                ? `可用${ffmpeg.version ? ` · ${ffmpeg.version}` : ""}`
                : `不可用${ffmpeg.error ? `：${ffmpeg.error}` : ""}`}
            </span>
          )}
        </CardContent>
      </Card>

      <div>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          保存设置
        </Button>
      </div>

      {gen && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CloudUpload className="size-4" />
              云端生成（Toapi）
            </CardTitle>
            <CardDescription>
              接入 Toapi 异步图像接口，用于分镜页「云端生成起始画面」。大陆用户接口地址用
              https://toapis.cn/v1。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="gen-baseUrl">接口地址（baseUrl）</Label>
              <Input
                id="gen-baseUrl"
                value={gen.baseUrl}
                onChange={(e) => updateGen("baseUrl", e.target.value)}
                placeholder="https://toapis.cn/v1"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="gen-apiKey">API Key</Label>
              <Input
                id="gen-apiKey"
                type="password"
                value={genKeyTouched ? genKeyInput : gen.apiKey}
                onFocus={() => {
                  if (!genKeyTouched) {
                    setGenKeyTouched(true);
                    setGenKeyInput("");
                  }
                }}
                onChange={(e) => setGenKeyInput(e.target.value)}
                placeholder="sk-..."
              />
              <p className="text-xs text-muted-foreground">
                已保存的 Key 仅以掩码显示；留空表示不修改。当前：
                {gen.apiKey || "未配置"}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="gen-model">图像模型</Label>
                <Input
                  id="gen-model"
                  value={gen.imageModel}
                  onChange={(e) => updateGen("imageModel", e.target.value)}
                  placeholder="gpt-image-2"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="gen-resolution">分辨率</Label>
                <SelectField
                  id="gen-resolution"
                  value={gen.imageResolution}
                  onChange={(resolution) =>
                    updateGen(
                      "imageResolution",
                      resolution as GenSettings["imageResolution"],
                    )
                  }
                  options={[
                    { value: "1k", label: "1k" },
                    { value: "2k", label: "2k" },
                    { value: "4k", label: "4k" },
                  ]}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="gen-maxRef">最多上传参考图张数</Label>
              <Input
                id="gen-maxRef"
                type="number"
                min={0}
                max={14}
                value={gen.maxRefImages}
                onChange={(e) =>
                  updateGen("maxRefImages", Number(e.target.value))
                }
              />
              <p className="text-xs text-muted-foreground">
                参考图取自该段分镜绑定的资产视图（角色/场景/道具），Toapi 上限 14 张。
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="gen-concurrency">批量出图并发数</Label>
              <Input
                id="gen-concurrency"
                type="number"
                min={1}
                max={8}
                value={gen.imageConcurrency}
                onChange={(e) =>
                  updateGen("imageConcurrency", Number(e.target.value))
                }
              />
              <p className="text-xs text-muted-foreground">
                同时在跑的出图任务数，批量/单张出图都受此限制。Toapi
                对并发有限制（vip 类模型约 3），调太高会返回「生成服务繁忙」；建议
                2~3。
              </p>
            </div>

            <Separator />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={testGen}
                disabled={testingGen}
              >
                {testingGen ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Zap className="size-4" />
                )}
                测试连接
              </Button>
              <Button type="button" onClick={saveGen} disabled={savingGen}>
                {savingGen && <Loader2 className="size-4 animate-spin" />}
                保存出图设置
              </Button>
              {genTest && (
                <span
                  className={`flex items-center gap-1.5 text-sm ${
                    genTest.ok ? "text-emerald-600" : "text-destructive"
                  }`}
                >
                  {genTest.ok ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <XCircle className="size-4" />
                  )}
                  {genTest.message}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {gen && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Film className="size-4" />
              生视频（自建 ComfyUI · MiniMax H3）
            </CardTitle>
            <CardDescription>
              分镜页「云端生成视频」调用自建 ComfyUI 实例（MiniMax H3
              极速版镜像）。生成链路为提交→轮询，长片耗时可达 20 分钟。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="gen-comfyUrl">ComfyUI 实例地址</Label>
              <Input
                id="gen-comfyUrl"
                value={gen.comfyUrl}
                onChange={(e) => updateGen("comfyUrl", e.target.value)}
                placeholder="https://xxxx.container.x-gpu.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="gen-videoTimeout">单段生成超时（分钟）</Label>
                <Input
                  id="gen-videoTimeout"
                  type="number"
                  min={1}
                  max={360}
                  value={Math.max(1, Math.round(gen.videoTimeoutMs / 60_000))}
                  onChange={(e) =>
                    updateGen(
                      "videoTimeoutMs",
                      Math.max(1, Number(e.target.value) || 1) * 60_000,
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  从提交到回传的最长等待时间；长片常见 15–25 分钟，默认 30 分钟。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="gen-videoModel">主模型</Label>
                <SelectField
                  id="gen-videoModel"
                  value={gen.comfyVideoModel}
                  onChange={(model) =>
                    updateGen(
                      "comfyVideoModel",
                      model as GenSettings["comfyVideoModel"],
                    )
                  }
                  options={[
                    { value: "pruned", label: "剪枝（24G，推荐）" },
                    { value: "int8", label: "非剪枝 int8（48G，画质更好）" },
                  ]}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="gen-videoAspect">画幅</Label>
                <SelectField
                  id="gen-videoAspect"
                  value={gen.videoAspect}
                  onChange={(aspect) => updateGen("videoAspect", aspect)}
                  options={[
                    { value: "", label: "跟随项目比例" },
                    { value: "16:9", label: "16:9" },
                    { value: "9:16", label: "9:16" },
                    { value: "1:1", label: "1:1" },
                    { value: "4:3", label: "4:3" },
                    { value: "3:4", label: "3:4" },
                    { value: "21:9", label: "21:9" },
                  ]}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="gen-videoSteps">步数</Label>
                <Input
                  id="gen-videoSteps"
                  type="number"
                  min={1}
                  max={30}
                  value={gen.videoSteps}
                  onChange={(e) => updateGen("videoSteps", Number(e.target.value))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="gen-videoRes">分辨率</Label>
                <SelectField
                  id="gen-videoRes"
                  value={gen.videoResolution}
                  onChange={(res) =>
                    updateGen(
                      "videoResolution",
                      res as GenSettings["videoResolution"],
                    )
                  }
                  options={[
                    { value: "480p", label: "480P" },
                    { value: "540p", label: "540P" },
                    { value: "608p", label: "608P" },
                    { value: "768p", label: "768P（H3 原生上限）" },
                  ]}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="gen-blocks">Block swap</Label>
                <Input
                  id="gen-blocks"
                  type="number"
                  min={0}
                  max={60}
                  value={gen.blocksToSwap}
                  onChange={(e) =>
                    updateGen("blocksToSwap", Number(e.target.value))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="gen-sageMax">关 Sage 的时长阈值（秒）</Label>
                <Input
                  id="gen-sageMax"
                  type="number"
                  min={1}
                  max={60}
                  value={gen.sageMaxDurationSec}
                  onChange={(e) =>
                    updateGen("sageMaxDurationSec", Number(e.target.value))
                  }
                />
              </div>
            </div>

            <details className="group rounded-lg border border-border bg-muted/20 px-3 py-2">
              <summary className="flex cursor-pointer list-none select-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
                高级选项（二采 / 像素放大）
                <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-3 grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="gen-outH">放大后输出高度 P（0=关闭）</Label>
                    <Input
                      id="gen-outH"
                      type="number"
                      min={0}
                      max={4320}
                      value={gen.videoOutHeight}
                      onChange={(e) =>
                        updateGen("videoOutHeight", Number(e.target.value))
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="gen-upscaleModel">
                    像素放大模型（留空=不放大）
                  </Label>
                  <Input
                    id="gen-upscaleModel"
                    value={gen.videoUpscaleModel}
                    onChange={(e) =>
                      updateGen("videoUpscaleModel", e.target.value)
                    }
                    placeholder="RealESRGAN_x2plus.pth"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={gen.videoSecondPass}
                    onChange={(e) =>
                      updateGen("videoSecondPass", e.target.checked)
                    }
                    className="size-4 accent-primary"
                  />
                  二采（latent 放大重采样）
                </label>

                <div className="warnbox rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                  ⚠ 原生上限 768p（0.98MP），调高只更慢；Sage ×
                  长片（≥阈值）会崩，故长片自动关 Sage；4x 放大撑爆内存，长片只用
                  RealESRGAN_x2；24G 必须 block swap=50。
                </div>
              </div>
            </details>

            <Separator />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={testComfy}
                disabled={testingComfy}
              >
                {testingComfy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Zap className="size-4" />
                )}
                测试连接
              </Button>
              <Button
                type="button"
                onClick={saveGen}
                disabled={savingGen}
              >
                {savingGen && <Loader2 className="size-4 animate-spin" />}
                保存视频设置
              </Button>
              {comfyTest && (
                <span
                  className={`flex items-center gap-1.5 text-sm ${
                    comfyTest.ok ? "text-emerald-600" : "text-destructive"
                  }`}
                >
                  {comfyTest.ok ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <XCircle className="size-4" />
                  )}
                  {comfyTest.message}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
