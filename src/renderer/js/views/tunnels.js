'use strict';
// 01 / 隧道 —— 列表、搜索、类型筛选、启停开关，以及新建隧道弹层。

(() => {
  const { $, el, bytes, route, seg, hint } = FK;
  const TYPES = ['tcp', 'udp', 'http', 'https'];
  const FILTERS = ['全部', ...TYPES];

  let q = '';
  let typeFilter = '全部';
  let serverAddr = '';
  const rowCache = new Map(); // id -> { node, refs }

  // —— 单行 ————————————————————————————————————————————

  function buildRow() {
    const node = el('div', 'row');

    const nameCell = el('div', 'row-name');
    const dot = el('span', 'dot');
    const nameBox = el('div', 'ellipsis');
    nameBox.style.minWidth = '0';
    const title = el('div', 'row-title ellipsis');
    const state = el('div', 'row-state ellipsis');
    nameBox.append(title, state);
    nameCell.append(dot, nameBox);

    const type = el('span', 'tag tag-outline');
    type.style.textTransform = 'uppercase';

    const routeCell = el('div', 'mono row-route ellipsis');
    const conns = el('span', 'mono row-num');
    const traffic = el('span', 'mono row-num');

    const actions = el('div', 'row-actions');
    const del = el('button', 'row-del', '✕');
    del.type = 'button';
    del.title = '删除隧道';
    const sw = el('button', 'sw');
    sw.type = 'button';
    sw.appendChild(el('i'));
    actions.append(del, sw);

    node.append(nameCell, type, routeCell, conns, traffic, actions);
    return { node, refs: { dot, title, state, type, routeCell, conns, traffic, del, sw } };
  }

  function paintRow(entry, t) {
    const r = entry.refs;
    r.dot.className = `dot ${t.enabled ? t.kind : ''}`;
    r.title.textContent = t.name;
    r.state.textContent = t.enabled ? t.state : '已停用';
    r.state.className = `row-state ellipsis ${t.enabled ? t.kind : ''}`;
    r.state.title = t.state;
    r.type.textContent = t.type;
    r.routeCell.textContent = route(t, serverAddr);
    r.routeCell.title = r.routeCell.textContent;
    r.conns.textContent = t.conns == null ? '—' : String(t.conns);
    r.traffic.textContent =
      t.up == null && t.down == null ? '—' : bytes((t.up || 0) + (t.down || 0));
    r.sw.className = `sw${t.enabled ? ' on' : ''}`;
    r.sw.title = t.enabled ? '停用（从 frpc.toml 移除并热重载）' : '启用';

    if (!r.sw.dataset.wired) {
      r.sw.dataset.wired = '1';
      r.sw.addEventListener('click', () => window.frpkit.tunnels.toggle(entry.id));
      r.del.addEventListener('click', async () => {
        if (!confirm(`删除隧道「${entry.name}」？`)) return;
        await window.frpkit.tunnels.remove(entry.id);
      });
    }
    entry.id = t.id;
    entry.name = t.name;
  }

  function renderRows(tunnels) {
    const host = $('#rows');
    const needle = q.trim().toLowerCase();
    const visible = tunnels.filter((t) => {
      if (typeFilter !== '全部' && t.type !== typeFilter) return false;
      if (!needle) return true;
      const hay = `${t.name} ${t.localPort} ${t.remotePort || ''} ${(t.customDomains || []).join(' ')}`;
      return hay.toLowerCase().includes(needle);
    });

    const seen = new Set();
    let cursor = null;
    for (const t of visible) {
      let entry = rowCache.get(t.id);
      if (!entry) {
        entry = buildRow();
        entry.id = t.id;
        rowCache.set(t.id, entry);
      }
      paintRow(entry, t);
      seen.add(t.id);
      // 保持 DOM 顺序与数据顺序一致，同时复用节点（不打断 hover / 滚动）。
      const next = cursor ? cursor.nextSibling : host.firstChild;
      if (next !== entry.node) host.insertBefore(entry.node, next);
      cursor = entry.node;
    }
    for (const [id, entry] of rowCache) {
      if (!seen.has(id)) { entry.node.remove(); rowCache.delete(id); }
    }

    let empty = $('#rowsEmpty');
    if (!visible.length) {
      if (!empty) {
        empty = el('div', 'empty');
        empty.id = 'rowsEmpty';
        host.appendChild(empty);
      }
      empty.textContent = tunnels.length
        ? '没有匹配的隧道。'
        : '还没有隧道。点右上角「＋ 新建隧道」把本机端口暴露出去。';
    } else if (empty) {
      empty.remove();
    }
  }

  // —— 新建弹层 ————————————————————————————————————————

  let newType = 'tcp';

  function previewToml() {
    const name = $('#nName').value.trim() || 'my-tunnel';
    const ip = $('#nLocalIP').value.trim() || '127.0.0.1';
    const port = $('#nLocalPort').value.trim() || '0';
    const lines = [
      '[[proxies]]',
      `name = "${name}"`,
      `type = "${newType}"`,
      `localIP = "${ip}"`,
      `localPort = ${port}`
    ];
    if (newType === 'tcp' || newType === 'udp') {
      const rp = $('#nRemotePort').value.trim();
      if (rp) lines.push(`remotePort = ${rp}`);
    } else {
      const domains = $('#nDomains').value.split(',').map((s) => s.trim()).filter(Boolean);
      if (domains.length) lines.push(`customDomains = [${domains.map((d) => `"${d}"`).join(', ')}]`);
    }
    $('#newPreview').textContent = lines.join('\n');
  }

  function syncTypeFields() {
    const isPort = newType === 'tcp' || newType === 'udp';
    $('#fRemotePort').hidden = !isPort;
    $('#fDomains').hidden = isPort;
    seg($('#newTypes'), TYPES, newType, (v) => { newType = v; syncTypeFields(); });
    previewToml();
  }

  function openSheet() {
    $('#nName').value = '';
    $('#nLocalIP').value = '127.0.0.1';
    $('#nLocalPort').value = '';
    $('#nRemotePort').value = '';
    $('#nDomains').value = '';
    hint($('#newHint'), '');
    newType = 'tcp';
    syncTypeFields();
    $('#newSheet').classList.add('is-open');
    $('#nName').focus();
  }

  function closeSheet() { $('#newSheet').classList.remove('is-open'); }

  async function saveTunnel() {
    const name = $('#nName').value.trim();
    const localPort = Number($('#nLocalPort').value.trim());
    if (!name) return hint($('#newHint'), '请填写名称。', 'err');
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return hint($('#newHint'), '名称只能用字母、数字、. _ - 。', 'err');
    if (!localPort || localPort < 1 || localPort > 65535) return hint($('#newHint'), '本地端口不合法。', 'err');

    const draft = {
      name,
      type: newType,
      localIP: $('#nLocalIP').value.trim() || '127.0.0.1',
      localPort,
      remotePort: null,
      customDomains: [],
      enabled: true
    };
    if (newType === 'tcp' || newType === 'udp') {
      const rp = Number($('#nRemotePort').value.trim());
      if (!rp || rp < 1 || rp > 65535) return hint($('#newHint'), '远程端口不合法。', 'err');
      draft.remotePort = rp;
    } else {
      draft.customDomains = $('#nDomains').value.split(',').map((s) => s.trim()).filter(Boolean);
      if (!draft.customDomains.length) return hint($('#newHint'), '请至少填一个自定义域名。', 'err');
    }

    hint($('#newHint'), '写入 frpc.toml 并热重载…');
    const res = await window.frpkit.tunnels.add(draft);
    if (res && res.ok === false) return hint($('#newHint'), res.message || '保存失败。', 'err');
    closeSheet();
  }

  // —— 对外 ————————————————————————————————————————————

  FK.tunnels = {
    init() {
      // seg 每次都重建按钮，所以换筛选项要重绑一次。
      const bindFilters = () => seg($('#typeFilters'), FILTERS, typeFilter, (v) => {
        typeFilter = v;
        bindFilters();
        FK.app.repaint();
      });
      bindFilters();

      $('#q').addEventListener('input', (e) => { q = e.target.value; FK.app.repaint(); });
      $('#btnNew').addEventListener('click', openSheet);
      $('#btnNewCancel').addEventListener('click', closeSheet);
      $('#btnNewSave').addEventListener('click', saveTunnel);
      $('#btnStopAll').addEventListener('click', async () => {
        if (!confirm('停用全部隧道？会从 frpc.toml 中移除并热重载。')) return;
        await window.frpkit.tunnels.stopAll();
      });
      for (const id of ['#nName', '#nLocalIP', '#nLocalPort', '#nRemotePort', '#nDomains']) {
        $(id).addEventListener('input', previewToml);
      }
      $('#newSheet').addEventListener('mousedown', (e) => {
        if (e.target === $('#newSheet')) closeSheet();
      });
    },

    update(state) {
      serverAddr = state.settings.serverAddr;
      renderRows(state.tunnels);
      const on = state.tunnels.filter((t) => t.enabled && t.kind === 'on').length;
      $('#listSummary').textContent = `${on} 个运行中 · 共 ${state.tunnels.length} 个隧道`;
      $('#configPath').textContent = state.configPath;
      $('#configPath').title = state.configPath;
      $('#navCountTunnels').textContent = String(state.tunnels.length);
    },

    closeSheet
  };
})();
