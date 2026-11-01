import { useState, type FormEvent } from "react";
import {
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
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
import { localLicense } from "../license/service";
import { useLicense } from "../license/use-license";
import { platformLabel } from "../platform/runtime";

function formatDate(value: number | null): string {
  if (!value) return "长期";
  return new Date(value).toLocaleDateString("zh-CN");
}

export function ActivationPage() {
  const license = useLicense();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function copyDevice() {
    if (!license.deviceDisplay) return;
    try {
      await navigator.clipboard.writeText(license.deviceCode ?? "");
      toast.success("设备码已复制");
    } catch {
      toast.error("复制失败，请手动选择");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (window.licenseAPI) {
        const result = await window.licenseAPI.activate(code);
        if (result.ok) toast.success("激活成功");
        else toast.error(result.error || result.state?.message || "激活失败");
        return;
      }
      const result = await localLicense.activate(code);
      if (result.ok) {
        toast.success("激活成功");
      } else {
        toast.error(result.error || "激活失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if (window.licenseAPI) {
        const state = await window.licenseAPI.checkin();
        if (state.allowed) toast.success(state.message || "授权有效");
        else toast.error(state.message || "未找到授权或试用");
      } else {
        const state = await localLicense.refresh();
        if (state.allowed) toast.success(state.message || "授权有效");
        else toast.error(state.message || "未找到授权或试用");
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function reset() {
    if (window.licenseAPI) {
      await window.licenseAPI.resetLicense();
    } else {
      await localLicense.reset();
    }
    setCode("");
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4 py-8 safe-top safe-bottom">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRound className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">激活掘流</h1>
            <p className="text-xs text-muted-foreground">
              {platformLabel()} · 本地授权 + 在线试用
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4" />
              设备码
            </CardTitle>
            <CardDescription>
              把 16 位设备码发给管理员生成激活码，一机一码。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2.5">
              <code className="min-w-0 flex-1 break-all font-mono text-xs">
                {license.deviceDisplay || (license.phase === "loading" ? "读取中…" : "—")}
              </code>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={copyDevice}
                disabled={!license.deviceDisplay}
                title="复制设备码"
              >
                <Copy className="size-4" />
              </Button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                管理员开通试用后无需激活码，联网刷新即可生效。
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={refresh}
                disabled={refreshing}
              >
                {refreshing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                刷新
              </Button>
            </div>

            {license.error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive">
                {license.error}
              </div>
            )}

            {license.status === "expired" && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700">
                授权已于 {formatDate(license.exp)} 过期，请输入新的激活码。
              </div>
            )}

            <form className="flex flex-col gap-3" onSubmit={submit}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="activation-code">激活码</Label>
                <Input
                  id="activation-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="粘贴管理员发来的激活码"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <Button type="submit" disabled={busy || !code.trim()}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <KeyRound className="size-4" />
                )}
                激活
              </Button>
            </form>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>产品：{license.product}</span>
              {license.code && (
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={reset}
                >
                  清除激活
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          授权与设备码绑定，一码一机。
          <br />
          更换设备或重装系统后请联系管理员重新签发。
        </p>
      </div>
    </div>
  );
}
