// 从失败的响应里取出尽量有用的错误信息；取不到则退回到调用方给的兜底文案。
export async function readError(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const data = (await res.json()) as {
      error?: unknown;
      detail?: unknown;
    } | null;
    if (data && typeof data.error === "string" && data.error.trim()) {
      return data.error;
    }
    if (data && typeof data.detail === "string" && data.detail.trim()) {
      return data.detail;
    }
  } catch {
    // 响应不是 JSON（如网关 HTML 错误页），用兜底文案。
  }
  return fallback;
}
