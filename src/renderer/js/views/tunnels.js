'use strict';
// 01 / 隧道 —— 列表、搜索、类型筛选、启停开关，以及新建隧道弹层。

(() => {
  const { $, el, bytes, route, seg, hint, t } = FK;
  const TYPES = ['tcp', 'udp', 'http', 'https'];
  // 值固定，只有标签跟着语言走。
  const filters = () => [{ value: 'all', label: t('filter.all') }, ...TYPES];

  let q = '';
  let typeFilter = 'all';
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

    const routeCell = el('div', 'row-route');
    const routeText = el('span', 'mono ellipsis');
    const copy = el('button', 'row-copy', '⧉');
    copy.type = 'button';
    copy.title = t('row.copy');
    routeCell.append(routeText, copy);
    const conns = el('span', 'mono row-num');
    const traffic = el('span', 'mono row-num');

    const actions = el('div', 'row-actions');
    const del = el('button', 'row-del', '✕');
    del.type = 'button';
    del.title = t('row.delete');
    const sw = el('button', 'sw');
    sw.type = 'button';
    sw.appendChild(el('i'));
    actions.append(del, sw);

    node.append(nameCell, type, routeCell, conns, traffic, actions);
    return { node, refs: { dot, title, state, type, routeText, copy, conns, traffic, del, sw } };
  }

  // 复制远程地址：按钮就地变成 ✓，1.2s 后还原。
  async function copyRemote(entry) {
    if (!entry.remote) return;
    await window.ferry.copy(entry.remote);
    const btn = entry.refs.copy;
    clearTimeout(entry.copyTimer);
    btn.textContent = '✓';
    btn.classList.add('done');
    btn.title = FK.t('row.copied');
    entry.copyTimer = setTimeout(() => {
      btn.textContent = '⧉';
      btn.classList.remove('done');
      btn.title = FK.t('row.copy');
    }, 1200);
  }

  function paintRow(entry, t) {
    const r = entry.refs;
    r.dot.className = `dot ${t.enabled ? t.kind : ''}`;
    r.title.textContent = t.name;
    r.state.textContent = t.enabled ? t.state : FK.t('row.disabled');
    r.state.className = `row-state ellipsis ${t.enabled ? t.kind : ''}`;
    r.state.title = t.state;
    r.type.textContent = t.type;
    r.routeText.textContent = route(t, serverAddr);
    r.routeText.title = r.routeText.textContent;
    entry.remote = FK.remoteCopy(t, serverAddr);
    r.copy.hidden = !entry.remote;
    // 换语言时行是重绘的，顺手把提示语跟上（正在显示「已复制」的先不动）。
    if (!r.copy.classList.contains('done')) r.copy.title = FK.t('row.copy');
    r.conns.textContent = t.conns == null ? '—' : String(t.conns);
    r.traffic.textContent =
      t.up == null && t.down == null ? '—' : bytes((t.up || 0) + (t.down || 0));
    r.sw.className = `sw${t.enabled ? ' on' : ''}`;
    r.sw.title = FK.t(t.enabled ? 'row.disableHint' : 'row.enableHint');

    if (!r.sw.dataset.wired) {
      r.sw.dataset.wired = '1';
      r.sw.addEventListener('click', () => window.ferry.tunnels.toggle(entry.id));
      r.copy.addEventListener('click', () => copyRemote(entry));
      r.del.addEventListener('click', async () => {
        if (!confirm(FK.t('confirm.deleteTunnel', { name: entry.name }))) return;
        await window.ferry.tunnels.remove(entry.id);
      });
    }
    entry.id = t.id;
    entry.name = t.name;
  }

  function renderRows(tunnels) {
    const host = $('#rows');
    const needle = q.trim().toLowerCase();
    const visible = tunnels.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
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
      empty.textContent = t(tunnels.length ? 'list.emptyFiltered' : 'list.empty');
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
    if (!name) return hint($('#newHint'), t('err.nameRequired'), 'err');
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return hint($('#newHint'), t('err.nameChars'), 'err');
    if (!localPort || localPort < 1 || localPort > 65535) return hint($('#newHint'), t('err.localPort'), 'err');

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
      if (!rp || rp < 1 || rp > 65535) return hint($('#newHint'), t('err.remotePort'), 'err');
      draft.remotePort = rp;
    } else {
      draft.customDomains = $('#nDomains').value.split(',').map((s) => s.trim()).filter(Boolean);
      if (!draft.customDomains.length) return hint($('#newHint'), t('err.domainRequired'), 'err');
    }

    hint($('#newHint'), t('msg.writingConfig'));
    const res = await window.ferry.tunnels.add(draft);
    if (res && res.ok === false) return hint($('#newHint'), res.message || t('err.saveFailed'), 'err');
    closeSheet();
  }

  // seg 每次都重建按钮，所以换筛选项（或换语言）都要重绑一次。
  function bindFilters() {
    seg($('#typeFilters'), filters(), typeFilter, (v) => {
      typeFilter = v;
      bindFilters();
      FK.app.repaint();
    });
  }

  // —— 对外 ————————————————————————————————————————————

  FK.tunnels = {
    init() {
      bindFilters();

      $('#q').addEventListener('input', (e) => { q = e.target.value; FK.app.repaint(); });
      $('#btnNew').addEventListener('click', openSheet);
      $('#btnNewCancel').addEventListener('click', closeSheet);
      $('#btnNewSave').addEventListener('click', saveTunnel);
      $('#btnStopAll').addEventListener('click', async () => {
        if (!confirm(t('confirm.stopAll'))) return;
        await window.ferry.tunnels.stopAll();
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
      const on = state.tunnels.filter((x) => x.enabled && x.kind === 'on').length;
      $('#listSummary').textContent = t('list.summary', { on, total: state.tunnels.length });
      $('#configPath').textContent = state.configPath;
      $('#configPath').title = state.configPath;
      $('#navCountTunnels').textContent = String(state.tunnels.length);
    },

    closeSheet,

    // 换语言：seg 的标签是 JS 生成的，得重建一次。
    retext() { bindFilters(); }
  };
})();
