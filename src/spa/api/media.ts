import { db } from "../storage/db";
import type { MediaRecord } from "../storage/types";
import { projectRepository } from "../storage/projects";
import { libraryRepository } from "../storage/library";
import { mediaRepository } from "../storage/media";
import { findSegment, findViewById } from "./helpers";

const blobUrls = new Map<string, string>();
const resolvedPaths = new Map<string, Promise<string | null>>();

function hasDesktopFiles(): boolean {
  return Boolean(
    typeof window !== "undefined" && window.desktopAPI?.media?.url,
  );
}

export async function directMediaUrl(
  record: MediaRecord,
): Promise<string | null> {
  const cached = blobUrls.get(record.id);
  if (cached) return cached;
  if (record.storage === "file" && record.relativePath) {
    const api = window.desktopAPI?.media;
    if (api) return api.url(record.relativePath);
  }
  if (record.blob) {
    const url = URL.createObjectURL(record.blob);
    blobUrls.set(record.id, url);
    return url;
  }
  if (record.storage === "file" && record.relativePath && hasDesktopFiles()) {
    return (await window.desktopAPI?.media.url(record.relativePath)) ?? null;
  }
  return null;
}

export async function mediaBlob(record: MediaRecord): Promise<Blob | null> {
  if (record.blob) return record.blob;
  if (record.storage === "file" && record.relativePath) {
    const url = await directMediaUrl(record);
    if (!url) return null;
    try {
      const res = await originalFetch(url);
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }
  return null;
}

export async function mediaResponse(
  record: MediaRecord,
  request?: Request,
): Promise<Response> {
  if (record.storage === "file" && record.relativePath) {
    const url = await directMediaUrl(record);
    if (url) {
      try {
        const res = await originalFetch(url, {
          headers: request?.headers,
        });
        if (res.ok) {
          return new Response(res.body, {
            status: res.status,
            headers: {
              "Content-Type":
                res.headers.get("Content-Type") || record.mime,
              "Cache-Control": "no-store",
              ...(res.headers.get("Content-Range")
                ? { "Content-Range": res.headers.get("Content-Range")! }
                : {}),
              ...(res.headers.get("Accept-Ranges")
                ? { "Accept-Ranges": res.headers.get("Accept-Ranges")! }
                : {}),
            },
          });
        }
      } catch {
        // fall through to blob
      }
    }
  }
  const blob = await mediaBlob(record);
  if (!blob) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": record.mime || blob.type || "application/octet-stream",
    "Cache-Control": "no-store",
  };
  return new Response(blob, { status: 200, headers });
}

async function mediaIdFromSegmentVideo(
  projectId: string,
  segmentId: string,
): Promise<string | null> {
  const doc = await projectRepository.loadProject(projectId);
  if (!doc) return null;
  const found = findSegment(doc, segmentId);
  if (!found) return null;
  return (
    doc.videoBindings?.[segmentId] ??
    found.segment.videoPath ??
    null
  );
}

export async function resolveMediaPath(
  pathname: string,
  searchParams: URLSearchParams,
): Promise<MediaRecord | null> {
  let match = pathname.match(
    /^\/api\/projects\/([^/]+)\/segments\/([^/]+)\/video$/,
  );
  if (match) {
    const mediaId = await mediaIdFromSegmentVideo(match[1], match[2]);
    return mediaId ? ((await db.media.get(mediaId)) ?? null) : null;
  }
  match = pathname.match(
    /^\/api\/projects\/([^/]+)\/assets\/views\/([^/]+)\/image$/,
  );
  if (match) {
    const projectId = match[1];
    const doc = await projectRepository.loadProject(projectId);
    if (!doc) return null;
    const found = findViewById(doc, match[2]);
    return found?.view.imagePath
      ? ((await db.media.get(found.view.imagePath)) ?? null)
      : null;
  }
  match = pathname.match(/^\/api\/projects\/([^/]+)\/frames\/([^/]+)\/image$/);
  if (match) {
    const doc = await projectRepository.loadProject(match[1]);
    const frame = doc?.frames?.find((item) => item.id === match![2]);
    return frame?.imagePath
      ? ((await db.media.get(frame.imagePath)) ?? null)
      : null;
  }
  match = pathname.match(
    /^\/api\/projects\/([^/]+)\/segments\/([^/]+)\/ref-uploads\/([^/]+)$/,
  );
  if (match) {
    const doc = await projectRepository.loadProject(match[1]);
    const mediaId = doc?.refUploads?.[match[3]];
    return mediaId ? ((await db.media.get(mediaId)) ?? null) : null;
  }
  match = pathname.match(
    /^\/api\/projects\/([^/]+)\/compositions\/([^/]+)\/video$/,
  );
  if (match) {
    const doc = await projectRepository.loadProject(match[1]);
    const composition = doc?.compositions?.find(
      (item) => item.id === match![2],
    );
    return composition?.mediaId
      ? ((await db.media.get(composition.mediaId)) ?? null)
      : null;
  }
  match = pathname.match(/^\/api\/library\/assets\/([^/]+)\/image$/);
  if (match) {
    const scope = searchParams.get("scope") === "project" ? "project" : "global";
    const seriesId = searchParams.get("seriesId");
    const items = await libraryRepository.listAssets(scope, seriesId);
    const item = items.find((entry) => entry.id === match![1]);
    return item?.mediaId ? ((await db.media.get(item.mediaId)) ?? null) : null;
  }
  return null;
}

export function resolveMediaUrl(pathname: string): Promise<string | null> {
  const existing = resolvedPaths.get(pathname);
  if (existing) return existing;
  const task = (async () => {
    const url = new URL(pathname, window.location.origin);
    const record = await resolveMediaPath(url.pathname, url.searchParams);
    if (!record) return null;
    return directMediaUrl(record);
  })();
  resolvedPaths.set(pathname, task);
  // 解析失败不能永久缓存：回传/截帧等操作后同一路径可能重新可用。
  void task.then(
    (url) => {
      if (!url) resolvedPaths.delete(pathname);
    },
    () => {
      resolvedPaths.delete(pathname);
    },
  );
  return task;
}

export function invalidateSegmentVideoUrls(
  projectId: string,
  segmentId: string,
): void {
  const base = `/api/projects/${projectId}/segments/${segmentId}/video`;
  for (const key of [...resolvedPaths.keys()]) {
    if (key === base || key.startsWith(`${base}?`)) {
      resolvedPaths.delete(key);
    }
  }
}

let bridgeInstalled = false;

function rewriteElement(element: Element): void {
  const mediaElement = element as
    | HTMLImageElement
    | HTMLVideoElement
    | HTMLSourceElement;
  for (const attr of ["src", "poster"] as const) {
    const raw = element.getAttribute(attr);
    if (!raw || !raw.startsWith("/api/")) continue;
    if (element.getAttribute(`data-jl-${attr}`) === raw) continue;
    element.setAttribute(`data-jl-${attr}`, raw);
    const hashIndex = raw.indexOf("#");
    const hash = hashIndex >= 0 ? raw.slice(hashIndex) : "";
    const path = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
    void resolveMediaUrl(path).then((url) => {
      if (!url) return;
      element.setAttribute(attr, `${url}${hash}`);
      if (
        attr === "src" &&
        element instanceof HTMLVideoElement &&
        hash.startsWith("#t=")
      ) {
        const seconds = Number(hash.slice(3));
        const seek = () => {
          if (Number.isFinite(seconds)) {
            try {
              element.currentTime = seconds;
            } catch {
              // ignore
            }
          }
          element.removeEventListener("loadedmetadata", seek);
        };
        element.addEventListener("loadedmetadata", seek);
      }
      void mediaElement;
    });
  }
  if (element instanceof HTMLAnchorElement) {
    const href = element.getAttribute("href");
    if (href && href.startsWith("/api/")) {
      const download = /[?&]download=1/.test(href);
      element.setAttribute("data-jl-href", href);
      void resolveMediaUrl(href).then((url) => {
        if (!url) return;
        element.setAttribute("href", url);
        if (download) {
          element.setAttribute("download", "video.mp4");
        }
      });
    }
  }
}

function scan(root: ParentNode): void {
  if (root instanceof Element) rewriteElement(root);
  root
    .querySelectorAll?.(
      'img[src^="/api/"], video[src^="/api/"], source[src^="/api/"], a[href^="/api/"], [poster^="/api/"]',
    )
    .forEach((element) => rewriteElement(element));
}

export function installMediaBridge(): void {
  if (bridgeInstalled || typeof window === "undefined") return;
  bridgeInstalled = true;
  scan(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        rewriteElement(mutation.target as Element);
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) scan(node);
      }
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "poster", "href"],
  });
}

export function clearMediaUrlCache(): void {
  for (const url of blobUrls.values()) URL.revokeObjectURL(url);
  blobUrls.clear();
  resolvedPaths.clear();
}

export { mediaRepository };

let originalFetchRef: typeof fetch | null = null;
export function captureOriginalFetch(fetchImpl: typeof fetch): void {
  originalFetchRef = fetchImpl;
}
export function originalFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!originalFetchRef) return window.fetch(input, init);
  return originalFetchRef(input, init);
}
