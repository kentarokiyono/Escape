// スマホ（横画面）用のタッチ操作: 左スティックで移動、右側ドラッグで視点、ボタン類
export const isTouch = () => new URLSearchParams(location.search).has('touch') || (matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window);

const BTNS = [
  ['use', '調べる', 'big'],
  ['dash', '走る', 'big'],
  ['crouch', 'しゃがむ', ''],
  ['flash', 'ライト', ''],
  ['map', 'マップ', ''],
];

export class TouchControls {
  constructor(game, settings) {
    this.g = game; this.settings = settings;
    this.stick = null; this.look = null;
    game.touchMove = { x: 0, y: 0, active: false };
    document.body.classList.add('touch');
    const root = document.createElement('div'); root.id = 'touch';
    root.innerHTML =
      '<div id="tStick" class="hide"><div id="tKnob"></div></div>' +
      '<div id="tBtns">' + BTNS.map(([a, l, c]) => '<button data-act="' + a + '" class="' + c + '">' + l + '</button>').join('') + '</div>' +
      '<button id="tPause" data-act="pause">||</button>' +
      '<div id="tMon"><button data-act="prev">◀</button><button data-act="back">戻る</button><button data-act="next">▶</button></div>';
    document.getElementById('ui').appendChild(root);
    this.root = root; this.stickEl = root.querySelector('#tStick'); this.knob = root.querySelector('#tKnob');
    this.monEl = root.querySelector('#tMon');
    const rot = document.createElement('div'); rot.id = 'rotate'; rot.innerHTML = '<div>↻</div><p>端末を横向きにしてください</p>';
    document.body.appendChild(rot);

    for (const b of root.querySelectorAll('button')) {
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); this.press(b.dataset.act, true, b); }, { passive: false });
      b.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); this.press(b.dataset.act, false, b); }, { passive: false });
      b.addEventListener('touchcancel', () => this.press(b.dataset.act, false, b));
    }
    const area = game.renderer.domElement;
    area.addEventListener('touchstart', (e) => this.start(e), { passive: false });
    area.addEventListener('touchmove', (e) => this.move(e), { passive: false });
    area.addEventListener('touchend', (e) => this.end(e), { passive: false });
    area.addEventListener('touchcancel', (e) => this.end(e), { passive: false });
    // 画面外へ出たら一時停止
    document.addEventListener('visibilitychange', () => { if (document.hidden && (game.state === 'play' || game.state === 'monitor')) game.pause(); });
  }

  get playing() { const s = this.g.state; return s === 'play' || s === 'trans' || s === 'monitor'; }

  press(act, down, el) {
    const g = this.g;
    if (el) el.classList.toggle('on', down && (act === 'dash'));
    if (act === 'dash') { g.keys.ShiftLeft = down; return; }
    if (!down) return;
    if (g.state === 'monitor') {
      if (act === 'prev') g.cycleMonitor(-1); else if (act === 'next') g.cycleMonitor(1); else if (act === 'back' || act === 'use') g.exitMonitor();
      return;
    }
    switch (act) {
      case 'use': g.interact(); break;
      case 'crouch': g.keys.KeyC = !g.keys.KeyC; this.root.querySelector('[data-act=crouch]').classList.toggle('on', !!g.keys.KeyC); break;
      case 'flash': g.toggleFlash(); break;
      case 'map': g.toggleMap(); break;
      case 'pause': if (g.state === 'play' || g.state === 'monitor') g.pause(); break;
    }
  }

  start(e) {
    if (!this.playing) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.42 && !this.stick) {
        this.stick = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        this.stickEl.style.left = t.clientX + 'px'; this.stickEl.style.top = t.clientY + 'px';
        this.stickEl.classList.remove('hide'); this.knob.style.transform = 'translate(-50%,-50%)';
      } else if (!this.look) this.look = { id: t.identifier, x: t.clientX, y: t.clientY };
    }
  }
  move(e) {
    e.preventDefault();
    const g = this.g;
    for (const t of e.changedTouches) {
      if (this.stick && t.identifier === this.stick.id) {
        const R = Math.min(70, innerHeight * 0.16);
        let dx = t.clientX - this.stick.x0, dy = t.clientY - this.stick.y0;
        const l = Math.hypot(dx, dy);
        if (l > R) { dx *= R / l; dy *= R / l; }
        this.knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
        const m = g.touchMove, dead = 0.12;
        const nx = dx / R, ny = dy / R, mag = Math.hypot(nx, ny);
        m.active = mag > dead; m.x = mag > dead ? nx : 0; m.y = mag > dead ? ny : 0;
      } else if (this.look && t.identifier === this.look.id) {
        const k = 0.0042 * (this.settings.sens || 1);
        if (g.state === 'play' || g.state === 'trans') g.player.look((t.clientX - this.look.x) * k, (t.clientY - this.look.y) * k);
        this.look.x = t.clientX; this.look.y = t.clientY;
      }
    }
  }
  end(e) {
    for (const t of e.changedTouches) {
      if (this.stick && t.identifier === this.stick.id) {
        this.stick = null; this.stickEl.classList.add('hide');
        Object.assign(this.g.touchMove, { x: 0, y: 0, active: false });
      } else if (this.look && t.identifier === this.look.id) this.look = null;
    }
  }

  // 毎フレーム: 表示切替
  update() {
    const s = this.g.state;
    this.root.classList.toggle('hide', !(s === 'play' || s === 'trans' || s === 'code' || s === 'monitor'));
    this.monEl.classList.toggle('show', s === 'monitor');
    if (!this.playing && this.stick) this.end({ changedTouches: [{ identifier: this.stick.id }] });
  }

  // 開始時: 全画面・横向き固定（対応端末のみ）
  static enterFullscreen() {
    const el = document.documentElement;
    try {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen();
      if (p && p.then) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    } catch (e) { /* 非対応 */ }
  }
}
