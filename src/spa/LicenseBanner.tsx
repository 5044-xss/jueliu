import { useState } from "react";
import { Clock3, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trialRemainingText } from "./license/format";
import { LicenseDialog } from "./license/LicenseDialog";
import { useLicense } from "./license/use-license";

export function LicenseBanner() {
  const license = useLicense();
  const [open, setOpen] = useState(false);

  if (license.phase !== "ready") return null;

  if (license.status === "trial") {
    return (
      <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-block-cream px-4 py-2 text-xs text-foreground/75">
          <Clock3 className="size-3.5 shrink-0" />
          <span>{trialRemainingText(license)}</span>
          {license.offline && (
            <span className="text-muted-foreground">（离线缓存）</span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-7 shrink-0 bg-background px-3 text-[11px] shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
            onClick={() => setOpen(true)}
          >
            激活正式版
          </Button>
        </div>
        {open && <LicenseDialog onClose={() => setOpen(false)} />}
      </>
    );
  }

  if (license.offline && license.warning) {
    return (
      <div className="flex items-center justify-center gap-2 border-b border-border bg-muted/60 px-4 py-2 text-xs text-muted-foreground">
        <WifiOff className="size-3.5 shrink-0" />
        <span>{license.warning}</span>
      </div>
    );
  }

  return null;
}
