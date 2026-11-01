/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __DESKTOP__: boolean;
declare const __MOBILE__: boolean;
declare const __APP_VERSION__: string;

interface Window {
  __JUELIU_SPA__?: boolean;
}
