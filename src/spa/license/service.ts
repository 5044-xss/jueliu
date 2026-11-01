import { CapacitorHttp } from "@capacitor/core";
import { isNativeMobile } from "../platform/runtime";
import {
  decodeCheckinEnvelope,
  decodeLicenseCode,
  formatCode,
  normalizeMid,
  type CheckinPayload,
  type CheckinStatus,
  type LicenseStatus,
} from "./codec";
import { LICENSE_API_BASE, LICENSE_PRODUCT } from "./config";
import { getDeviceCode, getInstallId } from "./device";
import {
  clearCheckinCache,
  clearStoredLicense,
  readCheckinCache,
  readStoredLicense,
  writeCheckinCache,
  writeStoredLicense,
} from "./store";

export interface LocalLicenseState {
  phase: "loading" | "ready";
  status: LicenseStatus | CheckinStatus | "error";
  allowed: boolean;
  message: string;
  error: string | null;
  product: string;
  deviceCode: string | null;
  deviceDisplay: string | null;
  sn: string | null;
  nbf: number | null;
  exp: number | null;
  features: string[];
  code: string | null;
  trialTotalDays?: number | null;
  trialLeftDays?: number | null;
  trialTotalHours?: number | null;
  trialLeftHours?: number | null;
  offline?: boolean;
  warning?: string | null;
}

const INITIAL_STATE: LocalLicenseState = {
  phase: "loading",
  status: "none",
  allowed: false,
  message: "正在检查授权…",
  error: null,
  product: LICENSE_PRODUCT,
  deviceCode: null,
  deviceDisplay: null,
  sn: null,
  nbf: null,
  exp: null,
  features: [],
  code: null,
};

const POLICY = {
  timeoutMs: 8000,
  normalIntervalMs: 6 * 60 * 60 * 1000,
  nearExpiryWindowMs: 24 * 60 * 60 * 1000,
  nearExpiryIntervalMs: 60 * 60 * 1000,
  wakeMinGapMs: 30 * 60 * 1000,
};

const STATUS_MESSAGES: Record<string, string> = {
  active: "授权有效",
  trial: "试用中",
  pending: "授权尚未生效",
  expired: "授权或试用已过期",
  revoked: "授权已被吊销",
  none: "未找到授权，请激活或申请试用",
  invalid: "激活码无效",
  error: "授权校验失败",
};

export interface ActivateResult {
  ok: boolean;
  error?: string;
  state: LocalLicenseState;
}

interface CheckinResult {
  data: CheckinPayload;
  offline: boolean;
  warning: string | null;
}

interface CheckinEnvelope {
  payload: string;
  sig: string;
}

interface LicenseError extends Error {
  code?: string;
  status?: number;
}

function parseEnvelope(raw: unknown, httpStatus: number): CheckinEnvelope {
  let body: unknown = raw;
  if (typeof raw === "string") {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error("授权服务器响应异常");
    }
  }
  const value = body as
    | { ok?: boolean; error?: string; payload?: string; sig?: string }
    | null;
  if (!value || !value.ok) {
    const error = new Error(
      (value && value.error) || `授权校验失败（HTTP ${httpStatus}）`,
    ) as LicenseError;
    error.code = httpStatus === 400 ? "bad_request" : "http";
    error.status = httpStatus;
    throw error;
  }
  if (!value.payload || !value.sig) throw new Error("授权服务器响应异常");
  return { payload: value.payload, sig: value.sig };
}

async function requestCheckin(
  mid: string,
  license: string | null,
): Promise<CheckinEnvelope> {
  const base = !isNativeMobile() && import.meta.env.DEV
    ? ""
    : LICENSE_API_BASE.replace(/\/+$/, "");
  const url = `${base}/api/license/checkin`;
  const body = {
    product: LICENSE_PRODUCT,
    mid,
    license: license || null,
    installId: await getInstallId().catch(() => null),
    appVersion: __APP_VERSION__,
  };

  if (isNativeMobile()) {
    let response;
    try {
      response = await CapacitorHttp.post({
        url,
        headers: { "Content-Type": "application/json" },
        data: body,
        connectTimeout: POLICY.timeoutMs,
        readTimeout: POLICY.timeoutMs,
      });
    } catch (error) {
      const wrapped = new Error(
        `无法连接授权服务器：${(error as Error)?.message || error}`,
      ) as LicenseError;
      wrapped.code = "network";
      throw wrapped;
    }
    return parseEnvelope(response.data, response.status);
  }

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POLICY.timeoutMs),
    });
  } catch (error) {
    const wrapped = new Error(
      `无法连接授权服务器：${(error as Error)?.message || error}`,
    ) as LicenseError;
    wrapped.code = "network";
    throw wrapped;
  }
  const data = await response.json().catch(() => null);
  return parseEnvelope(data, response.status);
}

function localPayloadData(
  decoded: ReturnType<typeof decodeLicenseCode>,
  now: number,
): CheckinPayload {
  return {
    v: 1,
    product: LICENSE_PRODUCT,
    mid: normalizeMid(decoded.payload.mid),
    status: decoded.status,
    nbf: decoded.payload.nbf ?? null,
    exp: decoded.payload.exp ?? null,
    licenseId: null,
    sn: decoded.payload.sn,
    trialTotalDays: null,
    trialLeftDays: null,
    trialTotalHours: null,
    trialLeftHours: null,
    serverTime: now,
    graceUntil: 0,
    message: decoded.message || STATUS_MESSAGES[decoded.status],
  };
}

function stateFromCheckin(
  data: CheckinPayload,
  deviceCode: string,
  extra: { offline: boolean; warning: string | null },
): Partial<LocalLicenseState> {
  const allowed = data.status === "active" || data.status === "trial";
  const message = data.message || STATUS_MESSAGES[data.status] || "授权状态未知";
  return {
    phase: "ready",
    status: data.status,
    allowed,
    message,
    error: allowed ? null : message,
    product: data.product,
    deviceCode,
    deviceDisplay: formatCode(deviceCode),
    sn: data.sn ?? null,
    nbf: data.nbf ?? null,
    exp: data.exp ?? null,
    features: [],
    trialTotalDays: data.trialTotalDays ?? null,
    trialLeftDays: data.trialLeftDays ?? null,
    trialTotalHours: data.trialTotalHours ?? null,
    trialLeftHours: data.trialLeftHours ?? null,
    offline: extra.offline,
    warning: extra.warning,
  };
}

async function reusableCache(mid: string): Promise<CheckinPayload | null> {
  const cache = await readCheckinCache();
  if (!cache) return null;
  try {
    const data = decodeCheckinEnvelope(cache.payload, cache.sig, mid);
    if (!data.graceUntil || data.graceUntil <= 0) return null;
    const offset =
      typeof data.serverTime === "number" ? data.serverTime - cache.savedAt : 0;
    return Date.now() + offset <= data.graceUntil ? data : null;
  } catch {
    await clearCheckinCache();
    return null;
  }
}

async function checkinWithFallback(
  mid: string,
  license: string | null,
): Promise<CheckinResult> {
  try {
    const result = await requestCheckin(mid, license);
    const data = decodeCheckinEnvelope(result.payload, result.sig, mid);
    await writeCheckinCache({
      payload: result.payload,
      sig: result.sig,
      savedAt: Date.now(),
    });
    return { data, offline: false, warning: null };
  } catch (error) {
    const message = (error as Error)?.message || "网络不可用，已使用本地缓存";
    const cached = await reusableCache(mid);
    if (cached) {
      return { data: cached, offline: true, warning: message };
    }

    if (license) {
      try {
        const decoded = decodeLicenseCode(license, mid);
        return {
          data: localPayloadData(decoded, Date.now()),
          offline: true,
          warning: message,
        };
      } catch (localError) {
        const wrapped = new Error(
          `${(localError as Error)?.message || localError}（且无法连接授权服务器）`,
        ) as LicenseError;
        wrapped.code = (error as LicenseError)?.code || "invalid";
        throw wrapped;
      }
    }

    throw error;
  }
}

class LocalLicenseService {
  private state: LocalLicenseState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private started: Promise<void> | null = null;
  private inflight: Promise<LocalLicenseState> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastOnlineAt = 0;
  private wakeAttached = false;

  getState = (): LocalLicenseState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<LocalLicenseState>): LocalLicenseState {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
    return this.state;
  }

  private failure(message: string, error: unknown): LocalLicenseState {
    return this.update({
      ...INITIAL_STATE,
      phase: "ready",
      status: "error",
      allowed: false,
      deviceCode: this.state.deviceCode,
      deviceDisplay: this.state.deviceDisplay,
      message,
      error: String((error as Error)?.message || error),
      offline: true,
    });
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const nearExpiry =
      typeof this.state.exp === "number" &&
      this.state.exp - Date.now() < POLICY.nearExpiryWindowMs;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.refreshNow();
      },
      nearExpiry ? POLICY.nearExpiryIntervalMs : POLICY.normalIntervalMs,
    );
  }

  private attachWake(): void {
    if (this.wakeAttached) return;
    this.wakeAttached = true;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (Date.now() - this.lastOnlineAt < POLICY.wakeMinGapMs) return;
      void this.refreshNow();
    });
  }

  start(): Promise<void> {
    if (!this.started) this.started = this.boot();
    return this.started;
  }

  private async boot(): Promise<void> {
    try {
      this.update({ phase: "loading", message: "正在获取设备标识" });
      const deviceCode = await getDeviceCode();
      this.update({
        deviceCode,
        deviceDisplay: formatCode(deviceCode),
        message: "正在校验授权",
      });
      this.attachWake();
      await this.refreshNow();
    } catch (error) {
      this.failure("授权校验失败", error);
    }
  }

  async refresh(): Promise<LocalLicenseState> {
    await this.start();
    return this.refreshNow();
  }

  private async refreshNow(): Promise<LocalLicenseState> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const deviceCode = await getDeviceCode();
        const license = await readStoredLicense().catch(() => null);
        const result = await checkinWithFallback(deviceCode, license);
        if (!result.offline) this.lastOnlineAt = Date.now();
        let next = this.update({
          ...stateFromCheckin(result.data, deviceCode, result),
          code: license,
        });
        if (next.status === "revoked") {
          await clearStoredLicense();
          await clearCheckinCache();
          next = this.update({
            code: null,
            warning: next.warning || "授权已被吊销，本地授权状态已清除",
          });
        }
        this.schedule();
        return next;
      } catch (error) {
        const next = this.failure("无法连接授权服务器", error);
        this.schedule();
        return next;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  async activate(input: string): Promise<ActivateResult> {
    await this.start();
    let deviceCode: string;
    try {
      deviceCode = await getDeviceCode();
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message || "无法获取设备标识",
        state: this.state,
      };
    }

    const value = String(input || "").trim();
    if (!value) return { ok: false, error: "请先填入激活码", state: this.state };

    let decoded: ReturnType<typeof decodeLicenseCode>;
    try {
      decoded = decodeLicenseCode(value, deviceCode);
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message || "激活码无效",
        state: this.state,
      };
    }

    const localData = localPayloadData(decoded, Date.now());
    if (localData.status === "expired") {
      this.update(
        stateFromCheckin(localData, deviceCode, {
          offline: true,
          warning: null,
        }),
      );
      return { ok: false, error: "激活码已过期", state: this.state };
    }

    try {
      const result = await requestCheckin(deviceCode, value);
      const data = decodeCheckinEnvelope(result.payload, result.sig, deviceCode);
      const next = this.update(
        stateFromCheckin(data, deviceCode, {
          offline: false,
          warning: null,
        }),
      );
      if (next.status !== "active" && next.status !== "pending") {
        if (next.status === "revoked") {
          await clearStoredLicense();
          await clearCheckinCache();
          this.update({ code: null });
        }
        return {
          ok: false,
          error:
            next.status === "trial"
              ? "激活码未在授权中心登记"
              : next.message || "激活失败",
          state: this.state,
        };
      }

      await writeStoredLicense(value);
      await writeCheckinCache({
        payload: result.payload,
        sig: result.sig,
        savedAt: Date.now(),
      });
      this.lastOnlineAt = Date.now();
      this.schedule();
      return { ok: true, state: this.update({ code: value }) };
    } catch (error) {
      const current = error as LicenseError;
      if (current.code === "bad_request") {
        return { ok: false, error: current.message, state: this.state };
      }

      await writeStoredLicense(value);
      const next = this.update({
        ...stateFromCheckin(localData, deviceCode, {
          offline: true,
          warning: "暂时无法连接授权服务器，已按离线激活码放行",
        }),
        code: value,
      });
      this.schedule();
      return { ok: true, state: next };
    }
  }

  async reset(): Promise<LocalLicenseState> {
    await this.start();
    await clearStoredLicense().catch(() => undefined);
    await clearCheckinCache();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.update({
      ...INITIAL_STATE,
      phase: "ready",
      status: "none",
      allowed: false,
      deviceCode: this.state.deviceCode,
      deviceDisplay: this.state.deviceDisplay,
      message: "已清除激活，请重新输入激活码",
      error: null,
      offline: false,
      warning: null,
    });
  }

  matchesDevice(value: string): boolean {
    return normalizeMid(value) === normalizeMid(this.state.deviceCode ?? "");
  }
}

export const localLicense = new LocalLicenseService();
