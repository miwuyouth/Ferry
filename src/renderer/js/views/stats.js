'use strict';
// 03 / 流量统计 —— 四张概览卡、24 小时柱状图、按隧道明细。
//
// 字节数和连接数只有配了 frps 面板才有；没配就诚实显示 —，
// 并在图表旁写清楚为什么。

(() => {
  const { $, el, bytes, ms, duration } = FK;

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
        '今日流量',
        hasDash ? bytes(totals.up + totals.down) : '—',
        hasDash ? `上行 ${bytes(totals.up)} / 下行 ${bytes(totals.down)}` : '需要 frps 面板'
      ),
      card(
        '活跃连接',
        hasDash ? String(totals.conns) : '—',
        hasDash ? `峰值 ${m.peakConns}` : '需要 frps 面板'
      ),
      card('平均延迟', ms(m.latency), m.latency == null ? '未连接' : '控制端口拨测 · 近一小时'),
      card(
        '在线时长',
        state.frpc.running ? duration(state.frpc.since) : '—',
        m.disconnects ? `断线 ${m.disconnects} 次` : state.frpc.running ? '无断线记录' : 'frpc 未运行'
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
      col.title = `上行 ${bytes(b.up)} · 下行 ${bytes(b.down)}`;
      col.append(up, down);
      host.appendChild(col);
    }

    const axis = $('#chartAxis');
    axis.textContent = '';
    const nowH = new Date().getHours();
    for (let i = 0; i < 5; i++) {
      const hoursAgo = 24 - Math.round((i * 24) / 4);
      const h = (nowH - hoursAgo + 24 + 24) % 24;
      axis.appendChild(el('span', null, i === 4 ? '现在' : `${String(h).padStart(2, '0')}:00`));
    }

    $('#chartNote').textContent = state.metrics.dashOk
      ? '浅色为上行，深色为下行 · 每小时增量，FrpKit 运行期间采样'
      : '未配置 frps 面板，暂无流量数据（设置 › 流量统计来源）';
  }

  function renderTable(state) {
    const body = $('#statRows');
    body.textContent = '';
    if (!state.tunnels.length) {
      const tr = el('tr');
      const td = el('td', null, '还没有隧道。');
      td.colSpan = 6;
      td.style.color = 'var(--label-2)';
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    for (const t of state.tunnels) {
      const tr = el('tr');
      const type = el('td', null, t.type);
      type.style.textTransform = 'uppercase';
      type.style.color = 'var(--label-2)';
      const state_ = el('td', null, t.enabled ? t.state : '已停用');
      state_.style.color =
        t.kind === 'error' ? 'var(--err)' : t.kind === 'on' ? 'var(--ok)' : 'var(--label-2)';
      tr.append(
        el('td', null, t.name),
        type,
        el('td', 'mono', t.conns == null ? '—' : String(t.conns)),
        el('td', 'mono', t.up == null ? '—' : bytes(t.up)),
        el('td', 'mono', t.down == null ? '—' : bytes(t.down)),
        state_
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
