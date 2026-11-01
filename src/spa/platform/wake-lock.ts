interface WakeLockSentinelLike {
  release: () => Promise<void>
  addEventListener: (type: "release", listener: () => void) => void
}

interface WakeLockApi {
  request: (type: "screen") => Promise<WakeLockSentinelLike>
}

let sentinel: WakeLockSentinelLike | null = null;
let holders = 0;
let pending: Promise<void> | null = null;

function wakeLockApi(): WakeLockApi | null {
  if (typeof navigator === "undefined") return null;
  return (
    (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock ?? null
  );
}

async function request(): Promise<void> {
  if (sentinel) return;
  if (!pending) {
    pending = (async () => {
      const api = wakeLockApi();
      if (!api) return;
      try {
        const next = await api.request("screen");
        sentinel = next;
        next.addEventListener("release", () => {
          if (sentinel === next) sentinel = null;
        });
      } catch {
        // 应用不在前台或系统不允许时静默失败。
      }
    })().finally(() => {
      pending = null;
    });
  }
  await pending;
}

// 长任务期间尽量保持屏幕常亮，避免 WebView 被系统挂起导致心跳中断。
export async function acquireScreenWakeLock(): Promise<() => void> {
  holders += 1;
  await request();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0 && sentinel) {
      const current = sentinel;
      sentinel = null;
      void current.release().catch(() => undefined);
    }
  };
}
