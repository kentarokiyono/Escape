// DOM の HUD / メッセージ / オーバーレイ / 暗証番号パネル
const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.e = {};
    for (const id of ['msg', 'floorTag', 'hudObj', 'hudCode', 'stamBar', 'hudSub', 'prompt', 'cross', 'veil', 'locker', 'map',
      'memo', 'memoTtl', 'memoCode', 'codeUI', 'codeDisp', 'codePad', 'codeErr', 'ov', 'ovTitle', 'ovBody', 'ovBtns', 'settings', 'hud', 'loading']) this.e[id] = $(id);
    this.cache = {};
    this.msgTimer = 0; this.memoTimer = 0;
    this.code = { onDigit: null, onDel: null, onOk: null, onCancel: null };
    this._setupPad();
  }
  _set(key, el, html) { if (this.cache[key] !== html) { this.cache[key] = html; el.innerHTML = html; } }

  loading(text) {
    this.e.loading.textContent = text || '';
    this.e.loading.classList.toggle('hide', !text);
  }

  say(text, sec = 3.4) {
    this.e.msg.textContent = text; this.e.msg.classList.add('on');
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => this.e.msg.classList.remove('on'), sec * 1000);
  }

  hud(d) {
    this._set('floor', this.e.floorTag, d.floor);
    this._set('obj', this.e.hudObj, d.obj);
    this._set('code', this.e.hudCode, d.code);
    this._set('sub', this.e.hudSub, d.sub);
    const w = Math.round(d.stamina) + '%';
    if (this.cache.stam !== w) { this.cache.stam = w; this.e.stamBar.style.width = w; }
    const ex = d.exhausted ? 'ex' : '';
    if (this.cache.ex !== ex) { this.cache.ex = ex; this.e.stamBar.parentElement.classList.toggle('ex', d.exhausted); }
  }
  prompt(text) { this._set('prompt', this.e.prompt, text || ''); }
  showHud(on) { this.e.hud.classList.toggle('hide', !on); this.e.floorTag.classList.toggle('hide', !on); }
  crosshair(on) { this.e.cross.classList.toggle('hide', !on); }
  veil(v, ms = 350) { this.e.veil.style.transition = 'opacity ' + ms + 'ms'; this.e.veil.style.opacity = v; }
  setHidden(on) { this.e.locker.classList.toggle('hide', !on); }

  showMemo(code, n) {
    this.e.memoTtl.textContent = n + 'F → ' + (n + 1) + 'F 階段コード';
    this.e.memoCode.textContent = code;
    this.e.memo.classList.remove('hide');
    clearTimeout(this.memoTimer);
    this.memoTimer = setTimeout(() => this.e.memo.classList.add('hide'), 3200);
  }

  // buttons: [{label, primary, onClick}]
  overlay({ title, body = '', buttons = [], settings = false }) {
    this.e.ovTitle.textContent = title;
    this.e.ovBody.innerHTML = body;
    this.e.ovBtns.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.primary) el.classList.add('primary');
      el.addEventListener('click', (ev) => { ev.stopPropagation(); b.onClick(); });
      this.e.ovBtns.appendChild(el);
    }
    this.e.settings.classList.toggle('hide', !settings);
    this.e.ov.classList.remove('hide');
  }
  hideOverlay() { this.e.ov.classList.add('hide'); }

  // ---------- 暗証番号 ----------
  _setupPad() {
    const pad = this.e.codePad;
    const mk = (label, cls, fn) => {
      const b = document.createElement('button'); b.textContent = label; if (cls) b.classList.add(cls);
      b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
      pad.appendChild(b);
    };
    for (let i = 1; i <= 9; i++) mk(String(i), '', () => this.code.onDigit && this.code.onDigit(i));
    mk('←', 'del', () => this.code.onDel && this.code.onDel());
    mk('0', '', () => this.code.onDigit && this.code.onDigit(0));
    mk('OK', 'ok', () => this.code.onOk && this.code.onOk());
    const cancel = document.createElement('button');
    cancel.textContent = '戻る'; cancel.className = 'cancel';
    cancel.addEventListener('click', (ev) => { ev.stopPropagation(); this.code.onCancel && this.code.onCancel(); });
    this.e.codeUI.querySelector('#codeBox').appendChild(cancel);
  }
  openCode(title) {
    this.e.codeUI.querySelector('.t').textContent = title;
    this.e.codeUI.classList.remove('hide');
    this.codeDisplay([], '');
  }
  codeDisplay(digits, err) {
    let html = '';
    for (let i = 0; i < 4; i++) html += '<span class="c">' + (digits[i] !== undefined ? digits[i] : '') + '</span>';
    this.e.codeDisp.innerHTML = html;
    this.e.codeErr.textContent = err || '';
  }
  closeCode() { this.e.codeUI.classList.add('hide'); }
}
