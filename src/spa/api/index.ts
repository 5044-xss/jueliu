import { captureOriginalFetch } from "./media";
import { handleLocalApi, maybeServeMedia } from "./local-api";

let installed = false;

export function installLocalApi(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  captureOriginalFetch(original);

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    let request: Request;
    try {
      request = input instanceof Request && !init ? input : new Request(input, init);
    } catch {
      return original(input, init);
    }
    const url = new URL(request.url, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
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
