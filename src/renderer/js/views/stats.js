'use strict';
// 03 / 流量统计 —— 四张概览卡、24 小时柱状图、按隧道明细。
//
// 字节数和连接数只有配了 frps 面板才有；没配就显示 —，并在图表旁说明原因。

(() => {
  const { $, el, bytes, ms, duration, t } = FK;

  function card(label, value, note) {
    const n = el('div', 'card stat');
    n.append(el('div', 'card-kicker', label), el('div', 'mono stat-value', value), el('div', 'stat-note', note));
    return n;
  }

  function renderCards(state) {
    const m = state.metrics;
    const host = $('#statCards');
    host.textContent = '';

    const totals = state.tunnels.reduce(
      (a, t) => ({ up: a.up + (t.up || 0), down: a.down + (t.down || 0), conns: a.conns + (t.conns || 0) }),
      { up: 0, down: 0, conns: 0 }
    );
    const hasDash = m.dashOk;

    host.append(
      card(
        t('stats.card.today'),
        hasDash ? bytes(totals.up + totals.down) : '—',
        hasDash
          ? t('stats.card.todayNote', { up: bytes(totals.up), down: bytes(totals.down) })
          : t('stats.needDash')
      ),
      card(
        t('stats.card.conns'),
        hasDash ? String(totals.conns) : '—',
        hasDash ? t('stats.card.connsNote', { n: m.peakConns }) : t('stats.needDash')
      ),
      card(
        t('stats.card.latency'),
        ms(m.latency),
        t(m.latency == null ? 'stats.notConnected' : 'stats.card.latencyNote')
      ),
      card(
        t('stats.card.uptime'),
        state.frpc.running ? duration(state.frpc.since) : '—',
        m.disconnects
          ? t('stats.card.disconnects', { n: m.disconnects })
          : t(state.frpc.running ? 'stats.card.noDisconnects' : 'stats.card.notRunning')
      )
    );
  }

  function renderChart(state) {
    const series = state.metrics.series || [];
    const host = $('#chart');
    host.textContent = '';
    const peak = Math.max(1, ...series.map((b) => Math.max(b.up, b.down)));

    for (const b of series) {
      const col = el('div', 'chart-col');
      const up = el('div', 'up');
      up.style.height = `${(b.up / peak) * 100}%`;
      const down = el('div', 'down');
      down.style.height = `${(b.down / peak) * 100}%`;
      if (!b.up && !b.down) col.classList.add('is-empty');
      col.title = t('chart.colTitle', { up: bytes(b.up), down: bytes(b.down) });
      col.append(up, down);
      host.appendChild(col);
    }

    const axis = $('#chartAxis');
    axis.textContent = '';
    const nowH = new Date().getHours();
    for (let i = 0; i < 5; i++) {
      const hoursAgo = 24 - Math.round((i * 24) / 4);
      const h = (nowH - hoursAgo + 24 + 24) % 24;
      axis.appendChild(el('span', null, i === 4 ? t('stats.now') : `${String(h).padStart(2, '0')}:00`));
    }

    $('#chartNote').textContent = t(state.metrics.dashOk ? 'stats.chartNoteOk' : 'stats.chartNoteNoDash');
  }

  function renderTable(state) {
    const body = $('#statRows');
    body.textContent = '';
    if (!state.tunnels.length) {
      const tr = el('tr');
      const td = el('td', null, t('stats.emptyRows'));
      td.colSpan = 6;
      td.style.color = 'var(--label-2)';
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    for (const tn of state.tunnels) {
      const tr = el('tr');
      const type = el('td', null, tn.type);
      type.style.textTransform = 'uppercase';
      type.style.color = 'var(--label-2)';
      const stateCell = el('td', null, tn.enabled ? tn.state : t('row.disabled'));
      stateCell.style.color =
        tn.kind === 'error' ? 'var(--err)' : tn.kind === 'on' ? 'var(--ok)' : 'var(--label-2)';
      tr.append(
        el('td', null, tn.name),
        type,
        el('td', 'mono', tn.conns == null ? '—' : String(tn.conns)),
        el('td', 'mono', tn.up == null ? '—' : bytes(tn.up)),
        el('td', 'mono', tn.down == null ? '—' : bytes(tn.down)),
        stateCell
      );
      body.appendChild(tr);
    }
  }

  FK.stats = {
    init() {},
    update(state) {
      if (!FK.app.isActive('stats')) return; // 不在这一页就别做无用功
      renderCards(state);
      renderChart(state);
      renderTable(state);
    }
  };
})();
