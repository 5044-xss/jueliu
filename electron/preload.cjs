const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("licenseAPI", {
  getMachineId: () => ipcRenderer.invoke("get-machine-id"),
  activate: (code) => ipcRenderer.invoke("activate", code),
  resetLicense: () => ipcRenderer.invoke("reset-license"),
  getVersion: () => ipcRenderer.invoke("get-version"),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openWorkspace: () => ipcRenderer.invoke("open-workspace"),
  revealPath: (relativePath) => ipcRenderer.invoke("reveal-path", relativePath),
  setActiveJobs: (count) => ipcRenderer.invoke("set-active-jobs", count),
  flashFrame: () => ipcRenderer.invoke("flash-frame"),
  notifyJob: (payload) => ipcRenderer.invoke("notify-job", payload),
});
