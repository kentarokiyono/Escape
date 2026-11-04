// 投げられる小物（皿・空き缶）。重力で放物線を描き、壁や床で跳ね返る。最初の衝突音でロボットをおびき寄せる
import * as THREE from 'three';
import { HOLE } from './physics.js';
import { Progress } from './progress.js';

const G = 9.8;
const _d = new THREE.Vector3();

export class Throwables {
  constructor(g) {
    this.g = g; this.list = []; this.charging = false; this.charge = 0;
    this.plateGeo = new THREE.CylinderGeometry(0.11, 0.08, 0.025, 20);
    this.canGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.12, 12);
    this.plateMat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.3 });
    this.canMat = new THREE.MeshStandardMaterial({ color: 0xa8302a, roughness: 0.4, metalness: 0.6 });
    // 軌道の予測線
    const N = 40;
    this.pts = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(this.pts, 3));
    this.line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xfff0c0, dashSize: 0.15, gapSize: 0.12, transparent: true, opacity: 0.7, depthTest: false }));
    this.line.renderOrder = 5; this.line.frustumCulled = false; this.line.visible = false;
    g.scene.add(this.line);
  }
  get speed() { return 5 + this.charge * 9; }
  start() {
    const g = this.g;
    if (g.state !== 'play' || g.player.hidden || g.player.robot) return;
    if (g.gear.throws <= 0) { g.ui.say('投げられる物を持っていない（皿や空き缶を拾う）'); return; }
    this.charging = true; this.charge = 0;
  }
  cancel() { this.charging = false; this.line.visible = false; }
  release() {
    const g = this.g;
    if (!this.charging) return;
    this.charging = false; this.line.visible = false;
    if (g.state !== 'play') return;
    g.gear.throws--;
    const [o, v] = this._launch();
    const plate = Math.random() < 0.6;
    const mesh = new THREE.Mesh(plate ? this.plateGeo : this.canGeo, plate ? this.plateMat : this.canMat);
    mesh.castShadow = true; mesh.position.copy(o);
    g.scene.add(mesh);
    this.list.push({ mesh, p: o.clone(), v, hit: false, rest: 0, plate, spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12) });
    g.audio.whoosh();
  }
  _launch() {
    const cam = this.g.camera;
    cam.getWorldDirection(_d);
    const o = cam.position.clone().addScaledVector(_d, 0.35); o.y -= 0.1;
    const v = _d.clone().multiplyScalar(this.speed); v.y += 1.2;
    return [o, v];
  }
  // 1 ステップ進める。衝突したら 'wall' / 'floor' を返す
  _step(b, dt) {
    const ph = this.g.level.phys;
    b.v.y -= G * dt;
    const nx = b.p.x + b.v.x * dt, ny = b.p.y + b.v.y * dt, nz = b.p.z + b.v.z * dt;
    let hit = null;
    if (!ph.inBounds(nx, nz, 0.05) || ph.topAt(nx, nz) > ny) {
      // どちらの軸でぶつかったかを調べて反射
      const xBlock = !ph.inBounds(nx, b.p.z, 0.05) || ph.topAt(nx, b.p.z) > ny;
      const zBlock = !ph.inBounds(b.p.x, nz, 0.05) || ph.topAt(b.p.x, nz) > ny;
      if (xBlock) b.v.x *= -0.35;
      if (zBlock) b.v.z *= -0.35;
      if (!xBlock && !zBlock) { b.v.x *= -0.35; b.v.z *= -0.35; }
      b.v.y *= 0.6; hit = 'wall';
    } else { b.p.x = nx; b.p.z = nz; }
    b.p.y = ny;
    const gr = ph.groundAt(b.p.x, b.p.z);
    if (gr > HOLE + 1 && b.p.y < gr + 0.03) {
      b.p.y = gr + 0.03;
      if (Math.abs(b.v.y) > 0.8) hit = hit || 'floor';
      b.v.y = -b.v.y * 0.3; b.v.x *= 0.6; b.v.z *= 0.6;
    }
    return hit;
  }
  update(dt) {
    const g = this.g;
    if (this.charging) {
      if (g.state !== 'play' || g.gear.throws <= 0) this.cancel();
      else { this.charge = Math.min(1, this.charge + dt * 1.1); this._preview(); }
    }
    for (const b of this.list) {
      const sub = 4;
      for (let i = 0; i < sub; i++) {
        const hit = this._step(b, dt / sub);
        const sp = b.v.length();
        if (hit && sp > 1.2) {
          g.audio.crash(b.p.x, b.p.y, b.p.z, b.plate, b.hit ? 0.4 : 1);
          if (!b.hit) {
            b.hit = true;
            const n = g.noiseAt(b.p.x, b.p.z, 11);
            if (n > 0) Progress.add('lures', 1);
          }
        }
      }
      const sp = b.v.length();
      if (sp < 0.3 && b.p.y < g.level.phys.groundAt(b.p.x, b.p.z) + 0.06) b.rest += dt; else { b.mesh.rotation.x += b.spin.x * dt; b.mesh.rotation.z += b.spin.z * dt; }
      b.mesh.position.copy(b.p);
      if (b.rest > 0) { b.mesh.rotation.x = b.plate ? 0 : Math.PI / 2; b.mesh.rotation.z = 0; }
    }
    for (const b of this.list) if (b.rest > 20 || b.p.y < -3) { g.scene.remove(b.mesh); b.dead = true; }
    this.list = this.list.filter((b) => !b.dead);
  }
  _preview() {
    const [o, v] = this._launch();
    const b = { p: o, v, hit: false };
    const N = this.pts.length / 3;
    let n = 0;
    for (let i = 0; i < N; i++) {
      this.pts[i * 3] = b.p.x; this.pts[i * 3 + 1] = b.p.y; this.pts[i * 3 + 2] = b.p.z; n = i + 1;
      let hit = false;
      for (let k = 0; k < 3 && !hit; k++) hit = !!this._step(b, 0.02);
      if (hit) { this.pts[(i + 1) * 3] = b.p.x; this.pts[(i + 1) * 3 + 1] = b.p.y; this.pts[(i + 1) * 3 + 2] = b.p.z; n = Math.min(N, i + 2); break; }
    }
    const geo = this.line.geometry;
    geo.setDrawRange(0, n); geo.attributes.position.needsUpdate = true;
    this.line.computeLineDistances();
    this.line.visible = true;
  }
  clear() { for (const b of this.list) this.g.scene.remove(b.mesh); this.list = []; this.cancel(); }
}
