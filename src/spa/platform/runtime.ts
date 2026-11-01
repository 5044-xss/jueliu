interface CapacitorRuntime {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function runtime(): CapacitorRuntime | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Capacitor?: CapacitorRuntime }).Capacitor ?? null;
}

export function isNativeMobile(): boolean {
  return Boolean(runtime()?.isNativePlatform?.());
}

export function nativePlatform(): string | null {
  return runtime()?.getPlatform?.() ?? null;
}

export function platformLabel(): string {
  if (__DESKTOP__) return "桌面端";
  if (isNativeMobile()) {
    return nativePlatform() === "ios" ? "iOS" : "Android";
  }
  return "移动端";
}
