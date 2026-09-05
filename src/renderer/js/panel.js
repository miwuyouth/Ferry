'use strict';
// 菜单栏下拉面板：状态、两条速率、前几条隧道的快捷开关。

(() => {
  const { $, el, rate, t } = FK;

  if (window.ferry && window.ferry.platform && window.ferry.platform !== 'darwin') {
    document.body.classList.add('not-darwin');
  }
  const MAX_ROWS = 6;
  const cache = new Map();

  function buildRow() {
    const node = el('div', 'panel-row');
    const dot = el('span', 'dot');
    const name = el('span', 'name ellipsis');
    const short = el('span', 'mono short');
    const sw = el('button', 'sw sm');
    sw.type = 'button';
    sw.appendChild(el('i'));
    node.append(dot, name, short, sw);
    return { node, dot, name, short, sw };
  }

  function renderRows(tunnels) {
    const host = $('#pList');
    const list = tunnels.slice(0, MAX_ROWS);
    const seen = new Set();
    let cursor = null;

    for (const t of list) {
      let e = cache.get(t.id);
      if (!e) {
        e = buildRow();
        e.sw.addEventListener('click', () => window.ferry.tunnels.toggle(e.id));
        cache.set(t.id, e);
      }
      e.id = t.id;
      e.dot.className = `dot ${t.enabled ? t.kind : ''}`;
      e.name.textContent = t.name;
      e.name.title = t.state;
      e.short.textContent = FK.short(t);
      e.sw.className = `sw sm${t.enabled ? ' on' : ''}`;
      seen.add(t.id);

      const next = cursor ? cursor.nextSibling : host.firstChild;
      if (next !== e.node) host.insertBefore(e.node, next);
      cursor = e.node;
    }
    for (const [id, e] of cache) {
      if (!seen.has(id)) { e.node.remove(); cache.delete(id); }
    }

    let empty = $('#pEmpty');
    if (!list.length) {
      if (!empty) {
        empty = el('div', null, t('panel.empty'));
        empty.id = 'pEmpty';
        empty.style.cssText = 'padding:14px 0; font-size:12px; color:var(--label-2); text-align:center';
        host.appendChild(empty);
      }
    } else if (empty) empty.remove();
  }

  function paint(state) {
    FK.last = state;
    // 语言由主进程解析好随状态推来；变了就把静态文案刷一遍，空列表那行走下面的重绘。
    if (FK.setLang(state.lang)) { const e = $('#pEmpty'); if (e) e.remove(); }
    const f = state.frpc;
    $('#pDot').className = `dot ${f.connected ? 'on' : f.running ? 'pending' : ''}`;
    $('#pState').textContent = t(f.connected ? 'conn.connected' : f.running ? 'conn.connectingShort' : 'conn.idle');
    $('#pHost').textContent = state.settings.serverAddr || t('rail.notConfigured');
    $('#pUp').textContent = state.metrics.dashOk ? rate(state.metrics.rate.up) : '—';
    $('#pDown').textContent = state.metrics.dashOk ? rate(state.metrics.rate.down) : '—';
    $('#pPauseLabel').textContent = t(f.running ? 'panel.pauseAll' : 'btn.connect');
    renderRows(state.tunnels);
    reportHeight();
  }

  // 面板窗口按内容长短自适应：隧道列表在 .panel 里是唯一会变高的部分。
  let lastH = 0;
  function reportHeight() {
    const h = Math.ceil(document.querySelector('.panel').scrollHeight);
    if (!h || Math.abs(h - lastH) < 4) return;
    lastH = h;
    window.ferry.win.panelHeight(h);
  }

  async function boot() {
    const state = await window.ferry.bootstrap();
    FK.i18n.setLang(state.lang);
    FK.i18n.applyStatic(document);
    paint(state);
    window.ferry.onState(paint);

    $('#pOpen').addEventListener('click', async () => {
      await window.ferry.win.show();
      window.ferry.win.hidePanel();
    });
    $('#pPause').addEventListener('click', async () => {
      const s = FK.last;
      if (s && s.frpc.running) await window.ferry.frpc.stop();
      else await window.ferry.frpc.start();
    });
    $('#pQuit').addEventListener('click', () => window.ferry.win.quit());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.ferry.win.hidePanel();
    });
  }

  boot();
})();
