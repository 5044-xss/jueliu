import { spawn, spawnSync } from "node:child_process";
import type { FfmpegStatus } from "@/lib/settings-shared";

export type { FfmpegStatus };

export function detectFfmpeg(binPath = "ffmpeg"): FfmpegStatus {
  const result = spawnSync(binPath, ["-version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) {
    return { available: false, path: binPath, error: result.error.message };
  }
  if (result.status !== 0) {
    return {
      available: false,
      path: binPath,
      error: (result.stderr || "ffmpeg exited with non-zero status").trim(),
    };
  }
  const firstLine = (result.stdout || "").split("\n")[0]?.trim();
  const version = firstLine?.match(/ffmpeg version (\S+)/)?.[1];
  return { available: true, path: binPath, version: version ?? firstLine };
}

export function runFfmpeg(
  binPath: string,
  args: string[],
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stderr }));
  });
}

export async function extractFrame(
  binPath: string,
  input: string,
  output: string,
  kind: "first" | "last",
): Promise<void> {
  // 尾帧：从结尾前 0.5s 的窗口里用 thumbnail 取「最具代表性」的一帧，
  // 避免直接取最后一帧时截到黑帧、淡出帧或下一镜的画面。
  const args =
    kind === "last"
      ? ["-y", "-sseof", "-0.5", "-i", input, "-vf", "thumbnail", "-frames:v", "1", "-q:v", "2", output]
      : ["-y", "-i", input, "-frames:v", "1", "-q:v", "2", output];
  const { code, stderr } = await runFfmpeg(binPath, args);
  if (code !== 0) {
    throw new Error(`ffmpeg 截帧失败：${stderr.split("\n").slice(-3).join(" ")}`);
  }
}
