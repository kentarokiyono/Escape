// ゲームのコア: 描画・プレイヤー・ロボット・照明/電源・扉・監視カメラ・インタラクション・状態遷移
// モード固有の進行（フリー/ストーリー/ロボット）は this.mode に委譲する
import * as THREE from 'three';
import { DECOY_CD, DECOY_RANGE, DIFFICULTY, LOADS, SYS_NAMES, CAPACITY, ROBOT_TYPES } from './config.js';
import { Sensors } from './sensors.js';
import { Throwables } from './throwable.js';
import { Progress, newRun } from './progress.js';
import { DOCS, NOTES } from './story/text.js';
import { buildMaterials, faceTextures, flashCookie } from './textures.js';
import { Robot, initRobotAssets } from './robot.js';
import { Player } from './player.js';
import { drawMap } from './minimap.js';
import { damp, clamp, angDiff } from './util.js';

const DUST_N = 500;
// 装備: リモコン・その電池・投げられる物・読んだ技術資料
export const newGear = () => ({ remote: false, cells: 0, throws: 0, docs: [] });
const _off = new THREE.Vector3(), _fwd = new THREE.Vector3();

export class Game {
  constructor({ renderer, scene, camera, audio, ui, fx, settings }) {
    Object.assign(this, { renderer, scene, camera, audio, ui, fx, settings });
    this.M = buildMaterials(renderer);
    initRobotAssets(this.M, faceTextures());
    scene.fog = new THREE.FogExp2(0x0b0a09, 0.032);
    scene.background = new THREE.Color(0x0b0a09);
    this.hemi = new THREE.HemisphereLight(0x8a90a0, 0x2a2420, 1.1); // 外から漏れる薄明かり
    scene.add(this.hemi);
    this.exposure = 1.1;

    // 懐中電灯: カメラに遅れて追従するリグ
    this.rig = new THREE.Object3D(); scene.add(this.rig);
    const fl = new THREE.SpotLight(0xfff0d6, 120, 34, 0.5, 0.45, 2);
    fl.map = flashCookie();
    fl.castShadow = true;
    fl.shadow.camera.near = 0.1; fl.shadow.camera.far = 34;
    fl.shadow.bias = -0.0002; fl.shadow.normalBias = 0.03;
    const tgt = new THREE.Object3D(); tgt.position.set(0, 0, -6);
    this.rig.add(fl, tgt); fl.target = tgt;
    this.flash = fl; this.flashBase = 120; this.flickT = 0;
    this.bounce = new THREE.PointLight(0xffe2c0, 0, 7, 2); scene.add(this.bounce);
    // 生きている蛍光灯のうちプレイヤーに近いものへ割り当てる（ライト数固定でシェーダ再コンパイルを避ける）
    this.fixLights = Array.from({ length: 6 }, () => { const l = new THREE.PointLight(0xdde6ff, 0, 15, 2); scene.add(l); return l; });
    this.monCam = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.05, 80);
    this.monCam.rotation.order = 'YXZ';
    this._makeDust();
    this.applyQuality();

    this.player = new Player();
    this.robots = []; this.npcs = []; this.level = null; this.mode = null;
    this.keys = {};
    this.state = 'title';
    this.fear = 0; this.mapOpen = false; this.pauseAfterTrans = false;
    this.flashOn = true; this.alarm = false; this.decoyCd = 0;
    this.codeInput = []; this.codeCtx = null;
    this.time = 0; this.clock = 0; this.spotted = 0;
    this.monIdx = 0; this.doc = null;
    this.gear = newGear(); this.run = newRun(); this.diff = DIFFICULTY.normal; this.diffKey = 'normal';
    this.sensors = new Sensors(this); this.throws = new Throwables(this);
    Progress.ui = ui; Progress.audio = audio;
    this.ui.code.onDigit = (d) => this.codeDigit(d);
    this.ui.code.onDel = () => this.codeDel();
    this.ui.code.onOk = () => this.codeSubmit(true);
    this.ui.code.onCancel = () => this.codeCancel(true);
  }

  applyQuality() {
    const hi = this.settings.quality !== 'low';
    const pr = hi ? Math.min(devicePixelRatio || 1, 1.5) : 1;
    this.renderer.setPixelRatio(pr);
    this.fx.setSize(innerWidth, innerHeight, pr);
    this.fx.bloom.enabled = hi;
    this.monCam.aspect = innerWidth / innerHeight; this.monCam.updateProjectionMatrix();
    const size = hi ? 1024 : 512;
    if (this.flash.shadow.mapSize.x !== size) {
      this.flash.shadow.mapSize.set(size, size);
      if (this.flash.shadow.map) { this.flash.shadow.map.dispose(); this.flash.shadow.map = null; }
    }
  }

  _makeDust() {
    const pos = new Float32Array(DUST_N * 3), seed = new Float32Array(DUST_N);
    for (let i = 0; i < DUST_N; i++) { pos[i * 3] = (Math.random() - 0.5) * 16; pos[i * 3 + 1] = Math.random() * 3; pos[i * 3 + 2] = (Math.random() - 0.5) * 16; seed[i] = Math.random(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { lp: { value: new THREE.Vector3() }, ld: { value: new THREE.Vector3(0, 0, -1) }, on: { value: 1 }, time: { value: 0 }, cosA: { value: Math.cos(0.5) } },
      vertexShader: `
        uniform vec3 lp, ld; uniform float on, time, cosA; attribute float seed; varying float vA;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec3 d = wp.xyz - lp; float dist = length(d);
          float c = dot(d / max(dist, 1e-3), ld);
          vA = on * smoothstep(cosA, mix(cosA, 1.0, 0.5), c) * clamp(1.0 - dist / 9.0, 0.0, 1.0) * (0.45 + 0.55 * sin(seed * 40.0 + time * (0.5 + seed)));
          vec4 mv = viewMatrix * wp;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.0 + seed * 1.5) * (5.0 / -mv.z);
        }`,
      fragmentShader: `
        varying float vA;
        void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r) * vA; gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a * 0.55, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  // ---------- モード・フロア ----------
  setMode(mode) {
    if (this.mode && this.mode.dispose) this.mode.dispose();
    this.mode = mode;
  }
  clearActors() {
    for (const r of this.robots) r.dispose();
    for (const n of this.npcs) n.dispose();
    this.robots = []; this.npcs = [];
  }
  setLevel(lv, pos) {
    if (this.level) { this.scene.remove(this.level.group); this.level.dispose(); }
    this.clearActors();
    this.level = lv; this.scene.add(lv.group);
    this.throws.clear();
    const y = pos.y ?? lv.groundAt(pos.x, pos.z);
    this.player.place(pos.x, pos.z, pos.yaw ?? 0, Math.max(0, y));
    this.ui.setHidden(false); this.audio.setMuffled(false);
    this.closeDoc();
    this.applyPower(lv.power, true);
  }
  addRobot(x, z, opts) { const r = new Robot(this, x, z, opts); this.robots.push(r); return r; }
  spawnRobotFar(minD = 15, silent = true) {
    const lv = this.level, p = this.player;
    for (let t = 0; t < 120; t++) {
      const q = lv.nav.randomFree(Math.random, lv.reach);
      if (!q) break;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < minD) continue;
      if (d < 32 && lv.phys.los(q.x, q.y + 1.3, q.z, p.x, p.eyeY, p.z)) continue;
      const r = this.addRobot(q.x, q.z);
      if (!silent) { this.audio.pa(); this.ui.say('【館内放送】フロアに追加スタッフが到着しました'); }
      return r;
    }
    return null;
  }
  randomPatrolPoint(r) {
    const lv = this.level;
    let best = null;
    for (let i = 0; i < 8; i++) {
      const q = lv.nav.randomFree(Math.random, lv.reach);
      if (!q) break;
      best = q;
      if (Math.hypot(q.x - r.x, q.z - r.z) > 10) break;
    }
    return best;
  }
  onSpotted(r) { this.spotted++; this.audio.jingle(r.x, r.z, true); }
  // 物音: 範囲内の平静なロボットが調べに来る
  noiseAt(x, z, radius) {
    let n = 0;
    for (const r of this.robots) {
      if (r.state !== 'patrol' && r.state !== 'search' && r.state !== 'lure') continue;
      if (Math.hypot(r.x - x, r.z - z) < radius) { r.enter('search', { x, z }); n++; }
    }
    return n;
  }

  // ---------- 電源 ----------
  // 系統が使えるか（主電源 ON かつ配電盤でその系統が ON）
  sysOn(k) { const lv = this.level; return !!(lv && lv.power && lv.sys[k]); }
  load() { const lv = this.level; return Object.keys(LOADS).reduce((a, k) => a + (lv.sys[k] ? LOADS[k] : 0), 0); }
  applyPower(on, instant) {
    const lv = this.level;
    lv.power = on;
    if (lv.breaker) {
      lv.breaker.on = on;
      lv.breaker.led.material.color.copy(on ? this.M.ledGreen.color : this.M.ledRed.color);
      lv.breaker.lever.rotation.x = on ? -0.6 : 0.6;
    }
    this.applySystems(instant, true);
  }
  applySystems(instant, boot) {
    const lv = this.level;
    for (const d of lv.doors) if (d.power) { if (this.sysOn('shutter')) this.openDoor(d, instant, true); else this.closeDoor(d, instant); }
    for (const L of lv.lifts) L.panelMat.color.copy(this.sysOn('lift') ? this.M.ledGreen.color : this.M.ledRed.color);
    // 電源投入直後のカメラは起動待ち
    for (const c of lv.cameras) { if (!this.sysOn('camera')) c.ledMat.color.setScalar(0.05); else if (!instant && boot !== false) { c.cd = 8; c.spotT = 0; } }
    if (!instant) lv.refresh();
  }

  // ---------- 配電盤パネル ----------
  openPanel(b) {
    this.state = 'panel'; this.panelB = b;
    this.ui.prompt(''); document.exitPointerLock();
    this.throws.cancel();
    this.renderPanel();
  }
  renderPanel(msg) {
    const lv = this.level;
    this.ui.panel({
      power: lv.power, locked: !lv.power && this.panelB.need && !this.mode.has(this.panelB.need),
      sys: Object.keys(LOADS).map((k) => ({ k, name: SYS_NAMES[k], amp: LOADS[k], on: !!lv.sys[k] })),
      load: this.load(), cap: CAPACITY, msg,
    }, {
      main: () => this.panelMain(), toggle: (k) => this.panelToggle(k), close: () => this.closePanel(true),
    });
  }
  panelMain() {
    const b = this.panelB, lv = this.level;
    if (!lv.power && b.need && !this.mode.has(b.need)) { this.audio.locked(); this.renderPanel('主電源のスイッチに鍵がかかっている'); return; }
    if (!lv.power && this.load() > CAPACITY) { this.trip(); return; }
    this.audio.breaker(b.x, b.z);
    this.applyPower(!lv.power);
    this.noiseAt(b.x, b.z, this.mode.breakerNoise ?? 12);
    if (this.mode.onPower) this.mode.onPower(lv.power, b);
    this.renderPanel();
  }
  panelToggle(k) {
    const lv = this.level;
    lv.sys[k] = !lv.sys[k];
    this.audio.click();
    if (this.mode.onSys) this.mode.onSys(lv.sys);
    if (lv.power && this.load() > CAPACITY) { this.trip(); return; }
    this.applySystems(false, lv.sys[k]);
    this.renderPanel();
  }
  // 過電流: 主電源が落ちる
  trip() {
    const b = this.panelB;
    this.audio.trip(b.x, b.z);
    this.applyPower(false);
    this.noiseAt(b.x, b.z, 14);
    if (this.mode.onPower) this.mode.onPower(false, b);
    Progress.unlock('trip');
    this.renderPanel('過電流でブレーカーが落ちた（' + this.load() + 'A ＞ ' + CAPACITY + 'A）。系統を減らしてから主電源を入れ直す');
  }
  closePanel(gesture) {
    if (this.state !== 'panel') return;
    this.ui.panel(null);
    this.state = 'play';
    if (gesture) this.requestLock(); else this.pause();
  }

  // ---------- 扉 ----------
  openDoor(d, instant, silent) {
    if (d.open) return;
    d.open = true; d.col.on = false;
    if (instant) { d.t = 1; this._doorPose(d); } else { this.level.refresh(); if (!silent || true) this.audio.door(d.type, d.x, d.z); }
    if (d.ledMat) d.ledMat.color.copy(this.M.ledGreen.color);
  }
  closeDoor(d, instant) {
    if (!d.open) return;
    d.open = false; d.col.on = true;
    if (instant) { d.t = 0; this._doorPose(d); } else { this.level.refresh(); this.audio.door(d.type, d.x, d.z); }
  }
  _doorPose(d) {
    const m = d.mesh;
    m.visible = d.t < 0.999 || d.type === 'shutter';
    if (d.type === 'shutter') m.position.y = d.y + d.h / 2 + d.t * (d.h - 0.15);
    else if (d.axis === 'x') m.position.x = d.x + d.t * (d.w * 0.95);
    else m.position.z = d.z + d.t * (d.w * 0.95);
  }
  updateDoors(dt) {
    for (const d of this.level.doors) {
      const tgt = d.open ? 1 : 0;
      if (Math.abs(d.t - tgt) < 1e-3) continue;
      d.t = clamp(d.t + Math.sign(tgt - d.t) * dt * (d.type === 'shutter' ? 0.45 : 1.2), 0, 1);
      this._doorPose(d);
    }
  }

  // ---------- 監視カメラ ----------
  updateCameras(dt) {
    const lv = this.level, p = this.player;
    if (!this.sysOn('camera') || this.mode.camerasOff) return;
    for (const c of lv.cameras) {
      c.phase += dt * 0.35;
      c.yaw = c.yaw0 + Math.sin(c.phase) * c.sweep;
      c.head.rotation.set(-c.pitch, c.yaw, 0, 'YXZ');
      c.cd = Math.max(0, c.cd - dt);
      let seeing = false;
      if (!p.hidden && this.state !== 'dying') {
        const dx = p.x - c.x, dz = p.z - c.z, dy = p.eyeY - c.y, d = Math.hypot(dx, dz);
        if (d < c.range && d > 0.5) {
          const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
          const cosA = (dx * fx + dz * fz) / d, elev = Math.atan2(dy, d);
          if (cosA > Math.cos(0.62) && Math.abs(elev - c.pitch) < 0.65 && lv.phys.los(c.x, c.y, c.z, p.x, p.eyeY - 0.2, p.z)) seeing = true;
        }
      }
      c.spotT = seeing ? c.spotT + dt * (this.flashOn ? 1.6 : 1) * (p.crouch ? 0.6 : 1) : Math.max(0, c.spotT - dt);
      const blink = seeing ? (Math.sin(this.clock * 25) > 0 ? 3 : 0.3) : (Math.sin(this.clock * 3 + c.phase) > 0.9 ? 2.5 : 0.25);
      c.ledMat.color.setRGB(blink, 0.1, 0.08);
      if (c.spotT > 0.9 && c.cd <= 0) {
        c.cd = 12; c.spotT = 0;
        this.audio.pa();
        this.ui.say('【館内放送】' + c.name + ' にてお客様をお見かけしました。スタッフがご案内に伺います');
        const near = this.robots.filter((r) => (r.state === 'patrol' || r.state === 'search' || r.state === 'lure'))
          .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, 2);
        for (const r of near) r.enter('search', { x: p.x, z: p.z });
      }
    }
  }

  // ---------- フレーム ----------
  frame(dt) {
    this.clock += dt;
    const s = this.state;
    if (s === 'play' || s === 'code' || s === 'monitor' || s === 'panel') this.update(dt);
    else if (s === 'dying') this.updateDying(dt);
    if (this.level) {
      if (s === 'monitor') this.updateMonitorCam(dt); else this.updateCamera(dt);
      if (s === 'play' || s === 'code' || s === 'dying' || s === 'trans' || s === 'monitor' || s === 'panel') this.audio.update(dt, this.player);
      this.sensors.update();
      this.audio.listen(this.camera);
    }
    this.fx.u.fear.value = this.fear;
    this.fx.render(dt, this.clock);
    if (this.mapOpen && this.level) drawMap(this.ui.e.map, this);
  }

  update(dt) {
    const p = this.player, lv = this.level;
    this.time += dt;
    this.decoyCd = Math.max(0, this.decoyCd - dt);
    this.mode.update(dt);
    if (this.state === 'dying' || this.state === 'trans' || !this.level) return;
    if (this.state !== 'monitor') p.update(dt, this.keys, this);
    lv.visit(p.x, p.z);
    for (const it of lv.interacts) if (it.spin && it.mesh) { it.mesh.rotation.y += dt * 1.5; }
    for (const r of this.robots) { r.update(dt); if (this.state === 'dying') break; }
    for (const n of this.npcs) n.update(dt);
    this.throws.update(dt);
    if (this.flashOn && !p.hidden) this.run.lightTime += dt;
    this.updateDoors(dt);
    this.updateCameras(dt);
    for (const t of lv.triggers || []) {
      if (!t.done && Math.hypot(t.x - p.x, t.z - p.z) < t.r) { t.done = true; if (this.mode.onTrigger) this.mode.onTrigger(t); }
    }

    let nearest = 99, chasing = false;
    for (const r of this.robots) {
      if (r.state === 'sleep' || r.state === 'off' || r.state === 'dead' || r.state === 'charge') continue;
      nearest = Math.min(nearest, Math.hypot(r.x - p.x, r.z - p.z));
      if (r.state === 'chase' || r.state === 'alert' || r.state === 'inspect') chasing = true;
    }
    const fearT = this.mode.fearOverride ?? clamp((chasing ? 0.55 : 0) + Math.max(0, 1 - nearest / 14) * 0.6, 0, 1);
    this.fear = damp(this.fear, fearT, 2, dt);
    this.audio.fear = p.hidden ? Math.max(this.fear, 0.3) : this.fear;
    this.audio.breath = p.exhausted ? 1 : p.stamina < 40 ? 0.45 : 0;
    this.updateLights(dt);
    this.updateHud();
  }

  updateLights(dt) {
    const lv = this.level, p = this.player, spots = lv.lightSpots, on = this.sysOn('light');
    for (const s of spots) {
      let v;
      if (!on) v = 0;
      else if (s.mode === 'dead') {
        if (s.off > 0) s.off -= dt; else if (Math.random() < dt * 0.25) s.off = 0.08 + Math.random() * 0.5;
        v = s.off > 0 && Math.random() < 0.6 ? 1 : 0;
      } else {
        if (s.off > 0) s.off -= dt; else if (Math.random() < dt * 0.3) s.off = 0.04 + Math.random() * 0.25;
        v = s.off > 0 ? (Math.random() < 0.35 ? 1 : 0) : 1;
      }
      if (v !== s.v) { s.v = v; s.mat.color.setScalar(v ? 2.2 : 0.04); }
      s.d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
    }
    const near = spots.slice().sort((a, b) => a.d - b.d);
    this.fixLights.forEach((L, i) => {
      const s = near[i];
      if (!s) { L.intensity = 0; return; }
      L.position.set(s.x, s.y, s.z);
      L.intensity = s.v * 9;
    });
    this.audio.updateBuzz(near.slice(0, 3));
    const amb = this.state === 'monitor' ? 4 : this.mode.ambient ?? (on ? 1.1 : 0.75); // 監視カメラは赤外線で明るく見える
    this.hemi.intensity = this.state === 'monitor' ? amb : damp(this.hemi.intensity, amb, 2, dt);
  }

  updateCamera(dt) {
    const p = this.player, cam = this.camera;
    const shake = this.state === 'dying' ? 0.02 : this.fear > 0.6 ? (this.fear - 0.6) * 0.01 : 0;
    p.applyCamera(cam, this.clock, shake);
    cam.updateMatrixWorld();
    _off.set(0.16, -0.2, -0.05).applyQuaternion(cam.quaternion);
    this.rig.position.copy(cam.position).add(_off);
    this.rig.quaternion.slerp(cam.quaternion, 1 - Math.exp(-12 * dt));
    if (this.flickT > 0) this.flickT -= dt;
    else if (Math.random() < dt * this.fear * 2.5) this.flickT = 0.05 + Math.random() * 0.2;
    const on = this.flashOn && !p.hidden && !p.robot;
    this.flash.intensity = on ? this.flashBase * (this.flickT > 0 ? 0.15 + Math.random() * 0.3 : 1) : 0;
    cam.getWorldDirection(_fwd);
    this.bounce.position.copy(cam.position).addScaledVector(_fwd, 1.4);
    this.bounce.intensity = on ? 0.35 : 0;
    // 明順応: ライトが照らす面までの距離で露出を調整（至近の白飛びを防ぐ）
    const d = on ? this.viewDistance(_fwd) : 8;
    const target = this.mode && this.mode.exposure ? this.mode.exposure : on ? clamp(0.09 * Math.pow(d, 1.6), 0.18, 1.3) : 1.7;
    this.setExposure(target, dt);
    // 埃
    const u = this.dustMat.uniforms;
    this.rig.getWorldPosition(u.lp.value);
    u.ld.value.set(0, 0, -1).applyQuaternion(this.rig.quaternion);
    u.on.value = on ? 1 : 0; u.time.value = this.clock;
    const pa = this.dust.geometry.attributes.position, arr = pa.array;
    for (let i = 0; i < DUST_N; i++) {
      let x = arr[i * 3], y = arr[i * 3 + 1] - dt * 0.05, z = arr[i * 3 + 2];
      if (y < cam.position.y - 2) y += 3; else if (y > cam.position.y + 1.5) y -= 3;
      if (x - cam.position.x > 8) x -= 16; else if (x - cam.position.x < -8) x += 16;
      if (z - cam.position.z > 8) z -= 16; else if (z - cam.position.z < -8) z += 16;
      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
    }
    pa.needsUpdate = true;
  }
  setExposure(target, dt) {
    this.exposure = damp(this.exposure, target, target < this.exposure ? 6 : 1.5, dt);
    this.renderer.toneMappingExposure = this.exposure;
    this.fx.bloom.threshold = 1.1 / this.exposure; // ブルームは露出補正前の値で判定されるため連動させる
  }

  // 視線方向で最初に当たる面（壁・背の高い物・床）までの距離
  viewDistance(f) {
    const p = this.player, ph = this.level.phys, ey = this.camera.position.y;
    const h = Math.hypot(f.x, f.z) || 1e-6;
    const floorD = f.y < -0.02 ? (ey - p.gy) / -f.y : 99;
    const ceilD = f.y > 0.02 ? (this.level.wallH - ey) / f.y : 99;
    let d = Math.min(floorD, ceilD, 12);
    const dx = f.x / h, dz = f.z / h;
    for (let s = 0.25; s * h < d; s += 0.25) {
      const x = p.x + dx * s, z = p.z + dz * s, y = ey + (f.y / h) * s;
      if (!ph.inBounds(x, z, 0) || ph.topAt(x, z) > y) { d = Math.min(d, s / h); break; }
    }
    return d;
  }

  // ---------- 監視モニター ----------
  enterMonitor() {
    const cams = this.level.cameras;
    if (!cams.length) return;
    if (!this.sysOn('camera')) { this.ui.say('監視カメラの系統に電気が来ていない（配電盤）'); this.audio.error(); return; }
    this.state = 'monitor'; this.monIdx = 0;
    this.fx.setCamera(this.monCam); this.fx.u.mon.value = 1;
    this.audio.click();
    this.updateMonitorCam(0);
  }
  exitMonitor() {
    if (this.state !== 'monitor') return;
    this.state = 'play';
    this.fx.setCamera(this.camera); this.fx.u.mon.value = 0;
    this.ui.monitor(null);
  }
  cycleMonitor(dir) {
    const n = this.level.cameras.length;
    this.monIdx = (this.monIdx + dir + n) % n;
    this.audio.staticBurst(0.04);
  }
  updateMonitorCam() {
    const c = this.level.cameras[this.monIdx];
    if (!c) { this.exitMonitor(); return; }
    this.monCam.position.set(c.x, c.y - 0.05, c.z);
    this.monCam.rotation.set(c.pitch, c.yaw + Math.PI, 0);
    this.setExposure(1.8, 0.016);
    this.ui.monitor(c.name + '  ' + (this.monIdx + 1) + '/' + this.level.cameras.length);
  }

  // ---------- インタラクション ----------
  findInteract() {
    const p = this.player, lv = this.level;
    if (this.doc) return { kind: 'closeDoc', text: '[E] 閉じる' };
    if (p.hidden) return { kind: 'unhide', text: '[E] ロッカーから出る' };
    const d = (x, z) => Math.hypot(x - p.x, z - p.z);
    let best = null, bd = 1e9;
    const consider = (it, dist, kind) => { if (dist < bd) { bd = dist; best = { ...it, kind: kind || it.kind, o: it }; } };
    for (const it of lv.interacts) {
      if (it.gone || Math.abs((it.y || 0) - p.gy) > 1.2) continue;
      const dd = d(it.x, it.z);
      if (dd < (it.r || 1.3)) consider(it, dd - (it.kind === 'item' ? 0.3 : 0));
    }
    for (const s of lv.pads) { const dd = d(s.x, s.z); if (dd < 1.5) consider(s, dd, 'pad'); }
    // 停止したロボットの型番プレート
    if (!p.robot) for (const r of this.robots) {
      if ((r.state !== 'off' && r.state !== 'dead') || r.plateTaken) continue;
      const dd = d(r.x, r.z);
      if (dd < 1.5 && dd + 0.1 < bd) { bd = dd + 0.1; best = { kind: 'plate', o: r, x: r.x, z: r.z }; }
    }
    if (!p.robot) {
      for (const l of lv.lockers) {
        if (Math.abs(l.y - p.gy) > 0.5) continue;
        const dd = d(l.exit.x, l.exit.z);
        if (dd < 0.9 && p.facingDot(l.x, l.z) > 0.3) consider(l, dd - 0.2, 'hide');
      }
      if (!best) for (const t of lv.tablets) { const dd = d(t.x, t.z); if (dd < t.reach && Math.abs(t.y - p.gy) < 0.5) consider(t, dd + 1, 'tablet'); }
    } else {
      for (const l of lv.lockers) { const dd = d(l.exit.x, l.exit.z); if (dd < 1.0) consider(l, dd - 0.2, 'openLocker'); }
    }
    if (!best) return null;
    best.text = this.mode.interactText?.(best) ?? this.interactText(best);
    return best.text === null ? null : best;
  }
  interactText(it) {
    switch (it.kind) {
      case 'hide': return '[E] ロッカーに隠れる';
      case 'tablet': return this.decoyCd > 0 ? 'タブレット充電中 ' + Math.ceil(this.decoyCd) + 's' : '[E] ' + it.name + 'から呼び出し（囮）';
      case 'breaker': return '[E] 配電盤を開く（' + (this.level.power ? '通電中 ' + this.load() + '/' + CAPACITY + 'A' : '停電中') + '）';
      case 'plate': return '[E] 停止したロボットの型番プレートを外す';
      case 'item': return it.gear ? '[E] ' + it.name + 'を拾う' : null;
      case 'door': {
        const dd = it.door;
        if (dd.open) return null;
        if (dd.thumb && this.thumbSide(dd)) return '[E] サムターンを回して開ける';
        if (dd.locked) return (dd.label || '扉') + '：開かない';
        if (dd.need) return this.mode.has(dd.need) ? '[E] カードキーで開ける' : (dd.label || '扉') + '：カードキーが必要';
        return (dd.label || '扉') + '：内側から施錠されている';
      }
      case 'shutter': return it.door.open ? null : 'シャッター：電源が落ちていて動かない';
      case 'monitor': return '[E] 監視モニターを見る';
      case 'lift': return !it.need && !this.sysOn('lift') ? it.label + '：' + (this.level.power ? 'リフトの系統が OFF（配電盤で ON に）' : '電源が落ちている') : '[E] ' + it.label + 'に乗る';
      case 'openLocker': return '[E] ロッカーを開ける';
      default: return null;
    }
  }
  // サムターン側（扉の thumb 方向）にプレイヤーがいるか
  thumbSide(d) {
    const p = this.player;
    return { n: p.z < d.z, s: p.z > d.z, w: p.x < d.x, e: p.x > d.x }[d.thumb];
  }

  interact() {
    if (this.state === 'monitor') { this.exitMonitor(); return; }
    if (this.state !== 'play') return;
    const it = this.findInteract();
    if (!it) return;
    if (this.mode.use && this.mode.use(it)) return;
    switch (it.kind) {
      case 'closeDoc': this.closeDoc(); break;
      case 'unhide': this.unhide(); break;
      case 'hide': this.hide(it.o); break;
      case 'tablet': if (this.decoyCd <= 0) this.useDecoy(it.o); else this.audio.error(); break;
      case 'breaker': this.openPanel(it.o); break;
      case 'plate': this.takePlate(it.o); break;
      case 'item': if (it.o.gear) this.pickupGear(it.o); break;
      case 'door': {
        const d = it.door;
        if (d.thumb && this.thumbSide(d)) { this.openDoor(d); this.mode.onDoorOpen?.(d); }
        else if (d.need && !d.locked && this.mode.has(d.need)) { this.audio.unlock(); this.openDoor(d); this.mode.onDoorOpen?.(d); }
        else this.audio.locked();
        break;
      }
      case 'shutter': this.audio.locked(); break;
      case 'monitor': this.enterMonitor(); break;
      case 'lift': if (this.mode.onLift) this.mode.onLift(it.o); break;
    }
  }

  hide(L) {
    const p = this.player;
    p.hidden = true; p.locker = L; this.run.lockers++;
    p.x = L.x + L.fx * 0.12; p.z = L.z + L.fz * 0.12; p.gy = L.y;
    p.yawCenter = Math.atan2(-L.fx, -L.fz); p.yaw = p.yawCenter; p.pitch = 0;
    this.audio.locker(true); this.audio.setMuffled(true); this.ui.setHidden(true);
    for (const r of this.robots) {
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if ((r.state === 'chase' || r.state === 'alert') && r.sinceSeen < 1.0 && d < 14) r.enter('inspect', L);
      else if ((r.state === 'patrol' || r.state === 'lure') && d < 4) r.enter('search', L.exit); // 扉の音を聞かれた
    }
  }
  unhide() {
    const p = this.player, L = p.locker;
    p.hidden = false; p.locker = null;
    if (L) { p.x = L.exit.x; p.z = L.exit.z; }
    this.audio.locker(false); this.audio.setMuffled(false); this.ui.setHidden(false);
  }

  useDecoy(t) {
    this.decoyCd = DECOY_CD;
    this.audio.chime(t.x, t.z);
    this.ui.say('呼び出しを受信: ' + t.name);
    for (const r of this.robots) {
      if (r.state === 'sleep' || r.state === 'inspect' || r.state === 'caught') continue;
      if (r.state === 'chase' && r.sinceSeen < 0.5) continue;
      if (Math.hypot(r.x - t.x, r.z - t.z) > DECOY_RANGE) continue;
      r.enter('lure', t);
    }
  }

  // ---------- 装備 ----------
  pickupGear(it) {
    const G = this.gear;
    if (it.gear === 'throw' && G.throws >= 3) { this.ui.say('これ以上持てない（投げられる物は3つまで）'); return; }
    it.gone = true; it.mesh.visible = false;
    this.audio.pickup();
    if (it.gear === 'cell') { G.cells++; this.ui.note('入手: 電池（リモコン用）'); }
    else if (it.gear === 'throw') { G.throws++; this.ui.note('入手: ' + it.name + '（G 長押しで投げる）'); }
    else if (it.gear === 'remote') {
      G.remote = true; G.cells += 2;
      this.showDoc('停止リモコン（整備用）', 'ロボットに停止信号を送る整備用リモコン。\n\n・正面からでも、7m 以内で狙ったロボット1台を止められる\n・1回ごとに電池を1本使う（電池は館内に落ちている）\n・止めたロボットは二度と動かない\n\n操作: R キー（スマホは「停止」ボタン）。画面中央にロボットを合わせて使う');
    } else if (it.gear === 'doc') {
      if (!G.docs.includes(it.docType)) G.docs.push(it.docType);
      const D = DOCS[it.docType];
      this.showDoc(D.title, D.body);
      if (['vision', 'hearing', 'battery'].every((k) => G.docs.includes(k))) Progress.unlock('docs3');
    } else if (it.gear === 'note') {
      const n = NOTES[it.note], isNew = Progress.dexAdd('notes', it.note);
      this.showDoc(n.title + (isNew ? '（図鑑に登録）' : ''), n.body);
    }
    if (this.mode.onPickup) this.mode.onPickup(it);
  }
  takePlate(r) {
    r.plateTaken = true;
    const T = ROBOT_TYPES[r.type], isNew = Progress.dexAdd('robots', r.type);
    this.audio.pickup();
    this.showDoc('型番プレート：' + T.name + (isNew ? '（図鑑に登録）' : ''),
      T.desc + '\n\n移動速度 ×' + T.speed + '　視覚センサー ×' + T.sight + '\nバッテリー容量 ' + T.battery + '　消費 ×' + T.drain);
  }
  // リモコン: 画面中央の先にいる近くのロボット1台を永久に止める
  useRemote() {
    const p = this.player, G = this.gear;
    if (this.state !== 'play' || p.hidden || p.robot) return;
    if (!G.remote) { this.ui.say('停止リモコンを持っていない'); return; }
    if (G.cells <= 0) { this.audio.error(); this.ui.say('リモコンの電池がない'); return; }
    let best = null, bd = 99;
    for (const r of this.robots) {
      if (r.state === 'off' || r.state === 'dead' || r.state === 'caught') continue;
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (d > 7 || p.facingDot(r.x, r.z) < 0.93) continue;
      if (!this.level.phys.los(p.x, p.eyeY, p.z, r.x, r.gy + 1.0, r.z)) continue;
      if (d < bd) { bd = d; best = r; }
    }
    if (!best) { this.audio.click(); this.ui.say('画面中央の先 7m 以内にロボットがいない'); return; }
    G.cells--;
    this.audio.zap(best.x, best.z);
    best.enter('off');
    this.onRobotStopped(best, 'remote');
  }
  onRobotStopped(r, why) {
    if (why === 'drain') {
      this.audio.powerDown(r.x, r.z);
      if (Math.hypot(r.x - this.player.x, r.z - this.player.z) < 25) this.ui.say('ロボットの電池が切れて止まった');
      Progress.add('drains');
    } else { this.ui.say('ロボットを停止させた（電池 残り' + this.gear.cells + '本）'); Progress.add('stops'); }
    if (this.mode.onRobotStopped) this.mode.onRobotStopped(r, why);
  }

  showDoc(title, body) {
    this.doc = { title, body };
    this.ui.doc(title, body);
  }
  closeDoc() { if (this.doc) { this.doc = null; this.ui.doc(null); } }

  // 画面暗転して何かを実行（階移動など）
  transition(fn, ms = 650, sound) {
    this.state = 'trans'; this.pauseAfterTrans = false;
    this.ui.veil(1, 450); this.ui.prompt('');
    if (sound) sound();
    setTimeout(() => {
      fn();
      this.ui.veil(0, 600);
      if (this.state !== 'trans') return;
      if (this.pauseAfterTrans || !this.isLocked()) this.pause(); else this.state = 'play';
    }, ms);
  }

  onStep(kind, wet) {
    if (this.player.robot) this.audio.servo(); else this.audio.step(this.level.surface, kind, wet);
  }
  onLand(v) {
    if (v < 3) return;
    this.audio.land(v);
    this.noiseAt(this.player.x, this.player.z, Math.min(16, v * 2.2));
  }
  onFallThrough() {
    if (this.mode.onFall) this.mode.onFall(this.player.x, this.player.z);
  }

  // ---------- 暗証番号 ----------
  openCode(title, check, onOk) {
    this.state = 'code'; this.codeInput = []; this.codeCtx = { check, onOk };
    this.ui.openCode(title);
    this.ui.prompt('');
    document.exitPointerLock();
  }
  codeDigit(d) {
    if (this.state !== 'code' || this.codeInput.length >= 4) return;
    this.codeInput.push(d); this.audio.uiTone(660 + d * 40);
    this.ui.codeDisplay(this.codeInput, '');
  }
  codeDel() { if (this.state === 'code') { this.codeInput.pop(); this.ui.codeDisplay(this.codeInput, ''); } }
  codeSubmit(gesture) {
    if (this.state !== 'code') return;
    if (this.codeInput.length < 4) { this.ui.codeDisplay(this.codeInput, '4桁入力してください'); return; }
    if (!this.codeCtx.check(this.codeInput.join(''))) {
      this.audio.error(); this.codeInput = [];
      this.ui.codeDisplay(this.codeInput, '番号が違います');
      return;
    }
    this.audio.unlock(); this.ui.closeCode();
    this.state = 'play';
    if (gesture) this.requestLock();
    this.codeCtx.onOk();
  }
  codeCancel(gesture) {
    if (this.state !== 'code') return;
    this.ui.closeCode();
    this.state = 'play';
    if (gesture) this.requestLock(); else this.pause();
  }

  // ---------- 捕獲 ----------
  caught(r) {
    if (this.state === 'dying' || this.state === 'over' || this.state === 'trans') return;
    if (this.mode.onCaught && this.mode.onCaught(r)) return;
    if (this.state === 'code') this.ui.closeCode();
    if (this.state === 'panel') this.ui.panel(null);
    if (this.state === 'monitor') this.exitMonitor();
    this.throws.cancel();
    this.closeDoc();
    this.state = 'dying'; this.dyingT = 0; this.killer = r;
    r.enter('caught');
    if (this.player.hidden) { this.player.hidden = false; this.ui.setHidden(false); this.audio.setMuffled(false); this.audio.locker(true); }
    this.audio.caught(); this.ui.prompt('');
    this.mapOpen = false; this.ui.e.map.classList.add('hide');
  }
  updateDying(dt) {
    const p = this.player, r = this.killer;
    this.dyingT += dt;
    const dx = r.x - p.x, dz = r.z - p.z, d = Math.hypot(dx, dz);
    if (d > 0.75) { r.x -= (dx / d) * dt * 1.5; r.z -= (dz / d) * dt * 1.5; }
    r.heading = Math.atan2(-dx, -dz); r.headYaw = 0; r._sync(dt);
    const ty = Math.atan2(-dx, -dz), tp = Math.atan2(r.gy + 1.33 - p.eyeY, Math.max(0.3, d));
    p.yaw += angDiff(p.yaw, ty) * (1 - Math.exp(-9 * dt));
    p.pitch = damp(p.pitch, tp, 9, dt);
    this.fx.u.caught.value = clamp(this.dyingT / 1.2, 0, 1);
    this.fear = 1;
    if (this.dyingT > 1.7) { this.state = 'over'; this.mode.gameOver(); setTimeout(() => { this.fx.u.caught.value = 0; }, 300); }
  }

  // ---------- 一時停止・ポインタロック ----------
  // タッチ端末はポインタロックが無いので、プレイ中フラグで代用する
  isLocked() { return this.touch ? this.touchActive : document.pointerLockElement === this.renderer.domElement; }
  requestLock() {
    if (this.touch) {
      this.touchActive = true;
      setTimeout(() => { if (this.state === 'pause' || this.state === 'title') this.resumePlay(); }, 0);
      return;
    }
    const el = this.renderer.domElement;
    try {
      const r = el.requestPointerLock();
      if (r && r.catch) r.catch(() => this.onLockError());
    } catch (e) { this.onLockError(); }
  }
  onLockError() {
    if (this.state === 'play' || this.state === 'monitor') this.pause();
    else if (this.state === 'trans') this.pauseAfterTrans = true;
  }
  onLockChange() {
    const locked = this.isLocked();
    this.ui.crosshair(locked);
    for (const k in this.keys) this.keys[k] = false;
    if (locked) {
      if (this.state === 'pause' || this.state === 'title') this.resumePlay();
    } else if (this.state === 'play' || this.state === 'monitor') this.pause();
    else if (this.state === 'trans') this.pauseAfterTrans = true;
  }
  resumePlay() {
    if (this.fx.camera !== this.camera) this.fx.setCamera(this.camera);
    this.fx.u.mon.value = 0; this.ui.monitor(null);
    this.state = 'play';
    this.ui.hideOverlay(); this.ui.showHud(true);
    if (this.audio.ctx && this.audio.ctx.state === 'suspended') this.audio.ctx.resume();
  }
  pause() {
    this.throws.cancel();
    if (this.touch) { this.touchActive = false; for (const k in this.keys) this.keys[k] = false; }
    if (this.state === 'monitor') { this.fx.setCamera(this.camera); this.fx.u.mon.value = 0; this.ui.monitor(null); }
    this.state = 'pause';
    if (this.audio.ctx) this.audio.ctx.suspend();
    const info = this.mode.pauseInfo();
    this.ui.overlay({
      title: '一時停止',
      body: info.body,
      buttons: [{ label: '再開', primary: true, onClick: () => { this.audio.init(); this.requestLock(); } }, ...info.buttons],
      settings: true,
    });
  }
  // モード開始時にポインタロックを取る
  begin() {
    this.audio.init();
    this.fx.u.caught.value = 0;
    this.state = 'title';
    if (this.isLocked()) this.resumePlay(); else this.requestLock();
  }

  toggleFlash() {
    if (this.state !== 'play' || this.player.hidden || this.player.robot) return;
    this.flashOn = !this.flashOn; this.audio.click();
  }
  toggleMap() {
    if (this.state !== 'play') return;
    this.mapOpen = !this.mapOpen;
    this.ui.e.map.classList.toggle('hide', !this.mapOpen);
  }

  updateHud() {
    const it = this.state === 'play' ? this.findInteract() : null;
    this.ui.prompt(it ? it.text : '');
    const h = this.mode.hud(), G = this.gear, gear = [];
    if (!this.player.robot) {
      if (G.remote) gear.push('リモコン 電池' + G.cells);
      if (G.throws) gear.push('投げ物 ' + G.throws);
      if (G.docs.length) gear.push('技術資料 ' + G.docs.length + '/3' + (this.sensors.on ? '' : '（V で表示）'));
    }
    if (gear.length) h.sub += '<br>' + gear.join('　');
    this.ui.hud(h);
  }
}
