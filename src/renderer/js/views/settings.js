'use strict';
// 04 / 设置 —— 服务器参数、常驻行为、流量数据源、frpc 位置。
//
// 表单是非受控的：值只在进入页面和外部导入后灌一次，
// 否则每秒一次的状态推送会把正在输入的内容冲掉。

(() => {
  const { $, el, seg, hint } = FK;
  const PROTOCOLS = ['tcp', 'kcp', 'quic', 'websocket'];

  const SWITCHES = [
    ['launchAtLogin', '开机启动', '登录时以后台方式启动 Ferry'],
    ['autoConnect', '启动后自动连接', '打开应用即建立控制连接'],
    ['quitOnClose', '关闭窗口时退出', '关掉则仅隐藏窗口，保留菜单栏图标'],
    ['autoReconnect', '断线自动重连', '指数退避，最多重试 10 次'],
    ['notifyOnError', '连接异常时发送通知', '使用 macOS 通知中心']
  ];

  let proto = 'tcp';
  let filled = false;
  const swNodes = new Map();

  function buildSwitches() {
    const host = $('#swList');
    host.textContent = '';
    for (const [key, label, note] of SWITCHES) {
      const row = el('div', 'sw-row');
      const box = el('div');
      box.style.flex = '1';
      box.append(el('div', 'sw-row-label', label), el('div', 'sw-row-note', note));
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
    for (const [key] of SWITCHES) {
      const sw = swNodes.get(key);
      if (sw) sw.classList.toggle('on', !!settings[key]);
    }
  }

  function bindProto() {
    seg($('#protoOpts'), PROTOCOLS, proto, (v) => { proto = v; bindProto(); });
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
    if (!patch.serverAddr) return hint($('#saveHint'), '请先填写服务器地址。', 'err');
    hint($('#saveHint'), '保存中…');
    const { needsRestart } = await window.ferry.settings.patch(patch);
    // serverAddr / token / protocol 这类不吃热重载，得把进程重来一遍。
    const res = needsRestart ? await window.ferry.frpc.restart() : await window.ferry.frpc.apply();
    if (res && res.ok === false) return hint($('#saveHint'), res.message || '应用失败。', 'err');
    hint($('#saveHint'), needsRestart ? '已保存，frpc 已重启。' : '已保存并热重载。', 'ok');
    setTimeout(() => hint($('#saveHint'), ''), 4000);
  }

  FK.settings = {
    init() {
      buildSwitches();
      bindProto();

      $('#btnSave').addEventListener('click', save);
      $('#btnTest').addEventListener('click', async () => {
        hint($('#testHint'), '拨测中…');
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
          hint($('#saveHint'), `已导入 ${res.count} 条隧道，frpc 已重启。`, 'ok');
        } else if (res.message) {
          hint($('#saveHint'), `导入失败：${res.message}`, 'err');
        }
      });
      $('#btnLocate').addEventListener('click', async () => {
        const res = await window.ferry.frpc.locate();
        if (res.ok) {
          $('#aboutPath').textContent = res.path;
          hint($('#saveHint'), `已选择 ${res.version || res.path}`, 'ok');
        }
      });
    },

    // 版本和路径是启动时读一次的静态信息。
    setAbout({ appVersion, frpcVersion, frpcPath }) {
      $('#aboutVersions').textContent = `Ferry ${appVersion} · ${frpcVersion || 'frpc 未找到'}`;
      $('#aboutPath').textContent = frpcPath || '未找到 frpc —— 可用 brew install frp 安装，或在右侧手动选择。';
      $('#aboutPath').title = frpcPath || '';
    },

    update(state) {
      if (!filled) { fill(state.settings); filled = true; }
      if (!FK.app.isActive('settings')) return;
      const m = state.metrics;
      if (state.settings.dashboard.enabled) {
        hint($('#dashHint'), m.dashOk ? '面板可达，正在读取流量。' : `面板读取失败：${m.dashError || '未响应'}`, m.dashOk ? 'ok' : 'err');
      } else {
        hint($('#dashHint'), '');
      }
    },

    refill(settings) { fill(settings); filled = true; }
  };
})();
