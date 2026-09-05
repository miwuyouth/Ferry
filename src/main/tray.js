'use strict';
// 菜单栏图标 + 点击弹出的面板窗口（设计稿的 02 号画板）。

const { Tray, BrowserWindow, nativeImage, screen, app } = require('electron');
const path = require('path');
const { t } = require('../shared/i18n');

const PANEL_W = 312;
const PANEL_H = 380;   // 首帧的兜底高度，渲染层量出真实内容高度后会覆盖它
const PANEL_MIN = 220;
const PANEL_MAX = 620;

let tray = null;
let panel = null;
let panelH = PANEL_H;

function fmtRate(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec < 1024) return '';
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)}K`;
  return `${(bytesPerSec / 1048576).toFixed(1)}M`;
}

function createPanel() {
  panel = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    transparent: true,
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#1c1c1e',
    hasShadow: true,
    ...(process.platform === 'darwin'
      ? {
          vibrancy: 'popover',
          visualEffectState: 'active'
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  panel.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
  // 点到别处就收起来——菜单栏面板该有的行为。
  panel.on('blur', () => panel.hide());
  // skipTransformProcessType 不能省：不加的话 Electron 会为了套用「所有工作区可见」
  // 把进程类型切成 UIElementApplication（也就是没有 Dock 图标的附件类应用），而且切完
  // 不会切回来 —— 表现就是启动时 Dock 图标闪一下就没了，非得点一次菜单栏图标、
  // 走到 dock.show() 才会回来。
  if (process.platform === 'darwin') {
    panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  } else {
    panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  return panel;
}

function positionPanel() {
  const b = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: b.x, y: b.y });
  const area = display.workArea;
  // 对齐图标中线，再夹回屏幕内，避免贴着边缘时露出去。
  let x = Math.round(b.x + b.width / 2 - PANEL_W / 2);
  x = Math.max(area.x + 8, Math.min(x, area.x + area.width - PANEL_W - 8));

  let y;
  // 如果托盘位于工作区下方（如 Windows 任务栏在底部），面板向上弹出
  if (b.y > area.y + area.height / 2) {
    y = Math.round(b.y - panelH - 6);
  } else {
    y = Math.round(b.y + b.height + 6);
  }
  y = Math.max(area.y + 8, Math.min(y, area.y + area.height - panelH - 8));
  panel.setBounds({ x, y, width: PANEL_W, height: Math.max(PANEL_MIN, panelH) });
}

// 面板可能已经被销毁（比如一次被拦下来的退出会先关掉它），这时候要重建，
// 不能拿着死对象去调 isVisible()。
function ensurePanel() {
  if (!panel || panel.isDestroyed()) createPanel();
  return panel;
}

function togglePanel() {
  ensurePanel();
  if (panel.isVisible()) { panel.hide(); return; }
  positionPanel();
  panel.show();
  panel.focus();
}

function createTray({ onShow, onQuit }) {
  const isMac = process.platform === 'darwin';
  const iconPath = isMac
    ? path.join(__dirname, '..', '..', 'resources', 'trayTemplate.png')
    : path.join(__dirname, '..', '..', 'resources', 'icon.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    // 图标文件缺失也不该让应用起不来——退回一个空图，靠标题文字露出来。
    image = nativeImage.createEmpty();
  }
  if (isMac) {
    image.setTemplateImage(true); // 跟随浅色/深色菜单栏自动反色
  }

  tray = new Tray(image);
  tray.setToolTip('Ferry');
  tray.on('click', togglePanel);
  tray.on('right-click', () => { onShow(); });

  createPanel();

  return {
    update(state, metrics) {
      const rate = metrics ? fmtRate(metrics.rate.down) : '';
      tray.setTitle(rate ? ` ${rate}` : '');
      tray.setToolTip(t(state.connected ? 'tray.connected' : state.running ? 'tray.connecting' : 'tray.idle'));
    },
    hidePanel() { if (panel && !panel.isDestroyed() && panel.isVisible()) panel.hide(); },

    // 隧道多的时候面板要长一点，少的时候不该留一片空白。
    // 高度由渲染层量完内容报上来。
    setPanelHeight(h) {
      const next = Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(h)));
      if (next === panelH) return;
      panelH = next;
      if (panel && !panel.isDestroyed() && panel.isVisible()) positionPanel();
    },
    showMain: onShow,
    quit: onQuit
  };
}

function destroyTray() {
  if (panel && !panel.isDestroyed()) panel.destroy();
  if (tray && !tray.isDestroyed()) tray.destroy();
  panel = null;
  tray = null;
}

module.exports = { createTray, destroyTray };
