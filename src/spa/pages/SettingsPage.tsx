import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  BookOpen,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { HelpDialog } from "@/components/help-dialog";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { readError } from "@/lib/http";
import type { FfmpegStatus } from "@core/shared/settings-shared";
import type { ProviderSettings } from "@/lib/settings/providers";
import { ProvidersPanel } from "../screens/settings/ProvidersPanel";
import { RoutingPanel } from "../screens/settings/RoutingPanel";
import { SystemPanel } from "../screens/settings/SystemPanel";
import { VendorsPanel } from "../screens/settings/VendorsPanel";

const TAB_VALUES = ["providers", "routing", "vendors", "system"];

function resolveTab(value: string): string {
  const normalized = value.replace(/^#/, "").replace(/^\?tab=/, "");
  if (normalized === "llm") return "providers";
  if (TAB_VALUES.includes(normalized)) return normalized;
  return "providers";
}

export function SettingsPage() {
  const [providers, setProviders] = useState<ProviderSettings | null>(null);
  const [ffmpegPath, setFfmpegPath] = useState("");
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [testingFfmpeg, setTestingFfmpeg] = useState(false);
  const [saving, setSaving] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [savedProviders, setSavedProviders] = useState("");
  const [savedFfmpegPath, setSavedFfmpegPath] = useState("");
  const providersRef = useRef<ProviderSettings | null>(null);
  const ffmpegPathRef = useRef("");
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  const hashTab = location.hash.replace(/^#/, "");
  const tab = resolveTab(searchParams.get("tab") ?? hashTab);

  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

  useEffect(() => {
    ffmpegPathRef.current = ffmpegPath;
  }, [ffmpegPath]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
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
        if (cancelled) return;
        const nextPath = settingsData.settings.ffmpeg.path ?? "";
        setProviders(providersData.settings);
        setFfmpegPath(nextPath);
        setFfmpeg(settingsData.ffmpeg ?? null);
        setSavedProviders(JSON.stringify(providersData.settings));
        setSavedFfmpegPath(nextPath);
      } catch (error) {
        if (cancelled) return;
        setLoadError((error as Error).message || "读取设置失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

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
    if (!providers) return;
    const submittedProviders = providers;
    const submittedFfmpegPath = ffmpegPath;
    const nextFfmpegPath = submittedFfmpegPath.trim();
    const providersChanged =
      JSON.stringify(submittedProviders) !== savedProviders;
    const ffmpegChanged = nextFfmpegPath !== savedFfmpegPath;
    if (!providersChanged && !ffmpegChanged) return;

    setSaving(true);
    try {
      let nextProviders = submittedProviders;
      if (providersChanged) {
        const res = await fetch("/api/settings/providers", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: submittedProviders }),
        });
        if (!res.ok) throw new Error(await readError(res, "保存服务商设置失败"));
        const data = await res.json();
        nextProviders = data.settings;
        if (providersRef.current === submittedProviders) {
          setProviders(nextProviders);
        }
      }

      let nextFfmpegPathSaved = savedFfmpegPath;
      if (ffmpegChanged) {
        const ffmpegRes = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ffmpeg: { path: nextFfmpegPath } }),
        });
        if (!ffmpegRes.ok) {
          throw new Error(await readError(ffmpegRes, "保存 FFmpeg 设置失败"));
        }
        const ffmpegData = await ffmpegRes.json();
        if (ffmpegData.ffmpeg) setFfmpeg(ffmpegData.ffmpeg);
        if (ffmpegPathRef.current === submittedFfmpegPath) {
          setFfmpegPath(nextFfmpegPath);
        }
        nextFfmpegPathSaved = nextFfmpegPath;
      }

      setSavedProviders(JSON.stringify(nextProviders));
      setSavedFfmpegPath(nextFfmpegPathSaved);
      toast.success("设置已保存");
    } catch (error) {
      toast.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const providersDirty = providers
    ? JSON.stringify(providers) !== savedProviders
    : false;
  const ffmpegDirty = ffmpegPath !== savedFfmpegPath;
  const dirty = providersDirty || ffmpegDirty;

  if (loadError) {
    return (
      <div className="flex max-w-xl flex-col items-start gap-4 rounded-2xl bg-card p-6 text-sm ring-1 ring-foreground/[0.08]">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="size-4" />
          {loadError}
        </div>
        <Button
          variant="outline"
          onClick={() => setReloadKey((value) => value + 1)}
        >
          <RefreshCw className="size-4" />
          重试
        </Button>
      </div>
    );
  }

  if (loading || !providers) {
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
        description="服务商管账号与连接；模型与参数在「模型路由」；平台能力与提示词方言在「厂商」。"
        actions={
          <>
            {tab !== "vendors" && dirty && (
              <span className="text-xs text-muted-foreground">未保存</span>
            )}
            <Button variant="outline" onClick={() => setHelpOpen(true)}>
              <BookOpen className="size-4" />
              使用说明
            </Button>
            {tab !== "vendors" && (
              <Button onClick={save} disabled={saving || !dirty}>
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                保存设置
              </Button>
            )}
          </>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setSearchParams({ tab: String(value) }, { replace: true });
        }}
      >
        <TabsList variant="line">
          <TabsTrigger value="providers">服务商</TabsTrigger>
          <TabsTrigger value="routing">模型路由</TabsTrigger>
          <TabsTrigger value="vendors">厂商</TabsTrigger>
          <TabsTrigger value="system">本机</TabsTrigger>
        </TabsList>

        <TabsContent value="providers" className="flex flex-col gap-4">
          <ProvidersPanel settings={providers} onChange={setProviders} />
        </TabsContent>

        <TabsContent value="routing">
          <RoutingPanel settings={providers} onChange={setProviders} />
        </TabsContent>

        <TabsContent value="vendors">
          <VendorsPanel />
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

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
