const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('skillerr', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
  on: (channel, fn) => ipcRenderer.on(channel, (_e, data) => fn(data)),
});
