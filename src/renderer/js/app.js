'use strict';
// 主窗口的壳：导航、标题栏、左栏状态，以及各视图的分发。

(() => {
  const { $, $$, rate, duration } = FK;

  const TITLES = {
    list: ['隧道', (s) => `${s.tunnels.length} 条代理 · ${s.tunnels.filter((t) => t.kind === 'on').length} 个运行中`],
    log: ['实时日志', () => 'frpc 标准输出'],
    stats: ['流量与连接', () => '近 24 小时'],
    settings: ['设置', () => 'frpc 客户端配置']
  };

  // 左栏两条速率条是相对刻度：以本次会话见过的峰值为满格，
  // 否则不知道该按什么当 100%。
  let peak = 1;

  let view = 'list';
  let state = null;

  function setView(next) {
    if (!TITLES[next]) return;
    view = next;
    for (const n of $$('.view')) n.classList.toggle('is-active', n.dataset.view === next);
    for (const n of $$('.nav-item')) n.classList.toggle('is-active', n.dataset.go === next);
    if (state) paint();
  }

  function paintChrome() {
    const [title, sub] = TITLES[view];
    $('#viewTitle').textContent = title;
    $('#viewSub').textContent = sub(state);

    const f = state.frpc;
    const tag = $('#connTag');
    if (f.connected) {
      tag.textContent = `已连接 ${state.settings.serverAddr}`;
      tag.className = 'tag tag-accent';
    } else if (f.running) {
      tag.textContent = '连接中…';
      tag.className = 'tag tag-neutral';
    } else {
      tag.textContent = f.error ? '未连接' : '未运行';
      tag.className = 'tag tag-outline';
    }
    tag.title = f.error || '';
    $('#btnPower').textContent = f.running ? '断开' : '连接';
  }

  function paintRail() {
    const f = state.frpc;
    const s = state.settings;
    $('#railHost').textContent = s.serverAddr || '未配置';
    $('#railMeta').textContent = s.serverAddr
      ? `:${s.serverPort} · ${s.protocol}${f.runId ? ` · run ${f.runId.slice(0, 8)}` : ''}`
      : '在设置中填写服务器地址';

    const dot = $('#railDot');
    dot.className = `dot ${f.connected ? 'on' : f.running ? 'pending' : ''}`;
    $('#railBeat').textContent = f.connected
      ? `已连接 ${duration(f.since)}`
      : f.running ? '正在连接…' : f.error ? '连接失败' : '未运行';

    const m = state.metrics;
    peak = Math.max(peak, m.rate.up, m.rate.down);
    $('#railUp').textContent = m.dashOk ? rate(m.rate.up) : '—';
    $('#railDown').textContent = m.dashOk ? rate(m.rate.down) : '—';
    $('#railUpBar').style.width = m.dashOk ? `${Math.min(100, (m.rate.up / peak) * 100)}%` : '0%';
    $('#railDownBar').style.width = m.dashOk ? `${Math.min(100, (m.rate.down / peak) * 100)}%` : '0%';
  }

  function paint() {
    paintChrome();
    paintRail();
    FK.tunnels.update(state);
    FK.logs.update(state);
    FK.stats.update(state);
    FK.settings.update(state);
    FK.onboarding.update(state);
  }

  FK.app = {
    get state() { return state; },
    isActive: (v) => view === v,
    repaint: () => state && paint(),
    setView
  };

  async function boot() {
    const b = await window.frpkit.bootstrap();
    state = b;

    FK.tunnels.init();
    FK.logs.init(b.logs);
    FK.stats.init();
    FK.settings.init();
    FK.settings.setAbout(b);
    FK.onboarding.init();

    for (const n of $$('[data-go]')) n.addEventListener('click', () => setView(n.dataset.go));

    $('#btnPower').addEventListener('click', async () => {
      if (state.frpc.running) await window.frpkit.frpc.stop();
      else await window.frpkit.frpc.start();
    });
    $('#btnOnboard').addEventListener('click', () => FK.onboarding.open(state.settings));

    window.frpkit.onState((s) => { state = s; paint(); });
    window.frpkit.onLogs((batch) => FK.logs.push(batch));

    // 侧栏选中态跟着窗口是否是前台走——聚焦时是实心 accent，
    // 失焦时退成中性灰，跟 Finder / Mail 的侧栏一个道理。
    window.addEventListener('focus', () => document.body.classList.add('is-key'));
    window.addEventListener('blur', () => document.body.classList.remove('is-key'));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        FK.tunnels.closeSheet();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'n' && view === 'list') {
        e.preventDefault();
        $('#btnNew').click();
      } else if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        setView(['list', 'log', 'stats', 'settings'][Number(e.key) - 1]);
      }
    });

    paint();
    // 没走过引导、或者压根还没填服务器，就直接把引导推到脸前。
    if (!b.onboarded || !b.settings.serverAddr) FK.onboarding.open(b.settings);
  }

  boot();
})();
