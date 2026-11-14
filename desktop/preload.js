// الجسر بين صفحات دفترة كاشير وويندوز: window.cashierDesktop (يقرؤه src/core/app.js عند البدء)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cashierDesktop', {
  info: () => ipcRenderer.invoke('info'),
});
