'use strict';
// frpc 标准输出 -> 结构化日志行。
//
// 实测 frpc 0.64 的输出形如（外面还包着 ANSI 颜色码）：
//   2026-09-04 23:52:47.687 [I] [sub/root.go:149] start frpc service for ...
//   2026-09-04 23:52:48.010 [I] [proxy/proxy_manager.go:161] [8f2c1ad4e9] [web-staging] start proxy success
// 第一个方括号里的是 run id，第二个是代理名——run id 对用户没用，去掉，
// 代理名留着，界面靠它把日志归到隧道上。

const fs = require('fs');
const os = require('os');

const ANSI = /\x1b\[[0-9;]*m/g;
const LINE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.\d+ \[([IWEDT])\] \[([^\]]+)\] ([\s\S]*)$/;
const RUNID = /^\[([0-9a-f]{8,})\] /;
// 我们自己写盘用的格式（见 push），读回时要按这个解析，
// 不能拿 frpc 的原始格式去套——那样每行都会掉进兜底分支变成 error。
const DISK = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \[(info|warn|error|debug|trace)\] (?:\[([^\]]+)\] )?([\s\S]*)$/;
const PROXY = /^\[([^\]\s]+)\] /;
const LEVELS = { I: 'info', W: 'warn', E: 'error', D: 'debug', T: 'trace' };

// toISOString 是 UTC，toTimeString 是本地时区——混用会让兜底行的日期和
// 时间对不上。统一走本地时区。
function localStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    t: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  };
}

const MAX_LINES = 5000;          // 内存里保留的行数
const RETENTION_MS = 7 * 864e5;  // 磁盘上保留 7 天

class LogBuffer {
  constructor(filePath, onBatch) {
    this.filePath = filePath;
    this.onBatch = onBatch;
    this.lines = [];
    this.seq = 0;
    this._tail = '';
    this._pending = [];
    this._timer = null;
    this._pruneDisk();
    this._loadFromDisk();
  }

  // 启动时丢掉 7 天前的行，并把余下的读回内存。
  _pruneDisk() {
    let raw;
    try { raw = fs.readFileSync(this.filePath, 'utf8'); } catch { return; }
    const cutoff = Date.now() - RETENTION_MS;
    const kept = raw.split('\n').filter((l) => {
      const at = Date.parse(l.slice(0, 19).replace(' ', 'T'));
      return Number.isFinite(at) ? at >= cutoff : false;
    });
    fs.writeFileSync(this.filePath, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
  }

  _loadFromDisk() {
    let raw;
    try { raw = fs.readFileSync(this.filePath, 'utf8'); } catch { return; }
    for (const l of raw.split('\n').slice(-MAX_LINES)) {
      const m = DISK.exec(l);
      if (!m) continue; // 读不懂的历史行直接跳过，别伪造成 error
      const [, date, t, lvl, proxy, msg] = m;
      this.lines.push({ id: ++this.seq, date, t, lvl, proxy: proxy || '', msg });
    }
  }

  _parse(text) {
    const clean = text.replace(ANSI, '').replace(/\r/g, '').trimEnd();
    if (!clean.trim()) return null;

    const m = LINE.exec(clean);
    if (!m) {
      // frpc 偶尔直接往 stderr 写没有前缀的东西（panic、用法错误）。
      // 这些恰恰是最该看见的，按 error 收下。
      return { id: ++this.seq, ...localStamp(), lvl: 'error', proxy: '', msg: clean };
    }

    const [, date, time, code, caller, rest] = m;
    // FrpKit 每 2 秒轮询一次 /api/status，这些回声会淹没日志窗口——但只丢轮询
    // 那两个接口，admin 接口的其它输出（success reload conf）是有用的，留着。
    if (caller.startsWith('client/admin_api.go') && /\/api\/(status|config)/.test(rest)) return null;

    let msg = rest;
    let proxy = '';
    const rid = RUNID.exec(msg);
    if (rid) msg = msg.slice(rid[0].length);
    const px = PROXY.exec(msg);
    if (px) { proxy = px[1]; msg = msg.slice(px[0].length); }

    return { id: ++this.seq, date, t: time, lvl: LEVELS[code] || 'info', proxy, msg };
  }

  // 从子进程管道喂进来的原始 chunk，可能在任意位置被切断。
  push(chunk) {
    const text = this._tail + chunk;
    const parts = text.split('\n');
    this._tail = parts.pop();
    const batch = [];
    for (const raw of parts) {
      const line = this._parse(raw);
      if (!line) continue;
      this.lines.push(line);
      batch.push(line);
      fs.appendFile(this.filePath, `${line.date} ${line.t} [${line.lvl}] ${line.proxy ? `[${line.proxy}] ` : ''}${line.msg}${os.EOL}`, () => {});
    }
    if (this.lines.length > MAX_LINES) this.lines = this.lines.slice(-MAX_LINES);
    if (batch.length) this._flush(batch);
  }

  // 攒 120ms 再发一次，避免 frpc 刷屏时把渲染进程压垮。
  _flush(batch) {
    this._pending.push(...batch);
    if (this._timer) return;
    this._timer = setTimeout(() => {
      const out = this._pending;
      this._pending = [];
      this._timer = null;
      this.onBatch(out);
    }, 120);
  }

  // FrpKit 自己的事件（进程启动、退出、重连）也进同一条流。
  note(lvl, msg) {
    const line = { id: ++this.seq, ...localStamp(), lvl, proxy: '', msg };
    this.lines.push(line);
    this._flush([line]);
  }

  all() { return this.lines; }

  clear() {
    this.lines = [];
    try { fs.writeFileSync(this.filePath, '', 'utf8'); } catch {}
  }

  toText() {
    return this.lines
      .map((l) => `${l.date} ${l.t} [${l.lvl}] ${l.proxy ? `[${l.proxy}] ` : ''}${l.msg}`)
      .join('\n');
  }
}

module.exports = { LogBuffer };
