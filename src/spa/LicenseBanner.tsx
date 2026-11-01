import { Clock3, WifiOff } from "lucide-react";
import { useLicense } from "./license/use-license";

function trialLeft(license: ReturnType<typeof useLicense>): string {
  if (license.trialLeftHours != null) return `剩余 ${license.trialLeftHours} 小时`;
  if (license.trialLeftDays != null) return `剩余 ${license.trialLeftDays} 天`;
  return "试用中";
}

export function LicenseBanner() {
  const license = useLicense();
  if (license.phase !== "ready") return null;

  if (license.status === "trial") {
    return (
      <div className="flex items-center justify-center gap-2 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2 text-xs text-amber-700">
        <Clock3 className="size-3.5 shrink-0" />
        <span>试用 · {trialLeft(license)}</span>
      </div>
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
