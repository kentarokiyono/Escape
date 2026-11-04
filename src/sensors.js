// FR-002 技術資料を読むと使えるセンサー表示
// vision: ロボットの視野（扇形）/ hearing: 自分の足音が届く範囲 / battery: ロボットの電池残量
import * as THREE from 'three';
import { ROBOT } from './config.js';

const FOV = Math.acos(ROBOT.fovCos);

export class Sensors {
  constructor(g) {
    this.g = g; this.on = true;
    this.group = new THREE.Group(); g.scene.add(this.group);
    const fan = new THREE.CircleGeometry(1, 28, Math.PI / 2 - FOV, FOV * 2);
    fan.rotateX(Math.PI / 2); // +Y 方向の扇を +Z（前方）へ
    this.fanGeo = fan;
    this.cones = []; this.bars = [];
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 48).rotateX(-Math.PI / 2), this.ringMat);
    this.ring.renderOrder = 2; this.group.add(this.ring);
    this.barGeo = new THREE.PlaneGeometry(0.5, 0.05);
  }
  _cone(i) {
    if (!this.cones[i]) {
      const m = new THREE.Mesh(this.fanGeo, new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      m.renderOrder = 2; this.group.add(m); this.cones[i] = m;
    }
    return this.cones[i];
  }
  _bar(i) {
    if (!this.bars[i]) {
      const bg = new THREE.Mesh(this.barGeo, new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6, depthTest: false }));
      const fg = new THREE.Mesh(this.barGeo, new THREE.MeshBasicMaterial({ color: 0x40ff60, depthTest: false }));
      fg.position.z = 0.001; bg.add(fg); bg.renderOrder = 3; fg.renderOrder = 4;
      this.group.add(bg); this.bars[i] = { bg, fg };
    }
    return this.bars[i];
  }
  has(k) { return this.g.gear.docs.includes(k); }
  update() {
    const g = this.g, p = g.player, lv = g.level;
    const active = this.on && lv && (g.state === 'play' || g.state === 'code' || g.state === 'panel' || g.state === 'dying') && !p.robot;
    this.group.visible = !!active;
    if (!active) return;
    let ci = 0, bi = 0;
    for (const r of g.robots) {
      const alive = r.state !== 'sleep' && r.state !== 'off' && r.state !== 'dead' && r.state !== 'caught';
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (d > 26) continue;
      if (this.has('vision') && alive && r.state !== 'charge' && r.state !== 'ret') {
        const c = this._cone(ci++), D = g.diff;
        const range = (g.flashOn ? ROBOT.sightFlash : ROBOT.sight) * (p.crouch ? 0.65 : 1) * r.T.sight * D.sight;
        c.visible = true;
        c.position.set(r.x, r.gy + 0.04, r.z); c.rotation.y = r.heading + r.headYaw; c.scale.set(range, 1, range);
        const hot = r.state === 'chase' || r.state === 'alert' || r.state === 'inspect';
        c.material.color.setHex(hot ? 0xff3020 : r.state === 'search' || r.state === 'lure' ? 0xffb020 : 0x40a0ff);
      }
      if (this.has('battery') && r.state !== 'off' && r.state !== 'dead') {
        const b = this._bar(bi++), k = Math.max(0, r.battery / r.batteryMax);
        b.bg.visible = true;
        b.bg.position.set(r.x, r.gy + 1.85, r.z); b.bg.quaternion.copy(g.camera.quaternion);
        b.fg.scale.x = Math.max(0.01, k); b.fg.position.x = -0.25 * (1 - k);
        b.fg.material.color.setRGB(1 - k, 0.3 + k * 0.7, 0.2);
      }
    }
    for (let i = ci; i < this.cones.length; i++) this.cones[i].visible = false;
    for (let i = bi; i < this.bars.length; i++) this.bars[i].bg.visible = false;
    const showRing = this.has('hearing') && p.noise > 0 && !p.hidden;
    this.ring.visible = showRing;
    if (showRing) { this.ring.position.set(p.x, p.gy + 0.05, p.z); this.ring.scale.set(p.noise, 1, p.noise); this.ringMat.opacity = p.dash ? 0.5 : 0.3; }
  }
}
