export const DESKTOP = __DESKTOP__;
export const MOBILE = __MOBILE__;

export const capabilities = {
  desktop: DESKTOP,
  mobile: MOBILE,
  qc: DESKTOP,
  compose: DESKTOP,
  ffmpeg: DESKTOP,
  license: true,
  workspace: DESKTOP,
  desktopNotifications: DESKTOP,
} as const;

export type Capability = keyof typeof capabilities;
