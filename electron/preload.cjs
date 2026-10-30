const { contextBridge, ipcRenderer } = require("electron");

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
