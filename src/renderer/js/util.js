'use strict';
// 渲染层共用的小工具。没有打包器，脚本按顺序加载，统一挂在 FK 上。

const FK = (window.FK = {});

FK.$ = (sel, root = document) => root.querySelector(sel);
FK.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

FK.el = (tag, className, text) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
};

FK.bytes = (n) => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
};

FK.rate = (n) => (n == null || !Number.isFinite(n) ? '—' : `${FK.bytes(n)}/s`);

FK.ms = (n) => (n == null ? '—' : `${Math.round(n)} ms`);

FK.duration = (since) => {
  if (!since) return '—';
  let s = Math.floor((Date.now() - since) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d) return `${d}d ${String(h).padStart(2, '0')}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
};

// 隧道的「本地 → 远程」那一列。远程地址优先用 frpc 报的真实值。
FK.route = (t, serverAddr) => {
  const local = `${t.localIP || '127.0.0.1'}:${t.localPort}`;
  if (t.remoteAddr) return `${local} → ${t.remoteAddr.replace(/^:/, `${serverAddr || 'frps'}:`)}`;
  if (t.type === 'tcp' || t.type === 'udp') {
    return `${local} → ${serverAddr || 'frps'}:${t.remotePort || '?'}`;
  }
  const d = (t.customDomains || [])[0];
  return `${local} → ${d || '（未设域名）'}`;
};

FK.short = (t) => `:${t.localPort}`;

// 分段控件：设计系统的 .seg / .seg-opt。选中态完全交给 CSS 的
// :has(input:checked) 处理，这里只负责标记哪个是选中的。
FK.seg = (container, options, current, onPick) => {
  container.textContent = '';
  for (const opt of options) {
    const value = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : opt.label;
    const b = FK.el('label', 'seg-opt mono');
    const radio = FK.el('input');
    radio.type = 'radio';
    radio.name = container.id || 'seg';
    radio.checked = value === current;
    b.appendChild(radio);
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', () => onPick(value));
    container.appendChild(b);
  }
};

FK.debounce = (fn, wait) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
};

FK.hint = (node, text, kind) => {
  node.textContent = text || '';
  node.className = `hint${kind ? ' ' + kind : ''}`;
};
