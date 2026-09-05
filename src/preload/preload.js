'use strict';
// 渲染进程唯一的对外出口。contextIsolation 开着，渲染层拿不到 Node，
// 只能走这里列出的这些调用。

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('ferry', {
  bootstrap: () => invoke('app:bootstrap'),

  onState: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('push:state', h);
    return () => ipcRenderer.removeListener('push:state', h);
  },
  onLogs: (cb) => {
    const h = (_e, batch) => cb(batch);
    ipcRenderer.on('push:logs', h);
    return () => ipcRenderer.removeListener('push:logs', h);
  },

  logs: {
    all: () => invoke('log:all'),
    clear: () => invoke('log:clear'),
    export: () => invoke('log:export')
  },

  frpc: {
    start: () => invoke('frpc:start'),
    stop: () => invoke('frpc:stop'),
    restart: () => invoke('frpc:restart'),
    apply: () => invoke('frpc:apply'),
    test: (payload) => invoke('frpc:test', payload),
    locate: () => invoke('frpc:locate')
  },

  tunnels: {
    add: (t) => invoke('tunnel:add', t),
    update: (id, patch) => invoke('tunnel:update', { id, patch }),
    remove: (id) => invoke('tunnel:remove', id),
    toggle: (id) => invoke('tunnel:toggle', id),
    stopAll: () => invoke('tunnel:stopAll')
  },

  settings: {
    patch: (p) => invoke('settings:patch', p)
  },

  config: {
    export: () => invoke('config:export'),
    import: () => invoke('config:import'),
    reveal: () => invoke('config:reveal')
  },

  win: {
    show: () => invoke('window:show'),
    hidePanel: () => invoke('window:hidePanel'),
    panelHeight: (h) => invoke('window:panelHeight', h),
    quit: () => invoke('app:quit')
  },

  onboardDone: () => invoke('onboard:done')
});
