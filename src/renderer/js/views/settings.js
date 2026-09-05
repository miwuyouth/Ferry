'use strict';
// 04 / 设置 —— 服务器参数、常驻行为、流量数据源、frpc 位置。
//
// 表单是非受控的：值只在进入页面和外部导入后灌一次，
// 否则每秒一次的状态推送会把正在输入的内容冲掉。

(() => {
  const { $, el, seg, hint, t } = FK;
  const PROTOCOLS = ['tcp', 'kcp', 'quic', 'websocket'];
  const SWITCHES = ['launchAtLogin', 'autoConnect', 'quitOnClose', 'autoReconnect', 'notifyOnError'];
  const LANGS = () => [
    { value: 'system', label: t('lang.system') },
    { value: 'zh', label: t('lang.zh') },
    { value: 'en', label: t('lang.en') }
  ];

  let proto = 'tcp';
  let language = 'system';
  let filled = false;
  let about = null;
  const swNodes = new Map();

  function buildSwitches() {
    const host = $('#swList');
    host.textContent = '';
    for (const key of SWITCHES) {
      const row = el('div', 'sw-row');
      const box = el('div');
      box.style.flex = '1';
      box.append(el('div', 'sw-row-label', t(`sw.${key}`)), el('div', 'sw-row-note', t(`sw.${key}.note`)));
      const sw = el('button', 'sw');
      sw.type = 'button';
      sw.appendChild(el('i'));
      sw.addEventListener('click', async () => {
        const next = !sw.classList.contains('on');
        sw.classList.toggle('on', next);
        await window.ferry.settings.patch({ [key]: next });
      });
      swNodes.set(key, sw);
      row.append(box, sw);
      host.appendChild(row);
    }
  }

  function fill(settings) {
    const set = (sel, value) => {
      const n = $(sel);
      if (n !== document.activeElement) n.value = value ?? '';
    };
    set('#sServerAddr', settings.serverAddr);
    set('#sServerPort', settings.serverPort);
    set('#sToken', settings.token);
    set('#sProxyUrl', settings.proxyUrl);
    set('#sDashAddr', settings.dashboard.addr);
    set('#sDashPort', settings.dashboard.port);
    set('#sDashUser', settings.dashboard.user);
    set('#sDashPassword', settings.dashboard.password);
    if ($('#sDashEnabled') !== document.activeElement) $('#sDashEnabled').checked = !!settings.dashboard.enabled;

    proto = settings.protocol || 'tcp';
    bindProto();
    language = settings.language || 'system';
    bindLang();
    for (const key of SWITCHES) {
      const sw = swNodes.get(key);
      if (sw) sw.classList.toggle('on', !!settings[key]);
    }
  }

  function bindProto() {
    seg($('#protoOpts'), PROTOCOLS, proto, (v) => { proto = v; bindProto(); });
  }

  // 语言不进「保存并重载 frpc」那一批：它跟 frpc 无关，选了就该立刻生效。
  function bindLang() {
    seg($('#langOpts'), LANGS(), language, async (v) => {
      language = v;
      bindLang();
      await window.ferry.settings.patch({ language: v });
    });
  }

  function collect() {
    return {
      serverAddr: $('#sServerAddr').value.trim(),
      serverPort: Number($('#sServerPort').value.trim()) || 7000,
      token: $('#sToken').value,
      protocol: proto,
      proxyUrl: $('#sProxyUrl').value.trim(),
      dashboard: {
        enabled: $('#sDashEnabled').checked,
        addr: $('#sDashAddr').value.trim() || $('#sServerAddr').value.trim(),
        port: Number($('#sDashPort').value.trim()) || 7500,
        user: $('#sDashUser').value.trim(),
        password: $('#sDashPassword').value
      }
    };
  }

  async function save() {
    const patch = collect();
    if (!patch.serverAddr) return hint($('#saveHint'), t('err.addrRequired'), 'err');
    hint($('#saveHint'), t('msg.saving'));
    const { needsRestart } = await window.ferry.settings.patch(patch);
    // serverAddr / token / protocol 这类不吃热重载，得把进程重来一遍。
    const res = needsRestart ? await window.ferry.frpc.restart() : await window.ferry.frpc.apply();
    if (res && res.ok === false) return hint($('#saveHint'), res.message || t('err.applyFailed'), 'err');
    hint($('#saveHint'), t(needsRestart ? 'msg.savedRestarted' : 'msg.savedReloaded'), 'ok');
    setTimeout(() => hint($('#saveHint'), ''), 4000);
  }

  FK.settings = {
    init() {
      buildSwitches();
      bindProto();
      bindLang();

      $('#btnSave').addEventListener('click', save);
      $('#btnTest').addEventListener('click', async () => {
        hint($('#testHint'), t('msg.probing'));
        const res = await window.ferry.frpc.test({
          serverAddr: $('#sServerAddr').value.trim(),
          serverPort: $('#sServerPort').value.trim()
        });
        hint($('#testHint'), res.message, res.ok ? 'ok' : 'err');
      });
      $('#btnExport').addEventListener('click', () => window.ferry.config.export());
      $('#btnReveal').addEventListener('click', () => window.ferry.config.reveal());
      $('#btnImport').addEventListener('click', async () => {
        const res = await window.ferry.config.import();
        if (res.ok) {
          filled = false; // 让下一次 update 用导入后的值重灌表单
          hint($('#saveHint'), t('msg.imported', { n: res.count }), 'ok');
        } else if (res.message) {
          hint($('#saveHint'), t('err.importFailed', { err: res.message }), 'err');
        }
      });
      $('#btnLocate').addEventListener('click', async () => {
        const res = await window.ferry.frpc.locate();
        if (res.ok) {
          $('#aboutPath').textContent = res.path;
          hint($('#saveHint'), t('msg.located', { what: res.version || res.path }), 'ok');
        }
      });
    },

    // 版本和路径是启动时读一次的静态信息，换语言时要重写一遍。
    setAbout(info) {
      about = info;
      const { appVersion, frpcVersion, frpcPath } = info;
      $('#aboutVersions').textContent = `Ferry ${appVersion} · ${frpcVersion || t('about.frpcMissing')}`;
      $('#aboutPath').textContent = frpcPath || t('about.pathMissing');
      $('#aboutPath').title = frpcPath || '';
    },

    update(state) {
      if (!filled) { fill(state.settings); filled = true; }
      if (!FK.app.isActive('settings')) return;
      const m = state.metrics;
      if (state.settings.dashboard.enabled) {
        hint(
          $('#dashHint'),
          m.dashOk ? t('set.dashOk') : t('set.dashFail', { err: m.dashError || t('set.dashNoResp') }),
          m.dashOk ? 'ok' : 'err'
        );
      } else {
        hint($('#dashHint'), '');
      }
    },

    refill(settings) { fill(settings); filled = true; },

    retext() {
      buildSwitches();
      bindProto();
      bindLang();
      if (FK.app.state) fill(FK.app.state.settings);
      if (about) FK.settings.setAbout(about);
    }
  };
})();
