'use strict';
// 首次启动引导 —— 三步，文案来自设计稿。
// 第二步真会写设置并拉起 frpc，第三步显示的是真实结果，不是占位。

(() => {
  const { $, el, hint } = FK;

  const COPY = {
    1: ['欢迎使用 Ferry', 'Ferry 是 macOS 上的 frp 客户端。它托管 frpc 进程，把配置变成表单，并在菜单栏显示实时状态。三步即可开始。'],
    2: ['连接你的 frps', '填写服务器地址与 token。参数会写入 frpc.toml，之后可在设置中随时修改。'],
    3: ['准备就绪', '控制连接已建立。现在可以新建隧道，把本机端口暴露到公网。']
  };

  const STEPS = [
    ['1', '欢迎', 'Ferry 能做什么'],
    ['2', '连接服务器', '地址、端口与 token'],
    ['3', '完成', '新建第一条隧道']
  ];

  let step = 1;

  function renderSteps() {
    const host = $('#obSteps');
    host.textContent = '';
    STEPS.forEach(([n, label, note], i) => {
      const row = el('div', `onboard-step${step === i + 1 ? ' is-current' : ''}`);
      row.appendChild(el('span', 'mono n', n));
      const box = el('div');
      box.append(el('div', null, label), el('div', 'onboard-step-note', note));
      row.appendChild(box);
      host.appendChild(row);
    });
  }

  function render() {
    $('#obN').textContent = String(step);
    $('#obTitle').textContent = COPY[step][0];
    $('#obBody').textContent = COPY[step][1];
    $('#obServer').hidden = step !== 2;
    $('#obDone').hidden = step !== 3;
    $('#obPrev').disabled = step === 1;
    $('#obNextLabel').textContent = step === 3 ? '开始使用' : '继续';
    renderSteps();
    if (step === 2) $('#obAddr').focus();
  }

  async function next() {
    if (step === 2) {
      const serverAddr = $('#obAddr').value.trim();
      if (!serverAddr) return hint($('#obHint'), '请填写服务器地址。', 'err');
      hint($('#obHint'), '保存并连接…');
      await window.ferry.settings.patch({
        serverAddr,
        serverPort: Number($('#obPort').value.trim()) || 7000,
        token: $('#obToken').value
      });
      const res = await window.ferry.frpc.restart();
      if (res && res.ok === false) return hint($('#obHint'), res.message || '启动失败。', 'err');
      hint($('#obHint'), '');
      step = 3;
      render();
      return;
    }
    if (step === 3) { finish(); return; }
    step++;
    render();
  }

  async function finish() {
    await window.ferry.onboardDone();
    $('#onboard').classList.remove('is-open');
    FK.settings.refill(FK.app.state.settings);
  }

  FK.onboarding = {
    init() {
      $('#obNext').addEventListener('click', next);
      $('#obPrev').addEventListener('click', () => { if (step > 1) { step--; render(); } });
      $('#obSkip').addEventListener('click', finish);
      $('#obTest').addEventListener('click', async () => {
        hint($('#obHint'), '拨测中…');
        const res = await window.ferry.frpc.test({
          serverAddr: $('#obAddr').value.trim(),
          serverPort: $('#obPort').value.trim()
        });
        hint($('#obHint'), res.message, res.ok ? 'ok' : 'err');
      });
      $('#obImport').addEventListener('click', async () => {
        const res = await window.ferry.config.import();
        if (res.ok) finish();
      });
    },

    open(settings) {
      step = 1;
      $('#obAddr').value = settings.serverAddr || '';
      $('#obPort').value = settings.serverPort || 7000;
      $('#obToken').value = settings.token || '';
      hint($('#obHint'), '');
      render();
      $('#onboard').classList.add('is-open');
    },

    // 第三步的那张卡跟着真实连接状态走。
    update(state) {
      if (step !== 3) return;
      const ok = state.frpc.connected;
      $('#obDoneTitle').textContent = ok
        ? '已就绪：控制连接建立，配置写入 frpc.toml。'
        : state.frpc.running
          ? '配置已写入，正在与 frps 建立控制连接…'
          : `尚未连接：${state.frpc.error || 'frpc 未运行'}`;
    }
  };
})();
