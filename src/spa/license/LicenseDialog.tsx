import { useState } from "react";
import { Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ActivationForm } from "./ActivationForm";
import { formatDateTime, statusLabel } from "./format";
import { localLicense } from "./service";
import { useLicense } from "./use-license";

export function LicenseDialog({ onClose }: { onClose: () => void }) {
  const license = useLicense();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const tone = license.allowed
    ? "bg-emerald-600/10 text-emerald-700"
    : license.status === "pending"
      ? "bg-amber-500/10 text-amber-700"
      : "bg-destructive/10 text-destructive";

  const clear = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      if (window.licenseAPI) {
        await window.licenseAPI.resetLicense();
      } else {
        await localLicense.reset();
      }
      setConfirmReset(false);
      toast.success("已清除本地授权");
    } catch {
      toast.error("清除本地授权失败");
    } finally {
      setResetting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[86dvh] gap-5 overflow-y-auto rounded-[24px] p-6 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>授权</DialogTitle>
        </DialogHeader>

        <div className="rounded-xl border border-border bg-surface-soft/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {statusLabel(license.status, license.phase)}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${tone}`}
            >
              {license.offline ? "离线" : "在线"}
            </span>
            <span className="ml-auto text-[11px] text-muted-foreground">
              产品 {license.product}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {license.message}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {license.sn && (
              <span>
                授权编号{" "}
                <span className="font-mono text-foreground">{license.sn}</span>
              </span>
            )}
            {license.nbf && <span>生效 {formatDateTime(license.nbf)}</span>}
            {license.exp && <span>到期 {formatDateTime(license.exp)}</span>}
            {!license.exp && license.status === "active" && <span>永久授权</span>}
          </div>
          {license.error && (
            <p className="mt-2 break-words text-[11px] text-destructive">
              {license.error}
            </p>
          )}
          {license.warning && license.warning !== license.error && (
            <p className="mt-1 break-words text-[11px] text-amber-600">
              {license.warning}
            </p>
          )}
        </div>

        <div className="border-t border-border pt-4">
          <ActivationForm />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          {confirmReset ? (
            <>
              <span className="text-[11px] text-muted-foreground">
                清除后需要重新输入激活码，确定吗？
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => void clear()}
                disabled={resetting}
              >
                {resetting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                确认清除
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmReset(false)}
                disabled={resetting}
              >
                取消
              </Button>
            </>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition hover:text-destructive"
              onClick={() => setConfirmReset(true)}
            >
              <Trash2 className="size-3" />
              清除本地授权
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
