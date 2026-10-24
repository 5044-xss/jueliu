import { execFileSync } from "node:child_process";
import {
  EnvHttpProxyAgent,
  fetch as undiciFetch,
  type Dispatcher,
} from "undici";

// Node 内置 fetch 不读取 Windows 系统代理，APIMart 等境外接口在开了代理的机器上会
// 直接连不上（fetch failed / Request timed out）。这里显式接管出站请求：
// 优先环境变量，其次 Windows「Internet 选项」代理。

const BASE_NO_PROXY = ["localhost", "127.0.0.1", "::1", "local"];
const INTERNET_SETTINGS =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

interface ProxyConfig {
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
}

function normalizeProxy(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
}

function readRegistryValue(name: string): string | null {
  try {
    const output = execFileSync("reg", ["query", INTERNET_SETTINGS, "/v", name], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = new RegExp(
      `${name}\\s+REG_(?:SZ|DWORD|EXPAND_SZ)\\s+(.+)`,
      "i",
    ).exec(output);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function splitProxyServer(server: string): { http: string; https: string } {
  if (!server.includes("=")) {
    const url = normalizeProxy(server);
    return { http: url, https: url };
  }
  const entries = new Map<string, string>();
  for (const part of server.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    entries.set(
      part.slice(0, index).trim().toLowerCase(),
      part.slice(index + 1).trim(),
    );
  }
  const http = normalizeProxy(entries.get("http") ?? entries.get("https") ?? "");
  const https = normalizeProxy(entries.get("https") ?? entries.get("http") ?? "");
  return { http, https };
}

function envProxyConfig(): ProxyConfig | null {
  const https = normalizeProxy(
    process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy ||
      "",
  );
  const http =
    normalizeProxy(process.env.HTTP_PROXY || process.env.http_proxy || "") ||
    https;
  if (!http && !https) return null;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || "";
  return {
    httpProxy: http || https,
    httpsProxy: https || http,
    noProxy: [noProxy, ...BASE_NO_PROXY].filter(Boolean).join(","),
  };
}

function windowsProxyConfig(): ProxyConfig | null {
  if (process.platform !== "win32") return null;
  if (readRegistryValue("ProxyEnable") !== "0x1") return null;
  const server = readRegistryValue("ProxyServer");
  if (!server) return null;
  const { http, https } = splitProxyServer(server);
  if (!http && !https) return null;
  const rawBypass = readRegistryValue("ProxyOverride") ?? "";
  const bypass = rawBypass
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item === "<local>" ? ".local" : item))
    // undici 只支持精确域名与后缀匹配，复杂通配交给代理端规则处理。
    .filter((item) => !item.includes("*") || item.startsWith("*."))
    .map((item) => item.replace(/^\*?\./, ""));
  return {
    httpProxy: http || https,
    httpsProxy: https || http,
    noProxy: [...bypass, ...BASE_NO_PROXY].join(","),
  };
}

let cached: { dispatcher: Dispatcher | null; proxy: string | null } | null =
  null;

/** 当前生效的代理（null 表示直连）。 */
export function getProxyDispatcher(): Dispatcher | null {
  if (cached) return cached.dispatcher;
  try {
    const config = envProxyConfig() ?? windowsProxyConfig();
    if (!config) {
      cached = { dispatcher: null, proxy: null };
      return null;
    }
    const dispatcher = new EnvHttpProxyAgent({
      httpProxy: config.httpProxy,
      httpsProxy: config.httpsProxy,
      noProxy: config.noProxy,
    });
    cached = {
      dispatcher,
      proxy: config.httpsProxy || config.httpProxy,
    };
    return dispatcher;
  } catch {
    cached = { dispatcher: null, proxy: null };
    return null;
  }
}

function isTlsPreflightError(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  const text = [
    (error as Error)?.message ?? "",
    cause?.message ?? "",
    cause?.code ?? "",
  ].join(" ");
  // 只重试“还没建立 TLS/连接”的错误：此时请求尚未发出，重试不会造成重复扣费。
  return /before secure TLS connection|Connect Timeout|UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(
    text,
  );
}

/** 统一出口：始终使用 undici fetch，并按需附带代理 dispatcher。 */
export async function serverFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const dispatcher = getProxyDispatcher();
  const options = {
    ...(init as object),
    ...(dispatcher ? { dispatcher } : {}),
  };
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return (await undiciFetch(
        input as never,
        options as never,
      )) as unknown as Response;
    } catch (error) {
      lastError = error;
      if (
        attempt >= 3 ||
        (error as Error)?.name === "AbortError" ||
        !isTlsPreflightError(error)
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  if ((lastError as Error)?.name === "AbortError") throw lastError;
  const cause = (lastError as { cause?: { code?: string; message?: string } })
    ?.cause;
  const detail = [cause?.code, cause?.message].filter(Boolean).join(" ");
  const message = (lastError as Error)?.message || "网络请求失败";
  throw new Error(
    detail ? `${message}（${detail}）` : message,
    { cause: lastError },
  );
}

/**
 * 接管全局 fetch，让 OpenAI SDK 等直接使用 globalThis.fetch 的库也走系统代理。
 * 非 HTTP(S) 与 Request 实例保持原样，避免破坏 Next 内部请求。
 */
export function installServerProxyFetch(): void {
  const dispatcher = getProxyDispatcher();
  if (!dispatcher) return;
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof Request !== "undefined" && input instanceof Request) {
      return original(input, init);
    }
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : "";
    if (!/^https?:\/\//i.test(url)) return original(input, init);
    return serverFetch(url, init);
  }) as typeof fetch;
}

// 客户端可能在 ensureCore 之前就被首次引用（例如设置页的连通性检测），
// 因此模块加载时也安装一次；函数内部幂等。
installServerProxyFetch();
