export {};

declare global {
  interface CheckUpdateResult {
    ok: boolean;
    current?: string;
    latest?: string;
    url?: string;
    hasUpdate?: boolean;
    note?: string;
    error?: string;
  }

  type LicenseStatus =
    | "active"
    | "trial"
    | "pending"
    | "expired"
    | "revoked"
    | "none"
    | "invalid"
    | "error"
    | null;

  interface LicenseState {
    phase: "loading" | "ready";
    status: LicenseStatus;
    allowed: boolean;
    machineCode: string | null;
    machineDisplay: string | null;
    message: string;
    offline: boolean;
    warning: string | null;
    error: string | null;
    nbf: number | null;
    exp: number | null;
    licenseId: string | null;
    sn: string | null;
    trialTotalDays: number | null;
    trialLeftDays: number | null;
    trialTotalHours: number | null;
    trialLeftHours: number | null;
    serverTime: number | null;
    graceUntil: number | null;
    checkedAt: number | null;
  }

  interface LicenseAPI {
    getMachineId(): Promise<{ code: string; display: string }>;
    getLicenseState(): Promise<LicenseState>;
    checkin(): Promise<LicenseState>;
    activate(code: string): Promise<{
      ok: boolean;
      error?: string;
      state?: LicenseState;
    }>;
    enterApp(): Promise<{ ok: boolean; error?: string }>;
    resetLicense(): Promise<{ ok: boolean; state?: LicenseState }>;
    onLicenseUpdate(callback: (state: LicenseState) => void): () => void;
    getVersion(): Promise<string>;
    checkUpdate(): Promise<CheckUpdateResult>;
    openExternal(url: string): Promise<{ ok: boolean }>;
    openWorkspace(): Promise<{ ok: boolean; error?: string }>;
    revealPath(
      relativePath: string,
    ): Promise<{ ok: boolean; error?: string }>;
    setActiveJobs(count: number): Promise<{ ok: boolean }>;
    flashFrame(): Promise<{ ok: boolean }>;
    notifyJob(payload: { title: string; body: string }): Promise<{
      ok: boolean;
    }>;
  }

  interface Window {
    licenseAPI?: LicenseAPI;
  }
}
