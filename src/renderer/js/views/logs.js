'use strict';
// 02 / 实时日志 —— frpc 的真实标准输出，按级别筛选，流式追加。
//
// 消息本体保持 frpc 原样（英文）：这是排障用的日志，改写它等于骗人。
// 中文只出现在界面 chrome 和 Ferry 自己写的那几行上。

(() => {
  const { $, el, t } = FK;
  const filters = () => [
    { label: t('filter.all'), value: 'all' },
    { label: t('log.info'), value: 'info' },
    { label: t('log.warn'), value: 'warn' },
    { label: t('log.error'), value: 'error' }
  ];
  const MAX_NODES = 3000;

  let filter = 'all';
  let autoScroll = true;
  let lines = [];
  // 主进程攒 120ms 才发一批，bootstrap 的快照可能正好落在这个窗口里，
  // 于是同几行会既在快照里、又在随后到达的批次里。行 id 是单调的，据此去重。
  let lastId = 0;

  const passes = (l) => filter === 'all' || l.lvl === filter;

  function lineNode(l) {
    const node = el('div', 'log-line');
    node.append(el('span', 'log-t', l.t), el('span', `log-lvl ${l.lvl}`, l.lvl));
    const msg = el('span', 'log-msg');
    if (l.proxy) {
      const px = el('span', 'px', `[${l.proxy}] `);
      msg.append(px, document.createTextNode(l.msg));
    } else {
      msg.textContent = l.msg;
    }
    node.appendChild(msg);
    return node;
  }

  function atBottom(host) {
    return host.scrollHeight - host.scrollTop - host.clientHeight < 40;
  }

  function append(batch) {
    const host = $('#logScroll');
    const stick = autoScroll && atBottom(host);
    const frag = document.createDocumentFragment();
    let added = 0;
    for (const l of batch) {
      if (!passes(l)) continue;
      frag.appendChild(lineNode(l));
      added++;
    }
    if (added) {
      host.appendChild(frag);
      while (host.childElementCount > MAX_NODES) host.firstElementChild.remove();
      if (stick) host.scrollTop = host.scrollHeight;
    }
    updateStatus();
  }

  function rebuild() {
    const host = $('#logScroll');
    host.textContent = '';
    const frag = document.createDocumentFragment();
    for (const l of lines.filter(passes).slice(-MAX_NODES)) frag.appendChild(lineNode(l));
    host.appendChild(frag);
    host.scrollTop = host.scrollHeight;
    updateStatus();
  }

  function updateStatus() {
    const shown = lines.filter(passes).length;
    const level = FK.app.state ? FK.app.state.settings.logLevel : 'info';
    $('#logStatus').textContent = t('log.status', { level, n: shown });
    $('#navCountLogs').textContent = lines.length ? String(lines.length) : '';
  }

  function bindFilters() {
    FK.seg($('#logFilters'), filters(), filter, (v) => {
      filter = v;
      bindFilters();
      rebuild();
    });
  }

  FK.logs = {
    init(initial) {
      lines = initial || [];
      lastId = lines.length ? lines[lines.length - 1].id : 0;

      bindFilters();

      $('#autoScroll').addEventListener('change', (e) => {
        autoScroll = e.target.checked;
        if (autoScroll) { const h = $('#logScroll'); h.scrollTop = h.scrollHeight; }
      });
      $('#btnLogClear').addEventListener('click', async () => {
        await window.ferry.logs.clear();
        lines = [];
        rebuild();
      });
      // 清空后主进程的 id 仍在往上走，lastId 保持不变即可继续正确去重。
      $('#btnLogExport').addEventListener('click', () => window.ferry.logs.export());

      rebuild();
    },

    push(batch) {
      const fresh = batch.filter((l) => l.id > lastId);
      if (!fresh.length) return;
      lastId = fresh[fresh.length - 1].id;
      lines.push(...fresh);
      if (lines.length > 6000) lines = lines.slice(-6000);
      append(fresh);
    },

    update() { updateStatus(); },

    retext() { bindFilters(); updateStatus(); }
  };
})();
