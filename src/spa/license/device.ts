import { Capacitor } from "@capacitor/core";
import { Device } from "@capacitor/device";
import { Preferences } from "@capacitor/preferences";
import { sha256 } from "@noble/hashes/sha2.js";
import { INSTALL_ID_KEY, LICENSE_PRODUCT } from "./config";

let cachedDeviceCode: string | null = null;

function deriveDeviceCode(raw: string): string {
  const digest = sha256(new TextEncoder().encode(raw));
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += digest[index].toString(16).padStart(2, "0");
  }
  return code.toUpperCase();
}

function randomId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
}

async function readInstallId(): Promise<string | null> {
  const local = readLocal(INSTALL_ID_KEY);
  if (local) return local;
  const stored = await Preferences.get({ key: INSTALL_ID_KEY }).catch(
    () => null,
  );
  const value = stored?.value?.trim() || null;
  if (value) await writeInstallId(value);
  return value;
}

async function writeInstallId(value: string): Promise<void> {
  writeLocal(INSTALL_ID_KEY, value);
  await Preferences.set({ key: INSTALL_ID_KEY, value }).catch(() => undefined);
}

export async function getInstallId(): Promise<string> {
  const existing = await readInstallId();
  if (existing) return existing;
  const created = randomId();
  await writeInstallId(created);
  return created;
}

async function ensureDeviceCode(): Promise<string> {
  let identifier = "";
  try {
    const result = await Device.getId();
    identifier = result.identifier || "";
  } catch {
    identifier = "";
  }
  if (!identifier) {
    identifier = await getInstallId();
  }
  return deriveDeviceCode(
    `${LICENSE_PRODUCT}|${Capacitor.getPlatform()}|${identifier}`,
  );
}

export async function getDeviceCode(): Promise<string> {
  if (cachedDeviceCode) return cachedDeviceCode;

  const desktopApi =
    typeof window !== "undefined" ? window.licenseAPI : undefined;
  if (desktopApi?.getMachineId) {
    try {
      const result = await desktopApi.getMachineId();
      if (result?.code) {
        cachedDeviceCode = result.code;
        return cachedDeviceCode;
      }
    } catch {
      cachedDeviceCode = await ensureDeviceCode();
      return cachedDeviceCode;
    }
  }

  cachedDeviceCode = await ensureDeviceCode();
  return cachedDeviceCode;
}

export async function resetDeviceCodeCache(): Promise<void> {
  cachedDeviceCode = null;
}
