'use strict';
// 主窗口的壳：导航、标题栏、左栏状态，以及各视图的分发。

(() => {
  const { $, $$, rate, duration, t } = FK;

  if (window.ferry && window.ferry.platform && window.ferry.platform !== 'darwin') {
    document.body.classList.add('not-darwin');
  }

  const SUBS = {
    list: (s) => t('sub.list', { n: s.tunnels.length, on: s.tunnels.filter((x) => x.kind === 'on').length }),
    log: () => t('sub.log'),
    stats: () => t('sub.stats'),
    settings: () => t('sub.settings')
  };

  // 左栏两条速率条是相对刻度：以本次会话见过的峰值为满格，
  // 否则不知道该按什么当 100%。
  let peak = 1;

  let view = 'list';
  let state = null;

  function setView(next) {
    if (!SUBS[next]) return;
    view = next;
    for (const n of $$('.view')) n.classList.toggle('is-active', n.dataset.view === next);
    for (const n of $$('.nav-item')) n.classList.toggle('is-active', n.dataset.go === next);
    if (state) paint();
  }

  function paintChrome() {
    $('#viewTitle').textContent = t(`title.${view}`);
    $('#viewSub').textContent = SUBS[view](state);

    const f = state.frpc;
    const tag = $('#connTag');
    if (f.connected) {
      tag.textContent = t('conn.connectedTo', { addr: state.settings.serverAddr });
      tag.className = 'tag tag-accent';
    } else if (f.running) {
      tag.textContent = t('conn.connecting');
      tag.className = 'tag tag-neutral';
    } else {
      tag.textContent = t(f.error ? 'conn.disconnected' : 'conn.idle');
      tag.className = 'tag tag-outline';
    }
    tag.title = f.error || '';
    $('#btnPower').textContent = t(f.running ? 'btn.disconnect' : 'btn.connect');
  }

  function paintRail() {
    const f = state.frpc;
    const s = state.settings;
    $('#railHost').textContent = s.serverAddr || t('rail.notConfigured');
    $('#railMeta').textContent = s.serverAddr
      ? `:${s.serverPort} · ${s.protocol}${f.runId ? ` · run ${f.runId.slice(0, 8)}` : ''}`
      : t('rail.fillServer');

    const dot = $('#railDot');
    dot.className = `dot ${f.connected ? 'on' : f.running ? 'pending' : ''}`;
    $('#railBeat').textContent = f.connected
      ? t('rail.connectedFor', { d: duration(f.since) })
      : f.running ? t('rail.connecting') : t(f.error ? 'rail.failed' : 'conn.idle');

    const m = state.metrics;
    peak = Math.max(peak, m.rate.up, m.rate.down);
    $('#railUp').textContent = m.dashOk ? rate(m.rate.up) : '—';
    $('#railDown').textContent = m.dashOk ? rate(m.rate.down) : '—';
    $('#railUpBar').style.width = m.dashOk ? `${Math.min(100, (m.rate.up / peak) * 100)}%` : '0%';
    $('#railDownBar').style.width = m.dashOk ? `${Math.min(100, (m.rate.down / peak) * 100)}%` : '0%';
  }

  // 语言由主进程解析好（settings.language 为 system 时按系统 locale 落地），
  // 跟着状态推送一起过来。变了就重刷静态文案 + 各视图里 JS 生成的标签。
  function syncLang(next) {
    if (!FK.setLang(next)) return;
    FK.tunnels.retext();
    FK.logs.retext();
    FK.settings.retext();
    FK.onboarding.retext();
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
    const b = await window.ferry.bootstrap();
    state = b;

    FK.i18n.setLang(b.lang);
    FK.i18n.applyStatic(document);

    FK.tunnels.init();
    FK.logs.init(b.logs);
    FK.stats.init();
    FK.settings.init();
    FK.settings.setAbout(b);
    FK.onboarding.init();

    for (const n of $$('[data-go]')) n.addEventListener('click', () => setView(n.dataset.go));

    $('#btnPower').addEventListener('click', async () => {
      if (state.frpc.running) await window.ferry.frpc.stop();
      else await window.ferry.frpc.start();
    });
    $('#btnOnboard').addEventListener('click', () => FK.onboarding.open(state.settings));

    window.ferry.onState((s) => { state = s; syncLang(s.lang); paint(); });
    window.ferry.onLogs((batch) => FK.logs.push(batch));

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
