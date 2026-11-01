import { useState } from "react";
import { Check, Copy, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { localLicense } from "./service";
import { useLicense } from "./use-license";

export function ActivationForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const license = useLicense();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activating, setActivating] = useState(false);
  const [checking, setChecking] = useState(false);

  const copyMachine = async () => {
    if (!license.deviceDisplay) return;
    try {
      await navigator.clipboard.writeText(license.deviceDisplay);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast.success("已复制机器码");
    } catch {
      toast.error("复制失败，请手动选择复制");
    }
  };

  const submit = async () => {
    const value = code.trim();
    if (!value) {
      setError("请先粘贴激活码");
      return;
    }
    setError(null);
    setActivating(true);
    try {
      if (window.licenseAPI) {
        const result = await window.licenseAPI.activate(value);
        if (!result.ok) {
          setError(result.error || result.state?.message || "激活失败");
          return;
        }
      } else {
        const result = await localLicense.activate(value);
        if (!result.ok) {
          setError(result.error || result.state.message || "激活失败");
          return;
        }
      }
      setCode("");
      toast.success("激活成功");
    } catch (err) {
      setError((err as Error).message || "激活失败");
    } finally {
      setActivating(false);
    }
  };

  const check = async () => {
    setError(null);
    setChecking(true);
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
    } catch (err) {
      toast.error((err as Error).message || "检查授权失败");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
          本机机器码
        </span>
        <div className="flex gap-2">
          <code className="flex min-w-0 flex-1 items-center truncate rounded-lg border border-border bg-surface-soft px-3.5 py-2.5 font-mono text-sm tracking-[0.08em] text-foreground">
            {license.deviceDisplay || "获取中…"}
          </code>
          <Button
            type="button"
            variant="outline"
            className="size-10 shrink-0 rounded-lg px-0"
            onClick={() => void copyMachine()}
            disabled={!license.deviceDisplay}
            title="复制机器码"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          把机器码发送给卖家获取激活码。一码一机，更换硬件后需要重新签发。
        </p>
      </div>

      <div>
        <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
          激活码
        </span>
        <Textarea
          autoFocus={autoFocus}
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setError(null);
          }}
          placeholder="粘贴激活码…"
          maxLength={8000}
          spellCheck={false}
          className="min-h-[92px] resize-y break-all font-mono text-xs leading-relaxed"
        />
        {license.status === "active" && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            当前已授权。如需更换授权，直接粘贴新的激活码即可。
          </p>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {!error && license.warning && (
        <p className="text-xs text-amber-600">{license.warning}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="lg"
          className="px-5 shadow-[0_8px_20px_-12px_rgba(0,0,0,0.5)]"
          onClick={() => void submit()}
          disabled={activating || !code.trim()}
        >
          {activating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <KeyRound className="size-4" />
          )}
          {activating ? "激活中…" : "激活"}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={() => void check()}
          disabled={checking}
        >
          <RefreshCw className={checking ? "size-4 animate-spin" : "size-4"} />
          {checking ? "检查中…" : "检查授权"}
        </Button>
      </div>
    </div>
  );
}
