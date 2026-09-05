'use strict';
// 采样层：把 frpc admin 接口、frps 面板接口和一次 TCP 拨测，
// 汇成界面要的那几个数。
//
// 分工要说清楚：frpc 只知道每条代理「跑没跑起来、报了什么错」，
// 它不统计字节数和连接数——那些计数器在 frps 上。所以没配 frps 面板
// 时，连接数 / 流量 / 曲线都会诚实地显示 —，而不是编一个数。

const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');
const { t } = require('../shared/i18n');

const STATUS_MS = 2000;   // frpc 本地接口，便宜
const DASH_MS = 5000;     // frps 面板，走公网
const PING_MS = 30000;    // 控制端口拨测

// frps 面板视角与本机视角是反的：
// 面板的 TrafficIn 是公网打进 frps 的字节（最终流向本机）= 本机的下行；
// TrafficOut 是 frps 发回公网的字节（源头是本机）= 本机的上行。
function fromDashboard(p) {
  return { up: Number(p.todayTrafficOut) || 0, down: Number(p.todayTrafficIn) || 0 };
}

function getJSON(url, auth, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'GET',
        timeout,
        rejectUnauthorized: false,
        headers: auth ? { Authorization: 'Basic ' + Buffer.from(auth).toString('base64') } : {}
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(t('net.timeout'))));
    req.on('error', reject);
    req.end();
  });
}

class Metrics extends EventEmitter {
  constructor(store, frpc) {
    super();
    this.store = store;
    this.frpc = frpc;
    this.timers = [];
    this.proxyStatus = {};
    this.dash = null;          // { byName: {name: {up,down,conns,status}}, ok, error }
    this.rate = { up: 0, down: 0 };
    this._lastTotals = null;   // { up, down, at }
    this.latency = null;
    this._pings = [];          // 最近一小时的拨测结果
    this.peakConns = 0;
    this.disconnects = 0;
    this._wasConnected = false;

    frpc.on('state', (s) => {
      if (this._wasConnected && !s.connected) this.disconnects++;
      this._wasConnected = s.connected;
    });
  }

  start() {
    this.timers.push(setInterval(() => this._pollStatus(), STATUS_MS));
    this.timers.push(setInterval(() => this._pollDashboard(), DASH_MS));
    this.timers.push(setInterval(() => this._pollLatency(), PING_MS));
    this._pollStatus();
    this._pollDashboard();
    this._pollLatency();
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  async _pollStatus() {
    this.proxyStatus = await this.frpc.proxyStatus();
    this.emit('tick');
  }

  async _pollLatency() {
    if (!this.frpc.state.running) return;
    const ms = await this.frpc.latency();
    this.latency = ms;
    if (ms != null) {
      this._pings.push({ at: Date.now(), ms });
      const cutoff = Date.now() - 3600000;
      this._pings = this._pings.filter((p) => p.at >= cutoff);
    }
    this.emit('tick');
  }

  async _pollDashboard() {
    const d = this.store.settings.dashboard;
    if (!d.enabled || !d.addr) {
      this.dash = null;
      this._lastTotals = null;
      this.rate = { up: 0, down: 0 };
      return;
    }
    const base = `http://${d.addr}:${d.port || 7500}`;
    const auth = d.user ? `${d.user}:${d.password}` : null;
    const byName = {};
    let ok = false;
    let error = '';
    for (const type of ['tcp', 'udp', 'http', 'https']) {
      try {
        const res = await getJSON(`${base}/api/proxy/${type}`, auth);
        ok = true;
        for (const p of res.proxies || []) {
          // frps 在多用户下会把名字写成 user.name，这里只取后半段对上本地隧道。
          const name = String(p.name).includes('.') ? String(p.name).split('.').pop() : String(p.name);
          const { up, down } = fromDashboard(p);
          byName[name] = { up, down, conns: Number(p.curConns) || 0, status: p.status };
        }
      } catch (err) {
        error = err.message;
      }
    }
    this.dash = { byName, ok, error };
    if (ok) this._accumulate(byName);
    this.emit('tick');
  }

  // 面板给的是「今日累计」，界面要的是「当前速率」和「按小时的柱子」，
  // 所以在这里做差分。跨零点计数器会归零，负增量直接丢掉。
  _accumulate(byName) {
    let up = 0;
    let down = 0;
    for (const v of Object.values(byName)) { up += v.up; down += v.down; }
    const now = Date.now();
    if (this._lastTotals) {
      const dt = (now - this._lastTotals.at) / 1000;
      const du = up - this._lastTotals.up;
      const dd = down - this._lastTotals.down;
      if (dt > 0 && du >= 0 && dd >= 0) {
        this.rate = { up: du / dt, down: dd / dt };
        this.store.addTraffic(du, dd);
      } else {
        this.rate = { up: 0, down: 0 };
      }
    }
    this._lastTotals = { up, down, at: now };

    let conns = 0;
    for (const v of Object.values(byName)) conns += v.conns;
    if (conns > this.peakConns) this.peakConns = conns;
  }

  avgLatency() {
    if (!this._pings.length) return null;
    return this._pings.reduce((a, p) => a + p.ms, 0) / this._pings.length;
  }

  // 24 个小时桶，补齐缺的小时，最后一格是当前小时。
  trafficSeries() {
    const nowH = Math.floor(Date.now() / 3600000);
    const map = new Map(this.store.traffic.map((b) => [b.h, b]));
    const out = [];
    for (let i = 23; i >= 0; i--) {
      const h = nowH - i;
      const b = map.get(h);
      out.push({ h, up: b ? b.up : 0, down: b ? b.down : 0 });
    }
    return out;
  }

  snapshot() {
    return {
      proxyStatus: this.proxyStatus,
      dash: this.dash,
      rate: this.rate,
      latency: this.avgLatency(),
      peakConns: this.peakConns,
      disconnects: this.disconnects,
      series: this.trafficSeries()
    };
  }
}

module.exports = { Metrics };
