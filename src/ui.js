// DOM の HUD / メッセージ / 字幕 / 文書 / オーバーレイ / 暗証番号パネル
const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.e = {};
    for (const id of ['msg', 'floorTag', 'hudObj', 'hudCode', 'stamBar', 'hudSub', 'prompt', 'cross', 'veil', 'locker', 'map',
      'memo', 'memoTtl', 'memoCode', 'codeUI', 'codeDisp', 'codePad', 'codeErr', 'ov', 'ovTitle', 'ovBody', 'ovBtns', 'settings', 'hud', 'loading',
      'sub', 'subWho', 'subText', 'note', 'doc', 'docTtl', 'docBody', 'chapter', 'chapNo', 'chapTitle', 'mon', 'monName', 'monTime', 'radar', 'face']) this.e[id] = $(id);
    this.cache = {};
    this.msgTimer = 0; this.memoTimer = 0; this.noteTimer = 0; this.chapTimer = 0;
    this.subQ = []; this.subT = 0; this.subCur = null;
    this.code = { onDigit: null, onDel: null, onOk: null, onCancel: null };
    this._setupPad();
  }
  _set(key, el, html) { if (this.cache[key] !== html) { this.cache[key] = html; el.innerHTML = html; } }

  toast(text) {
    const t = document.getElementById('toast');
    t.textContent = text; t.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('on'), 3500);
  }
  // 配電盤パネル。d=null で閉じる
  panel(d, h) {
    const el = document.getElementById('panel');
    if (!d) { el.classList.add('hide'); return; }
    el.classList.remove('hide');
    document.getElementById('pCap').textContent = d.cap;
    const main = document.getElementById('pMain');
    main.textContent = '主電源： ' + (d.power ? 'ON（押すと切る）' : d.locked ? 'OFF（鍵がかかっている）' : 'OFF（押すと入れる）');
    main.className = d.power ? 'on' : d.locked ? 'locked' : '';
    main.onclick = (e) => { e.stopPropagation(); h.main(); };
    const rows = document.getElementById('pRows');
    rows.innerHTML = '';
    for (const s of d.sys) {
      const b = document.createElement('button');
      b.className = s.on ? 'on' : '';
      b.innerHTML = s.name + '　' + (s.on ? 'ON' : 'OFF') + '<span>' + s.amp + 'A（' + s.amp * 100 + 'W）</span>';
      b.onclick = (e) => { e.stopPropagation(); h.toggle(s.k); };
      rows.appendChild(b);
    }
    const m = document.getElementById('pMeter');
    m.classList.toggle('over', d.load > d.cap);
    m.querySelector('i').style.width = Math.min(100, (d.load / d.cap) * 100) + '%';
    m.querySelector('span').textContent = '合計 ' + d.load + 'A / ' + d.cap + 'A' + (d.power ? '' : '（停電中）');
    document.getElementById('pMsg').textContent = d.msg || '';
    const c = document.getElementById('pClose');
    c.onclick = (e) => { e.stopPropagation(); h.close(); };
  }
  loading(text) {
    this.e.loading.textContent = text || '';
    this.e.loading.classList.toggle('hide', !text);
  }
  say(text, sec = 3.4) {
    this.e.msg.textContent = text; this.e.msg.classList.add('on');
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => this.e.msg.classList.remove('on'), sec * 1000);
  }
  note(text) {
    this.e.note.textContent = text; this.e.note.classList.add('on');
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => this.e.note.classList.remove('on'), 3000);
  }

  // ---------- 字幕（順番に表示） ----------
  subtitles(lines) {
    for (const [who, text] of lines) this.subQ.push({ who, text, sec: Math.max(2.2, text.length * 0.11) });
  }
  clearSubtitles() { this.subQ = []; this.subCur = null; this.subT = 0; this.e.sub.classList.remove('on'); }
  get subBusy() { return !!this.subCur || this.subQ.length > 0; }
  updateSubtitles(dt) {
    if (this.subCur) {
      this.subT -= dt;
      if (this.subT > 0) return;
      this.subCur = null; this.e.sub.classList.remove('on');
      this.subGap = 0.25;
    }
    if (this.subGap > 0) { this.subGap -= dt; return; }
    const s = this.subQ.shift();
    if (!s) return;
    this.subCur = s; this.subT = s.sec;
    this.e.subWho.textContent = s.who || '';
    this.e.subWho.className = 'who ' + whoClass(s.who);
    this.e.subText.textContent = s.text;
    this.e.sub.classList.add('on');
  }

  chapterCard(no, title) {
    this.e.chapNo.textContent = no; this.e.chapTitle.textContent = title;
    this.e.chapter.classList.add('on');
    clearTimeout(this.chapTimer);
    this.chapTimer = setTimeout(() => this.e.chapter.classList.remove('on'), 3600);
  }

  doc(title, body) {
    if (!title) { this.e.doc.classList.add('hide'); return; }
    this.e.docTtl.textContent = title;
    this.e.docBody.innerHTML = body;
    this.e.doc.classList.remove('hide');
  }

  monitor(name) {
    this.e.mon.classList.toggle('hide', !name);
    if (name) {
      this.e.monName.textContent = name;
      const d = new Date(Date.UTC(2015, 10, 3, 2, 14)), t = new Date(d.getTime() + performance.now());
      this.e.monTime.textContent = t.toISOString().replace('T', ' ').slice(0, 19);
    }
  }

  hud(d) {
    this._set('floor', this.e.floorTag, d.floor);
    this._set('obj', this.e.hudObj, d.obj);
    this._set('code', this.e.hudCode, d.code || '');
    this._set('sub', this.e.hudSub, d.sub);
    const w = Math.round(d.stamina) + '%';
    if (this.cache.stam !== w) { this.cache.stam = w; this.e.stamBar.style.width = w; }
    const ex = d.exhausted ? 'ex' : '';
    if (this.cache.ex !== ex) { this.cache.ex = ex; this.e.stamBar.parentElement.parentElement.classList.toggle('ex', d.exhausted); }
  }
  prompt(text) { this._set('prompt', this.e.prompt, text || ''); }
  showHud(on) { this.e.hud.classList.toggle('hide', !on); this.e.floorTag.classList.toggle('hide', !on); }
  crosshair(on) { this.e.cross.classList.toggle('hide', !on); }
  veil(v, ms = 350) { this.e.veil.style.transition = 'opacity ' + ms + 'ms'; this.e.veil.style.opacity = v; }
  setHidden(on) { this.e.locker.classList.toggle('hide', !on); }
  radar(on) { this.e.radar.classList.toggle('hide', !on); }
  robotFace(on) { this.e.face.classList.toggle('on', !!on); }

  showMemo(code, title) {
    this.e.memoTtl.textContent = title;
    this.e.memoCode.textContent = code;
    this.e.memo.classList.remove('hide');
    clearTimeout(this.memoTimer);
    this.memoTimer = setTimeout(() => this.e.memo.classList.add('hide'), 3200);
  }

  // buttons: [{label, primary, onClick, disabled}]
  overlay({ title, body = '', buttons = [], settings = false }) {
    this.e.ovTitle.textContent = title;
    this.e.ovBody.innerHTML = body;
    this.e.ovBtns.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.primary) el.classList.add('primary');
      if (b.disabled) el.disabled = true;
      el.addEventListener('click', (ev) => { ev.stopPropagation(); if (!b.disabled) b.onClick(); });
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

function whoClass(who) {
  if (!who) return '';
  if (who.includes('FR-002') || who.includes('放送')) return 'ai';
  if (who.includes('サキ')) return 'saki';
  if (who.includes('ミケ')) return 'robot';
  return 'me';
}
