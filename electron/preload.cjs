const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("licenseAPI", {
  getMachineId: () => ipcRenderer.invoke("get-machine-id"),
  getLicenseState: () => ipcRenderer.invoke("get-license-state"),
  checkin: () => ipcRenderer.invoke("checkin"),
  activate: (code) => ipcRenderer.invoke("activate", code),
  enterApp: () => ipcRenderer.invoke("enter-app"),
  resetLicense: () => ipcRenderer.invoke("reset-license"),
  onLicenseUpdate: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("license:update", listener);
    return () => ipcRenderer.removeListener("license:update", listener);
  },
  getVersion: () => ipcRenderer.invoke("get-version"),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openWorkspace: () => ipcRenderer.invoke("open-workspace"),
  revealPath: (relativePath) => ipcRenderer.invoke("reveal-path", relativePath),
  setActiveJobs: (count) => ipcRenderer.invoke("set-active-jobs", count),
  flashFrame: () => ipcRenderer.invoke("flash-frame"),
  notifyJob: (payload) => ipcRenderer.invoke("notify-job", payload),
});

contextBridge.exposeInMainWorld("desktopAPI", {
  media: {
    getPathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return "";
      }
    },
    importFile: (payload) => ipcRenderer.invoke("media:import", payload),
    importBuffer: (payload) => ipcRenderer.invoke("media:import-buffer", payload),
    remove: (relativePath) => ipcRenderer.invoke("media:remove", relativePath),
    openRoot: () => ipcRenderer.invoke("media:open-root"),
    openFolder: (payload) => ipcRenderer.invoke("media:open-folder", payload),
    reveal: (relativePath) => ipcRenderer.invoke("media:reveal", relativePath),
    url: async (relativePath) =>
      `jueman-media://media/${String(relativePath)
        .split("/")
        .filter(Boolean)
        .map(encodeURIComponent)
        .join("/")}`,
  },
  qc: {
    run: (input) => ipcRenderer.invoke("qc:run", input),
  },
  compose: {
    run: (input) => ipcRenderer.invoke("compose:run", input),
  },
  llm: {
    fetch: (payload) => ipcRenderer.invoke("llm:fetch", payload),
  },
});
