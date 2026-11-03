// ゲーム進行: 状態遷移・フロア管理・インタラクション・ライト/カメラ
import * as THREE from 'three';
import { ENTRY, KEY_POS, TOP_FLOOR, DECOY_CD, DECOY_RANGE, STORAGE_KEYS, FLOORS } from './config.js';
import { buildMaterials, faceTextures, flashCookie } from './textures.js';
import { buildLevel } from './level.js';
import { Robot, initRobotAssets } from './robot.js';
import { Player } from './player.js';
import { drawMap } from './minimap.js';
import { mulberry32, damp, clamp, angDiff, storage, fmtTime } from './util.js';

const DUST_N = 500;
const _off = new THREE.Vector3(), _fwd = new THREE.Vector3();

export class Game {
  constructor({ renderer, scene, camera, audio, ui, fx, settings }) {
    Object.assign(this, { renderer, scene, camera, audio, ui, fx, settings });
    this.M = buildMaterials(renderer);
    initRobotAssets(this.M, faceTextures());
    scene.fog = new THREE.FogExp2(0x000000, 0.045);
    scene.background = new THREE.Color(0x000000);
    scene.add(new THREE.HemisphereLight(0x2a3440, 0x0b0907, 0.4));
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
    this.fixLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xdde6ff, 0, 10, 2); scene.add(l); return l; });
    this._makeDust();
    this.applyQuality();

    this.player = new Player();
    this.robots = []; this.level = null;
    this.keys = {};
    this.state = 'title';
    this.fear = 0; this.mapOpen = false; this.pauseAfterTrans = false;
    this.flashOn = true; this.alarm = false;
    this.codeInput = []; this.codePad = null;
    this.time = 0; this.clock = 0;
    this.best = storage.get(STORAGE_KEYS.best, null);
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

  // ---------- 進行 ----------
  newRun(seed) {
    this.seed = seed >>> 0;
    const R = mulberry32(this.seed ^ 0x9e3779b9);
    this.codes = {};
    for (let n = 2; n < TOP_FLOOR; n++) this.codes[n] = String(Math.floor(R() * 10000)).padStart(4, '0');
    const randPos = () => {
      for (;;) {
        const x = -30 + R() * 60, z = -62 + R() * 124;
        if (Math.hypot(x - ENTRY.x, z - ENTRY.z) > 25 && Math.hypot(x - KEY_POS.x, z - KEY_POS.z) > 25) return { x, z };
      }
    };
    const p1 = randPos(); let p2;
    do { p2 = randPos(); } while (Math.hypot(p2.x - p1.x, p2.z - p1.z) < 50);
    this.stairsWorld = [p1, p2];
    this.floorState = {};
    this.hasKey = false; this.alarm = false; this.flashOn = true;
    this.time = 0; this.spotted = 0; this.decoyCd = 0; this.fear = 0;
    this.player.reset(ENTRY.x, ENTRY.z, 0);
    this.loadFloor(1, null);
  }

  loadFloor(n, arrival) {
    if (this.level) { this.scene.remove(this.level.group); this.level.dispose(); }
    for (const r of this.robots) r.dispose();
    this.robots = [];
    this.floor = n;
    const lv = buildLevel(n, { seed: this.seed, stairsWorld: this.stairsWorld, codes: this.codes, hasKey: this.hasKey, M: this.M });
    this.level = lv; this.scene.add(lv.group);
    const pos = arrival ? lv.arrival(arrival.si, arrival.dir) : { x: ENTRY.x, z: ENTRY.z, yaw: 0 };
    this.player.place(pos.x, pos.z, pos.yaw); // ロボット配置より先に確定させる
    this.ui.setHidden(false); this.audio.setMuffled(false);
    const st = this.floorState[n] || (this.floorState[n] = {
      count: 1, interval: Math.max(25, 55 - 5 * n), max: 2 + n, timer: 0, unlocked: false, known: false, visited: new Set(), alarm: false,
    });
    if (this.hasKey && !st.alarm) { st.alarm = true; st.interval = Math.min(st.interval, 20); st.max += 1; }
    for (let i = 0; i < st.count; i++) this.spawnRobot(true);
    if (n === TOP_FLOOR) {
      for (const d of lv.docks) {
        const r = new Robot(this, d.x, d.z, { sleep: !this.hasKey, heading: 0 });
        this.robots.push(r);
      }
    }
    lv.lightSpots.forEach((s) => { s.off = 0; s.mode = Math.random() < 0.34 ? 'dead' : 'live'; });
    this.audio.setBuzz(lv.lightSpots);
    const codeInfo = this.codes[n] ? (st.known ? '（コード記憶済み ' + this.codes[n] + '）' : '／上り階段は暗証番号が必要') : '';
    this.ui.say((arrival ? '→ ' : '') + FLOORS[n].name + codeInfo);
  }

  spawnRobot(silent) {
    const lv = this.level, p = this.player;
    for (let t = 0; t < 120; t++) {
      const q = lv.nav.randomFree(Math.random, lv.reach);
      if (!q) break;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < 15) continue;
      if (d < 32 && lv.phys.los(q.x, q.z, p.x, p.z, 1.2)) continue;
      this.robots.push(new Robot(this, q.x, q.z));
      if (!silent) { this.audio.pa(); this.ui.say('【店内放送】フロアに追加スタッフが到着しました'); }
      return;
    }
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

  onSpotted(r) {
    this.spotted++;
    this.audio.jingle(r.x, r.z, true);
  }

  // ---------- フレーム ----------
  frame(dt) {
    this.clock += dt;
    const s = this.state;
    if (s === 'play' || s === 'code') this.update(dt);
    else if (s === 'dying') this.updateDying(dt);
    if (this.level) {
      this.updateCamera(dt);
      if (s === 'play' || s === 'code' || s === 'dying' || s === 'trans') this.audio.update(dt, this.player);
      this.audio.listen(this.camera);
    }
    this.fx.u.fear.value = this.fear;
    this.fx.render(dt, this.clock);
    if (this.mapOpen && this.level) drawMap(this.ui.e.map, this);
  }

  update(dt) {
    const p = this.player, lv = this.level, st = this.floorState[this.floor];
    this.time += dt;
    this.decoyCd = Math.max(0, this.decoyCd - dt);
    st.timer += dt * (p.hidden ? 3 : 1);
    if (st.count < st.max && st.timer >= st.interval) { st.timer = 0; st.count++; this.spawnRobot(false); }
    p.update(dt, this.keys, this);
    st.visited.add(lv.cellOf(p.x, p.z));
    if (lv.key) { lv.key.mesh.rotation.y += dt * 1.5; lv.key.mesh.position.y = 0.92 + Math.sin(this.time * 2) * 0.015; }
    for (const r of this.robots) { r.update(dt); if (this.state === 'dying') break; }

    let nearest = 99, chasing = false;
    for (const r of this.robots) {
      if (r.state === 'sleep') continue;
      nearest = Math.min(nearest, Math.hypot(r.x - p.x, r.z - p.z));
      if (r.state === 'chase' || r.state === 'alert' || r.state === 'inspect') chasing = true;
    }
    this.fear = damp(this.fear, clamp((chasing ? 0.55 : 0) + Math.max(0, 1 - nearest / 14) * 0.6, 0, 1), 2, dt);
    this.audio.fear = p.hidden ? Math.max(this.fear, 0.3) : this.fear;
    this.audio.breath = p.exhausted ? 1 : p.stamina < 40 ? 0.45 : 0;
    this.updateLights(dt);
    this.updateHud();
  }

  updateLights(dt) {
    const lv = this.level;
    for (let i = 0; i < 3; i++) {
      const L = this.fixLights[i], s = lv.lightSpots[i];
      if (!s) { L.intensity = 0; continue; }
      L.position.set(s.x, s.y, s.z);
      let v;
      if (s.mode === 'dead') {
        if (s.off > 0) s.off -= dt; else if (Math.random() < dt * 0.25) s.off = 0.08 + Math.random() * 0.5;
        v = s.off > 0 && Math.random() < 0.6 ? 1 : 0;
      } else {
        if (s.off > 0) s.off -= dt; else if (Math.random() < dt * 0.7) s.off = 0.04 + Math.random() * 0.3;
        v = s.off > 0 ? (Math.random() < 0.35 ? 1 : 0) : 1;
      }
      L.intensity = v * 5;
      s.mat.color.setScalar(v ? 2.2 : 0.04);
      if (this.audio.buzz[i]) this.audio.buzz[i].set(v);
    }
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
    const on = this.flashOn && !p.hidden;
    this.flash.intensity = on ? this.flashBase * (this.flickT > 0 ? 0.15 + Math.random() * 0.3 : 1) : 0;
    cam.getWorldDirection(_fwd);
    this.bounce.position.copy(cam.position).addScaledVector(_fwd, 1.4);
    this.bounce.intensity = on ? 0.35 : 0;
    // 明順応: ライトが照らす面までの距離で露出を調整（至近の白飛びを防ぐ）
    const d = on ? this.viewDistance(_fwd) : 8;
    const target = on ? clamp(0.09 * Math.pow(d, 1.6), 0.1, 1.25) : 1.35;
    this.exposure = damp(this.exposure, target, target < this.exposure ? 6 : 1.5, dt);
    this.renderer.toneMappingExposure = this.exposure;
    this.fx.bloom.threshold = 1.1 / this.exposure; // ブルームは露出補正前の値で判定されるため連動させる
    // 埃
    const u = this.dustMat.uniforms;
    this.rig.getWorldPosition(u.lp.value);
    u.ld.value.set(0, 0, -1).applyQuaternion(this.rig.quaternion);
    u.on.value = on ? 1 : 0; u.time.value = this.clock;
    const pa = this.dust.geometry.attributes.position, arr = pa.array;
    for (let i = 0; i < DUST_N; i++) {
      let x = arr[i * 3], y = arr[i * 3 + 1] - dt * 0.05, z = arr[i * 3 + 2];
      if (y < 0) y += 3;
      if (x - cam.position.x > 8) x -= 16; else if (x - cam.position.x < -8) x += 16;
      if (z - cam.position.z > 8) z -= 16; else if (z - cam.position.z < -8) z += 16;
      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
    }
    pa.needsUpdate = true;
  }

  // 視線方向で最初に当たる面（壁・背の高い物・床）までの距離
  viewDistance(f) {
    const p = this.player, ph = this.level.phys;
    const h = Math.hypot(f.x, f.z) || 1e-6;
    const floorD = f.y < -0.02 ? p.eyeH / -f.y : 99;
    const ceilD = f.y > 0.02 ? (3 - p.eyeH) / f.y : 99;
    let d = Math.min(floorD, ceilD, 12);
    const dx = f.x / h, dz = f.z / h;
    for (let s = 0.25; s * h < d; s += 0.25) {
      const x = p.x + dx * s, z = p.z + dz * s;
      if (!ph.inBounds(x, z, 0) || ph.heightAt(x, z) > 1.4) { d = Math.min(d, s / h); break; }
    }
    return d;
  }

  // ---------- インタラクション ----------
  findInteract() {
    const p = this.player, lv = this.level;
    if (p.hidden) return { kind: 'unhide', text: '[E] ロッカーから出る' };
    const d = (x, z) => Math.hypot(x - p.x, z - p.z);
    if (lv.exit && d(lv.exit.x, lv.exit.z) < 1.6) return { kind: 'exit', text: this.hasKey ? '[E] マスターキーで脱出口を開ける' : '脱出口：施錠されている（マスターキーが必要）' };
    if (lv.key && d(lv.key.x, lv.key.z) < 1.6) return { kind: 'key', text: '[E] マスターキーを取る' };
    for (const m of lv.memos) if (d(m.x, m.z) < 1.3) return { kind: 'memo', text: '[E] 落ちているメモを読む' };
    let bl = null, bd = 1e9;
    for (const l of lv.lockers) { const dd = d(l.exit.x, l.exit.z); if (dd < bd) { bd = dd; bl = l; } }
    if (bl && bd < 0.9 && p.facingDot(bl.x, bl.z) > 0.3) return { kind: 'hide', o: bl, text: '[E] ロッカーに隠れる' };
    let bp = null; bd = 1e9;
    for (const s of lv.pads) { const dd = d(s.x, s.z); if (dd < bd) { bd = dd; bp = s; } }
    if (bp && bd < 1.5) {
      const tf = this.floor + bp.dir, need = this.needCode(bp);
      return { kind: 'pad', o: bp, text: '[E] 階段を' + (bp.dir > 0 ? '上る' : '下りる') + '（' + tf + 'F）' + (need ? ' <span class="warn">暗証番号が必要</span>' : '') };
    }
    let bt = null; bd = 1e9;
    for (const t of lv.tablets) { const dd = d(t.x, t.z); if (dd < t.reach && dd < bd) { bd = dd; bt = t; } }
    if (bt) return { kind: 'tablet', o: bt, text: this.decoyCd > 0 ? 'タブレット充電中 ' + Math.ceil(this.decoyCd) + 's' : '[E] ' + bt.name + 'から呼び出し（囮）' };
    return null;
  }
  needCode(pad) {
    return pad.dir > 0 && this.codes[this.floor] && !this.floorState[this.floor].unlocked;
  }

  interact() {
    if (this.state !== 'play') return;
    const it = this.findInteract();
    if (!it) return;
    switch (it.kind) {
      case 'unhide': this.unhide(); break;
      case 'exit':
        if (this.hasKey) this.win();
        else { this.audio.locked(); this.ui.say('鍵がかかっている。マスターキーは5Fにある'); }
        break;
      case 'key': this.takeKey(); break;
      case 'memo': {
        const st = this.floorState[this.floor];
        if (!st.known) { st.known = true; this.audio.pickup(); }
        this.ui.showMemo(this.codes[this.floor], this.floor);
        break;
      }
      case 'hide': this.hide(it.o); break;
      case 'pad': if (this.needCode(it.o)) this.openCode(it.o); else this.changeFloor(it.o); break;
      case 'tablet': if (this.decoyCd <= 0) this.useDecoy(it.o); else this.audio.error(); break;
    }
  }

  hide(L) {
    const p = this.player;
    p.hidden = true; p.locker = L;
    p.x = L.x + L.fx * 0.12; p.z = L.z + L.fz * 0.12;
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

  takeKey() {
    const lv = this.level, st = this.floorState[this.floor];
    lv.key.mesh.visible = false; lv.key = null;
    this.hasKey = true; this.alarm = true;
    this.audio.pickup();
    setTimeout(() => { this.audio.pa(); this.audio.jingle(KEY_POS.x, KEY_POS.z - 2, true, 0.16); }, 400);
    this.ui.say('【警報】マスターキーが持ち出されました。全スタッフは確保に向かってください', 4.5);
    st.interval = 10; st.max += 3; st.alarm = true;
    for (const r of this.robots) {
      if (r.state === 'sleep') r.enter('search', { x: KEY_POS.x, z: KEY_POS.z + 1.5 });
      else r.setLook(r.state);
    }
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

  changeFloor(pad) {
    this.state = 'trans'; this.pauseAfterTrans = false;
    this.ui.veil(1, 450); this.ui.prompt('');
    this.audio.stairs();
    setTimeout(() => {
      this.loadFloor(this.floor + pad.dir, { si: pad.si, dir: pad.dir });
      this.ui.veil(0, 600);
      if (this.state !== 'trans') return;
      if (this.pauseAfterTrans || !this.isLocked()) this.pause(); else this.state = 'play';
    }, 650);
  }

  // ---------- 暗証番号 ----------
  openCode(pad) {
    this.state = 'code'; this.codePad = pad; this.codeInput = [];
    this.ui.openCode(this.floor + 'F → ' + (this.floor + 1) + 'F　暗証番号（テンキー / Enter / Esc）');
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
    if (this.codeInput.join('') !== this.codes[this.floor]) {
      this.audio.error(); this.codeInput = [];
      this.ui.codeDisplay(this.codeInput, '番号が違います');
      return;
    }
    this.floorState[this.floor].unlocked = true;
    this.audio.unlock(); this.ui.closeCode();
    this.state = 'play';
    if (gesture) this.requestLock();
    this.changeFloor(this.codePad);
  }
  codeCancel(gesture) {
    if (this.state !== 'code') return;
    this.ui.closeCode();
    this.state = 'play';
    if (gesture) this.requestLock(); else this.pause();
  }

  // ---------- 捕獲・終了 ----------
  caught(r) {
    if (this.state === 'dying' || this.state === 'over') return;
    if (this.state === 'code') this.ui.closeCode();
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
    const ty = Math.atan2(-dx, -dz), tp = Math.atan2(1.33 - p.eyeH, Math.max(0.3, d));
    p.yaw += angDiff(p.yaw, ty) * (1 - Math.exp(-9 * dt));
    p.pitch = damp(p.pitch, tp, 9, dt);
    this.fx.u.caught.value = clamp(this.dyingT / 1.2, 0, 1);
    this.fear = 1;
    if (this.dyingT > 1.7) this.gameOver();
  }
  gameOver() {
    this.state = 'over';
    document.exitPointerLock();
    this.ui.showHud(false);
    this.ui.overlay({
      title: 'ご利用ありがとうございました',
      body: '<p>またのお越しをお待ちしております〜♪</p>' + this.statsHtml(),
      buttons: [
        { label: '同じ建物で再挑戦', primary: true, onClick: () => this.start(this.seed) },
        { label: '新しい建物で挑戦', onClick: () => this.start(randomSeed()) },
      ],
      settings: true,
    });
    setTimeout(() => { if (this.state === 'over') this.fx.u.caught.value = 0; }, 300);
  }
  win() {
    this.state = 'win';
    const t = this.time;
    const isBest = this.best == null || t < this.best;
    if (isBest) { this.best = t; storage.set(STORAGE_KEYS.best, t); }
    this.audio.unlock();
    document.exitPointerLock();
    this.ui.showHud(false);
    this.ui.overlay({
      title: 'ビルから抜け出した…',
      body: '<p>しかし駐車場にも、小さな白い影が並んでいた</p>' + this.statsHtml() + (isBest ? '<p class="best">ベストタイム更新</p>' : ''),
      buttons: [
        { label: '同じ建物で再挑戦', primary: true, onClick: () => this.start(this.seed) },
        { label: '新しい建物で挑戦', onClick: () => this.start(randomSeed()) },
      ],
      settings: true,
    });
  }
  statsHtml() {
    return '<table class="stats"><tr><th>経過時間</th><td>' + fmtTime(this.time) + '</td></tr>' +
      '<tr><th>到達階</th><td>' + Math.max(...Object.keys(this.floorState).map(Number)) + 'F</td></tr>' +
      '<tr><th>発見された回数</th><td>' + this.spotted + '</td></tr>' +
      '<tr><th>ベスト</th><td>' + (this.best != null ? fmtTime(this.best) : '—') + '</td></tr>' +
      '<tr><th>建物番号</th><td>' + this.seed + '</td></tr></table>';
  }

  // ---------- 一時停止・ポインタロック ----------
  isLocked() { return document.pointerLockElement === this.renderer.domElement; }
  requestLock() {
    const el = this.renderer.domElement;
    try {
      const r = el.requestPointerLock();
      if (r && r.catch) r.catch(() => this.onLockError());
    } catch (e) { this.onLockError(); }
  }
  onLockError() {
    if (this.state === 'play') this.pause();
    else if (this.state === 'trans') this.pauseAfterTrans = true;
  }
  onLockChange() {
    const locked = this.isLocked();
    this.ui.crosshair(locked);
    for (const k in this.keys) this.keys[k] = false;
    if (locked) {
      if (this.state === 'pause' || this.state === 'title') this.resumePlay();
    } else if (this.state === 'play') this.pause();
    else if (this.state === 'trans') this.pauseAfterTrans = true;
  }
  resumePlay() {
    this.state = 'play';
    this.ui.hideOverlay(); this.ui.showHud(true);
    if (this.audio.ctx && this.audio.ctx.state === 'suspended') this.audio.ctx.resume();
  }
  pause() {
    this.state = 'pause';
    if (this.audio.ctx) this.audio.ctx.suspend();
    this.ui.overlay({
      title: '一時停止',
      body: '<p>' + FLOORS[this.floor].name + '　経過 ' + fmtTime(this.time) + '</p>',
      buttons: [
        { label: '再開', primary: true, onClick: () => { this.audio.init(); this.requestLock(); } },
        { label: '最初からやり直す', onClick: () => this.start(this.seed) },
      ],
      settings: true,
    });
  }
  start(seed) {
    this.audio.init();
    this.fx.u.caught.value = 0;
    this.newRun(seed);
    this.state = 'title';
    if (this.isLocked()) this.resumePlay(); else this.requestLock();
  }

  toggleFlash() {
    if (this.state !== 'play' || this.player.hidden) return;
    this.flashOn = !this.flashOn; this.audio.click();
  }
  toggleMap() {
    if (this.state !== 'play') return;
    this.mapOpen = !this.mapOpen;
    this.ui.e.map.classList.toggle('hide', !this.mapOpen);
  }

  updateHud() {
    const p = this.player, st = this.floorState[this.floor];
    const active = this.robots.filter((r) => r.state !== 'sleep').length;
    const it = this.state === 'play' ? this.findInteract() : null;
    this.ui.prompt(it ? it.text : '');
    let code = '';
    if (this.codes[this.floor]) code = st.unlocked ? '上り階段: 解除済み' : '上り階段コード: ' + (st.known ? '<b class="code">' + this.codes[this.floor] + '</b>' : '<span class="warn">未発見（床の黄色いメモ）</span>');
    this.ui.hud({
      floor: FLOORS[this.floor].name + '<small>' + fmtTime(this.time) + '</small>',
      obj: this.hasKey ? '目標: <b>1F の脱出口へ</b>' : '目標: <b>5F のマスターキーを取る</b>',
      code,
      sub: '稼働スタッフ ' + active + '　ライト ' + (this.flashOn ? 'ON' : '<span class="warn">OFF</span>') +
        '　タブレット ' + (this.decoyCd > 0 ? Math.ceil(this.decoyCd) + 's' : '可') +
        (p.crouch ? '　<span class="dim">しゃがみ</span>' : '') +
        (p.hidden ? '<br><span class="warn">隠れている…増援が3倍速で迫る</span>' : ''),
      stamina: p.stamina, exhausted: p.exhausted,
    });
  }
}

export function randomSeed() { return (Math.random() * 1e9) >>> 0; }
