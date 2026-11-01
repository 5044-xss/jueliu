import { Preferences } from "@capacitor/preferences";
import { LICENSE_CHECKIN_KEY, LICENSE_CODE_KEY } from "./config";

const WEB_KEY = LICENSE_CODE_KEY;

export interface StoredCheckin {
  payload: string;
  sig: string;
  savedAt: number;
}

function canUseLocalStorage(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const probe = "__jueliu_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

async function readValue(key: string): Promise<string | null> {
  if (canUseLocalStorage()) {
    return window.localStorage.getItem(key);
  }
  const stored = await Preferences.get({ key }).catch(() => null);
  return stored?.value ?? null;
}

async function writeValue(key: string, value: string): Promise<void> {
  if (canUseLocalStorage()) {
    window.localStorage.setItem(key, value);
    return;
  }
  await Preferences.set({ key, value });
}

async function removeValue(key: string): Promise<void> {
  if (canUseLocalStorage()) {
    window.localStorage.removeItem(key);
    return;
  }
  await Preferences.remove({ key });
}

export async function readStoredLicense(): Promise<string | null> {
  return readValue(WEB_KEY);
}

export async function writeStoredLicense(code: string): Promise<void> {
  await writeValue(WEB_KEY, code);
}

export async function clearStoredLicense(): Promise<void> {
  await removeValue(WEB_KEY);
}

export async function readCheckinCache(): Promise<StoredCheckin | null> {
  const raw = await readValue(LICENSE_CHECKIN_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCheckin>;
    if (
      typeof parsed.payload === "string" &&
      typeof parsed.sig === "string" &&
      typeof parsed.savedAt === "number"
    ) {
      return { payload: parsed.payload, sig: parsed.sig, savedAt: parsed.savedAt };
    }
  } catch {
    return null;
  }
  return null;
}

export async function writeCheckinCache(cache: StoredCheckin): Promise<void> {
  await writeValue(LICENSE_CHECKIN_KEY, JSON.stringify(cache)).catch(
    () => undefined,
  );
}

export async function clearCheckinCache(): Promise<void> {
  await removeValue(LICENSE_CHECKIN_KEY).catch(() => undefined);
}
