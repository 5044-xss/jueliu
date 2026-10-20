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

  interface LicenseAPI {
    getMachineId(): Promise<{ code: string; display: string }>;
    activate(code: string): Promise<{ ok: boolean; error?: string }>;
    resetLicense(): Promise<{ ok: boolean }>;
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
