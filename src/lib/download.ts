"use client";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * 把同源图片 URL 触发为浏览器下载（尾帧/起始画面要拿去第三方平台上传）。
 * 扩展名按响应的 MIME 推断，避免和实际文件格式对不上。
 */
export async function downloadImage(
  url: string,
  baseName: string,
): Promise<void> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("下载失败");
  const blob = await res.blob();
  const ext = EXT_BY_MIME[blob.type] ?? "png";
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `${baseName}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
