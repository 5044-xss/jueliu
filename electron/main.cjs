const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Menu,
  dialog,
  Notification,
  powerMonitor,
  protocol,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { spawn } = require("node:child_process");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "jueman-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const { getMachineCode } = require("./machine-id.cjs");
const { createLicenseService } = require("./license.cjs");

const isDev = !app.isPackaged;
// 保持历史数据目录不变：原始安装包使用 jueman 作为 userData 目录。
app.setPath("userData", path.join(app.getPath("appData"), "jueman"));
const SPA_DEV_URL = process.env.SPA_DEV_URL || "http://127.0.0.1:5173";
const REPO = "5044-xss/jueliu";
const SKIP_LICENSE = process.env.SKIP_LICENSE === "1";

function localUiEntry() {
  return path.join(__dirname, "..", "dist", "desktop", "index.html");
}

let mainWindow = null;
let activationWindow = null;
let licenseService = null;
let startingApp = null;
let activeJobCount = 0;
let forceQuit = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(bootstrap);
}

function workspaceDir() {
  if (!isDev) return path.join(app.getPath("userData"), "workspace");
  const configured = process.env.WORKSPACE_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), "workspace");
}

function mediaRoot() {
  return path.join(app.getPath("userData"), "media");
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function safeProjectId(value) {
  const id = String(value || "");
  if (!SAFE_ID.test(id)) throw new Error("非法的项目 id");
  return id;
}

function resolveMediaPath(relativePath) {
  const relative = String(relativePath || "").replace(/\\/g, "/");
  if (!relative || relative.startsWith("/") || relative.includes("../")) {
    throw new Error("非法的素材路径");
  }
  const root = path.resolve(mediaRoot());
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("非法的素材路径");
  }
  return target;
}

const MEDIA_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

function mimeOf(file) {
  return MEDIA_MIME[path.extname(file).slice(1).toLowerCase()] || "application/octet-stream";
}

function registerMediaProtocol() {
  protocol.handle("jueman-media", async (request) => {
    try {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const file = resolveMediaPath(relative);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return new Response("Not found", { status: 404 });
      }
      const stat = fs.statSync(file);
      const mime = mimeOf(file);
      const range = request.headers.get("range");
      let start = 0;
      let end = stat.size - 1;
      let status = 200;
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        if (match) {
          const s = match[1] ? Number(match[1]) : 0;
          const e = match[2] ? Number(match[2]) : stat.size - 1;
          if (s >= 0 && s < stat.size && e >= s) {
            start = s;
            end = Math.min(e, stat.size - 1);
            status = 206;
          }
        }
      }
      const stream = Readable.toWeb(
        fs.createReadStream(file, { start, end }),
      );
      const headers = {
        "Content-Type": mime,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers":
          "Content-Range, Accept-Ranges, Content-Length",
      };
      if (status === 206) {
        headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
      }
      return new Response(stream, { status, headers });
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
  });
}

function importMedia(payload) {
  const projectId = safeProjectId(payload?.projectId);
  const name = String(payload?.name || "未命名文件");
  const mime = String(payload?.mime || "application/octet-stream");
  const id = crypto.randomUUID();
  const ext =
    path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 8) ||
    (mime.startsWith("image/") ? ".png" : ".mp4");
  const dir = path.join(mediaRoot(), projectId);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${id}${ext}`);
  if (payload?.sourcePath) {
    fs.copyFileSync(payload.sourcePath, dest);
  } else if (payload?.buffer) {
    fs.writeFileSync(dest, Buffer.from(payload.buffer));
  } else {
    throw new Error("缺少文件内容");
  }
  const stat = fs.statSync(dest);
  return {
    id,
    relativePath: path.relative(mediaRoot(), dest).split(path.sep).join("/"),
    name,
    mime,
    size: stat.size,
    createdAt: new Date().toISOString(),
  };
}

function runFfmpeg(args, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("ffmpeg 执行超时"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-8000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-16000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

function parseFfmpegInfo(stderr) {
  const durationMatch = stderr.match(
    /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/,
  );
  const videoMatch = stderr.match(
    /Stream #[^\n]*Video:\s*([A-Za-z0-9_-]+)[^\n]*?(\d{2,5})x(\d{2,5})/,
  );
  const fpsMatch = stderr.match(/(\d+(?:\.\d+)?)\s*fps/);
  let durationMs = null;
  if (durationMatch) {
    const [, h, m, s] = durationMatch;
    durationMs = Math.round(
      (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000,
    );
  }
  return {
    durationMs,
    width: videoMatch ? Number(videoMatch[2]) : null,
    height: videoMatch ? Number(videoMatch[3]) : null,
    codec: videoMatch ? videoMatch[1] : null,
    fps: fpsMatch ? Number(fpsMatch[1]) : null,
    hasAudio: /Stream #[^\n]*Audio:/.test(stderr),
  };
}

async function runQc(relativePath) {
  const file = resolveMediaPath(relativePath);
  if (!fs.existsSync(file)) throw new Error("视频文件不存在");
  const stat = fs.statSync(file);
  const result = await runFfmpeg(
    ["-hide_banner", "-i", file],
    30_000,
  ).catch((error) => ({ code: 1, stdout: "", stderr: String(error.message) }));
  const info = parseFfmpegInfo(result.stderr);
  const warnings = [];
  if (!info.durationMs) warnings.push("无法读取时长");
  if (!info.codec) warnings.push("无法读取视频流");
  if (!info.hasAudio) warnings.push("没有音频轨");
  return {
    ok: Boolean(info.durationMs && info.codec),
    ...info,
    size: stat.size,
    warnings,
  };
}

function ffmpegConcatLine(file) {
  return `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

async function runComposeSimple(payload) {
  const projectId = safeProjectId(payload?.projectId);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const files = items.map((item) => resolveMediaPath(item?.relativePath));
  if (files.length === 0) throw new Error("请选择至少一个视频");
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error("素材文件不存在");
  }

  const id = crypto.randomUUID();
  const outputDir = path.join(mediaRoot(), projectId, "exports");
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, `${id}.mp4`);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jueman-compose-"));
  const listFile = path.join(tempDir, "list.txt");
  fs.writeFileSync(
    listFile,
    files.map(ffmpegConcatLine).join("\n"),
    "utf8",
  );

  try {
    const copy = await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ]);
    if (copy.code !== 0 || !fs.existsSync(output)) {
      const encode = await runFfmpeg([
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        output,
      ]);
      if (encode.code !== 0 || !fs.existsSync(output)) {
        throw new Error(
          `合成失败：${(encode.stderr || copy.stderr).slice(-500)}`,
        );
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const stat = fs.statSync(output);
  return {
    id,
    relativePath: path.relative(mediaRoot(), output).split(path.sep).join("/"),
    name: `合成-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.mp4`,
    mime: "video/mp4",
    size: stat.size,
    createdAt: new Date().toISOString(),
  };
}

function escapeFilterPath(file) {
  return file
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,");
}

function srtTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

function buildSrt(cues) {
  const lines = [];
  let index = 1;
  for (const cue of cues) {
    const text = String(cue?.text || "").replace(/\s+/g, " ").trim();
    const start = Number(cue?.startMs);
    const end = Number(cue?.endMs);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    lines.push(String(index++), `${srtTime(start)} --> ${srtTime(end)}`, text, "");
  }
  return lines.join("\n");
}

async function runCompose(payload) {
  const transition = String(payload?.transition || "none");
  const transitionMs = Math.max(0, Number(payload?.transitionMs) || 0);
  const cues = Array.isArray(payload?.cues) ? payload.cues : [];
  const subtitles = payload?.subtitles === true && cues.length > 0;
  if (transition === "none" && !subtitles) {
    return runComposeSimple(payload);
  }

  const projectId = safeProjectId(payload?.projectId);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const files = items.map((item) => resolveMediaPath(item?.relativePath));
  if (files.length === 0) throw new Error("请选择至少一个视频");
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error("素材文件不存在");
  }

  const probes = [];
  for (const file of files) {
    const result = await runFfmpeg(["-hide_banner", "-i", file], 30_000).catch(
      (error) => ({ code: 1, stdout: "", stderr: String(error.message || error) }),
    );
    const info = parseFfmpegInfo(result.stderr);
    const durationMs = info.durationMs || 0;
    probes.push({ ...info, durationMs: Math.max(durationMs, 100) });
  }

  const width =
    Number(payload?.width) ||
    probes.find((probe) => probe.width)?.width ||
    1280;
  const height =
    Number(payload?.height) ||
    probes.find((probe) => probe.height)?.height ||
    720;
  const fps = 24;
  const parts = [];
  const labels = [];
  for (let i = 0; i < files.length; i += 1) {
    const probe = probes[i];
    parts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v${i}]`,
    );
    if (probe.hasAudio) {
      parts.push(
        `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`,
      );
    } else {
      parts.push(
        `anullsrc=r=48000:cl=stereo,atrim=0:${(probe.durationMs / 1000).toFixed(3)}[a${i}]`,
      );
    }
    labels.push({ v: `[v${i}]`, a: `[a${i}]` });
  }

  let videoLabel;
  let audioLabel;
  if (files.length === 1) {
    videoLabel = labels[0].v;
    audioLabel = labels[0].a;
  } else if (transition === "none") {
    const concatInputs = labels.map((label) => `${label.v}${label.a}`).join("");
    parts.push(
      `${concatInputs}concat=n=${labels.length}:v=1:a=1[cv][ca]`,
    );
    videoLabel = "[cv]";
    audioLabel = "[ca]";
  } else {
    const minDuration = Math.min(...probes.map((probe) => probe.durationMs));
    let duration = transitionMs / 1000;
    duration = Math.min(duration, Math.max(0.1, minDuration / 3000));
    duration = Math.max(0.1, duration);
    let prevV = labels[0].v;
    let prevA = labels[0].a;
    let cursor = probes[0].durationMs / 1000;
    for (let i = 1; i < labels.length; i += 1) {
      const nextV = `[vx${i}]`;
      const nextA = `[ax${i}]`;
      const offset = Math.max(0, cursor - duration);
      parts.push(
        `${prevV}${labels[i].v}xfade=transition=${transition}:duration=${duration.toFixed(3)}:offset=${offset.toFixed(3)}${nextV}`,
      );
      parts.push(
        `${prevA}${labels[i].a}acrossfade=d=${duration.toFixed(3)}:c1=tri:c2=tri${nextA}`,
      );
      cursor = cursor + probes[i].durationMs / 1000 - duration;
      prevV = nextV;
      prevA = nextA;
    }
    videoLabel = prevV;
    audioLabel = prevA;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jueman-compose-"));
  let subtitlePath = null;
  try {
    let finalVideo = videoLabel;
    if (subtitles) {
      subtitlePath = path.join(tempDir, "subtitles.srt");
      fs.writeFileSync(subtitlePath, buildSrt(cues), "utf8");
      const style =
        "FontName=Microsoft YaHei,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=1,Shadow=0,MarginV=18";
      parts.push(
        `${videoLabel}subtitles=filename='${escapeFilterPath(subtitlePath)}':force_style='${style}'[vout]`,
      );
      finalVideo = "[vout]";
    }
    const outputDir = path.join(mediaRoot(), projectId, "exports");
    fs.mkdirSync(outputDir, { recursive: true });
    const id = crypto.randomUUID();
    const output = path.join(outputDir, `${id}.mp4`);
    const result = await runFfmpeg([
      "-y",
      ...files.flatMap((file) => ["-i", file]),
      "-filter_complex",
      parts.join(";"),
      "-map",
      finalVideo,
      "-map",
      audioLabel,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      output,
    ]);
    if (result.code !== 0 || !fs.existsSync(output)) {
      throw new Error(`合成失败：${(result.stderr || "").slice(-500)}`);
    }
    const stat = fs.statSync(output);
    return {
      id,
      relativePath: path.relative(mediaRoot(), output).split(path.sep).join("/"),
      name: `合成-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.mp4`,
      mime: "video/mp4",
      size: stat.size,
      createdAt: new Date().toISOString(),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function ffmpegPath() {
  if (!isDev) {
    const bundled = path.join(process.resourcesPath, "ffmpeg", "ffmpeg.exe");
    if (fs.existsSync(bundled)) return bundled;
  }
  const local = path.join(process.resourcesPath || "", "ffmpeg", "ffmpeg.exe");
  if (fs.existsSync(local)) return local;
  const repo = path.join(__dirname, "..", "resources", "ffmpeg", "ffmpeg.exe");
  if (fs.existsSync(repo)) return repo;
  return "ffmpeg";
}

function appIconPath() {
  const candidates = [
    path.join(process.resourcesPath || "", "appicon.png"),
    path.join(__dirname, "..", "public", "appicon.png"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || undefined;
}

async function bootstrap() {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId("com.5044.jueman");

  licenseService = createLicenseService({
    userDataDir: app.getPath("userData"),
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    onUpdate: handleLicenseUpdate,
  });

  registerIpc();
  registerMediaProtocol();

  powerMonitor.on("resume", () => {
    if (!isDev && !SKIP_LICENSE) void licenseService?.poke();
  });
  powerMonitor.on("unlock-screen", () => {
    if (!isDev && !SKIP_LICENSE) void licenseService?.poke();
  });

  try {
    if (isDev || SKIP_LICENSE) {
      if (!SKIP_LICENSE) void licenseService.start();
      await startApp();
      return;
    }

    const state = await Promise.race([
      licenseService.start(),
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (state && state.allowed) {
      await startApp();
    } else {
      showActivation();
    }
  } catch (error) {
    dialog.showErrorBox("启动失败", String(error.message || error));
    app.quit();
  }
}

function handleLicenseUpdate(state) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("license:update", state);
  }

  if (isDev || SKIP_LICENSE || !licenseService) return;
  if (!state || state.phase !== "ready" || state.allowed) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  showActivation();
  forceQuit = true;
  const win = mainWindow;
  mainWindow = null;
  win.close();
}

function registerIpc() {
  ipcMain.handle("get-machine-id", async () => {
    const { code, display } = await getMachineCode();
    return { code, display };
  });

  ipcMain.handle("get-license-state", () => licenseService.getState());

  ipcMain.handle("checkin", () => licenseService.refresh({ manual: true }));

  ipcMain.handle("activate", async (_event, licenseCode) => {
    const result = await licenseService.activate(licenseCode);
    if (result.ok) {
      await startApp();
      if (activationWindow && !activationWindow.isDestroyed()) activationWindow.close();
    }
    return result;
  });

  ipcMain.handle("enter-app", async () => {
    const state = licenseService.getState();
    if (!state.allowed) {
      return { ok: false, error: state.message || "当前授权不可用" };
    }
    await startApp();
    if (activationWindow && !activationWindow.isDestroyed()) activationWindow.close();
    return { ok: true };
  });

  ipcMain.handle("reset-license", () => {
    const state = licenseService.reset();
    showActivation();
    if (mainWindow && !mainWindow.isDestroyed()) {
      forceQuit = true;
      const win = mainWindow;
      mainWindow = null;
      win.close();
    }
    return { ok: true, state };
  });

  ipcMain.handle("get-version", () => app.getVersion());

  ipcMain.handle("open-external", (_event, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle("open-workspace", async () => {
    try {
      const dir = workspaceDir();
      fs.mkdirSync(dir, { recursive: true });
      const error = await shell.openPath(dir);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });

  ipcMain.handle("reveal-path", async (_event, relativePath) => {
    if (typeof relativePath !== "string" || !relativePath.trim()) {
      return { ok: false, error: "缺少路径" };
    }
    try {
      const root = path.resolve(workspaceDir());
      const target = path.resolve(root, relativePath);
      if (target !== root && !target.startsWith(root + path.sep)) {
        return { ok: false, error: "非法路径" };
      }
      if (!fs.existsSync(target)) return { ok: false, error: "文件不存在" };
      if (fs.statSync(target).isDirectory()) {
        const error = await shell.openPath(target);
        return error ? { ok: false, error } : { ok: true };
      }
      shell.showItemInFolder(target);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });

  ipcMain.handle("set-active-jobs", (_event, count) => {
    activeJobCount = Number.isFinite(count)
      ? Math.max(0, Math.floor(count))
      : 0;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(activeJobCount > 0 ? 2 : -1);
    }
    return { ok: true };
  });

  ipcMain.handle("flash-frame", () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
      mainWindow.flashFrame(true);
    }
    return { ok: true };
  });

  ipcMain.handle("notify-job", (_event, payload) => {
    if (!Notification.isSupported()) return { ok: false };
    const title = typeof payload?.title === "string" ? payload.title : "掘流";
    const body = typeof payload?.body === "string" ? payload.body : "";
    try {
      new Notification({ title, body, icon: appIconPath() }).show();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle("media:import", (_event, payload) => importMedia(payload));

  ipcMain.handle("media:import-buffer", (_event, payload) =>
    importMedia(payload),
  );

  ipcMain.handle("media:remove", (_event, relativePath) => {
    try {
      const file = resolveMediaPath(relativePath);
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });

  ipcMain.handle("media:open-root", async () => {
    try {
      const dir = mediaRoot();
      fs.mkdirSync(dir, { recursive: true });
      const error = await shell.openPath(dir);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });

  ipcMain.handle("media:open-folder", async (_event, payload) => {
    try {
      const projectId = safeProjectId(payload?.projectId);
      const subpath = String(payload?.subpath || "")
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "");
      const root = path.resolve(mediaRoot());
      const target = path.resolve(root, projectId, subpath);
      if (target !== root && !target.startsWith(root + path.sep)) {
        return { ok: false, error: "非法路径" };
      }
      fs.mkdirSync(target, { recursive: true });
      const error = await shell.openPath(target);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });

  ipcMain.handle("media:reveal", async (_event, relativePath) => {
    try {
      const file = resolveMediaPath(relativePath);
      if (!fs.existsSync(file)) return { ok: false, error: "文件不存在" };
      shell.showItemInFolder(file);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });

  ipcMain.handle("qc:run", async (_event, input) => {
    try {
      return await runQc(input?.relativePath);
    } catch (error) {
      return {
        ok: false,
        durationMs: null,
        width: null,
        height: null,
        codec: null,
        fps: null,
        hasAudio: false,
        size: 0,
        warnings: [],
        error: String(error.message || error),
      };
    }
  });

  ipcMain.handle("compose:run", async (_event, input) => {
    try {
      return await runCompose(input);
    } catch (error) {
      throw new Error(String(error.message || error));
    }
  });

  ipcMain.handle("llm:fetch", async (_event, payload) => {
    const url = String(payload?.url || "");
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: "非法的请求地址" };
    }
    try {
      const res = await fetch(url, {
        method: String(payload?.method || "POST"),
        headers:
          payload?.headers && typeof payload.headers === "object"
            ? payload.headers
            : undefined,
        body:
          payload?.body === undefined || payload?.body === null
            ? undefined
            : String(payload.body),
        signal: AbortSignal.timeout(
          Math.max(5000, Number(payload?.timeoutMs) || 300000),
        ),
      });
      const text = await res.text();
      return {
        ok: true,
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: text,
      };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });

  ipcMain.handle("check-update", async () => {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/releases/latest`,
        {
          headers: {
            "User-Agent": "Jueliu-Desktop",
            Accept: "application/vnd.github+json",
          },
        },
      );
      const current = app.getVersion();
      // 404：仓库尚无任何 Release，视为「暂无更新」，不是错误。
      if (res.status === 404) {
        return { ok: true, current, latest: current, url: null, hasUpdate: false, note: "暂无发布版本" };
      }
      // 403/429：GitHub 未授权接口限流，属于临时状况，给友好提示而非报错。
      if (res.status === 403 || res.status === 429) {
        return { ok: false, error: "检查太频繁了，请稍后再试" };
      }
      if (!res.ok) return { ok: false, error: `检查更新失败（HTTP ${res.status}）` };
      const data = await res.json();
      const latest = String(data.tag_name || "").replace(/^v/i, "");
      return {
        ok: true,
        current,
        latest,
        url: data.html_url,
        hasUpdate: compareVersions(latest, current) > 0,
      };
    } catch {
      return { ok: false, error: "网络异常，请稍后再试" };
    }
  });
}

function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function preloadPath() {
  return path.join(__dirname, "preload.cjs");
}

function createWindow(url, isFile = false) {
  forceQuit = false;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#0b0b0f",
    icon: appIconPath(),
    title: "掘流",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    if (forceQuit || activeJobCount <= 0) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["继续等待", "退出并中断"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: "任务还在运行",
      message: `还有 ${activeJobCount} 个任务正在运行`,
      detail: "关闭窗口会中断这些任务。建议等待任务完成后再关闭。",
    });
    if (choice === 0) {
      event.preventDefault();
      mainWindow.show();
      mainWindow.focus();
    } else {
      forceQuit = true;
    }
  });
  mainWindow.on("focus", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.flashFrame(false);
      if (!isDev && !SKIP_LICENSE) void licenseService?.poke();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  if (isFile) mainWindow.loadFile(url);
  else mainWindow.loadURL(url);
  return mainWindow;
}

function showActivation() {
  if (activationWindow && !activationWindow.isDestroyed()) {
    activationWindow.focus();
    return;
  }
  activationWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    resizable: true,
    minimizable: true,
    maximizable: true,
    show: false,
    backgroundColor: "#f7f7f5",
    icon: appIconPath(),
    title: "掘流 · 激活",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  activationWindow.once("ready-to-show", () => activationWindow.show());
  activationWindow.on("focus", () => {
    if (!isDev && !SKIP_LICENSE) void licenseService?.poke();
  });
  activationWindow.on("closed", () => {
    activationWindow = null;
  });
  activationWindow.loadFile(path.join(__dirname, "activation.html"));
}

async function startApp() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  if (startingApp) return startingApp;

  startingApp = (async () => {
    if (isDev) {
      createWindow(SPA_DEV_URL);
      return;
    }
    const entry = localUiEntry();
    if (!fs.existsSync(entry)) {
      throw new Error(`未找到本地界面：${entry}`);
    }
    createWindow(entry, true);
  })();

  try {
    await startingApp;
  } finally {
    startingApp = null;
  }
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  forceQuit = true;
  licenseService?.stop();
});
