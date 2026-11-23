'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  scan: () => ipcRenderer.invoke('scan'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  addRoot: () => ipcRenderer.invoke('add-root'),
  remove: (paths, opts) => ipcRenderer.invoke('remove', { paths, ...opts }),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (on) => ipcRenderer.invoke('set-autostart', on),
  quit: () => ipcRenderer.invoke('quit'),
  onScan: (cb) => ipcRenderer.on('scan-updated', (_e, data) => cb(data)),
});
