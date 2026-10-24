"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Terminal,
  XCircle,
  Zap,
} from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { OpenWorkspaceButton } from "@/components/workspace-actions";
import type { FfmpegStatus } from "@core/shared/settings-shared";

const FALLBACK_DOWNLOAD_URL =
  "https://my.feishu.cn/drive/folder/BTNnfef6blmndfd4pUtcYySWnSf?from=from_copylink";

const noopSubscribe = () => () => {};

function useDesktop() {
  return useSyncExternalStore(
    noopSubscribe,
    () => Boolean(window.licenseAPI),
    () => false,
  );
}

export function SystemPanel({
  ffmpegPath,
  onFfmpegPathChange,
  ffmpeg,
  testingFfmpeg,
  onTestFfmpeg,
}: {
  ffmpegPath: string;
  onFfmpegPathChange: (value: string) => void;
  ffmpeg: FfmpegStatus | null;
  testingFfmpeg: boolean;
  onTestFfmpeg: () => void;
}) {
  const [machine, setMachine] = useState<{ code: string; display: string } | null>(
    null,
  );
  const [appVersion, setAppVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<CheckUpdateResult | null>(null);
  const isDesktop = useDesktop();

  useEffect(() => {
    if (!window.licenseAPI) return;
    window.licenseAPI.getMachineId().then(setMachine).catch(() => undefined);
    window.licenseAPI.getVersion().then(setAppVersion).catch(() => undefined);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-block-cream px-4 py-3 text-sm">
        <span>API Key 由你自备、按量自费；项目与素材保存在本机工作区。</span>
        <OpenWorkspaceButton />
      </div>

      <Card size="sm" className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            授权与版本
          </CardTitle>
          <CardDescription>离线签名授权，一码一机，永久有效。</CardDescription>
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
            <div className="flex gap-2 sm:max-w-md">
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.licenseAPI?.resetLicense()}
                >
                  重新激活
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card size="sm" className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4" />
            FFmpeg（合成与截帧）
          </CardTitle>
          <CardDescription>
            用于合成成片、截取首/尾帧。打包版通常已内置，一般无需修改。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ffmpeg-path">ffmpeg 路径</Label>
            <div className="flex gap-2 sm:max-w-xl">
              <Input
                id="ffmpeg-path"
                value={ffmpegPath}
                onChange={(e) => onFfmpegPathChange(e.target.value)}
                placeholder="ffmpeg 或 D:\\ffmpeg\\bin\\ffmpeg.exe"
              />
              <Button
                type="button"
                variant="outline"
                onClick={onTestFfmpeg}
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
    </div>
  );
}
