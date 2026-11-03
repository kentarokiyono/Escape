// ロボットモードの NPC（脱出を目指す客）: 鍵を探す → 脱出口へ。ロボットを見たら逃げる/隠れる
import * as THREE from 'three';
import { angDiff, damp, clamp } from './util.js';

const COLORS = [0x4a5a78, 0x7a4038, 0x3e6a4a, 0x6a5a3a, 0x5a3e6a];

export class Npc {
  constructor(g, x, z, key, idx) {
    this.g = g; this.x = x; this.z = z; this.gy = g.level.groundAt(x, z);
    this.key = key; this.idx = idx; this.r = 0.3;
    this.heading = Math.random() * 6; this.vx = 0; this.vz = 0; this.speed = 0;
    this.state = 'seek'; this.hasKey = false;
    this.threat = null; this.since = 99; this.fleeT = 0; this.stamina = 100;
    this.locker = null; this.hideT = 0; this.target = null; this.phase = 0; this.lastStep = 0;
    this.keyKnown = false; this.wander = null; this.wanderT = 0; this.takeT = 0;
    this.stuckT = 0; this.lastPos = { x, z }; this.unstick = 0; this.unstickDir = 0;
    this._build(COLORS[idx % COLORS.length]);
  }
  _build(color) {
    const g = new THREE.Group(), M = this.g.M;
    const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a58a, roughness: 0.7 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.9 });
    this.mats = [cloth, skin, pants];
    const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    add(new THREE.BoxGeometry(0.4, 0.6, 0.24), cloth, 0, 1.2, 0);
    add(new THREE.SphereGeometry(0.12, 14, 10), skin, 0, 1.64, 0);
    this.legs = [-0.1, 0.1].map((x) => { const p = new THREE.Group(); p.position.set(x, 0.9, 0); g.add(p); add(new THREE.BoxGeometry(0.14, 0.88, 0.16), pants, 0, -0.44, 0, p); return p; });
    this.arms = [-0.26, 0.26].map((x) => { const p = new THREE.Group(); p.position.set(x, 1.46, 0); g.add(p); add(new THREE.BoxGeometry(0.1, 0.6, 0.12), cloth, 0, -0.3, 0, p); return p; });
    // 懐中電灯の光線（見た目のみ）
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.1, 6, 18, 1, true), beamMat);
    beam.rotation.x = -Math.PI / 2; beam.position.set(0.22, 1.25, 3.1);
    g.add(beam);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M.tubeOn); lens.position.set(0.22, 1.25, 0.15); g.add(lens);
    this.mats.push(beamMat);
    this.beam = beam;
    g.position.set(this.x, this.gy, this.z);
    this.group = g; this.g.scene.add(g);
  }

  get active() { return this.state !== 'caught' && this.state !== 'escaped'; }

  update(dt) {
    if (!this.active) return;
    const g = this.g, p = g.player, lv = g.level;
    const dx = p.x - this.x, dz = p.z - this.z, dist = Math.hypot(dx, dz);
    // 知覚（相手はロボット＝プレイヤー）
    if (this.state !== 'hide') {
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading), dot = (dx * fx + dz * fz) / (dist || 1);
      const see = dist < 14 && (dot > 0.35 || dist < 3.5) && lv.phys.los(this.x, this.gy + 1.55, this.z, p.x, p.gy + 1.2, p.z);
      const hear = dist < (p.dash ? 9 : 4) && p.moving;
      if (see || hear) {
        this.since = 0; this.threat = { x: p.x, z: p.z };
        if (this.state === 'seek' || this.state === 'exit' || this.state === 'take' || this.state === 'unlock') this._react();
      } else this.since += dt;
    } else this.since += dt;

    let tx = null, tz = 0, speed = 0;
    switch (this.state) {
      case 'seek': {
        // 鍵の場所は知らない。部屋を見て回り、見えたら取りに行く
        const k = this.key;
        if (!this.keyKnown && Math.hypot(k.x - this.x, k.z - this.z) < 4.5 && lv.phys.los(this.x, this.gy + 1.5, this.z, k.x, (k.y || 0) + 0.3, k.z)) this.keyKnown = true;
        speed = this.since < 10 ? 1.5 : 1.9;
        if (this.keyKnown) {
          tx = k.x; tz = k.z;
          if (Math.hypot(k.x - this.x, k.z - this.z) < 1.0) { this.state = 'take'; this.takeT = 2.5; }
        } else {
          this.wanderT -= dt;
          if (!this.wander || this.wanderT < 0 || Math.hypot(this.wander.x - this.x, this.wander.z - this.z) < 1) {
            this.wander = lv.nav.randomFree(Math.random, lv.reach); this.wanderT = 25;
          }
          if (this.wander) { tx = this.wander.x; tz = this.wander.z; }
        }
        break;
      }
      case 'take': {
        // 鍵を外している間は動けない（物音がする）
        this.takeT -= dt;
        if (Math.random() < dt * 2) g.mode.ping(this.x, this.z, 0.8);
        if (this.takeT <= 0) { this.hasKey = true; this.key.gone = true; this.key.mesh.visible = false; this.state = 'exit'; g.mode.onNpcKey(this); }
        break;
      }
      case 'exit': {
        const T = lv.exit;
        tx = T.x; tz = T.z; speed = this.since < 10 ? 1.6 : 2.1;
        if (Math.hypot(T.x - this.x, T.z - this.z) < 1.0) { this.state = 'unlock'; this.takeT = 8; g.mode.onNpcExit(this); }
        break;
      }
      case 'unlock': {
        // 脱出口の解錠に時間がかかる（ガチャガチャと音がする）
        this.takeT -= dt;
        if (Math.random() < dt * 3) { g.mode.ping(this.x, this.z, 1.5); g.audio.locked(); }
        if (this.takeT <= 0) { this.state = 'escaped'; this.group.visible = false; g.mode.onNpcEscape(this); return; }
        break;
      }
      case 'flee': {
        this.fleeT -= dt;
        if (!this.target || Math.hypot(this.target.x - this.x, this.target.z - this.z) < 1 || this.fleeT < 0) {
          if (this.since > 4) { this.state = this.hasKey ? 'exit' : 'seek'; break; }
          this.target = this._fleePoint(); this.fleeT = 6;
        }
        tx = this.target.x; tz = this.target.z;
        speed = this.stamina > 0 ? 4.3 : 2.6;
        this.stamina = Math.max(0, this.stamina - dt * 14);
        break;
      }
      case 'goHide': {
        const L = this.locker;
        tx = L.exit.x; tz = L.exit.z; speed = 4.0;
        if (L.npc && L.npc !== this) { this.locker = null; this.state = 'flee'; break; }
        if (Math.hypot(tx - this.x, tz - this.z) < 0.6) {
          this.state = 'hide'; L.npc = this; this.hideT = 6 + Math.random() * 8;
          this.group.visible = false; g.audio.locker(true);
        }
        break;
      }
      case 'hide': {
        this.hideT -= dt;
        if (this.hideT <= 0) {
          if (dist < 7) { this.hideT = 3; break; }
          const L = this.locker; L.npc = null; this.locker = null;
          this.x = L.exit.x; this.z = L.exit.z; this.group.visible = true; g.audio.locker(false);
          this.state = this.hasKey ? 'exit' : 'seek';
        }
        this._sync(dt);
        return;
      }
    }
    if (this.state !== 'flee') this.stamina = Math.min(100, this.stamina + dt * 8);
    if (tx !== null) this._moveTo(tx, tz, speed, dt);
    this._sync(dt);
    // 足音（プレイヤーに聞こえる）
    const sp = Math.hypot(this.vx, this.vz);
    this.phase += sp * dt / 0.75 * Math.PI;
    const s = Math.floor(this.phase / Math.PI);
    if (s !== this.lastStep) {
      this.lastStep = s;
      if (sp > 0.4 && dist < 26) { g.audio.footAt(this.x, this.z, sp > 3 ? 0.14 : 0.06); g.mode.ping(this.x, this.z, sp > 3 ? 1 : 0.5); }
    }
  }

  _react() {
    const g = this.g, p = g.player;
    let best = null, bd = 1e9;
    for (const L of g.level.lockers) {
      if (L.npc) continue;
      const d = Math.hypot(L.exit.x - this.x, L.exit.z - this.z), dr = Math.hypot(L.exit.x - p.x, L.exit.z - p.z);
      if (d < 8 && dr > d + 2 && d < bd) { bd = d; best = L; }
    }
    if (best && Math.random() < 0.65) { this.locker = best; this.state = 'goHide'; }
    else { this.state = 'flee'; this.target = null; }
    g.audio.scream(this.x, this.z);
  }
  _fleePoint() {
    const lv = this.g.level, t = this.threat || this.g.player;
    let best = null, bs = -1e9;
    for (let i = 0; i < 16; i++) {
      const q = lv.nav.randomFree(Math.random, lv.reach);
      if (!q) continue;
      const dn = Math.hypot(q.x - this.x, q.z - this.z);
      if (dn < 5 || dn > 22) continue;
      const s = Math.hypot(q.x - t.x, q.z - t.z) - dn * 0.4;
      if (s > bs) { bs = s; best = q; }
    }
    return best || { x: this.x, z: this.z };
  }
  _moveTo(tx, tz, speed, dt) {
    const g = this.g, nav = g.level.nav, ph = g.level.phys;
    let wx = tx, wz = tz;
    if (!(Math.hypot(tx - this.x, tz - this.z) < 3 && nav.lineFree(this.x, this.z, tx, tz))) {
      const w = nav.next(this.x, this.z, nav.fieldAt(tx, tz, g.level.groundAt(tx, tz)), this.gy);
      if (w) { wx = w.x; wz = w.z; }
    }
    let dx = wx - this.x, dz = wz - this.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    if (this.unstick > 0) { this.unstick -= dt; dx += Math.cos(this.unstickDir); dz += Math.sin(this.unstickDir); }
    const turn = angDiff(this.heading, Math.atan2(dx, dz));
    this.heading += clamp(turn, -7 * dt, 7 * dt);
    const sl = Math.abs(turn) > 1.3 ? 0.4 : 1;
    this.vx = damp(this.vx, Math.sin(this.heading) * speed * sl, 8, dt);
    this.vz = damp(this.vz, Math.cos(this.heading) * speed * sl, 8, dt);
    const o = { robot: true, y: this.gy };
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    if (ph.canMove(nx, this.z, this.r, o)) this.x = nx; else this.vx *= 0.3;
    if (ph.canMove(this.x, nz, this.r, o)) this.z = nz; else this.vz *= 0.3;
    this.gy = Math.max(-1, ph.groundAt(this.x, this.z));
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      if (Math.hypot(this.x - this.lastPos.x, this.z - this.lastPos.z) < 0.3 * speed) { this.unstick = 0.6; this.unstickDir = Math.random() * 6.28; }
      this.stuckT = 0; this.lastPos.x = this.x; this.lastPos.z = this.z;
    }
  }
  _sync() {
    const sp = Math.hypot(this.vx, this.vz), sw = Math.sin(this.phase) * Math.min(1, sp / 3) * 0.6;
    this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;
    this.arms[0].rotation.x = -sw * 0.8; this.arms[1].rotation.x = -0.9 + sw * 0.2;
    this.group.position.set(this.x, this.gy + Math.abs(Math.sin(this.phase)) * 0.03 * Math.min(1, sp), this.z);
    this.group.rotation.y = this.heading;
    this.beam.material.opacity = 0.05 + Math.random() * 0.01;
  }
  catch() {
    this.state = 'caught'; this.group.visible = false;
    if (this.locker) { this.locker.npc = null; this.locker = null; }
  }
  dispose() {
    this.g.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
  }
}
