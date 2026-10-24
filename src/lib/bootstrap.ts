import path from "node:path";
import { configureCore, registerDbExtensions } from "@core/server/setup";
import { ensureColumn, type Db } from "@core/server/db/extensions";
import { registerGenerationSettings } from "@/lib/generation/settings";
import { installServerProxyFetch } from "@/lib/server-fetch";
import { registerProviderSettings } from "@/lib/settings/providers-server";

// jueman 的启动引导：在首次触碰 DB / settings 之前完成三个接缝。
// 幂等，可从 instrumentation 与各路由安全重复调用。
let done = false;

export function ensureCore(): void {
  if (done) return;
  done = true;

  const workspaceDir =
    process.env.WORKSPACE_DIR?.trim() || path.join(process.cwd(), "workspace");
  const ffmpegPath = process.env.FFMPEG_PATH?.trim();
  configureCore(ffmpegPath ? { workspaceDir, ffmpegPath } : { workspaceDir });

  // 接缝0：让 Node 出站请求遵守系统代理（APIMart 等境外接口必需）。
  installServerProxyFetch();

  // 接缝A：为 segment 增生成列（幂等）。
  registerDbExtensions({
    migrations: [
      {
        id: "jueman-gen-columns-v1",
        up: (db: Db) => {
          ensureColumn(db, "segment", "gen_task_id", "gen_task_id TEXT");
          ensureColumn(db, "segment", "gen_status", "gen_status TEXT");
          ensureColumn(db, "segment", "gen_params", "gen_params TEXT");
        },
      },
      {
        id: "jueman-composition-subtitles-v1",
        up: (db: Db) => {
          ensureColumn(
            db,
            "composition",
            "subtitles",
            "subtitles INTEGER NOT NULL DEFAULT 0",
          );
        },
      },
    ],
  });

  // 接缝C：产品设置段。
  registerGenerationSettings();
  registerProviderSettings();
}

export { ensureCore as bootstrap };
