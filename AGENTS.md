# 掘流开发约定

- 桌面端、移动端和 Web 端共用 `src/spa` 的 Vite + React 应用。
- 业务数据保存在本地 IndexedDB，服务端只负责鉴权与必要的 LLM 转发。
- Next.js 已从运行时移除，不要再引入 `next` 依赖或 `src/app` 目录。
- 提交前运行 `npm run typecheck`、`npm run lint`、`npm run build:app:desktop`。
