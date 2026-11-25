const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gt', {
  correct: (p) => ipcRenderer.invoke('gt:correct', p),
  getSettings: () => ipcRenderer.invoke('gt:settings:get'),
  saveSettings: (p) => ipcRenderer.invoke('gt:settings:set', p),
  close: () => ipcRenderer.send('gt:close'),
  copy: (t) => ipcRenderer.send('gt:copy', t),
  replace: (t) => ipcRenderer.send('gt:replace', t),
  onSelection: (cb) => ipcRenderer.on('gt:selection', (_e, t) => cb(t)),
  onFocusInput: (cb) => ipcRenderer.on('gt:focus-input', () => cb()),
  checkUpdate: () => ipcRenderer.invoke('gt:update:check'),
  applyUpdate: (m) => ipcRenderer.invoke('gt:update:apply', m),
  relaunch: () => ipcRenderer.invoke('gt:update:relaunch'),
  onUpdateProgress: (cb) => ipcRenderer.on('gt:update:progress', (_e, p) => cb(p))
})
