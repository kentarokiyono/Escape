// WebAudio: 立体音響(HRTF)・残響・遮蔽ローパス・環境音・心拍
import * as THREE from 'three';

const _f = new THREE.Vector3(), _u = new THREE.Vector3();

export class AudioSys {
  constructor() {
    this.ctx = null; this.volume = 0.8;
    this.fear = 0; this.breath = 0; this.beatT = 0; this.breathT = 0; this.ambT = 5;
    this.buzz = [];
  }
  get ok() { return !!this.ctx; }
  get now() { return this.ctx.currentTime; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC(); } catch (e) { return false; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.volume;
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.muffle = c.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 18000;
    this.muffle.connect(this.comp); this.comp.connect(this.master); this.master.connect(c.destination);
    this.verb = c.createConvolver(); this.verb.buffer = this.impulse(2.8, 3);
    this.wet = c.createGain(); this.wet.gain.value = 0.32;
    this.verb.connect(this.wet); this.wet.connect(this.muffle);
    this.bus = c.createGain(); this.bus.connect(this.muffle); this.bus.connect(this.verb);
    this.ui = c.createGain(); this.ui.connect(this.comp);
    this.noise = this.makeNoise(2, false); this.brown = this.makeNoise(4, true);
    this.startAmbience();
    return true;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.now, 0.05); }
  setMuffled(on) { if (this.muffle) this.muffle.frequency.setTargetAtTime(on ? 850 : 18000, this.now, 0.08); }

  makeNoise(sec, brown) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  impulse(sec, decay) {
    const c = this.ctx, sr = c.sampleRate, len = Math.floor(sr * sec), b = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch), pre = Math.floor(sr * 0.012);
      for (let i = pre; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      for (let k = 0; k < 7; k++) d[Math.floor(sr * (0.015 + Math.random() * 0.07))] += (Math.random() < 0.5 ? -1 : 1) * 0.5;
    }
    return b;
  }
  setPos(n, x, y, z, smooth) {
    if (n.positionX) {
      if (smooth) { const t = this.now; n.positionX.setTargetAtTime(x, t, 0.03); n.positionY.setTargetAtTime(y, t, 0.03); n.positionZ.setTargetAtTime(z, t, 0.03); }
      else { n.positionX.value = x; n.positionY.value = y; n.positionZ.value = z; }
    } else n.setPosition(x, y, z);
  }
  panner(x, y, z, ref = 1.5) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.maxDistance = 60; p.rolloffFactor = 1.4;
    this.setPos(p, x, y, z, false);
    p.connect(this.bus);
    return p;
  }
  listen(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = cam.position;
    cam.getWorldDirection(_f); _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = _f.x; L.forwardY.value = _f.y; L.forwardZ.value = _f.z;
      L.upX.value = _u.x; L.upY.value = _u.y; L.upZ.value = _u.z;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z); }
  }

  // ---------- 基本ショット ----------
  _env(g, t0, attack, peak, dur) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  noiseShot(dest, { t0 = this.now, dur = 0.1, type = 'bandpass', freq = 1000, f2 = 0, q = 1, vol = 0.1, attack = 0.004, rate = 1, brown = false }) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = brown ? this.brown : this.noise; s.playbackRate.value = rate;
    f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    this._env(g, t0, attack, vol, dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05);
    s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
  }
  toneShot(dest, { t0 = this.now, f = 440, f2 = 0, dur = 0.2, type = 'sine', vol = 0.1, attack = 0.005, detune = 0 }) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0); o.detune.value = detune;
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    this._env(g, t0, attack, vol, dur);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }
  _at(x, y, z, life, ref) {
    const p = this.panner(x, y, z, ref);
    setTimeout(() => p.disconnect(), (life + 0.5) * 1000);
    return p;
  }

  // ---------- 効果音 ----------
  step(surface, kind, wet) {
    if (!this.ctx) return;
    const v = kind === 'dash' ? 0.2 : kind === 'crouch' ? 0.045 : 0.12;
    const t = this.now;
    const fr = surface === 'concrete' ? 900 : 1500;
    this.noiseShot(this.bus, { t0: t, dur: 0.07, freq: fr * (0.85 + Math.random() * 0.3), q: 0.8, vol: v });
    this.toneShot(this.bus, { t0: t, f: 95, f2: 45, dur: 0.09, vol: v * 0.7 });
    if (wet) this.noiseShot(this.bus, { t0: t + 0.01, dur: 0.18, type: 'highpass', freq: 2500, vol: v * 0.6, attack: 0.02 });
  }
  stairs() {
    if (!this.ctx) return;
    for (let i = 0; i < 5; i++) {
      const t = this.now + i * 0.13;
      this.noiseShot(this.bus, { t0: t, dur: 0.06, freq: 1100, vol: 0.1 });
      this.toneShot(this.bus, { t0: t, f: 85, f2: 40, dur: 0.08, vol: 0.09 });
    }
  }
  jingle(x, z, slow, vol = 0.12) {
    if (!this.ctx) return;
    const p = this._at(x, 1.2, z, 2.5, 2.5), t = this.now;
    [523, 659, 784, 1046].forEach((f, i) => {
      const d = slow ? 0.32 : 0.12, ff = slow ? f * 0.5 : f;
      this.toneShot(p, { t0: t + i * (slow ? 0.33 : 0.12), f: ff, dur: d, type: slow ? 'sawtooth' : 'sine', vol });
      if (slow) this.toneShot(p, { t0: t + i * 0.33, f: ff, dur: d, type: 'triangle', vol: vol * 0.6, detune: -35 });
    });
    this.noiseShot(p, { dur: 0.25, freq: 3000, vol: 0.03 });
  }
  chime(x, z) {
    if (!this.ctx) return;
    const p = this._at(x, 1, z, 1.2, 2), t = this.now;
    this.toneShot(p, { t0: t, f: 988, dur: 0.18, vol: 0.12 });
    this.toneShot(p, { t0: t + 0.16, f: 1319, dur: 0.35, vol: 0.12 });
  }
  pa() {
    if (!this.ctx) return;
    const t = this.now;
    this.noiseShot(this.bus, { t0: t, dur: 0.3, freq: 2500, vol: 0.025 });
    this.toneShot(this.bus, { t0: t + 0.05, f: 784, dur: 0.5, vol: 0.06 });
    this.toneShot(this.bus, { t0: t + 0.45, f: 622, dur: 0.8, vol: 0.06 });
  }
  door(type, x, z) {
    if (!this.ctx) return;
    const p = this._at(x, 1.2, z, 2.5, 2), t = this.now;
    if (type === 'shutter') {
      this.noiseShot(p, { t0: t, dur: 2.0, type: 'bandpass', freq: 900, q: 2, vol: 0.12, attack: 0.1 });
      for (let i = 0; i < 12; i++) this.noiseShot(p, { t0: t + i * 0.16, dur: 0.05, freq: 2200, vol: 0.06 });
    } else {
      this.toneShot(p, { t0: t, f: 1400, dur: 0.08, vol: 0.06 });
      this.noiseShot(p, { t0: t + 0.1, dur: 0.6, type: 'lowpass', freq: 600, vol: 0.12, attack: 0.05 });
    }
  }
  breaker(x, z) {
    if (!this.ctx) return;
    const p = this._at(x, 1.4, z, 1.5, 2), t = this.now;
    this.noiseShot(p, { t0: t, dur: 0.12, type: 'lowpass', freq: 1200, vol: 0.3 });
    this.toneShot(p, { t0: t, f: 120, f2: 60, dur: 0.3, vol: 0.2 });
    this.noiseShot(this.bus, { t0: t + 0.2, dur: 1.2, freq: 120, q: 4, vol: 0.06, attack: 0.3 });
  }
  servo() { if (this.ctx) this.noiseShot(this.bus, { dur: 0.12, freq: 700, q: 3, vol: 0.03, attack: 0.02 }); }
  land(v) {
    if (!this.ctx) return;
    const k = Math.min(1, v / 8), t = this.now;
    this.toneShot(this.bus, { t0: t, f: 80, f2: 35, dur: 0.25, vol: 0.2 + k * 0.3 });
    this.noiseShot(this.bus, { t0: t, dur: 0.2, type: 'lowpass', freq: 900, vol: 0.15 + k * 0.25 });
  }
  liftRide(sec) {
    if (!this.ctx) return;
    const t = this.now;
    this.noiseShot(this.bus, { t0: t, dur: sec, type: 'bandpass', freq: 160, q: 3, vol: 0.12, attack: 0.4, brown: true });
    this.toneShot(this.bus, { t0: t, f: 70, f2: 74, dur: sec, type: 'sawtooth', vol: 0.03, attack: 0.4 });
    this.noiseShot(this.bus, { t0: t + sec - 0.3, dur: 0.15, type: 'lowpass', freq: 800, vol: 0.25 });
    this.toneShot(this.bus, { t0: t + sec - 0.1, f: 1046, dur: 0.4, vol: 0.05 });
  }
  footAt(x, z, vol) {
    if (!this.ctx) return;
    const p = this._at(x, 0.2, z, 0.4, 1.5);
    this.noiseShot(p, { dur: 0.07, freq: 1400 * (0.85 + Math.random() * 0.3), q: 0.8, vol });
    this.toneShot(p, { f: 95, f2: 45, dur: 0.09, vol: vol * 0.7 });
  }
  scream(x, z) {
    if (!this.ctx) return;
    const p = this._at(x, 1.5, z, 2, 3), t = this.now;
    this.noiseShot(p, { t0: t, dur: 0.8, freq: 1800, f2: 900, q: 6, vol: 0.18, attack: 0.03 });
    this.toneShot(p, { t0: t, f: 620, f2: 380, dur: 0.8, type: 'sawtooth', vol: 0.04 });
  }
  // 物語用: 低い持続音（不穏）
  drone(on) {
    if (!this.ctx) return;
    if (!this._drone) {
      const c = this.ctx, g = c.createGain(); g.gain.value = 0; g.connect(this.ui);
      for (const f of [55, 58.3, 82.4]) { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.connect(g); o.start(); }
      this._drone = g;
    }
    this._drone.gain.setTargetAtTime(on ? 0.035 * on : 0, this.now, 1.2);
  }
  uiTone(f, dur = 0.06, type = 'sine', vol = 0.08) { if (this.ctx) this.toneShot(this.ui, { f, dur, type, vol }); }
  click() { if (this.ctx) { this.noiseShot(this.ui, { dur: 0.02, type: 'highpass', freq: 3000, vol: 0.12 }); this.toneShot(this.ui, { f: 2200, dur: 0.02, vol: 0.03 }); } }
  locker(open) {
    if (!this.ctx) return;
    const t = this.now;
    this.noiseShot(this.bus, { t0: t, dur: 0.45, freq: open ? 500 : 380, f2: open ? 260 : 600, q: 6, vol: 0.06, attack: 0.05 });
    this.toneShot(this.bus, { t0: t + (open ? 0.05 : 0.35), f: 310, f2: 290, dur: 0.25, type: 'triangle', vol: 0.09 });
    this.noiseShot(this.bus, { t0: t + (open ? 0.05 : 0.35), dur: 0.08, freq: 1800, vol: 0.1 });
  }
  pickup() { if (!this.ctx) return; const t = this.now; [2100, 2600, 1900].forEach((f, i) => this.toneShot(this.bus, { t0: t + i * 0.06, f, dur: 0.25, type: 'triangle', vol: 0.05 })); }
  unlock() { if (!this.ctx) return; const t = this.now; this.noiseShot(this.bus, { t0: t, dur: 0.05, freq: 1500, vol: 0.12 }); this.noiseShot(this.bus, { t0: t + 0.12, dur: 0.06, freq: 1200, vol: 0.14 }); this.toneShot(this.ui, { t0: t + 0.2, f: 1320, dur: 0.15, vol: 0.06 }); }
  locked() { if (!this.ctx) return; const t = this.now; for (let i = 0; i < 3; i++) this.noiseShot(this.bus, { t0: t + i * 0.09, dur: 0.07, type: 'lowpass', freq: 700, vol: 0.16 }); }
  error() { this.uiTone(180, 0.18, 'sawtooth', 0.08); }
  staticBurst(vol = 0.05) { if (this.ctx) this.noiseShot(this.ui, { dur: 0.3, freq: 3500, q: 0.5, vol }); }
  caught() {
    if (!this.ctx) return;
    const t = this.now;
    this.noiseShot(this.ui, { t0: t, dur: 1.4, freq: 2500, q: 0.4, vol: 0.25, attack: 0.02 });
    this.toneShot(this.ui, { t0: t, f: 220, f2: 55, dur: 1.4, type: 'sawtooth', vol: 0.12 });
    this.toneShot(this.ui, { t0: t, f: 233, f2: 58, dur: 1.4, type: 'square', vol: 0.05 });
  }

  // ---------- ロボットの駆動音（ループ） ----------
  robotVoice() {
    if (!this.ctx) return null;
    const c = this.ctx, p = this.panner(0, 0.6, 0, 2);
    const out = c.createGain(); out.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
    out.connect(lp); lp.connect(p);
    const base = 50 + Math.random() * 10;
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = base;
    const g1 = c.createGain(); g1.gain.value = 0.22; o1.connect(g1); g1.connect(out);
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = base * 2.01;
    const g2 = c.createGain(); g2.gain.value = 0.05; o2.connect(g2); g2.connect(out);
    const nz = c.createBufferSource(); nz.buffer = this.noise; nz.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 1.2;
    const g3 = c.createGain(); g3.gain.value = 0.3; nz.connect(bp); bp.connect(g3); g3.connect(out);
    o1.start(); o2.start(); nz.start();
    const nodes = [o1, o2, nz, g1, g2, g3, bp, out, lp, p];
    return {
      update: (x, z, speed, state, occluded, y = 0) => {
        const t = this.now;
        this.setPos(p, x, y + 0.6, z, true);
        const v = state === 'sleep' ? 0 : 0.04 + speed * 0.05 + (state === 'chase' ? 0.04 : 0);
        out.gain.setTargetAtTime(v, t, 0.12);
        lp.frequency.setTargetAtTime(occluded ? 480 : 3200, t, 0.1);
        o1.frequency.setTargetAtTime(base + speed * 7, t, 0.2);
        g3.gain.setTargetAtTime(0.05 + speed * 0.35, t, 0.1);
      },
      dispose: () => {
        try { o1.stop(); o2.stop(); nz.stop(); } catch (e) { /* 停止済み */ }
        for (const n of nodes) n.disconnect();
      },
    };
  }

  // ---------- 環境音 ----------
  startAmbience() {
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = 0.05; g.connect(this.bus);
    const hv = c.createBufferSource(); hv.buffer = this.brown; hv.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    hv.connect(lp); lp.connect(g); hv.start();
    for (const f of [41, 41.7, 82.3]) {
      const o = c.createOscillator(); o.frequency.value = f;
      const og = c.createGain(); og.gain.value = f > 80 ? 0.12 : 0.35;
      o.connect(og); og.connect(g); o.start();
    }
  }
  // 近くの点滅蛍光灯のジー音（3ボイスを最寄りの照明へ移動）
  updateBuzz(spots) {
    if (!this.ctx) return;
    if (!this.buzz.length) {
      this.buzz = [0, 1, 2].map(() => {
        const c = this.ctx, p = this.panner(0, 2.8, 0, 1.2);
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 100;
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 240; bp.Q.value = 3;
        const g = c.createGain(); g.gain.value = 0;
        o.connect(bp); bp.connect(g); g.connect(p); o.start();
        return { p, g };
      });
    }
    this.buzz.forEach((b, i) => {
      const s = spots[i];
      if (s) this.setPos(b.p, s.x, s.y, s.z, false);
      b.g.gain.setTargetAtTime(s ? s.v * 0.04 : 0, this.now, 0.02);
    });
  }

  update(dt, lp) {
    if (!this.ctx) return;
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 5 + Math.random() * 12;
      const a = Math.random() * Math.PI * 2, d = 6 + Math.random() * 16;
      const x = lp.x + Math.cos(a) * d, z = lp.z + Math.sin(a) * d, r = Math.random();
      if (r < 0.4) { const p = this._at(x, 2.9, z, 0.5, 1); this.toneShot(p, { f: 1300 + Math.random() * 600, f2: 420, dur: 0.09, vol: 0.06 }); }
      else if (r < 0.7) { const p = this._at(x, 1.5, z, 1.6, 2); this.noiseShot(p, { dur: 1.3, freq: 320, f2: 160, q: 8, vol: 0.05, attack: 0.3 }); }
      else if (r < 0.88) { const p = this._at(x, 1, z, 0.8, 3); this.toneShot(p, { f: 60, f2: 35, dur: 0.4, vol: 0.18 }); this.noiseShot(p, { dur: 0.3, type: 'lowpass', freq: 400, vol: 0.1 }); }
      else this.jingle(x * 2 - lp.x, z * 2 - lp.z, true, 0.03);
    }
    if (this.fear > 0.12) {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        this.beatT = 60 / (62 + this.fear * 85);
        const t = this.now, v = 0.08 + this.fear * 0.22;
        this.toneShot(this.ui, { t0: t, f: 58, f2: 40, dur: 0.12, vol: v });
        this.toneShot(this.ui, { t0: t + 0.17, f: 50, f2: 36, dur: 0.12, vol: v * 0.7 });
      }
    }
    if (this.breath > 0.05) {
      this.breathT -= dt;
      if (this.breathT <= 0) {
        this.breathT = 0.85 + Math.random() * 0.2;
        this.noiseShot(this.ui, { dur: 0.55, freq: 900, f2: 600, q: 1.5, vol: 0.05 * this.breath, attack: 0.18 });
      }
    }
  }
}
