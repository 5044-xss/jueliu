import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Electron dev loads the app from http://127.0.0.1:3000. Next 16 dev treats
  // that as a cross-origin request and blocks dev resources (/_next/hmr), which
  // stalls client hydration. Allow it explicitly.
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["better-sqlite3"],
  // 严禁把本地工作区数据（含 API Key）、密钥、.env 追踪进 standalone 包。
  outputFileTracingExcludes: {
    "/*": [
      "./workspace/**/*",
      "./keys/**/*",
      "./.env",
      "./.env.*",
      "./resources/**/*",
      "./release/**/*",
      "./release.zip",
      "./rb.log",
      "./docs/**/*",
    ],
  },
};

export default nextConfig;
