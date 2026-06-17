'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:set', s),
  getDeals: (limit) => ipcRenderer.invoke('deals:get', limit),
  getStatus: () => ipcRenderer.invoke('status:get'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
});
