export const LICENSE_PRODUCT =
  (import.meta.env.VITE_LICENSE_PRODUCT as string | undefined)?.trim() ||
  "jueliu";

export const LICENSE_CODE_KEY = "jueliu.license.code";
export const LICENSE_CHECKIN_KEY = "jueliu.license.checkin";
export const INSTALL_ID_KEY = "jueliu.install.id";

export const LICENSE_API_BASE =
  (import.meta.env.VITE_LICENSE_API as string | undefined)?.trim() ||
  (import.meta.env.VITE_LICENSE_API_BASE as string | undefined)?.trim() ||
  "http://101.43.46.217";

export const TRUSTED_PUBLIC_KEYS = [
  import.meta.env.VITE_LICENSE_PUBLIC_KEY as string | undefined,
  "MCowBQYDK2VwAyEAV3Y7o43+5FnPWh3YQ4ayKl40LQSer1t3om4NzLoDKYY=",
  "MCowBQYDK2VwAyEAxQWPcOpM9+q0THXDXe58YU0If79KHvMuHnGzduoqz0o=",
].filter((value): value is string => Boolean(value && value.trim()));
