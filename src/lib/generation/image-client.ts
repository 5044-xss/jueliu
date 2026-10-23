import { ApimartClient } from "./apimart";
import {
  ToApiClient,
  type CreateImageTaskInput,
  type ToApiTask,
  type WaitOptions,
} from "./toapi";

// 图像能力的协议分发：调用方只依赖 ImageClient，具体协议由设置或端点决定。

export type ImageApiProtocol = "toapis-image" | "apimart-image";

export interface ImageClient {
  uploadImage(filePath: string): Promise<string>;
  createImageTask(
    input: CreateImageTaskInput,
    signal?: AbortSignal,
  ): Promise<ToApiTask>;
  waitForImage(taskId: string, opts: WaitOptions): Promise<string>;
  downloadImage(url: string, signal?: AbortSignal): Promise<Buffer>;
  testConnection(): Promise<{ ok: boolean; status: number; detail?: string }>;
}

export interface CreateImageClientInput {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  /** 缺省时按端点推断。 */
  protocol?: ImageApiProtocol;
}

/** 显式协议优先；APIMart 端点只要没被显式标成 Toapi 就按 APIMart 处理。 */
export function resolveImageProtocol(
  protocol: ImageApiProtocol | undefined,
  baseUrl: string,
): ImageApiProtocol {
  if (protocol === "apimart-image") return "apimart-image";
  if (/apimart/i.test(baseUrl)) return "apimart-image";
  return protocol ?? "toapis-image";
}

export function createImageClient(input: CreateImageClientInput): ImageClient {
  const protocol = resolveImageProtocol(input.protocol, input.baseUrl);
  if (protocol === "apimart-image") {
    return new ApimartClient({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      timeoutMs: input.timeoutMs,
    });
  }
  return new ToApiClient({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    timeoutMs: input.timeoutMs,
  });
}
