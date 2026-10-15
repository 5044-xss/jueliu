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
  timeoutMs = 10 * 60 * 1000,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, { windowsHide: true });
    let stderr = "";
    let done = false;
    // 卡死时强制结束进程（Windows 上用 taskkill 连子进程一起杀），避免任务永久 pending。
    const timer = setTimeout(() => {
      if (done) return;
      killProcessTree(child.pid);
      done = true;
      reject(new Error("ffmpeg 执行超时，已终止"));
    }, timeoutMs);
    child.stderr.on("data", (chunk) => {
      // 只保留末尾一段，避免长任务把 stderr 全量攒在内存里。
      stderr = (stderr + chunk.toString()).slice(-8000);
    });
    child.on("error", (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: code ?? 0, stderr });
    });
  });
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
      });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // 进程可能已退出
  }
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
