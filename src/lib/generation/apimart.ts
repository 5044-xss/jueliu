import fs from "node:fs";
import path from "node:path";
import type {
  CreateImageTaskInput,
  ToApiTask,
  ToApiTaskStatus,
  WaitOptions,
} from "./toapi";

// APIMart 异步图像接口的最小 Node 客户端。
// 链路与 Toapi 一致：上传参考图 → 提交任务 → 轮询 → 取结果 URL → 下载。
// 文档：https://docs.apimart.ai（base 用 https://api.apimart.ai/v1）。
// 与 Toapi 的差异：
//  - 参考图字段是 image_urls（Toapi 是 reference_images）
//  - 提交返回 { code, data: [{ task_id, status }] }
//  - 轮询走 /tasks/{id}，结果在 data.result.images[0].url[0]
//  - 上传返回扁平 { url }（Toapi 是 { success, data: { url } }）

export interface ApimartConfig {
  /** 含版本段，例如 https://api.apimart.ai/v1 。 */
  baseUrl: string;
  apiKey: string;
  /** 单次 HTTP 请求超时（毫秒）。 */
  timeoutMs?: number;
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
  const b = body as {
    message?: unknown;
    error?: unknown;
    data?: { error?: { message?: unknown } };
  };
  const raw =
    b.message ??
    b.error ??
    b.data?.error?.message;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "message" in raw) {
    return String((raw as { message: unknown }).message);
  }
  return JSON.stringify(body);
}

function mapStatus(status: unknown): ToApiTaskStatus {
  switch (String(status ?? "").toLowerCase()) {
    case "completed":
    case "succeeded":
    case "success":
      return "completed";
    case "failed":
    case "failure":
    case "cancelled":
    case "canceled":
      return "failed";
    case "processing":
    case "in_progress":
    case "running":
      return "in_progress";
    default:
      return "queued";
  }
}

/** 兼容 images[0].url 为字符串或字符串数组两种返回。 */
function firstImageUrl(result: unknown): string | undefined {
  const images = (result as { images?: unknown } | null)?.images;
  if (!Array.isArray(images) || images.length === 0) return undefined;
  const url = (images[0] as { url?: unknown } | null)?.url;
  if (typeof url === "string") return url;
  if (Array.isArray(url)) {
    const found = url.find((item): item is string => typeof item === "string");
    if (found) return found;
  }
  return undefined;
}

export class ApimartClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(cfg: ApimartConfig) {
    if (!cfg.baseUrl || !cfg.baseUrl.trim()) {
      throw new Error("缺少 APIMart 接口地址（baseUrl）");
    }
    if (!cfg.apiKey || !cfg.apiKey.trim()) {
      throw new Error("缺少 APIMart API Key，请先在设置里填写");
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

  /** 上传本地图片，返回可直接用于生成接口的 URL（72 小时有效）。 */
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
      url?: string;
      data?: { url?: string };
      error?: { message?: string };
      message?: string;
    } | null;
    const url = body?.url ?? body?.data?.url;
    if (!res.ok || !url) {
      throw new Error(
        `上传参考图失败（HTTP ${res.status}）：${errorText(body)}`,
      );
    }
    return url;
  }

  /** 提交图像生成任务，返回任务对象（含 id）。 */
  async createImageTask(
    input: CreateImageTaskInput,
    signal?: AbortSignal,
  ): Promise<ToApiTask> {
    const refs = input.reference_images?.filter(Boolean) ?? [];
    const payload = {
      model: input.model,
      prompt: input.prompt,
      n: input.n ?? 1,
      ...(input.size ? { size: input.size } : {}),
      ...(input.resolution ? { resolution: input.resolution } : {}),
      ...(refs.length ? { image_urls: refs } : {}),
    };
    const res = await this.request("/images/generations", {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
      signal,
    });
    const body = (await res.json().catch(() => null)) as {
      code?: number;
      data?: unknown;
      message?: string;
      error?: unknown;
    } | null;
    if (!res.ok) {
      throw new Error(
        `提交图像任务失败（HTTP ${res.status}）：${errorText(body)}`,
      );
    }
    const data = body?.data;
    const item = (Array.isArray(data) ? data[0] : data) as
      | { task_id?: string; id?: string; status?: string }
      | undefined;
    const id = item?.task_id ?? item?.id;
    if (!id) {
      throw new Error(`提交图像任务返回异常：${JSON.stringify(body)}`);
    }
    return {
      id,
      object: "image.generation",
      model: input.model,
      status: mapStatus(item?.status ?? "submitted"),
      created_at: Math.floor(Date.now() / 1000),
    };
  }

  async getImageTask(taskId: string, signal?: AbortSignal): Promise<ToApiTask> {
    const res = await this.request(
      `/tasks/${encodeURIComponent(taskId)}?language=zh`,
      { method: "GET", headers: this.authHeaders(), signal },
    );
    const body = (await res.json().catch(() => null)) as {
      data?: unknown;
      id?: string;
      status?: string;
      progress?: number;
      created?: number;
      result?: unknown;
      error?: { message?: string } | string | null;
      message?: string;
    } | null;
    if (!res.ok || !body) {
      throw new Error(`查询图像任务失败（HTTP ${res.status}）：${errorText(body)}`);
    }
    const data = (body.data ?? body) as {
      id?: string;
      status?: string;
      progress?: number;
      created?: number;
      result?: unknown;
      error?: { message?: string } | string | null;
    };
    const status = mapStatus(data.status);
    return {
      id: data.id ?? taskId,
      object: "image.generation",
      status,
      progress: data.progress,
      created_at: data.created,
      result:
        status === "completed"
          ? { data: [{ url: firstImageUrl(data.result) }] }
          : null,
      error: data.error ?? null,
    };
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
