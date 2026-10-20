import fs from "node:fs";
import path from "node:path";

// Toapi（ToAPIs）异步图像接口的最小 Node 客户端。
// 链路：上传参考图 → 提交图像任务 → 轮询 → 取结果 URL → 下载。
// 文档：https://docs.toapis.cn（国内 base 用 https://toapis.cn/v1）。

export interface ToApiConfig {
  /** 含版本段，例如 https://toapis.cn/v1 。 */
  baseUrl: string;
  apiKey: string;
  /** 单次 HTTP 请求超时（毫秒）。 */
  timeoutMs?: number;
}

export type ToApiTaskStatus = "queued" | "in_progress" | "completed" | "failed";

export interface ToApiImageItem {
  url?: string;
  b64_json?: string;
}

export interface ToApiTask {
  id: string;
  object?: string;
  model?: string;
  status: ToApiTaskStatus;
  progress?: number;
  created_at?: number;
  result?: { data?: ToApiImageItem[] } | null;
  error?: { message?: string } | string | null;
  fail_reason?: string | null;
  message?: string | null;
}

export interface CreateImageTaskInput {
  model: string;
  prompt: string;
  /** 比例，如 "9:16" / "1:1"。 */
  size?: string;
  /** 分辨率档位：1k / 2k / 4k。 */
  resolution?: string;
  n?: number;
  /** 参考图 URL 列表（需先用 uploadImage 拿到 URL）。 */
  reference_images?: string[];
}

export interface WaitOptions {
  intervalMs: number;
  timeoutMs: number;
  onProgress?: (task: ToApiTask) => void;
  /** 外部取消信号（取消出图）。 */
  signal?: AbortSignal;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function joinUrl(base: string, p: string): string {
  return `${base.replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(body: unknown): string {
  if (!body || typeof body !== "object") return "无返回内容";
  const b = body as { message?: unknown; error?: unknown; fail_reason?: unknown };
  const raw = b.message ?? b.error ?? b.fail_reason;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "message" in raw) {
    return String((raw as { message: unknown }).message);
  }
  return JSON.stringify(body);
}

export class ToApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(cfg: ToApiConfig) {
    if (!cfg.baseUrl || !cfg.baseUrl.trim()) {
      throw new Error("缺少 Toapi 接口地址（baseUrl）");
    }
    if (!cfg.apiKey || !cfg.apiKey.trim()) {
      throw new Error("缺少 Toapi API Key，请先在设置里填写");
    }
    this.baseUrl = cfg.baseUrl.trim();
    this.apiKey = cfg.apiKey.trim();
    this.timeoutMs = cfg.timeoutMs ?? 600_000;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, ...extra };
  }

  private async request(
    p: string,
    init: RequestInit,
    timeoutMs?: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs ?? this.timeoutMs,
    );
    // 外部取消信号（取消出图）与超时信号合并，任一触发即中断请求。
    const external = init.signal ?? undefined;
    const signal = external
      ? AbortSignal.any([controller.signal, external])
      : controller.signal;
    try {
      return await fetch(joinUrl(this.baseUrl, p), { ...init, signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** 上传本地图片，返回可直接用于生成接口的 URL。 */
  async uploadImage(filePath: string): Promise<string> {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME_BY_EXT[ext] ?? "image/png";
    const form = new FormData();
    form.append(
      "file",
      new Blob([buf], { type }),
      path.basename(filePath) || `image${ext || ".png"}`,
    );
    const res = await this.request("/uploads/images", {
      method: "POST",
      headers: this.authHeaders(),
      body: form,
    });
    const body = (await res.json().catch(() => null)) as {
      success?: boolean;
      data?: { url?: string };
      message?: string;
    } | null;
    if (!res.ok || !body?.success || !body.data?.url) {
      throw new Error(
        `上传参考图失败（HTTP ${res.status}）：${body?.message ?? "无返回内容"}`,
      );
    }
    return body.data.url;
  }

  /** 提交图像生成任务，返回任务对象（含 id）。 */
  async createImageTask(
    input: CreateImageTaskInput,
    signal?: AbortSignal,
  ): Promise<ToApiTask> {
    const res = await this.request("/images/generations", {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ n: 1, response_format: "url", ...input }),
      signal,
    });
    const body = (await res.json().catch(() => null)) as
      | ToApiTask
      | { message?: string }
      | null;
    if (!res.ok) {
      throw new Error(`提交图像任务失败（HTTP ${res.status}）：${errorText(body)}`);
    }
    if (!body || typeof (body as ToApiTask).id !== "string") {
      throw new Error(`提交图像任务返回异常：${JSON.stringify(body)}`);
    }
    return body as ToApiTask;
  }

  async getImageTask(taskId: string, signal?: AbortSignal): Promise<ToApiTask> {
    const res = await this.request(
      `/images/generations/${encodeURIComponent(taskId)}`,
      { method: "GET", headers: this.authHeaders(), signal },
    );
    const body = (await res.json().catch(() => null)) as ToApiTask | null;
    if (!res.ok || !body) {
      throw new Error(`查询图像任务失败（HTTP ${res.status}）：${errorText(body)}`);
    }
    return body;
  }

  /** 轮询直到完成，返回结果图 URL。 */
  async waitForImage(taskId: string, opts: WaitOptions): Promise<string> {
    const deadline = Date.now() + opts.timeoutMs;
    for (;;) {
      if (opts.signal?.aborted) throw new Error("已取消");
      const task = await this.getImageTask(taskId, opts.signal);
      opts.onProgress?.(task);
      if (task.status === "completed") {
        const url = task.result?.data?.find((d) => d.url)?.url;
        if (!url) {
          throw new Error(`任务已完成但未返回图片 URL：${JSON.stringify(task)}`);
        }
        return url;
      }
      if (task.status === "failed") {
        throw new Error(`图像生成失败：${errorText(task) || "未知原因"}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`图像生成超时（已等待 ${Math.round(opts.timeoutMs / 1000)}s）`);
      }
      await sleep(opts.intervalMs);
    }
  }

  /** 下载结果图到内存。结果 URL 在对象存储/CDN 上，无需鉴权。 */
  async downloadImage(url: string, signal?: AbortSignal): Promise<Buffer> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const res = await fetch(url, {
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    if (!res.ok) {
      throw new Error(`下载结果图失败（HTTP ${res.status}）`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /** 连接自检：GET /models。 */
  async testConnection(): Promise<{ ok: boolean; status: number; detail?: string }> {
    try {
      const res = await this.request(
        "/models",
        { method: "GET", headers: this.authHeaders() },
        20_000,
      );
      return { ok: res.ok, status: res.status };
    } catch (error) {
      return { ok: false, status: 0, detail: (error as Error).message };
    }
  }
}

/** 从结果 URL 推断图片扩展名（用于落盘命名）。 */
export function extFromUrl(url: string): string {
  const match = /\.(png|jpe?g|webp|gif)(?:\?|#|$)/i.exec(url);
  if (!match) return "png";
  const ext = match[1].toLowerCase();
  return ext === "jpeg" ? "jpg" : ext;
}
