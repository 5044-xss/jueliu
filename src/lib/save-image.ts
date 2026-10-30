const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function saveImage(
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
  // 立即 revoke 可能让部分浏览器取消下载，留出启动时间。
  setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
}
