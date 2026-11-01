import { useEffect, useState, useSyncExternalStore } from "react";
import { localLicense } from "./service";
import type { LocalLicenseState } from "./service";

const DESKTOP_LOADING: LocalLicenseState = {
  phase: "loading",
  status: "none",
  allowed: false,
  message: "正在校验授权…",
  error: null,
  product: "jueliu",
  deviceCode: null,
  deviceDisplay: null,
  sn: null,
  nbf: null,
  exp: null,
  features: [],
  code: null,
  trialTotalDays: null,
  trialLeftDays: null,
  trialTotalHours: null,
  trialLeftHours: null,
  offline: false,
  warning: null,
};

function fromDesktop(state: LicenseState | null): LocalLicenseState {
  if (!state) return DESKTOP_LOADING;
  return {
    phase: state.phase,
    status: state.status === "error" ? "invalid" : (state.status ?? "none"),
    allowed: state.allowed,
    message: state.message,
    error: state.error ?? (state.allowed ? null : state.message),
    product: "jueliu",
    deviceCode: state.machineCode,
    deviceDisplay: state.machineDisplay,
    sn: state.sn,
    nbf: state.nbf,
    exp: state.exp,
    features: [],
    code: null,
    trialTotalDays: state.trialTotalDays,
    trialLeftDays: state.trialLeftDays,
    trialTotalHours: state.trialTotalHours,
    trialLeftHours: state.trialLeftHours,
    offline: state.offline,
    warning: state.warning,
  };
}

function useDesktopLicense(): LocalLicenseState {
  const [state, setState] = useState<LocalLicenseState>(DESKTOP_LOADING);

  useEffect(() => {
    const api = window.licenseAPI;
    if (!api) return;
    let alive = true;
    api
      .getLicenseState()
      .then((next) => {
        if (alive) setState(fromDesktop(next));
      })
      .catch(() => undefined);
    const off = api.onLicenseUpdate((next) => {
      if (alive) setState(fromDesktop(next));
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  return state;
}

export function useLicense() {
  const desktop = useDesktopLicense();
  const local = useSyncExternalStore(
    localLicense.subscribe,
    localLicense.getState,
    localLicense.getState,
  );

  useEffect(() => {
    if (!window.licenseAPI) void localLicense.start();
  }, []);

  return window.licenseAPI ? desktop : local;
}
