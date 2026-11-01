import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const isDesktop = mode === "desktop";
  const isMobile = mode === "mobile";
  const outDir = isDesktop
    ? "dist/desktop"
    : isMobile
      ? "dist/mobile"
      : "dist/web";

  return {
    base: "./",
    plugins: [
      react(),
      VitePWA({
        disable: isDesktop,
        registerType: "autoUpdate",
        includeAssets: ["icons/*.png"],
        manifest: {
          name: "掘流",
          short_name: "掘流",
          description: "本地 AI 剧本与分镜提示词工作台",
          theme_color: "#0b0b0f",
          background_color: "#0b0b0f",
          display: "standalone",
          start_url: "./",
          icons: [
            {
              src: "icons/icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "icons/icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          navigateFallback: "index.html",
          globPatterns: [
            "**/*.{js,css,html,svg,ico,woff2,webmanifest}",
            "icons/*.png",
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@core": path.resolve(import.meta.dirname, "packages/core/src"),
      },
    },
    define: {
      __DESKTOP__: JSON.stringify(isDesktop),
      __MOBILE__: JSON.stringify(isMobile),
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.1.7"),
    },
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: true,
      target: "es2020",
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api/license": {
          target: "http://101.43.46.217",
          changeOrigin: true,
        },
      },
    },
  };
});
