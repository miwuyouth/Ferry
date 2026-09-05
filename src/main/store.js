'use strict';
// 持久化：设置、隧道列表、流量小时桶。
// 全部落在 ~/Library/Application Support/Ferry/store.json，
// 生成的 frpc.toml 就在它旁边（界面底栏显示的就是这个路径）。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const DEFAULTS = {
  settings: {
    serverAddr: '',
    serverPort: 7000,
    token: '',
    protocol: 'tcp',
    proxyUrl: '',
    logLevel: 'info',
    frpcPath: '',
    // 'system' 时按系统 locale 落到中文或英文，见 shared/i18n.js。
    language: 'system',
    // frpc 自己不统计流量和连接数——那是 frps 面板的数据。
    // 填了这里才有「连接数 / 今日流量 / 24 小时曲线」，否则界面显示 —。
    dashboard: { enabled: false, addr: '', port: 7500, user: 'admin', password: '' },
    launchAtLogin: false,
    autoConnect: true,
    quitOnClose: false,
    autoReconnect: true,
    notifyOnError: true,
    onboarded: false
  },
  tunnels: [],
  // [{ h: <epoch 小时>, up: <字节>, down: <字节> }]，只留最近 24 个。
  traffic: []
};

class Store {
  constructor() {
    // userData 默认就是 ~/Library/Application Support/Ferry（productName 决定），
    // 走 getPath 而不是自己拼，是为了 --user-data-dir 能覆盖它——冒烟测试要用。
    this.dir = app.getPath('userData');
    this.file = path.join(this.dir, 'store.json');
    this.configPath = path.join(this.dir, 'frpc.toml');
    this.logPath = path.join(this.dir, 'frpc.log');
    fs.mkdirSync(this.dir, { recursive: true });
    this.data = this._read();
    // admin 接口的口令每次启动重新生成，不落盘——它只在本机回环上用一次。
    this.admin = {
      port: 0,
      user: 'ferry',
      password: crypto.randomBytes(18).toString('base64url')
    };
  }

  _read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        settings: { ...DEFAULTS.settings, ...raw.settings, dashboard: { ...DEFAULTS.settings.dashboard, ...(raw.settings || {}).dashboard } },
        tunnels: Array.isArray(raw.tunnels) ? raw.tunnels : [],
        traffic: Array.isArray(raw.traffic) ? raw.traffic : []
      };
    } catch {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  save() {
    clearTimeout(this._soon);
    this._soon = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file); // 原子替换，避免写一半断电留下坏文件
  }

  // 流量每 5 秒采一次样，没必要每次都落盘；攒一分钟再写。
  saveSoon() {
    if (this._soon) return;
    this._soon = setTimeout(() => this.save(), 60000);
    this._soon.unref?.();
  }

  get settings() { return this.data.settings; }
  get tunnels() { return this.data.tunnels; }
  get traffic() { return this.data.traffic; }

  patchSettings(patch) {
    const d = patch.dashboard
      ? { ...this.data.settings.dashboard, ...patch.dashboard }
      : this.data.settings.dashboard;
    this.data.settings = { ...this.data.settings, ...patch, dashboard: d };
    this.save();
    return this.data.settings;
  }

  addTunnel(t) {
    const tunnel = {
      id: crypto.randomUUID(),
      name: t.name,
      type: t.type,
      localIP: t.localIP || '127.0.0.1',
      localPort: Number(t.localPort) || 0,
      remotePort: t.remotePort ? Number(t.remotePort) : null,
      customDomains: (t.customDomains || []).filter(Boolean),
      enabled: t.enabled !== false
    };
    this.data.tunnels.push(tunnel);
    this.save();
    return tunnel;
  }

  updateTunnel(id, patch) {
    const t = this.data.tunnels.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    this.save();
    return t;
  }

  removeTunnel(id) {
    this.data.tunnels = this.data.tunnels.filter((x) => x.id !== id);
    this.save();
  }

  replaceTunnels(list) {
    this.data.tunnels = list.map((t) => ({ id: crypto.randomUUID(), ...t }));
    this.save();
    return this.data.tunnels;
  }

  // 按小时累计流量增量，只保留 24 个桶。
  addTraffic(upDelta, downDelta) {
    const h = Math.floor(Date.now() / 3600000);
    let bucket = this.data.traffic[this.data.traffic.length - 1];
    if (!bucket || bucket.h !== h) {
      bucket = { h, up: 0, down: 0 };
      this.data.traffic.push(bucket);
    }
    const rolled = bucket.up === 0 && bucket.down === 0;
    bucket.up += Math.max(0, upDelta);
    bucket.down += Math.max(0, downDelta);
    if (this.data.traffic.length > 24) this.data.traffic = this.data.traffic.slice(-24);
    if (rolled) this.save(); else this.saveSoon();
  }
}

module.exports = { Store, DEFAULTS };
