'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Notification, nativeTheme, nativeImage, globalShortcut } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store } = require('./store');
const { LogBuffer } = require('./logbuf');
const { Frpc, probeLatency } = require('./frpc');
const { Metrics } = require('./metrics');
const { createTray, destroyTray } = require('./tray');
const toml = require('./toml');
const i18n = require('../shared/i18n');
const { t } = i18n;

app.name = 'Ferry';
app.setName('Ferry');

let store, logs, frpc, metrics, mainWindow, tray;
let quitting = false;

// —— 窗口 ——————————————————————————————————————————————

function createMainWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 600,
    show: false,
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 16, y: 16 }
        }
      : {
          autoHideMenuBar: true
        }),
    // 跟随系统外观选初始底色，避免加载完成前的一瞬间闪错主题。
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f2f2f3',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Dock tile 是窗口真正出现之后才建起来的，whenReady 里设的那次可能早于它，
  // 所以这里再设一次。
  mainWindow.once('ready-to-show', () => { mainWindow.show(); applyDockIcon(); });

  mainWindow.on('close', (e) => {
    // 「关闭窗口时退出」关掉的话，关窗只是把窗口藏起来，菜单栏图标还在。
    if (!quitting && !store.settings.quitOnClose) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// 打包后的 app 从 Info.plist 里的 icon.icns 拿图标，不需要这个。但 `npm start`
// 直接跑裸的 electron 二进制时，Dock 显示的是 electron 自己的原子 logo，得手动设。
// 而且每次 dock.show() 都会按 bundle 里的图标重建 Dock tile，把这里设过的图标冲掉
// —— 所以不是设一次就完事，show() 之后必须重设。
function applyDockIcon() {
  if (app.isPackaged || !app.dock) return;
  const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'resources', 'icon.png'));
  if (!img.isEmpty()) app.dock.setIcon(img);
}

function showMainWindow() {
  if (!mainWindow) createMainWindow();
  else { mainWindow.show(); mainWindow.focus(); }
  // dock.show() 是异步的，而且会按 bundle 里的图标重建 Dock tile。本来就显示着的时候
  // 调它，等于白白把图标冲回 electron 的原子 logo —— 所以只在真的被隐藏时才调，
  // 并且等它 resolve 之后再把图标设回来。
  if (app.dock && !app.dock.isVisible()) app.dock.show().then(applyDockIcon);
}

// —— 往渲染进程推 ————————————————————————————————————————

function windows() {
  const list = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  return list;
}

function broadcast(channel, payload) {
  for (const w of windows()) w.webContents.send(channel, payload);
}

// 隧道的展示态 = 本地配置 + frpc 的运行态 + （可选的）frps 面板计数。
function tunnelView() {
  const status = metrics.proxyStatus;
  const dash = metrics.dash && metrics.dash.ok ? metrics.dash.byName : null;
  return store.tunnels.map((tn) => {
    const st = status[tn.name];
    const d = dash ? dash[tn.name] : null;
    let state = t('st.stopped');
    let kind = 'off';
    if (tn.enabled) {
      if (!frpc.state.running) { state = t('st.notRunning'); kind = 'off'; }
      else if (!st) { state = t('st.waiting'); kind = 'pending'; }
      else if (st.status === 'running') { state = t('st.running'); kind = 'on'; }
      else if (st.status === 'start error' || st.status === 'check failed') {
        state = st.err ? st.err.split('\n')[0] : t('st.startFailed');
        kind = 'error';
      } else { state = st.status === 'new' || st.status === 'wait start' ? t('st.starting') : st.status; kind = 'pending'; }
    }
    return {
      ...tn,
      state,
      kind,
      remoteAddr: st ? st.remoteAddr : '',
      conns: d ? d.conns : null,
      up: d ? d.up : null,
      down: d ? d.down : null
    };
  });
}

function fullState() {
  return {
    frpc: frpc.state,
    tunnels: tunnelView(),
    metrics: {
      rate: metrics.rate,
      latency: metrics.avgLatency(),
      peakConns: metrics.peakConns,
      disconnects: metrics.disconnects,
      series: metrics.trafficSeries(),
      dashOk: !!(metrics.dash && metrics.dash.ok),
      dashError: metrics.dash ? metrics.dash.error : ''
    },
    settings: store.settings,
    // 界面用不着自己判断 'system' 到底是哪种语言，主进程解析好一起推下去。
    lang: i18n.getLang(),
    // 界面显示用的短路径（设计稿底栏写的就是 ~/Library/… 这种形态）。
    // 真实路径留在主进程，config:reveal 用它。
    configPath: store.configPath.replace(os.homedir(), '~')
  };
}

let pushTimer = null;
function startPushing() {
  pushTimer = setInterval(() => broadcast('push:state', fullState()), 1000);
  metrics.on('tick', () => broadcast('push:state', fullState()));
  frpc.on('state', () => broadcast('push:state', fullState()));
}

function notify(title, body) {
  if (!store.settings.notifyOnError || !Notification.isSupported()) return;
  new Notification({ title, body }).show();
}

// —— IPC ——————————————————————————————————————————————

function registerIpc() {
  ipcMain.handle('app:bootstrap', async () => ({
    ...fullState(),
    tunnelsRaw: store.tunnels,
    logs: logs.all(),
    appVersion: app.getVersion(),
    frpcVersion: await frpc.version(),
    frpcPath: frpc.resolveBinary(),
    onboarded: store.settings.onboarded
  }));

  ipcMain.handle('log:all', () => logs.all());
  ipcMain.handle('log:clear', () => { logs.clear(); return true; });
  ipcMain.handle('log:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: t('dlg.exportLog'),
      defaultPath: path.join(app.getPath('downloads'), `frpc-${new Date().toISOString().slice(0, 10)}.log`)
    });
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, logs.toText(), 'utf8');
    return { ok: true, filePath };
  });

  ipcMain.handle('frpc:start', () => frpc.start());
  ipcMain.handle('frpc:stop', async () => { await frpc.stop(); return { ok: true }; });
  ipcMain.handle('frpc:restart', () => frpc.restart());
  ipcMain.handle('frpc:apply', () => frpc.apply());

  // 引导页和设置页的「测试连接」：先看 TCP 端口通不通，
  // 再让 frpc 自己校验一遍这套参数能不能成配置。
  ipcMain.handle('frpc:test', async (_e, payload) => {
    const addr = payload.serverAddr;
    const port = Number(payload.serverPort) || 7000;
    if (!addr) return { ok: false, message: t('err.addrRequired') };
    const ms = await probeLatency(addr, port, 5000);
    if (ms == null) return { ok: false, message: t('test.unreachable', { addr, port }) };
    return { ok: true, message: t('test.ok', { addr, port, ms: Math.round(ms) }) };
  });

  ipcMain.handle('settings:patch', async (_e, patch) => {
    const before = store.settings;
    const needsRestart =
      ('serverAddr' in patch && patch.serverAddr !== before.serverAddr) ||
      ('serverPort' in patch && Number(patch.serverPort) !== Number(before.serverPort)) ||
      ('token' in patch && patch.token !== before.token) ||
      ('protocol' in patch && patch.protocol !== before.protocol) ||
      ('proxyUrl' in patch && patch.proxyUrl !== before.proxyUrl) ||
      ('logLevel' in patch && patch.logLevel !== before.logLevel);

    const next = store.patchSettings(patch);
    if ('language' in patch) i18n.setLang(i18n.resolve(next.language, app.getLocale()));
    if ('launchAtLogin' in patch) {
      app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin, openAsHidden: true });
    }
    broadcast('push:state', fullState());
    return { settings: next, needsRestart };
  });

  ipcMain.handle('tunnel:add', async (_e, t) => {
    const tunnel = store.addTunnel(t);
    const res = await frpc.apply();
    return { tunnel, ...res };
  });

  ipcMain.handle('tunnel:update', async (_e, { id, patch }) => {
    store.updateTunnel(id, patch);
    return frpc.apply();
  });

  ipcMain.handle('tunnel:remove', async (_e, id) => {
    store.removeTunnel(id);
    return frpc.apply();
  });

  ipcMain.handle('tunnel:toggle', async (_e, id) => {
    const t = store.tunnels.find((x) => x.id === id);
    if (!t) return { ok: false };
    store.updateTunnel(id, { enabled: !t.enabled });
    broadcast('push:state', fullState());
    return frpc.apply();
  });

  ipcMain.handle('tunnel:stopAll', async () => {
    for (const t of store.tunnels) store.updateTunnel(t.id, { enabled: false });
    broadcast('push:state', fullState());
    return frpc.apply();
  });

  ipcMain.handle('config:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: t('dlg.exportToml'),
      defaultPath: path.join(app.getPath('downloads'), 'frpc.toml')
    });
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, toml.stringify(store.settings, store.tunnels, store.admin), 'utf8');
    return { ok: true, filePath };
  });

  ipcMain.handle('config:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: t('dlg.importToml'),
      properties: ['openFile'],
      filters: [{ name: t('dlg.tomlFilter'), extensions: ['toml'] }]
    });
    if (canceled || !filePaths.length) return { ok: false };
    try {
      const parsed = toml.parse(fs.readFileSync(filePaths[0], 'utf8'));
      store.patchSettings(parsed.settings);
      store.replaceTunnels(parsed.tunnels);
      await frpc.restart();
      return { ok: true, count: parsed.tunnels.length };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  ipcMain.handle('config:reveal', () => { shell.showItemInFolder(store.configPath); });

  ipcMain.handle('frpc:locate', async () => {
    const isWin = process.platform === 'win32';
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: t('dlg.chooseFrpc'),
      properties: ['openFile'],
      defaultPath: isWin ? 'C:\\' : (process.platform === 'linux' ? '/usr/bin' : '/usr/local/bin'),
      filters: isWin ? [{ name: 'Executable (*.exe)', extensions: ['exe'] }] : undefined
    });
    if (canceled || !filePaths.length) return { ok: false };
    store.patchSettings({ frpcPath: filePaths[0] });
    return { ok: true, path: filePaths[0], version: await frpc.version() };
  });

  ipcMain.handle('window:show', () => showMainWindow());
  ipcMain.handle('window:hidePanel', () => tray && tray.hidePanel());
  ipcMain.handle('window:panelHeight', (_e, h) => tray && tray.setPanelHeight(h));
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
  ipcMain.handle('onboard:done', () => { store.patchSettings({ onboarded: true }); return true; });
}

// —— 启动 ——————————————————————————————————————————————

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

app.whenReady().then(async () => {
  // 没抢到锁的那个实例只负责退出：再建一遍托盘、面板、frpc 会多一个菜单栏图标、
  // 多闪一下 Dock 图标，还可能去动同一份配置。
  if (!gotTheLock) return;

  nativeTheme.themeSource = 'system'; // 跟随系统的浅色 / 深色外观
  applyDockIcon();

  store = new Store();
  // 语言得在建窗口、托盘和拉起 frpc 之前定下来，否则首批文案会用错语言。
  i18n.setLang(i18n.resolve(store.settings.language, app.getLocale()));
  logs = new LogBuffer(store.logPath, (batch) => broadcast('push:logs', batch));
  frpc = new Frpc(store, logs);
  metrics = new Metrics(store, frpc);

  frpc.on('crash', () => notify('Ferry', t('notify.crash')));
  frpc.on('gaveup', () => notify('Ferry', t('notify.gaveup')));
  frpc.on('state', (s) => { if (tray) tray.update(s, metrics); });

  registerIpc();
  createMainWindow();
  tray = createTray({
    onShow: showMainWindow,
    onQuit: () => { quitting = true; app.quit(); }
  });
  metrics.start();
  metrics.on('tick', () => tray && tray.update(frpc.state, metrics));
  startPushing();

  app.setLoginItemSettings({ openAtLogin: !!store.settings.launchAtLogin, openAsHidden: true });

  // 菜单栏面板上印着 ⌘⇧P，那它就得真的能按 —— 界面里写出来的快捷键
  // 不该是装饰。注册失败（被别的应用占了）只记一行日志，不影响启动。
  if (!globalShortcut.register('CommandOrControl+Shift+P', async () => {
    if (frpc.state.running) await frpc.stop();
    else await frpc.start();
  })) {
    logs.note('warn', t('shortcut.failed'));
  }

  if (store.settings.autoConnect && store.settings.serverAddr) {
    const res = await frpc.start();
    if (!res.ok) logs.note('warn', t('autoconnect.failed', { err: res.message }));
  }

  app.on('activate', () => showMainWindow());
});

app.on('window-all-closed', () => {
  // 菜单栏还在跑，关掉所有窗口不等于退出应用。
  if (store && store.settings.quitOnClose) app.quit();
});

app.on('before-quit', async (e) => {
  // 先认账：这时候是真的在退出（⌘Q、菜单栏的「退出」、登出关机都会走这里）。
  // 不置位的话，主窗口的 close 会以为只是关窗而 preventDefault —— 退出被拦下，
  // 但面板窗口已经先一步被销毁了，应用就卡在「还活着但面板是死的」状态，
  // 下一次点菜单栏图标必崩（Object has been destroyed）。
  quitting = true;
  if (!frpc || !frpc.proc) return;
  e.preventDefault();
  clearInterval(pushTimer);
  globalShortcut.unregisterAll();
  metrics.stop();
  await frpc.stop();
  destroyTray();
  app.exit(0);
});
