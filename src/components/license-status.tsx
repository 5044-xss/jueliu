"use client";

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";

export function LicenseStatus() {
  const [state, setState] = useState<LicenseState | null>(null);

  useEffect(() => {
    if (!window.licenseAPI) return;
    window.licenseAPI
      .getLicenseState()
      .then(setState)
      .catch(() => undefined);
    return window.licenseAPI.onLicenseUpdate(setState);
  }, []);

  if (!state?.allowed || state.status !== "trial") return null;

  const left =
    state.trialLeftHours != null
      ? `剩余 ${state.trialLeftHours} 小时`
      : state.trialLeftDays != null
        ? `剩余 ${state.trialLeftDays} 天`
        : "试用中";

  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg bg-block-cream px-2.5 py-2 text-xs text-amber-700">
      <Clock3 className="size-3.5 shrink-0" />
      <span>试用{left === "试用中" ? "中" : ` · ${left}`}</span>
    </div>
  );
}
