'use strict';
// 首次启动引导 —— 三步，文案来自设计稿。
// 第二步真会写设置并拉起 frpc，第三步显示的是真实结果，不是占位。

(() => {
  const { $, el, hint, t } = FK;

  let step = 1;
  let open = false;

  function renderSteps() {
    const host = $('#obSteps');
    host.textContent = '';
    for (let i = 1; i <= 3; i++) {
      const row = el('div', `onboard-step${step === i ? ' is-current' : ''}`);
      row.appendChild(el('span', 'mono n', String(i)));
      const box = el('div');
      box.append(el('div', null, t(`ob.step${i}`)), el('div', 'onboard-step-note', t(`ob.step${i}.note`)));
      row.appendChild(box);
      host.appendChild(row);
    }
  }

  function render() {
    $('#obKicker').textContent = t('ob.kicker', { n: step });
    $('#obTitle').textContent = t(`ob.${step}.title`);
    $('#obBody').textContent = t(`ob.${step}.body`);
    $('#obServer').hidden = step !== 2;
    $('#obDone').hidden = step !== 3;
    $('#obPrev').disabled = step === 1;
    $('#obNextLabel').textContent = t(step === 3 ? 'btn.start' : 'btn.next');
    renderSteps();
    if (step === 2) $('#obAddr').focus();
  }

  async function next() {
    if (step === 2) {
      const serverAddr = $('#obAddr').value.trim();
      if (!serverAddr) return hint($('#obHint'), t('err.addrRequired'), 'err');
      hint($('#obHint'), t('msg.savingConnecting'));
      await window.ferry.settings.patch({
        serverAddr,
        serverPort: Number($('#obPort').value.trim()) || 7000,
        token: $('#obToken').value
      });
      const res = await window.ferry.frpc.restart();
      if (res && res.ok === false) return hint($('#obHint'), res.message || t('err.startFailed'), 'err');
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
    open = false;
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
        hint($('#obHint'), t('msg.probing'));
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
      open = true;
      $('#obAddr').value = settings.serverAddr || '';
      $('#obPort').value = settings.serverPort || 7000;
      $('#obToken').value = settings.token || '';
      hint($('#obHint'), '');
      render();
      $('#onboard').classList.add('is-open');
    },

    retext() { if (open) render(); },

    // 第三步的那张卡跟着真实连接状态走。
    update(state) {
      if (step !== 3) return;
      const ok = state.frpc.connected;
      $('#obDoneTitle').textContent = ok
        ? t('ob.doneReady')
        : state.frpc.running
          ? t('ob.doneConnecting')
          : t('ob.doneFailed', { err: state.frpc.error || t('stats.card.notRunning') });
    }
  };
})();
