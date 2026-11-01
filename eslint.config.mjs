import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  {
    ignores: [
      "dist/**",
      "release/**",
      "release-local/**",
      "build-resources/**",
      "resources/**",
      "keys/**",
      "electron/**",
      "android/**",
      "ios/**",
      "workspace/**",
    ],
  },
  tseslint.configs.base,
  {
    files: ["src/**/*.{ts,tsx}", "packages/**/*.ts", "tests/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
