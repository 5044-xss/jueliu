import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // 严禁把本地工作区数据（含 API Key）、密钥、.env 追踪进 standalone 包。
  outputFileTracingExcludes: {
    "*": [
      "./workspace/**/*",
      "./keys/**/*",
      "./.env",
      "./.env.*",
      "./resources/**/*",
      "./release/**/*",
    ],
  },
};

export default nextConfig;
