export interface CopyImageInput {
  slot: number;
  label: string;
  url: string;
}

export interface CopyImagesResult {
  count: number;
  total: number;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function toPng(blob: Blob): Promise<Blob | null> {
  if (blob.type === "image/png") return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/png");
    });
  } catch {
    return null;
  }
}

function copyHtmlFallback(html: string): boolean {
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.innerHTML = html;
  holder.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;";
  document.body.appendChild(holder);
  try {
    const range = document.createRange();
    range.selectNodeContents(holder);
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    holder.remove();
    window.getSelection()?.removeAllRanges();
  }
}

export async function copyImagesToClipboard(
  items: CopyImageInput[],
): Promise<CopyImagesResult> {
  if (items.length === 0) throw new Error("没有可复制的参考图");
  const loaded: { item: CopyImageInput; blob: Blob }[] = [];
  for (const item of items) {
    try {
      const res = await fetch(item.url, { cache: "no-store" });
      if (!res.ok) continue;
      loaded.push({ item, blob: await res.blob() });
    } catch {
      // 单张缺失时继续复制其余图片。
    }
  }
  if (loaded.length === 0) throw new Error("参考图读取失败");

  const dataUrls = await Promise.all(
    loaded.map((entry) => blobToDataUrl(entry.blob)),
  );
  const text = loaded
    .map((entry) => `图${entry.item.slot}：${entry.item.label}`)
    .join("\n");
  const html = `<div>${loaded
    .map(
      (entry, index) =>
        `<p>图${entry.item.slot}：${escapeHtml(entry.item.label)}</p>` +
        `<p><img src="${dataUrls[index]}" alt="图${entry.item.slot}"></p>`,
    )
    .join("")}</div>`;

  if (
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  ) {
    try {
      const data: Record<string, Blob> = {
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      };
      const firstPng = await toPng(loaded[0].blob);
      if (firstPng) data["image/png"] = firstPng;
      await navigator.clipboard.write([new ClipboardItem(data)]);
      return { count: loaded.length, total: items.length };
    } catch {
      // 剪贴板 API 不可用时退回 execCommand。
    }
  }

  if (!copyHtmlFallback(html)) throw new Error("复制失败");
  return { count: loaded.length, total: items.length };
}
