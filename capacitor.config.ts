import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.jueliu.mobile",
  appName: "掘流",
  webDir: "dist/mobile",
  server: {
    androidScheme: "https",
    cleartext: true,
  },
  ios: {
    contentInset: "automatic",
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
