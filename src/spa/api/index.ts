import { captureOriginalFetch } from "./media";
import { handleLocalApi, maybeServeMedia } from "./local-api";

let installed = false;

function filePathname(url: URL): string {
  if (url.protocol !== "file:") return url.pathname;
  return url.pathname.replace(/^\/[A-Za-z]:\//, "/");
}

function localRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: URL,
): Request {
  if (input instanceof Request) {
    if (input.url === url.href) return input;
    return new Request(url.href, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      mode: input.mode,
      credentials: input.credentials,
      cache: input.cache,
      redirect: input.redirect,
      referrer: input.referrer,
      referrerPolicy: input.referrerPolicy,
      integrity: input.integrity,
      keepalive: input.keepalive,
      signal: input.signal,
    });
  }
  return new Request(url.href, init);
}

export function installLocalApi(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  captureOriginalFetch(original);

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const raw = input instanceof Request ? input.url : String(input);
    let url: URL;
    try {
      url = new URL(raw, window.location.origin);
    } catch {
      return original(input, init);
    }

    const pathname = filePathname(url);
    const sameOrigin =
      url.origin === window.location.origin ||
      (url.protocol === "file:" && window.location.protocol === "file:");
    if (!sameOrigin || !pathname.startsWith("/api/")) {
      return original(input, init);
    }

    let request: Request;
    try {
      const base = url.protocol === "file:" ? "file://" : url.origin;
      request = localRequest(
        input,
        init,
        new URL(pathname + url.search, base),
      );
    } catch {
      return original(input, init);
    }

    const clone = request.clone();
    const handled = await handleLocalApi(request);
    if (handled) return handled;
    const media = await maybeServeMedia(clone);
    if (media) return media;
    return new Response(JSON.stringify({ error: "接口不存在" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  };
}
