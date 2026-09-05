'use strict';
// frpc.toml 的序列化与读取。
//
// 只覆盖 frp 客户端配置实际用到的 TOML 子集：点号键（auth.token）、
// 顶层键值、[[proxies]] 数组表、字符串/整数/布尔/字符串数组。
// 写出的文件用 `frpc verify` 校验过，导入时能读回 Ferry 自己写的文件，
// 也能读懂手写的常见 frpc.toml。

const TYPES = ['tcp', 'udp', 'http', 'https'];

function q(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// —— 序列化 ——————————————————————————————————————————————

// tunnels 里只有 enabled 的会被写进去：frp 没有“运行时停用某条代理”的
// 概念，停用等于把它从配置里拿掉再热重载。
function stringify(settings, tunnels, admin) {
  const L = [];
  L.push('# 由 Ferry 生成 —— 手动修改会在下次保存时被覆盖。');
  L.push('# frp 配置参考 https://gofrp.org/docs/reference/client-configures/');
  L.push('');
  L.push(`serverAddr = ${q(settings.serverAddr || '')}`);
  L.push(`serverPort = ${Number(settings.serverPort) || 7000}`);
  L.push('loginFailExit = false');
  if (settings.token) {
    L.push('auth.method = "token"');
    L.push(`auth.token = ${q(settings.token)}`);
  }
  L.push(`transport.protocol = ${q(settings.protocol || 'tcp')}`);
  if (settings.proxyUrl) L.push(`transport.proxyURL = ${q(settings.proxyUrl)}`);
  L.push('log.to = "console"');
  L.push(`log.level = ${q(settings.logLevel || 'info')}`);
  L.push('');
  L.push('# Ferry 通过这个本地 admin 接口读取代理状态并热重载配置。');
  L.push('webServer.addr = "127.0.0.1"');
  L.push(`webServer.port = ${admin.port}`);
  L.push(`webServer.user = ${q(admin.user)}`);
  L.push(`webServer.password = ${q(admin.password)}`);

  for (const t of tunnels) {
    if (!t.enabled) continue;
    L.push('');
    L.push('[[proxies]]');
    L.push(`name = ${q(t.name)}`);
    L.push(`type = ${q(t.type)}`);
    L.push(`localIP = ${q(t.localIP || '127.0.0.1')}`);
    L.push(`localPort = ${Number(t.localPort) || 0}`);
    if (t.type === 'tcp' || t.type === 'udp') {
      if (t.remotePort) L.push(`remotePort = ${Number(t.remotePort)}`);
    } else {
      const domains = (t.customDomains || []).filter(Boolean);
      if (domains.length) L.push(`customDomains = [${domains.map(q).join(', ')}]`);
    }
  }
  return L.join('\n') + '\n';
}

// —— 解析 ——————————————————————————————————————————————

function parseValue(raw) {
  const s = raw.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s[0] === '"' || s[0] === "'") {
    const body = s.slice(1, s.lastIndexOf(s[0]));
    return s[0] === '"' ? body.replace(/\\(["\\])/g, '$1') : body;
  }
  if (s[0] === '[') {
    const inner = s.slice(1, s.lastIndexOf(']'));
    if (!inner.trim()) return [];
    return inner.split(',').map((x) => parseValue(x)).filter((x) => x !== '');
  }
  const n = Number(s);
  return Number.isFinite(n) && s !== '' ? n : s;
}

function setDotted(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// 返回 { settings, tunnels }，形状与 store 中的一致，可直接用于导入。
function parse(text) {
  const root = {};
  const proxies = [];
  let target = root;

  for (let line of String(text).split(/\r?\n/)) {
    line = line.trim();
    if (!line || line[0] === '#') continue;
    if (line === '[[proxies]]') {
      target = {};
      proxies.push(target);
      continue;
    }
    if (line[0] === '[') {
      // 其它表（[[visitors]]、[metadatas] …）Ferry 不管，跳过其内容。
      target = {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    setDotted(target, line.slice(0, eq).trim(), parseValue(line.slice(eq + 1)));
  }

  const settings = {
    serverAddr: root.serverAddr || '',
    serverPort: root.serverPort || 7000,
    token: (root.auth && root.auth.token) || '',
    protocol: (root.transport && root.transport.protocol) || 'tcp',
    proxyUrl: (root.transport && root.transport.proxyURL) || '',
    logLevel: (root.log && root.log.level) || 'info'
  };

  const tunnels = proxies
    .filter((p) => p.name && TYPES.includes(p.type))
    .map((p) => ({
      name: String(p.name),
      type: p.type,
      localIP: p.localIP || '127.0.0.1',
      localPort: Number(p.localPort) || 0,
      remotePort: p.remotePort ? Number(p.remotePort) : null,
      customDomains: Array.isArray(p.customDomains)
        ? p.customDomains.map(String)
        : p.customDomains ? [String(p.customDomains)] : [],
      enabled: true
    }));

  return { settings, tunnels };
}

module.exports = { stringify, parse, TYPES };
