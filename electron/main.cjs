const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Menu,
  dialog,
  Notification,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");

const { getMachineCode } = require("./machine-id.cjs");
const { verifyLicense, loadLicense, saveLicense, clearLicense } = require("./license.cjs");

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_DEV_URL || "http://127.0.0.1:3000";
const REPO = "5044-xss/jueman";
const SKIP_LICENSE = process.env.SKIP_LICENSE === "1";

let mainWindow = null;
let activationWindow = null;
let serverProcess = null;
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

function licensePath() {
  return path.join(app.getPath("userData"), "license.key");
}

function workspaceDir() {
  if (!isDev) return path.join(app.getPath("userData"), "workspace");
  const configured = process.env.WORKSPACE_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), "workspace");
}

function ffmpegPath() {
  if (!isDev) {
    const bundled = path.join(process.resourcesPath, "ffmpeg", "ffmpeg.exe");
    if (fs.existsSync(bundled)) return bundled;
  }
  const local = path.join(process.resourcesPath || "", "ffmpeg", "ffmpeg.exe");
  if (fs.existsSync(local)) return local;
  return "ffmpeg";
}

function appIconPath() {
  const candidates = [
    path.join(process.resourcesPath || "", "appicon.png"),
    path.join(__dirname, "..", "public", "appicon.png"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || undefined;
}

function standaloneDir() {
  return path.join(process.resourcesPath, "app.asar.unpacked", ".next", "standalone");
}

async function bootstrap() {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId("com.5044.jueman");
  registerIpc();

  if (isDev || SKIP_LICENSE) {
    startApp();
    return;
  }

  const { code } = await getMachineCode();
  const saved = loadLicense(licensePath());
  if (saved) {
    const result = verifyLicense(saved, code);
    if (result.ok) {
      startApp();
      return;
    }
    clearLicense(licensePath());
  }
  showActivation();
}

function registerIpc() {
  ipcMain.handle("get-machine-id", async () => {
    const { code, display } = await getMachineCode();
    return { code, display };
  });

  ipcMain.handle("activate", async (_event, licenseCode) => {
    const { code } = await getMachineCode();
    const result = verifyLicense(licenseCode, code);
    if (!result.ok) return { ok: false, error: result.error };
    saveLicense(licensePath(), licenseCode);
    setTimeout(() => {
      if (activationWindow && !activationWindow.isDestroyed()) activationWindow.close();
      startApp();
    }, 400);
    return { ok: true };
  });

  ipcMain.handle("reset-license", () => {
    forceQuit = true;
    clearLicense(licensePath());
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    mainWindow = null;
    showActivation();
    return { ok: true };
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
    const title = typeof payload?.title === "string" ? payload.title : "掘漫";
    const body = typeof payload?.body === "string" ? payload.body : "";
    try {
      new Notification({ title, body, icon: appIconPath() }).show();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle("check-update", async () => {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/releases/latest`,
        {
          headers: {
            "User-Agent": "Jueman-Desktop",
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

function createWindow(url) {
  forceQuit = false;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#0b0b0f",
    icon: appIconPath(),
    title: "掘漫",
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
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(false);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(url);
  return mainWindow;
}

function showActivation() {
  if (activationWindow && !activationWindow.isDestroyed()) {
    activationWindow.focus();
    return;
  }
  activationWindow = new BrowserWindow({
    width: 560,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    backgroundColor: "#0b0b0f",
    icon: appIconPath(),
    title: "掘漫 · 激活",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  activationWindow.once("ready-to-show", () => activationWindow.show());
  activationWindow.on("closed", () => {
    activationWindow = null;
  });
  activationWindow.loadFile(path.join(__dirname, "activation.html"));
}

async function startApp() {
  if (isDev) {
    createWindow(DEV_URL);
    return;
  }
  try {
    const port = await findFreePort();
    await startServer(port);
    createWindow(`http://127.0.0.1:${port}`);
  } catch (error) {
    dialog.showErrorBox("启动失败", String(error.message || error));
    app.quit();
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function startServer(port) {
  const dir = standaloneDir();
  const serverEntry = path.join(dir, "server.js");
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`未找到内置服务器：${serverEntry}`);
  }

  // 不把宿主机的 LLM 相关环境变量透传给内置服务，避免买家的 key 被本机环境变量覆盖/回显。
  const childEnv = { ...process.env };
  for (const key of ["DASHSCOPE_API_KEY", "dashscope", "MODENAME", "modename"]) {
    delete childEnv[key];
  }
  Object.assign(childEnv, {
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    JUMAN_BUNDLED: "1",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    WORKSPACE_DIR: workspaceDir(),
    FFMPEG_PATH: ffmpegPath(),
  });

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: dir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
  serverProcess.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
  serverProcess.on("exit", (code) => {
    serverProcess = null;
    if (code !== 0 && code !== null && mainWindow) {
      dialog.showErrorBox("服务已退出", `内置服务器异常退出（code ${code}）。`);
    }
  });

  return waitForServer(port, 30000);
}

function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() > deadline) {
        reject(new Error(`服务器启动超时（端口 ${port}）`));
        return;
      }
      const req = http.get(
        { host: "127.0.0.1", port, path: "/", timeout: 2000 },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on("error", () => setTimeout(attempt, 300));
      req.on("timeout", () => {
        req.destroy();
        setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  forceQuit = true;
  stopServer();
});
