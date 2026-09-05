'use strict';
// frpc 子进程的看护者：找二进制、写配置、拉起、盯着、热重载、停掉。

const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const toml = require('./toml');
const { t } = require('../shared/i18n');

const CANDIDATES = [
  '/opt/homebrew/bin/frpc',
  '/usr/local/bin/frpc',
  '/opt/local/bin/frpc',
  '/usr/bin/frpc'
];

const BACKOFF = [1000, 2000, 4000, 8000, 15000, 30000, 30000, 60000, 60000, 60000];
const MAX_RETRIES = 10;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// 到 frps 控制端口拨一次 TCP，用握手耗时当延迟。
// frpc 不上报 rtt，这是本机能拿到的最贴近的数字。
function probeLatency(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    if (!host) return resolve(null);
    const started = process.hrtime.bigint();
    const sock = new net.Socket();
    const done = (val) => { sock.destroy(); resolve(val); };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(Number(process.hrtime.bigint() - started) / 1e6));
    sock.once('timeout', () => done(null));
    sock.once('error', () => done(null));
    sock.connect(port, host);
  });
}

class Frpc extends EventEmitter {
  constructor(store, logs) {
    super();
    this.store = store;
    this.logs = logs;
    this.proc = null;
    this.retries = 0;
    this.retryTimer = null;
    this.stopping = false;
    this.state = { running: false, connected: false, runId: '', since: null, error: '' };
  }

  // —— 二进制定位 ————————————————————————————————————————

  resolveBinary() {
    const override = this.store.settings.frpcPath;
    if (override && fs.existsSync(override)) return override;
    // 打包后可以把 frpc 放进 app 的 resources/ 里一起分发。
    const bundled = path.join(process.resourcesPath || '', 'frpc');
    if (fs.existsSync(bundled)) return bundled;
    for (const p of CANDIDATES) if (fs.existsSync(p)) return p;
    return null;
  }

  version() {
    return new Promise((resolve) => {
      const bin = this.resolveBinary();
      if (!bin) return resolve(null);
      execFile(bin, ['--version'], { timeout: 4000 }, (err, stdout) =>
        resolve(err ? null : String(stdout).trim()));
    });
  }

  // —— 配置 ————————————————————————————————————————————

  writeConfig() {
    const text = toml.stringify(this.store.settings, this.store.tunnels, this.store.admin);
    fs.writeFileSync(this.store.configPath, text, { encoding: 'utf8', mode: 0o600 });
    return text;
  }

  // 用 frpc 自己的校验器,而不是我们再写一遍规则。
  verifyConfig() {
    return new Promise((resolve) => {
      const bin = this.resolveBinary();
      if (!bin) return resolve({ ok: false, message: t('frpc.notFound') });
      execFile(bin, ['verify', '-c', this.store.configPath], { timeout: 8000 }, (err, stdout, stderr) => {
        const out = String(stderr || stdout).trim();
        resolve(err ? { ok: false, message: out || String(err.message) } : { ok: true, message: out });
      });
    });
  }

  // —— 生命周期 ————————————————————————————————————————

  async start() {
    if (this.proc) return { ok: true };
    const bin = this.resolveBinary();
    if (!bin) {
      const message = t('frpc.notFoundLong');
      this._setState({ error: message });
      this.logs.note('error', message);
      return { ok: false, message };
    }
    if (!this.store.settings.serverAddr) {
      const message = t('frpc.noAddr');
      this._setState({ error: message });
      return { ok: false, message };
    }

    this.stopping = false;
    this.store.admin.port = await freePort();
    this.writeConfig();

    const check = await this.verifyConfig();
    if (!check.ok) {
      this._setState({ error: check.message });
      this.logs.note('error', t('frpc.checkFailed', { err: check.message }));
      return { ok: false, message: check.message };
    }

    this.logs.note('info', t('frpc.launching', { bin, cfg: this.store.configPath }));
    // frpc 无论输出到不到终端都会上 ANSI 颜色码，日志解析器负责剥掉。
    const proc = spawn(bin, ['-c', this.store.configPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.proc = proc;
    this._setState({ running: true, since: Date.now(), error: '' });

    const onData = (buf) => {
      const text = buf.toString('utf8');
      this._sniff(text);
      this.logs.push(text);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('exit', (code, signal) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this._setState({ running: false, connected: false, runId: '' });
      if (this.stopping) {
        this.logs.note('info', t('frpc.stopped'));
        return;
      }
      this.logs.note('error', t('frpc.exited', { code: code ?? '-', signal: signal ? `, signal ${signal}` : '' }));
      this.emit('crash', { code, signal });
      this._scheduleRetry();
    });

    proc.on('error', (err) => {
      this.logs.note('error', t('frpc.spawnFailed', { err: err.message }));
      this._setState({ running: false, error: err.message });
    });

    return { ok: true };
  }

  // 从日志里读出控制连接的状态——frpc 没有别的地方告诉我们这件事。
  _sniff(text) {
    if (/login to server success/.test(text)) {
      const m = /get run id \[([^\]]+)\]/.exec(text);
      this.retries = 0;
      this._setState({ connected: true, runId: m ? m[1] : '', error: '' });
    } else if (/login to server failed/.test(text)) {
      const m = /login to server failed: (.+)/.exec(text);
      this._setState({ connected: false, error: m ? m[1].split('\n')[0] : t('frpc.loginFailed') });
    } else if (/control connection closed|try to reconnect to server/.test(text)) {
      this._setState({ connected: false });
    }
  }

  _scheduleRetry() {
    if (!this.store.settings.autoReconnect) return;
    if (this.retries >= MAX_RETRIES) {
      this.logs.note('error', t('frpc.gaveup', { n: MAX_RETRIES }));
      this.emit('gaveup');
      return;
    }
    const wait = BACKOFF[Math.min(this.retries, BACKOFF.length - 1)];
    this.retries++;
    this.logs.note('info', t('frpc.retry', { s: wait / 1000, i: this.retries, n: MAX_RETRIES }));
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.start(), wait);
  }

  async stop() {
    this.stopping = true;
    this.retries = 0;
    clearTimeout(this.retryTimer);
    const proc = this.proc;
    if (!proc) {
      this._setState({ running: false, connected: false });
      return;
    }
    // 先按 admin 接口的正常关闭走，让 frpc 有机会跟 frps 说再见。
    try { await this.api('POST', '/api/stop'); } catch {}
    await new Promise((resolve) => {
      const done = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} resolve(); }, 3000);
      proc.once('exit', () => { clearTimeout(done); resolve(); });
      try { proc.kill('SIGTERM'); } catch { clearTimeout(done); resolve(); }
    });
    this.proc = null;
    this._setState({ running: false, connected: false, runId: '' });
  }

  // 改了配置就重写 + 热重载。
  // 进程没在跑时只落盘：改一条隧道不该顺手把连接也建起来，
  // 建连接是标题栏那个「连接」按钮的事。
  async apply() {
    if (!this.proc) { this.writeConfig(); return { ok: true, started: false }; }
    this.writeConfig();
    const check = await this.verifyConfig();
    if (!check.ok) {
      this.logs.note('error', t('frpc.reloadSkipped', { err: check.message }));
      return { ok: false, message: check.message };
    }
    try {
      await this.api('GET', '/api/reload');
      this.logs.note('info', t('frpc.reloaded'));
      return { ok: true };
    } catch (err) {
      this.logs.note('warn', t('frpc.reloadFailed', { err: err.message }));
      await this.stop();
      return this.start();
    }
  }

  // 服务器参数变了就必须重启：serverAddr/token 这类不吃热重载。
  async restart() {
    await this.stop();
    return this.start();
  }

  // —— admin 接口 ————————————————————————————————————————

  api(method, apiPath) {
    return new Promise((resolve, reject) => {
      const { port, user, password } = this.store.admin;
      if (!port) return reject(new Error(t('frpc.adminNotReady')));
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          path: apiPath,
          timeout: 4000,
          headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64') }
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            try { resolve(body ? JSON.parse(body) : {}); } catch { resolve(body); }
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error(t('frpc.adminTimeout'))));
      req.on('error', reject);
      req.end();
    });
  }

  // 拉平成 { 代理名: { status, err, remoteAddr } }。
  async proxyStatus() {
    if (!this.proc) return {};
    let raw;
    try { raw = await this.api('GET', '/api/status'); } catch { return {}; }
    const out = {};
    for (const list of Object.values(raw || {})) {
      if (!Array.isArray(list)) continue;
      for (const p of list) {
        out[p.name] = { status: p.status, err: p.err || '', remoteAddr: p.remote_addr || '' };
      }
    }
    return out;
  }

  latency() {
    return probeLatency(this.store.settings.serverAddr, Number(this.store.settings.serverPort) || 7000);
  }

  _setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }
}

module.exports = { Frpc, probeLatency };
