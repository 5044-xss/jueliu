import { Capacitor, CapacitorHttp } from "@capacitor/core";

// OpenCode Go 要求每个客户端在请求头中带上稳定的会话标识，否则会返回
// 400 MissingSessionID。其它服务商不需要这个头。
const OPENCODE_GO_ENDPOINT = /opencode\.ai\/(?:inference\/)?go\//;

let opencodeSessionId: string | null = null;

function getOpencodeSessionId(): string {
  if (!opencodeSessionId) {
    opencodeSessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  return opencodeSessionId;
}

function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

function withProviderHeaders(
  url: string,
  headers: HeadersInit | undefined,
): Record<string, string> {
  const next = headersToObject(headers);
  if (OPENCODE_GO_ENDPOINT.test(url)) {
    const hasSession = Object.keys(next).some(
      (key) => key.toLowerCase() === "x-opencode-session",
    );
    if (!hasSession) next["x-opencode-session"] = getOpencodeSessionId();
  }
  return next;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function nativeBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") return body ?? undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

// 移动端 WebView 直连第三方 LLM 会被 CORS 拦截（尤其是自定义请求头），
// 因此原生端统一走 CapacitorHttp，由系统网络栈发起请求。
async function nativeLlmFetch(
  url: string,
  init: RequestInit | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const result = await CapacitorHttp.request({
      url,
      method: (init?.method || "GET").toUpperCase(),
      headers,
      data: nativeBody(init?.body),
      connectTimeout: 30_000,
      readTimeout: 5 * 60 * 1000,
      responseType: "text",
    });
    const body =
      typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data ?? "");
    return new Response(body, {
      status: result.status,
      headers: result.headers,
    });
  } catch (error) {
    throw new Error(
      `网络请求失败：${(error as Error).message || "请检查网络或代理设置"}`,
    );
  }
}

export async function llmFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const api = window.desktopAPI?.llm;
  const url = urlOf(input);
  const headers = withProviderHeaders(
    url,
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (Capacitor.isNativePlatform()) {
    return nativeLlmFetch(url, init, headers);
  }
  if (!api) {
    return fetch(input, { ...init, headers });
  }
  const body =
    typeof init?.body === "string"
      ? init.body
      : init?.body === undefined || init?.body === null
        ? undefined
        : String(init.body);
  const result = await api.fetch({
    url,
    method: init?.method || "GET",
    headers,
    body,
    timeoutMs: 5 * 60 * 1000,
  });
  if (!result.ok) {
    throw new Error(result.error || "网络请求失败");
  }
  return new Response(result.body ?? "", {
    status: result.status ?? 200,
    headers: result.headers,
  });
}
