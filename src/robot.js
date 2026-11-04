// 給仕ロボット: モデル・知覚（視覚/聴覚）・状態遷移・移動
import * as THREE from 'three';
import { ROBOT, ROBOT_TYPES } from './config.js';
import { angDiff, damp, clamp } from './util.js';

let A = null;
export function initRobotAssets(M, faces) {
  A = {
    base: new THREE.CylinderGeometry(0.29, 0.31, 0.14, 24),
    ring: new THREE.TorusGeometry(0.3, 0.014, 8, 32),
    body: new THREE.CylinderGeometry(0.21, 0.27, 1.0, 24),
    neck: new THREE.CylinderGeometry(0.09, 0.12, 0.12, 16),
    head: new THREE.SphereGeometry(0.25, 24, 18),
    bezel: new THREE.BoxGeometry(0.4, 0.3, 0.04),
    screen: new THREE.PlaneGeometry(0.34, 0.25),
    ear: new THREE.ConeGeometry(0.07, 0.16, 4),
    tray: new THREE.CylinderGeometry(0.25, 0.25, 0.02, 20),
    trayRing: new THREE.TorusGeometry(0.25, 0.008, 6, 28),
    pole: new THREE.CylinderGeometry(0.015, 0.015, 0.75, 8),
    bow: new THREE.BoxGeometry(0.16, 0.07, 0.03), hat: new THREE.CylinderGeometry(0.13, 0.11, 0.2, 16), antenna: new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), tip: new THREE.SphereGeometry(0.025, 8, 6),
    bowMat: new THREE.MeshStandardMaterial({ color: 0x8a1a1a, roughness: 0.6 }), hatMat: new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.8 }),
    tints: {},
    plastic: M.plastic, dark: M.dark, rubber: M.rubber,
    faces,
  };
}

// state: [LED r,g,b, 顔]
const LOOK = {
  patrol: [0.3, 1.6, 2.4, 'normal'],
  alarm: [2.4, 0.5, 0.2, 'normal'],
  search: [2.2, 1.8, 0.3, 'search'],
  alert: [2.4, 2.0, 0.3, 'alert'],
  chase: [2.8, 0.15, 0.1, 'chase'],
  inspect: [2.8, 0.15, 0.1, 'chase'],
  lure: [2.4, 1.0, 0.2, 'lure'],
  sleep: [0.02, 0.12, 0.16, 'sleep'],
  ret: [0.9, 0.7, 0.1, 'sleep'],
  charge: [0.1, 0.9, 0.3, 'sleep'],
  off: [0, 0, 0, 'sleep'],
  dead: [0, 0, 0, 'sleep'],
  caught: [3, 0, 0, 'caught'],
};

export class Robot {
  constructor(game, x, z, opts = {}) {
    this.g = game;
    this.x = x; this.z = z; this.vx = 0; this.vz = 0; this.r = ROBOT.radius;
    this.gy = game.level ? game.level.groundAt(x, z) : 0;
    this.heading = opts.heading ?? Math.random() * Math.PI * 2;
    this.headYaw = 0; this.speedNow = 0; this.t = Math.random() * 10;
    this.state = opts.sleep ? 'sleep' : 'patrol';
    this.timer = 0; this.target = null; this.lure = null; this.locker = null;
    this.lastSeen = { x, z }; this.sinceSeen = 99;
    this.stuckT = 0; this.lastPos = { x, z }; this.unstick = 0; this.unstickDir = 0;
    this.pauseT = 0; this.pauseDur = 1.5; this.patrolT = 0; this.looking = 0; this.checked = false; this.waitT = 0;
    this.flick = 0;
    // 機種とバッテリー
    this.type = opts.type || pickType(game, opts);
    this.T = ROBOT_TYPES[this.type];
    this.batteryMax = this.T.battery; this.battery = this.batteryMax * (0.75 + Math.random() * 0.25);
    this.plateTaken = false; this.dock = null;
    this._build();
    this.voice = game.audio.robotVoice();
    this.setLook(this.state);
  }

  _build() {
    const g = new THREE.Group(), pivot = new THREE.Group(), head = new THREE.Group();
    this.ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.screenMat = new THREE.MeshBasicMaterial({ map: A.faces.normal, color: new THREE.Color(1.5, 1.5, 1.5) });
    const add = (parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
    };
    add(g, A.base, A.rubber, 0, 0.08, 0);
    add(g, A.ring, this.ledMat, 0, 0.16, 0, Math.PI / 2).castShadow = false;
    g.add(pivot); pivot.position.y = 0.15;
    const shell = tintMat(this.T.tint);
    add(pivot, A.body, shell, 0, 0.5, 0);
    add(pivot, A.neck, A.dark, 0, 1.04, 0);
    for (let i = 0; i < 3; i++) {
      add(pivot, A.tray, A.dark, 0, 0.32 + i * 0.3, -0.3);
      add(pivot, A.trayRing, this.ledMat, 0, 0.32 + i * 0.3, -0.3, Math.PI / 2).castShadow = false;
    }
    add(pivot, A.pole, A.dark, 0, 0.67, -0.52);
    pivot.add(head); head.position.y = 1.17;
    add(head, A.head, shell, 0, 0, 0).scale.set(1, 0.82, 0.92);
    if (this.T.acc === 'bow') add(pivot, A.bow, A.bowMat, 0, 1.0, 0.18);
    if (this.T.acc === 'hat') add(head, A.hat, A.hatMat, 0, 0.27, 0);
    if (this.T.acc === 'antenna') { add(head, A.antenna, A.dark, 0.06, 0.32, -0.05); add(head, A.tip, this.ledMat, 0.06, 0.47, -0.05).castShadow = false; }
    add(head, A.bezel, A.dark, 0, 0.01, 0.2);
    add(head, A.screen, this.screenMat, 0, 0.01, 0.222).castShadow = false;
    for (const s of [-1, 1]) add(head, A.ear, A.dark, 0.13 * s, 0.22, 0, 0, Math.PI / 4, s * -0.2);
    g.position.set(this.x, 0, this.z);
    this.group = g; this.pivot = pivot; this.head = head;
    this.g.scene.add(g);
  }

  setLook(state) {
    const key = state === 'patrol' && this.g.alarm ? 'alarm' : state;
    const L = LOOK[key] || LOOK.patrol;
    this.ledMat.color.setRGB(L[0], L[1], L[2]);
    this.screenMat.map = A.faces[L[3]];
    this.screenBase = state === 'off' || state === 'dead' ? 0 : state === 'sleep' || state === 'charge' || state === 'ret' ? 0.4 : 1.5;
  }

  goCharge() {
    const docks = (this.g.level.docks || []).concat(this.g.level.chargers || []).filter((k) => !k.busy || k.busy === this);
    let best = null, bd = 1e9;
    for (const k of docks) { const d = Math.hypot(k.x - this.x, k.z - this.z); if (d < bd) { bd = d; best = k; } }
    if (!best) return; // ドックが無い階では、そのまま動き続けて電池切れになる
    best.busy = this; this.dock = best;
    this.enter('ret');
  }
  enter(s, d) {
    if ((this.state === 'off' || this.state === 'dead') && s !== 'caught') return; // 停止は永久
    if (this.dock && s !== 'ret' && s !== 'charge') { this.dock.busy = null; this.dock = null; }
    this.state = s; this.timer = 0;
    if (s === 'alert') { this.timer = ROBOT.alertTime; this.g.onSpotted(this); }
    else if (s === 'search') { this.target = { x: d.x, z: d.z }; this.looking = 0; this.checked = false; }
    else if (s === 'lure') { this.lure = d; this.waitT = 0; }
    else if (s === 'inspect') { this.locker = d; }
    else if (s === 'patrol') { this.target = null; this.pauseT = 0; this.patrolT = 0; }
    this.setLook(s);
  }

  update(dt) {
    const g = this.g, p = g.player, lv = g.level;
    this.t += dt;
    if (this.state === 'sleep' || this.state === 'caught' || this.state === 'off' || this.state === 'dead') {
      this.vx = this.vz = 0; this.speedNow = 0;
      this._sync(dt);
      if (this.voice) this.voice.update(this.x, this.z, 0, this.state === 'caught' ? 'caught' : 'sleep', false);
      return;
    }
    if (this.state === 'charge') {
      this.vx = this.vz = 0; this.speedNow = 0;
      this.battery = Math.min(this.batteryMax, this.battery + dt * 6);
      if (this.battery >= this.batteryMax * 0.95) { this.dock.busy = null; this.dock = null; this.enter('patrol'); }
      this._sync(dt);
      if (this.voice) this.voice.update(this.x, this.z, 0, 'sleep', false);
      return;
    }
    // バッテリー消費（追跡は激しく減る）
    const D = g.diff || { speed: 1, sight: 1, drain: 1 };
    const hot = this.state === 'chase' || this.state === 'alert' || this.state === 'inspect';
    this.battery -= dt * (hot ? 1.1 : this.state === 'patrol' ? 0.12 : this.state === 'ret' ? 0.2 : 0.3) * this.T.drain * D.drain;
    if (this.battery <= 0) { this.battery = 0; this.enter('dead'); g.onRobotStopped(this, 'drain'); return; }
    if (this.state !== 'ret' && this.battery < this.batteryMax * (hot ? 0.08 : 0.18)) this.goCharge();
    const dx = p.x - this.x, dz = p.z - this.z, dist = Math.hypot(dx, dz);
    let vis = null;
    const los = () => (vis === null ? (vis = dist < 40 && lv.phys.los(this.x, this.gy + 1.3, this.z, p.x, p.gy + p.eyeH * 0.8, p.z)) : vis);

    // ---- 知覚 ----
    let see = false, heard = false;
    if (!p.hidden) {
      const range = (g.flashOn ? ROBOT.sightFlash : ROBOT.sight) * (p.crouch ? 0.65 : 1) * this.T.sight * D.sight;
      if (dist < range) {
        const a = this.heading + this.headYaw, fx = Math.sin(a), fz = Math.cos(a);
        const dot = (dx * fx + dz * fz) / (dist || 1);
        if ((dot > ROBOT.fovCos || dist < ROBOT.close) && los()) see = true;
      }
      // ライトを顔に向けられたら遠くからでも気づく
      if (!see && g.flashOn && dist < 24 && p.facingDot(this.x, this.z) > 0.95 && los()) see = true;
      if (p.noise > 0 && dist < p.noise) heard = dist < p.noise * 0.55 || los();
    }
    if (see) { this.lastSeen.x = p.x; this.lastSeen.z = p.z; this.sinceSeen = 0; } else this.sinceSeen += dt;

    const calm = this.state === 'patrol' || this.state === 'search' || this.state === 'lure'; // 帰還中（低電力）は反応しない
    if (see && calm) this.enter('alert');
    else if (heard && calm) {
      if (this.state !== 'search') this.enter('search', p);
      else { this.target.x = p.x; this.target.z = p.z; this.looking = 0; this.timer = 0; }
    }

    // ---- 行動 ----
    let tx = null, tz = 0, speed = 0, headT = 0, look = null;
    switch (this.state) {
      case 'alert':
        this.timer -= dt; look = p;
        this._turnToward(p.x, p.z, dt, 6);
        if (this.timer <= 0) this.enter('chase');
        break;
      case 'chase': {
        look = p;
        const track = this.sinceSeen < ROBOT.track;
        tx = track ? p.x : this.lastSeen.x; tz = track ? p.z : this.lastSeen.z;
        speed = ROBOT.chase * this.T.speed * D.speed;
        if (this.sinceSeen > ROBOT.loseTime || (!track && Math.hypot(this.lastSeen.x - this.x, this.lastSeen.z - this.z) < 0.8)) {
          this.enter('search', this.lastSeen); tx = null; break;
        }
        if (!p.hidden && dist < ROBOT.catchDist && Math.abs(p.gy - this.gy) < 0.5 && los()) g.caught(this);
        break;
      }
      case 'inspect': {
        const L = this.locker;
        tx = L.exit.x; tz = L.exit.z; speed = ROBOT.search + 0.6;
        if (Math.hypot(tx - this.x, tz - this.z) < 0.7) {
          this._turnToward(L.x, L.z, dt, 8);
          if (p.hidden && p.locker === L) g.caught(this);
          else this.enter('search', { x: tx, z: tz });
          tx = null;
        }
        break;
      }
      case 'search': {
        const T = this.target, d = Math.hypot(T.x - this.x, T.z - this.z);
        this.timer += dt;
        if (d > 0.8 && this.timer < 14) { tx = T.x; tz = T.z; speed = ROBOT.search * this.T.speed * D.speed; }
        else {
          this.looking += dt; headT = Math.sin(this.looking * 1.8) * 1.1;
          if (!this.checked) {
            this.checked = true;
            const L = p.hidden && p.locker;
            if (L && Math.hypot(L.x - this.x, L.z - this.z) < 4.5 && Math.random() < 0.4) { this.enter('inspect', L); break; }
          }
          if (this.looking > 3.2) this.enter('patrol');
        }
        break;
      }
      case 'lure': {
        const L = this.lure, d = Math.hypot(L.x - this.x, L.z - this.z);
        this.timer += dt;
        if (d > L.reach - 0.5 && this.timer < 18) { tx = L.x; tz = L.z; speed = ROBOT.lure; }
        else {
          this.waitT += dt; headT = Math.sin(this.waitT * 1.5) * 0.9;
          if (this.waitT > 3) this.enter('patrol');
        }
        break;
      }
      case 'ret': {
        // 充電ドックへ戻る
        const d0 = this.dock;
        if (!d0) { this.enter('patrol'); break; }
        tx = d0.x; tz = d0.z; speed = ROBOT.patrol * 1.3;
        if (Math.hypot(d0.x - this.x, d0.z - this.z) < 0.6) { this.enter('charge'); tx = null; }
        break;
      }
      default: { // patrol
        if (!this.target) { this.target = g.randomPatrolPoint(this); this.patrolT = 0; this.pauseDur = 1 + Math.random() * 2; }
        if (!this.target) break;
        const d = Math.hypot(this.target.x - this.x, this.target.z - this.z);
        this.patrolT += dt;
        if (d < 0.8 || this.patrolT > 45) {
          this.pauseT += dt; headT = Math.sin(this.pauseT * 1.4) * 0.8;
          if (this.pauseT > this.pauseDur) { this.target = null; this.pauseT = 0; }
        } else { tx = this.target.x; tz = this.target.z; speed = ROBOT.patrol * (g.alarm ? 1.5 : 1) * this.T.speed; }
      }
    }

    if (tx !== null) this._moveTo(tx, tz, speed, dt);
    else { this.vx = damp(this.vx, 0, 8, dt); this.vz = damp(this.vz, 0, 8, dt); this._applyVel(dt); }

    if (look) headT = clamp(angDiff(this.heading, Math.atan2(look.x - this.x, look.z - this.z)), -1.3, 1.3);
    this.headYaw = damp(this.headYaw, headT, 6, dt);
    this._sync(dt);
    if (this.voice) this.voice.update(this.x, this.z, this.speedNow, this.state, dist > 40 || !los(), this.gy);
  }

  _turnToward(x, z, dt, rate) {
    const turn = angDiff(this.heading, Math.atan2(x - this.x, z - this.z));
    this.heading += clamp(turn, -rate * dt, rate * dt);
  }

  _moveTo(tx, tz, speed, dt) {
    const g = this.g, nav = g.level.nav;
    let wx = tx, wz = tz;
    const d = Math.hypot(tx - this.x, tz - this.z);
    if (!(d < 3 && nav.lineFree(this.x, this.z, tx, tz))) {
      const w = nav.next(this.x, this.z, nav.fieldAt(tx, tz, g.level.groundAt(tx, tz)), this.gy);
      if (w) { wx = w.x; wz = w.z; }
    }
    let dx = wx - this.x, dz = wz - this.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    for (const o of g.robots) {
      if (o === this || o.state === 'sleep') continue;
      const ox = this.x - o.x, oz = this.z - o.z, od = Math.hypot(ox, oz);
      if (od < 0.95 && od > 1e-3) { const k = ((0.95 - od) / 0.95) * 1.6; dx += (ox / od) * k; dz += (oz / od) * k; }
    }
    if (this.unstick > 0) { this.unstick -= dt; dx += Math.cos(this.unstickDir) * 1.2; dz += Math.sin(this.unstickDir) * 1.2; }
    const turn = angDiff(this.heading, Math.atan2(dx, dz));
    const maxT = (speed > 3 ? 5.5 : 3.2) * dt;
    this.heading += clamp(turn, -maxT, maxT);
    const slow = Math.abs(turn) > 1.2 ? 0.3 : 1;
    this.vx = damp(this.vx, Math.sin(this.heading) * speed * slow, 6, dt);
    this.vz = damp(this.vz, Math.cos(this.heading) * speed * slow, 6, dt);
    this._applyVel(dt);
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      if (Math.hypot(this.x - this.lastPos.x, this.z - this.lastPos.z) < 0.25 * speed) { this.unstick = 0.7; this.unstickDir = Math.random() * Math.PI * 2; }
      this.stuckT = 0; this.lastPos.x = this.x; this.lastPos.z = this.z;
    }
  }

  _applyVel(dt) {
    const ph = this.g.level.phys;
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const o = { robot: true, y: this.gy };
    if (ph.canMove(nx, this.z, this.r, o)) this.x = nx; else this.vx *= 0.3;
    if (ph.canMove(this.x, nz, this.r, o)) this.z = nz; else this.vz *= 0.3;
    this.gy = Math.max(-1, ph.groundAt(this.x, this.z));
    this.speedNow = Math.hypot(this.vx, this.vz);
  }

  _sync(dt) {
    const s = this.speedNow;
    this.group.position.set(this.x, this.gy + (s > 0.1 ? Math.sin(this.t * 14) * 0.004 * s : 0), this.z);
    this.group.rotation.y = this.heading;
    const down = this.state === 'off' || this.state === 'dead';
    this.pivot.rotation.x = damp(this.pivot.rotation.x, down ? 0.22 : s * 0.035, 5, dt);
    this.head.rotation.y = this.headYaw;
    this.head.rotation.x = damp(this.head.rotation.x, down ? 0.5 : 0, 4, dt);
    // 画面のちらつき
    if (this.flick > 0) this.flick -= dt;
    else if (Math.random() < dt * 0.6) this.flick = 0.04 + Math.random() * 0.1;
    let k = this.flick > 0 ? 0.25 : 1;
    if (this.state === 'ret') k *= Math.sin(this.t * 4) > 0 ? 1 : 0.3;
    if (this.state === 'search' || this.state === 'alert') k *= 0.6 + 0.4 * (Math.sin(this.t * 18) > 0 ? 1 : 0);
    this.screenMat.color.setScalar(this.screenBase * k);
  }

  dispose() {
    this.g.scene.remove(this.group);
    this.ledMat.dispose(); this.screenMat.dispose();
    if (this.voice) this.voice.dispose();
  }
}

// 階のテーマ・役割から機種を決める
function pickType(g, opts) {
  if (opts.sid === 'greeter') return 'guide';
  const th = g.level && g.level.theme;
  if (Math.random() < 0.15) return 'old';
  if (th === 'kitchen') return Math.random() < 0.7 ? 'kitchen' : 'patrol';
  if (th === 'machine') return Math.random() < 0.7 ? 'guard' : 'patrol';
  if (opts.dock && th === 'hall') return Math.random() < 0.3 ? 'guide' : 'patrol';
  return 'patrol';
}
function tintMat(tint) {
  if (!tint) return A.plastic;
  if (!A.tints[tint]) { const m = A.plastic.clone(); m.color = new THREE.Color(tint); A.tints[tint] = m; }
  return A.tints[tint];
}
