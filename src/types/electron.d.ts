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

  interface DesktopMediaImportPayload {
    projectId: string;
    name: string;
    mime: string;
    kind: "image" | "video" | "file";
  }

  interface DesktopMediaImportResult {
    id: string;
    relativePath: string;
    name: string;
    mime: string;
    size: number;
    createdAt: string;
  }

  interface DesktopQcResult {
    ok: boolean;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    codec: string | null;
    fps: number | null;
    hasAudio: boolean;
    size: number;
    warnings: string[];
    error?: string;
  }

  interface DesktopComposeResult extends DesktopMediaImportResult {
    durationMs?: number | null;
  }

  interface DesktopMediaAPI {
    getPathForFile(file: File): string;
    importFile(
      payload: DesktopMediaImportPayload & { sourcePath: string },
    ): Promise<DesktopMediaImportResult>;
    importBuffer(
      payload: DesktopMediaImportPayload & { buffer: ArrayBuffer },
    ): Promise<DesktopMediaImportResult>;
    remove(relativePath: string): Promise<{ ok: boolean; error?: string }>;
    openRoot(): Promise<{ ok: boolean; error?: string }>;
    openFolder(payload: {
      projectId: string;
      subpath?: string;
    }): Promise<{ ok: boolean; error?: string }>;
    reveal(relativePath: string): Promise<{ ok: boolean; error?: string }>;
    url(relativePath: string): Promise<string>;
  }

  interface DesktopQCAPI {
    run(input: { relativePath: string }): Promise<DesktopQcResult>;
  }

  interface DesktopComposeAPI {
    run(input: {
      projectId: string;
      items: { relativePath: string }[];
      transition?: string;
      transitionMs?: number;
      subtitles?: boolean;
      cues?: { startMs: number; endMs: number; text: string }[];
      width?: number;
      height?: number;
    }): Promise<DesktopComposeResult>;
  }

  interface DesktopLlmAPI {
    fetch(payload: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      timeoutMs?: number;
    }): Promise<{
      ok: boolean;
      status?: number;
      headers?: Record<string, string>;
      body?: string;
      error?: string;
    }>;
  }

  interface DesktopAPI {
    media: DesktopMediaAPI;
    qc: DesktopQCAPI;
    compose: DesktopComposeAPI;
    llm: DesktopLlmAPI;
  }

  interface Window {
    licenseAPI?: LicenseAPI;
    desktopAPI?: DesktopAPI;
  }
}
