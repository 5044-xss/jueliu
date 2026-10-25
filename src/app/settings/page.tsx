"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { BookOpen, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { readError } from "@/lib/http";
import type { FfmpegStatus } from "@core/shared/settings-shared";
import type { GenerationOverrides, ProviderSettings } from "@/lib/settings/providers";
import { ProvidersPanel } from "./providers-panel";
import { RoutingPanel } from "./routing-panel";
import { AdvancedPanel } from "./advanced-panel";
import { SystemPanel } from "./system-panel";
import type { GenerationView } from "./types";

const DEFAULT_GENERATION: GenerationView = {
  pollIntervalMs: 3000,
  comfyVideoModel: "pruned",
  videoSteps: 8,
  videoResolution: "540p",
  videoAspect: "",
  sagePreset: "Nvidia-Sage",
  sageMaxDurationSec: 12,
  blocksToSwap: 50,
  videoUpscaleModel: "",
  videoOutHeight: 0,
  videoSecondPass: false,
};

function toGenerationView(raw: Partial<GenerationView> | null | undefined): GenerationView {
  return {
    pollIntervalMs: raw?.pollIntervalMs ?? DEFAULT_GENERATION.pollIntervalMs,
    comfyVideoModel:
      raw?.comfyVideoModel === "int8" ? "int8" : "pruned",
    videoSteps: raw?.videoSteps ?? DEFAULT_GENERATION.videoSteps,
    videoResolution: raw?.videoResolution ?? DEFAULT_GENERATION.videoResolution,
    videoAspect: raw?.videoAspect ?? DEFAULT_GENERATION.videoAspect,
    sagePreset: raw?.sagePreset ?? DEFAULT_GENERATION.sagePreset,
    sageMaxDurationSec:
      raw?.sageMaxDurationSec ?? DEFAULT_GENERATION.sageMaxDurationSec,
    blocksToSwap: raw?.blocksToSwap ?? DEFAULT_GENERATION.blocksToSwap,
    videoUpscaleModel:
      raw?.videoUpscaleModel ?? DEFAULT_GENERATION.videoUpscaleModel,
    videoOutHeight: raw?.videoOutHeight ?? DEFAULT_GENERATION.videoOutHeight,
    videoSecondPass:
      raw?.videoSecondPass ?? DEFAULT_GENERATION.videoSecondPass,
  };
}

function resolveTab(hash: string): string {
  const value = hash.replace(/^#/, "");
  if (value === "llm") return "providers";
  if (["providers", "routing", "system"].includes(value)) return value;
  return "providers";
}

function subscribeHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export default function SettingsPage() {
  const [providers, setProviders] = useState<ProviderSettings | null>(null);
  const [generation, setGeneration] = useState<GenerationView | null>(null);
  const [ffmpegPath, setFfmpegPath] = useState("");
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [testingFfmpeg, setTestingFfmpeg] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualTab, setManualTab] = useState("");

  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => "",
  );
  const tab = manualTab || resolveTab(hash);

  useEffect(() => {
    (async () => {
      try {
        const [providersRes, settingsRes] = await Promise.all([
          fetch("/api/settings/providers"),
          fetch("/api/settings"),
        ]);
        if (!providersRes.ok) {
          throw new Error(await readError(providersRes, "读取服务商设置失败"));
        }
        if (!settingsRes.ok) {
          throw new Error(await readError(settingsRes, "读取设置失败"));
        }
        const providersData = await providersRes.json();
        const settingsData = await settingsRes.json();
        setProviders(providersData.settings);
        setGeneration(toGenerationView(providersData.generation));
        setFfmpegPath(settingsData.settings.ffmpeg.path ?? "");
        setFfmpeg(settingsData.ffmpeg ?? null);
      } catch (error) {
        toast.error((error as Error).message || "读取设置失败");
      }
    })();
  }, []);

  function updateGeneration(patch: Partial<GenerationView>) {
    setGeneration((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function testFfmpeg() {
    setTestingFfmpeg(true);
    try {
      const res = await fetch("/api/system/ffmpeg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ffmpegPath }),
      });
      const data = (await res.json().catch(() => null)) as FfmpegStatus | null;
      if (!res.ok || !data) throw new Error("检测失败");
      setFfmpeg(data);
      if (data.available) {
        toast.success(`ffmpeg 可用${data.version ? ` · ${data.version}` : ""}`);
      } else {
        toast.error(data.error ? `ffmpeg 不可用：${data.error}` : "ffmpeg 不可用");
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setTestingFfmpeg(false);
    }
  }

  async function save() {
    if (!providers || !generation) return;
    setSaving(true);
    try {
      const generationPatch: GenerationOverrides = {
        pollIntervalMs: generation.pollIntervalMs,
        comfyVideoModel: generation.comfyVideoModel,
        videoSteps: generation.videoSteps,
        videoResolution: generation.videoResolution as GenerationOverrides["videoResolution"],
        videoAspect: generation.videoAspect,
        sagePreset: generation.sagePreset,
        sageMaxDurationSec: generation.sageMaxDurationSec,
        blocksToSwap: generation.blocksToSwap,
        videoUpscaleModel: generation.videoUpscaleModel,
        videoOutHeight: generation.videoOutHeight,
        videoSecondPass: generation.videoSecondPass,
      };

      const res = await fetch("/api/settings/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: providers,
          generation: generationPatch,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, "保存服务商设置失败"));
      const data = await res.json();
      setProviders(data.settings);
      setGeneration(toGenerationView(data.generation));

      const ffmpegRes = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ffmpeg: { path: ffmpegPath } }),
      });
      if (!ffmpegRes.ok) throw new Error(await readError(ffmpegRes, "保存 FFmpeg 设置失败"));
      const ffmpegData = await ffmpegRes.json();
      if (ffmpegData.ffmpeg) setFfmpeg(ffmpegData.ffmpeg);

      toast.success("设置已保存");
    } catch (error) {
      toast.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (!providers || !generation) {
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
        description="填 API Key 即可；模型与生成参数都按服务商配置，能力路由会自动选好。"
        actions={
          <>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/help" />}
            >
              <BookOpen className="size-4" />
              使用说明
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              保存设置
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(value) => setManualTab(String(value))}>
        <TabsList variant="line">
          <TabsTrigger value="providers">服务商</TabsTrigger>
          <TabsTrigger value="routing">能力</TabsTrigger>
          <TabsTrigger value="system">本机</TabsTrigger>
        </TabsList>

        <TabsContent value="providers" className="flex flex-col gap-4">
          <ProvidersPanel settings={providers} onChange={setProviders} />
          <AdvancedPanel
            settings={providers}
            onChange={setProviders}
            generation={generation}
            onGenerationChange={updateGeneration}
          />
        </TabsContent>

        <TabsContent value="routing">
          <RoutingPanel settings={providers} onChange={setProviders} />
        </TabsContent>

        <TabsContent value="system">
          <SystemPanel
            ffmpegPath={ffmpegPath}
            onFfmpegPathChange={setFfmpegPath}
            ffmpeg={ffmpeg}
            testingFfmpeg={testingFfmpeg}
            onTestFfmpeg={testFfmpeg}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
