import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Electron 主进程为 CommonJS，不适用 TS 的 import 规则
    "electron/**",
    "release/**",
    "build-resources/**",
    "resources/**",
    "keys/**",
    // 工作区产物与一次性脚本不入版本库，也不参与 lint
    "workspace/**",
  ]),
]);

export default eslintConfig;
