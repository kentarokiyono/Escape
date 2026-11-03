// フロア生成。静的ジオメトリはマテリアル単位でマージして描画コールを減らす
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RX, RZ, WALL_H, FLOORS, ENTRY, EXIT_DOOR, KEY_POS, DOCK_XS, TOP_FLOOR } from './config.js';
import { mulberry32 } from './util.js';
import { Physics } from './physics.js';
import { Nav } from './nav.js';
import { graffitiTexture, memoTexture, signTexture } from './textures.js';

const GRAFFITI = ['逃ゲロ', '帰レ', 'マダ営業中', '(o ω o)', '鍵ハ上', '見テル', '番号忘レルナ', 'オ席ヘ', '静カニ'];

const _m = new THREE.Matrix4(), _lm = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);

// ローカル変換 → 小物の変換 の順にジオメトリへ焼き込む
function xform(geo, p, lx = 0, ly = 0, lz = 0, lrx = 0, lry = 0, lrz = 0) {
  _e.set(lrx, lry, lrz); _q.setFromEuler(_e); _v.set(lx, ly, lz); _lm.compose(_v, _q, _one);
  _e.set(p.rx || 0, p.ry || 0, p.rz || 0); _q.setFromEuler(_e); _v.set(p.x, p.y || 0, p.z); _m.compose(_v, _q, _one);
  _m.multiply(_lm);
  geo.applyMatrix4(_m);
  return geo;
}

// 法線の支配軸でワールド座標から UV を作る（テクセル密度を揃える）
function worldUV(geo, scale) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    let u, v;
    if (ny >= nx && ny >= nz) { u = p.getX(i); v = p.getZ(i); }
    else if (nx >= nz) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, u / scale, v / scale);
  }
  uv.needsUpdate = true;
  return geo;
}

class Batch {
  constructor() { this.m = new Map(); }
  add(mat, geo, cast) {
    const k = mat.uuid + (cast ? 'c' : 'n');
    let e = this.m.get(k);
    if (!e) { e = { mat, cast, geos: [] }; this.m.set(k, e); }
    e.geos.push(geo);
  }
  build(group) {
    for (const e of this.m.values()) {
      const g = mergeGeometries(e.geos, false);
      for (const x of e.geos) x.dispose();
      const mesh = new THREE.Mesh(g, e.mat);
      mesh.castShadow = e.cast; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      group.add(mesh);
    }
    this.m.clear();
  }
}

export class Level {
  constructor(n) {
    const cfg = FLOORS[n];
    this.n = n; this.cfg = cfg;
    this.cols = cfg.cols; this.rows = cfg.rows;
    this.roomW = (RX * 2) / cfg.cols; this.roomH = (RZ * 2) / cfg.rows;
    this.group = new THREE.Group();
    this.owned = [];
    this.phys = new Physics(); this.nav = null;
    this.doors = []; this.edges = []; this.walls = [];
    this.lockers = []; this.tablets = []; this.pads = []; this.stairs = []; this.memos = [];
    this.key = null; this.docks = []; this.exit = null;
    this.lightSpots = []; this.puddles = [];
    this.reserved = new Set();
    this.surface = cfg.theme === 'machine' ? 'concrete' : 'tile';
    this.valid = true;
  }
  get total() { return this.cols * this.rows; }
  cellOf(x, z) {
    const c = Math.max(0, Math.min(this.cols - 1, Math.floor((x + RX) / this.roomW)));
    const r = Math.max(0, Math.min(this.rows - 1, Math.floor((z + RZ) / this.roomH)));
    return r * this.cols + c;
  }
  cellCenter(i) {
    const c = i % this.cols, r = Math.floor(i / this.cols);
    return { x: -RX + this.roomW * (c + 0.5), z: -RZ + this.roomH * (r + 0.5) };
  }
  // 階段から出た位置と向き。dir>0 = 上ってきた
  arrival(si, dir) {
    const s = this.stairs[si];
    return dir > 0 ? { x: s.x, z: s.z + 3.5, yaw: Math.PI } : { x: s.x, z: s.z - 3.5, yaw: 0 };
  }
  mat(m) { this.owned.push(m); return m; }
  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.owned) { if (m.map) m.map.dispose(); m.dispose(); }
  }
}

// 階段セルは試行ごとに変えない（行き来で位置が一致するように）
function pickStairCells(lv, stairsWorld) {
  if (lv.n === 1) lv.reserved.add(lv.cellOf(ENTRY.x, ENTRY.z));
  if (lv.n === TOP_FLOOR) lv.reserved.add(lv.cellOf(KEY_POS.x, KEY_POS.z));
  const out = [];
  for (const w of stairsWorld) {
    let best = -1, bd = 1e9;
    for (let i = 0; i < lv.total; i++) {
      if (lv.reserved.has(i) || out.includes(i)) continue;
      const c = lv.cellCenter(i), d = Math.hypot(c.x - w.x, c.z - w.z);
      if (d < bd) { bd = d; best = i; }
    }
    out.push(best);
  }
  for (const c of out) lv.reserved.add(c);
  lv.stairCells = out;
  lv.stairs = out.map((c) => lv.cellCenter(c));
}

export function buildLevel(n, ctx) {
  let lv = null;
  for (let salt = 0; salt < 8; salt++) {
    lv = tryBuild(n, ctx, salt);
    if (lv.valid) return lv;
    if (salt < 7) lv.dispose();
  }
  console.warn('floor validation failed', n, lv.why);
  return lv;
}

function tryBuild(n, ctx, salt) {
  const M = ctx.M;
  const lv = new Level(n);
  const R = mulberry32((ctx.seed ^ Math.imul(n, 7919) ^ Math.imul(salt + 1, 104729)) >>> 0);
  const cfg = lv.cfg, { cols, rows, roomW, roomH } = lv;
  const batch = new Batch();
  const put = (mat, scale, geo, cast = true) => { if (scale) worldUV(geo, scale); batch.add(mat, geo, cast); };
  const P = (x, z, ry = 0, y = 0, rx = 0, rz = 0) => ({ x, z, ry, y, rx, rz });
  pickStairCells(lv, ctx.stairsWorld);

  // ---------- 床・天井・外壁 ----------
  const floorMat = cfg.theme === 'machine' ? M.concrete : M.floor;
  const fl = new THREE.Mesh(worldUV(xform(new THREE.PlaneGeometry(RX * 2, RZ * 2), P(0, 0), 0, 0, 0, -Math.PI / 2), cfg.theme === 'machine' ? 2 : M.floorScale), floorMat);
  fl.receiveShadow = true; lv.group.add(fl);
  const ce = new THREE.Mesh(worldUV(xform(new THREE.PlaneGeometry(RX * 2, RZ * 2), P(0, 0), 0, WALL_H, 0, Math.PI / 2), M.ceilingScale), M.ceiling);
  ce.receiveShadow = true; lv.group.add(ce);
  const wallBox = (x, z, w, d, h = WALL_H, y = h / 2) => put(M.wall, M.wallScale, xform(new THREE.BoxGeometry(w, h, d), P(x, z), 0, y, 0));
  wallBox(0, -RZ, RX * 2 + 0.2, 0.2); wallBox(0, RZ, RX * 2 + 0.2, 0.2);
  wallBox(-RX, 0, 0.2, RZ * 2); wallBox(RX, 0, 0.2, RZ * 2);
  lv.walls.push({ x: 0, z: -RZ, horiz: true, len: RX * 2, side: 1 }, { x: 0, z: RZ, horiz: true, len: RX * 2, side: -1 },
    { x: -RX, z: 0, horiz: false, len: RZ * 2, side: 1 }, { x: RX, z: 0, horiz: false, len: RZ * 2, side: -1 });

  // ---------- 部屋の接続 ----------
  const edges = [];
  for (let r = 0; r < rows; r++) for (let c = 1; c < cols; c++) edges.push({ a: r * cols + c - 1, b: r * cols + c, vert: true, c, r, on: !cfg.maze });
  for (let r = 1; r < rows; r++) for (let c = 0; c < cols; c++) edges.push({ a: (r - 1) * cols + c, b: r * cols + c, vert: false, c, r, on: !cfg.maze });
  if (cfg.maze) {
    const seen = new Uint8Array(lv.total), stack = [lv.stairCells[0]];
    seen[stack[0]] = 1;
    const adj = (i) => edges.filter((e) => e.a === i || e.b === i);
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const opts = adj(cur).filter((e) => !seen[e.a === cur ? e.b : e.a]);
      if (!opts.length) { stack.pop(); continue; }
      const e = opts[Math.floor(R() * opts.length)];
      e.on = true;
      const nx = e.a === cur ? e.b : e.a;
      seen[nx] = 1; stack.push(nx);
    }
    for (const e of edges) if (!e.on && R() < 0.14) e.on = true;
  }
  const lintel = (x, z, w, d, y0) => put(M.wall, M.wallScale, xform(new THREE.BoxGeometry(w, WALL_H - y0, d), P(x, z), 0, (WALL_H + y0) / 2, 0));
  for (const e of edges) {
    const open = e.on && R() < cfg.open;
    if (e.vert) {
      const wx = -RX + e.c * roomW, z0 = -RZ + e.r * roomH, z1 = z0 + roomH;
      if (open) { lv.doors.push({ a: e.a, b: e.b, x: wx, z: (z0 + z1) / 2, w: roomH, vert: true }); continue; }
      const seg = (s0, s1) => {
        if (s1 - s0 < 0.1) return;
        wallBox(wx, (s0 + s1) / 2, 0.2, s1 - s0);
        lv.phys.addBox(wx, (s0 + s1) / 2, 0.1, (s1 - s0) / 2, WALL_H);
        lv.walls.push({ x: wx, z: (s0 + s1) / 2, horiz: false, len: s1 - s0, side: 0 });
      };
      if (!e.on) { seg(z0, z1); continue; }
      const gw = Math.min(cfg.door, roomH - 3), gz = z0 + 1.5 + gw / 2 + R() * (roomH - 3 - gw);
      seg(z0, gz - gw / 2); seg(gz + gw / 2, z1);
      lintel(wx, gz, 0.2, gw, gw > 2.6 ? 2.6 : 2.25);
      lv.doors.push({ a: e.a, b: e.b, x: wx, z: gz, w: gw, vert: true });
    } else {
      const wz = -RZ + e.r * roomH, x0 = -RX + e.c * roomW, x1 = x0 + roomW;
      if (open) { lv.doors.push({ a: e.a, b: e.b, x: (x0 + x1) / 2, z: wz, w: roomW, vert: false }); continue; }
      const seg = (s0, s1) => {
        if (s1 - s0 < 0.1) return;
        wallBox((s0 + s1) / 2, wz, s1 - s0, 0.2);
        lv.phys.addBox((s0 + s1) / 2, wz, (s1 - s0) / 2, 0.1, WALL_H);
        lv.walls.push({ x: (s0 + s1) / 2, z: wz, horiz: true, len: s1 - s0, side: 0 });
      };
      if (!e.on) { seg(x0, x1); continue; }
      const gw = Math.min(cfg.door, roomW - 3), gx = x0 + 1.5 + gw / 2 + R() * (roomW - 3 - gw);
      seg(x0, gx - gw / 2); seg(gx + gw / 2, x1);
      lintel(gx, wz, gw, 0.2, gw > 2.6 ? 2.6 : 2.25);
      lv.doors.push({ a: e.a, b: e.b, x: gx, z: wz, w: gw, vert: false });
    }
  }
  lv.edges = edges;

  // 扉前の立入禁止判定
  const doorsOf = Array.from({ length: lv.total }, () => []);
  for (const d of lv.doors) { doorsOf[d.a].push(d); doorsOf[d.b].push(d); }
  // 扉の開口（線分）と AABB の距離が th 未満なら扉前とみなす
  const nearDoor = (cell, x, z, hw, hd, th = 1.3) => {
    for (const d of doorsOf[cell]) {
      const ex = d.vert ? 0 : d.w / 2, ez = d.vert ? d.w / 2 : 0;
      const dx = Math.max(Math.abs(d.x - x) - hw - ex, 0), dz = Math.max(Math.abs(d.z - z) - hd - ez, 0);
      if (Math.hypot(dx, dz) < th) return true;
    }
    return false;
  };
  const tryPlace = (cell, hw, hd, margin = 0.55, attempts = 14) => {
    const cc = lv.cellCenter(cell);
    const ax = roomW / 2 - hw - 0.7, az = roomH / 2 - hd - 0.7;
    if (ax < 0 || az < 0) return null;
    for (let a = 0; a < attempts; a++) {
      const x = cc.x + (R() * 2 - 1) * ax, z = cc.z + (R() * 2 - 1) * az;
      if (nearDoor(cell, x, z, hw, hd)) continue;
      if (!lv.phys.boxFree(x, z, hw + margin, hd + margin)) continue;
      return { x, z };
    }
    return null;
  };

  // ---------- ロッカー ----------
  const cells = [];
  for (let i = 0; i < lv.total; i++) if (!lv.reserved.has(i)) cells.push(i);
  const shuffled = cells.slice().sort(() => R() - 0.5);
  const lockerTarget = Math.max(5, Math.ceil(cells.length * 0.22));
  const addLocker = (x, z, fx, fz) => {
    const ry = Math.atan2(fx, fz), p = P(x, z, ry);
    put(M.metal, M.metalScale, xform(new THREE.BoxGeometry(0.8, 2.2, 0.8), p, 0, 1.1, 0));
    put(M.lockerDoor, 0, xform(new THREE.PlaneGeometry(0.74, 2.1), p, 0, 1.1, 0.402));
    lv.phys.addBox(x, z, 0.4, 0.4, 2.2);
    lv.lockers.push({ x, z, fx, fz, ry, exit: { x: x + fx * 0.95, z: z + fz * 0.95 } });
  };
  for (const cell of shuffled) {
    if (lv.lockers.length >= lockerTarget) break;
    const cc = lv.cellCenter(cell);
    const sx = R() < 0.5 ? -1 : 1, sz = R() < 0.5 ? -1 : 1;
    const ex = cc.x + sx * roomW / 2, ez = cc.z + sz * roomH / 2;
    const alongX = R() < 0.5; // true: x方向の壁に背を向ける
    const count = R() < 0.4 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      let x, z, fx, fz;
      if (alongX) { x = ex - sx * 0.53; z = ez - sz * (0.95 + k * 0.82); fx = -sx; fz = 0; }
      else { z = ez - sz * 0.53; x = ex - sx * (0.95 + k * 0.82); fx = 0; fz = -sz; }
      if (nearDoor(cell, x, z, 0.4, 0.4, 0.5) || nearDoor(cell, x + fx * 0.9, z + fz * 0.9, 0.3, 0.3, 0.3)) break;
      if (!lv.phys.boxFree(x, z, 0.39, 0.39)) break;
      if (!lv.phys.boxFree(x + fx * 0.9, z + fz * 0.9, 0.35, 0.35)) break;
      addLocker(x, z, fx, fz);
    }
  }

  // ---------- 小物 ----------
  let tno = 1;
  const addTablet = (x, z, y, p, lx, lz, reach, name) => {
    put(M.dark, 0, xform(new THREE.BoxGeometry(0.26, 0.02, 0.18), p, lx, y + 0.01, lz), false);
    put(M.screen, 0, xform(new THREE.PlaneGeometry(0.22, 0.14), p, lx, y + 0.022, lz, -Math.PI / 2), false);
    lv.tablets.push({ x, z, reach, name: name + (tno++) });
  };
  const tableRect = (cell) => {
    const w = 1.3 + R() * 0.5, d = 0.9 + R() * 0.3, rot = R() < 0.5;
    const hw = rot ? d / 2 : w / 2, hd = rot ? w / 2 : d / 2;
    const q = tryPlace(cell, hw, hd); if (!q) return;
    const fallen = R() < 0.22;
    const p = P(q.x, q.z, rot ? Math.PI / 2 : 0, fallen ? -0.1 : 0, 0, fallen ? 0.4 : 0);
    put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(w, 0.05, d), p, 0, 0.75, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(M.dark, 0, xform(new THREE.BoxGeometry(0.05, 0.72, 0.05), p, sx * (w / 2 - 0.08), 0.36, sz * (d / 2 - 0.08)));
    lv.phys.addBox(q.x, q.z, hw, hd, 0.78);
    if (!fallen) addTablet(q.x, q.z, 0.775, p, w / 2 - 0.3, 0, Math.max(hw, hd) + 1.0, 'テーブル');
  };
  const tableRound = (cell) => {
    const q = tryPlace(cell, 0.8, 0.8); if (!q) return;
    const p = P(q.x, q.z, R() * 3);
    put(M.wood, M.woodScale, xform(new THREE.CylinderGeometry(0.8, 0.8, 0.05, 28), p, 0, 0.75, 0));
    put(M.dark, 0, xform(new THREE.CylinderGeometry(0.06, 0.06, 0.72, 10), p, 0, 0.37, 0));
    put(M.dark, 0, xform(new THREE.CylinderGeometry(0.38, 0.4, 0.04, 20), p, 0, 0.02, 0));
    lv.phys.addCircle(q.x, q.z, 0.8, 0.78);
    addTablet(q.x, q.z, 0.775, p, 0.35, 0, 1.75, 'テーブル');
  };
  const booth = (cell) => {
    const rot = R() < 0.5, hw = rot ? 0.85 : 1.45, hd = rot ? 1.45 : 0.85;
    const q = tryPlace(cell, hw, hd); if (!q) return;
    const p = P(q.x, q.z, rot ? Math.PI / 2 : 0);
    for (const s of [-1, 1]) {
      put(M.vinyl, M.vinylScale, xform(new THREE.BoxGeometry(0.55, 0.45, 1.7), p, s * 1.1, 0.225, 0));
      put(M.vinyl, M.vinylScale, xform(new THREE.BoxGeometry(0.15, 0.7, 1.7), p, s * 1.33, 0.8, 0, 0, 0, s * 0.08));
    }
    put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(1.25, 0.05, 1.45), p, 0, 0.75, 0));
    put(M.dark, 0, xform(new THREE.BoxGeometry(0.12, 0.72, 0.12), p, 0, 0.36, 0));
    const sx = rot ? 0 : 1.1, sz = rot ? 1.1 : 0;
    lv.phys.addBox(q.x - sx, q.z - sz, rot ? 0.85 : 0.35, rot ? 0.35 : 0.85, 1.15);
    lv.phys.addBox(q.x + sx, q.z + sz, rot ? 0.85 : 0.35, rot ? 0.35 : 0.85, 1.15);
    lv.phys.addBox(q.x, q.z, rot ? 0.73 : 0.63, rot ? 0.63 : 0.73, 0.78);
    addTablet(q.x, q.z, 0.775, p, 0, 0.45, 1.9, 'テーブル');
  };
  const chair = (x, z, ry, down) => {
    const p = P(x, z, ry, down ? 0.21 : 0, down ? Math.PI / 2 : 0);
    put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(0.42, 0.05, 0.42), p, 0, 0.45, 0));
    put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(0.42, 0.5, 0.04), p, 0, 0.72, -0.2));
    for (const a of [-1, 1]) for (const b of [-1, 1]) put(M.dark, 0, xform(new THREE.BoxGeometry(0.035, 0.45, 0.035), p, a * 0.18, 0.225, b * 0.18));
  };
  const longTable = (cell) => {
    const w = 2.6 + R() * 1.2, d = 0.9, rot = R() < 0.5;
    const hw = rot ? d / 2 + 0.55 : w / 2, hd = rot ? w / 2 : d / 2 + 0.55;
    const q = tryPlace(cell, hw, hd); if (!q) return;
    const p = P(q.x, q.z, rot ? Math.PI / 2 : 0);
    put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(w, 0.05, d), p, 0, 0.75, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(M.dark, 0, xform(new THREE.BoxGeometry(0.06, 0.72, 0.06), p, sx * (w / 2 - 0.1), 0.36, sz * (d / 2 - 0.1)));
    lv.phys.addBox(q.x, q.z, rot ? d / 2 : w / 2, rot ? w / 2 : d / 2, 0.78);
    const nC = Math.floor(w / 0.7);
    for (let i = 0; i < nC; i++) for (const s of [-1, 1]) {
      if (R() < 0.3) continue;
      const lx = -w / 2 + 0.45 + i * ((w - 0.9) / Math.max(1, nC - 1)), lz = s * (d / 2 + 0.32);
      const cx = q.x + (rot ? lz : lx), cz = q.z + (rot ? -lx : lz);
      const down = R() < 0.2;
      chair(cx, cz, (rot ? Math.PI / 2 : 0) + (s > 0 ? Math.PI : 0) + (R() - 0.5) * 0.4, down);
      lv.phys.addBox(cx, cz, 0.22, 0.22, 0.95);
    }
    addTablet(q.x, q.z, 0.775, p, 0, 0, Math.max(hw, hd) + 0.8, 'テーブル');
  };
  const debris = (cell, tall) => {
    const q = tryPlace(cell, 0.8, 0.8); if (!q) return;
    let h = 0;
    const k = 2 + Math.floor(R() * (tall ? 4 : 2));
    for (let i = 0; i < k; i++) {
      const s = 0.5 + R() * 0.5, y = i < 2 ? s / 2 : h + s / 2 - 0.05;
      put(i % 2 ? M.wood : M.concrete, i % 2 ? M.woodScale : M.concreteScale,
        xform(new THREE.BoxGeometry(s, s, s * (0.8 + R() * 0.4)), P(q.x + (R() - 0.5) * 0.6, q.z + (R() - 0.5) * 0.6, R() * 3), 0, y, 0, 0, 0, (R() - 0.5) * 0.2));
      h = Math.max(h, y + s / 2);
    }
    lv.phys.addBox(q.x, q.z, 0.75, 0.75, h);
  };
  const counter = (cell) => {
    const w = 2.4 + R() * 1.4, d = 0.8, rot = R() < 0.5;
    const hw = rot ? d / 2 : w / 2, hd = rot ? w / 2 : d / 2;
    const q = tryPlace(cell, hw, hd); if (!q) return;
    const p = P(q.x, q.z, rot ? Math.PI / 2 : 0);
    put(M.steel, M.steelScale, xform(new THREE.BoxGeometry(w, 0.86, d), p, 0, 0.43, 0));
    put(M.steel, M.steelScale, xform(new THREE.BoxGeometry(w + 0.04, 0.04, d + 0.04), p, 0, 0.88, 0));
    if (R() < 0.5) put(M.dark, 0, xform(new THREE.BoxGeometry(0.5, 0.12, 0.4), p, -w / 4, 0.96, 0));
    lv.phys.addBox(q.x, q.z, hw, hd, 0.9);
    if (R() < 0.5) addTablet(q.x, q.z, 0.9, p, w / 2 - 0.35, 0, Math.max(hw, hd) + 0.9, '厨房端末');
  };
  const shelf = (cell) => {
    const w = 1.6, d = 0.5, rot = R() < 0.5;
    const hw = rot ? d / 2 : w / 2, hd = rot ? w / 2 : d / 2;
    const q = tryPlace(cell, hw, hd); if (!q) return;
    const p = P(q.x, q.z, rot ? Math.PI / 2 : 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(M.steel, 0, xform(new THREE.BoxGeometry(0.04, 1.8, 0.04), p, sx * (w / 2 - 0.02), 0.9, sz * (d / 2 - 0.02)));
    for (let i = 0; i < 4; i++) {
      put(M.steel, M.steelScale, xform(new THREE.BoxGeometry(w, 0.03, d), p, 0, 0.15 + i * 0.52, 0));
      for (let k = 0; k < 3; k++) if (R() < 0.6) {
        const s = 0.15 + R() * 0.2;
        put(R() < 0.5 ? M.metal : M.concrete, 0, xform(new THREE.BoxGeometry(s, s, s), p, -w / 2 + 0.3 + k * 0.5, 0.17 + i * 0.52 + s / 2, 0), false);
      }
    }
    lv.phys.addBox(q.x, q.z, hw, hd, 1.8);
  };
  const cabinet = (cell) => {
    const rot = R() < 0.5, w = 1.2, d = 0.8, hw = rot ? d / 2 : w / 2, hd = rot ? w / 2 : d / 2;
    const q = tryPlace(cell, hw, hd, 0.7); if (!q) return;
    const p = P(q.x, q.z, rot ? Math.PI / 2 : 0);
    put(M.metal, M.metalScale, xform(new THREE.BoxGeometry(w, 2.0, d), p, 0, 1.0, 0));
    for (let i = 0; i < 6; i++) {
      const led = R() < 0.25 ? M.ledRed : M.ledGreen;
      for (const s of [-1, 1]) put(led, 0, xform(new THREE.BoxGeometry(0.03, 0.03, 0.01), p, -0.4 + (i % 3) * 0.08, 1.6 - Math.floor(i / 3) * 0.08, s * (d / 2 + 0.006)), false);
    }
    lv.phys.addBox(q.x, q.z, hw, hd, 2.0);
    if (R() < 0.35) lv.tablets.push({ x: q.x, z: q.z, reach: Math.max(hw, hd) + 0.9, name: '制御端末' + (tno++) });
  };
  const pipeV = (cell) => {
    const q = tryPlace(cell, 0.2, 0.2, 0.4); if (!q) return;
    put(M.metal, M.metalScale, xform(new THREE.CylinderGeometry(0.16, 0.16, WALL_H, 14), P(q.x, q.z), 0, WALL_H / 2, 0));
    lv.phys.addCircle(q.x, q.z, 0.16, WALL_H);
  };
  const smallDebris = (cell) => {
    const cc = lv.cellCenter(cell), k = 2 + Math.floor(R() * 5);
    for (let i = 0; i < k; i++) {
      const x = cc.x + (R() * 2 - 1) * (roomW / 2 - 0.8), z = cc.z + (R() * 2 - 1) * (roomH / 2 - 0.8);
      if (R() < 0.45) {
        put(M.paper, 0, xform(new THREE.PlaneGeometry(0.21, 0.3), P(x, z, R() * 6), 0, 0.004, 0, -Math.PI / 2), false);
      } else {
        const s = 0.08 + R() * 0.25;
        put(R() < 0.5 ? M.concrete : M.wood, 0, xform(new THREE.BoxGeometry(s, s * 0.6, s * 1.3), P(x, z, R() * 6), 0, s * 0.3, 0), false);
      }
    }
  };

  for (const cell of cells) {
    const r = R();
    switch (cfg.theme) {
      case 'hall':
        if (r < 0.5) { tableRect(cell); if (R() < 0.6) tableRect(cell); if (R() < 0.5) tableRound(cell); if (R() < 0.3) tableRound(cell); }
        else if (r < 0.7) { booth(cell); if (R() < 0.4) booth(cell); }
        else if (r < 0.82) debris(cell, false);
        break;
      case 'private':
        if (r < 0.62) booth(cell); else if (r < 0.76) tableRect(cell); else if (r < 0.88) debris(cell, false);
        break;
      case 'banquet':
        if (r < 0.5) longTable(cell); else if (r < 0.72) debris(cell, true); else if (r < 0.82) tableRound(cell);
        break;
      case 'kitchen':
        if (r < 0.6) counter(cell);
        if (R() < 0.5) counter(cell);
        if (R() < 0.5) shelf(cell);
        if (R() < 0.2) debris(cell, false);
        break;
      case 'machine': {
        const k = 3 + Math.floor(R() * 4);
        for (let i = 0; i < k; i++) cabinet(cell);
        if (R() < 0.6) pipeV(cell);
        if (R() < 0.4) debris(cell, true);
        break;
      }
    }
    smallDebris(cell);
  }

  // ---------- 水たまり ----------
  const nP = 8 + Math.floor(R() * 6);
  for (let i = 0; i < nP; i++) {
    const x = -RX + 2 + R() * (RX * 2 - 4), z = -RZ + 2 + R() * (RZ * 2 - 4), r = 0.6 + R() * 1.4, sx = 0.6 + R() * 0.8;
    const g = new THREE.CircleGeometry(r, 24);
    g.scale(sx, 1, 1);
    put(M.puddle, 0, xform(g, P(x, z, R() * 3), 0, 0.006, 0, -Math.PI / 2), false);
    lv.puddles.push({ x, z, r: r * Math.max(sx, 1) });
  }

  // ---------- 天井設備 ----------
  const fixtures = [];
  for (let i = 0; i < lv.total; i++) {
    const cc = lv.cellCenter(i), k = Math.max(1, Math.round((roomW * roomH) / 70));
    for (let j = 0; j < k; j++) {
      const x = cc.x + (R() * 2 - 1) * (roomW / 2 - 1.2), z = cc.z + (R() * 2 - 1) * (roomH / 2 - 1.2);
      const hang = R() < 0.15;
      const p = P(x, z, R() < 0.5 ? 0 : Math.PI / 2, hang ? -0.35 : 0, 0, hang ? 0.35 : 0);
      put(M.metal, 0, xform(new THREE.BoxGeometry(1.25, 0.07, 0.3), p, 0, WALL_H - 0.04, 0), true);
      fixtures.push({ x, z, p, i });
    }
  }
  const live = fixtures.filter((f) => !lv.reserved.has(f.i)).sort(() => R() - 0.5).slice(0, Math.max(4, Math.round(fixtures.length * 0.3)));
  for (const f of fixtures) {
    const on = live.includes(f);
    const mat = on ? lv.mat(M.tubeOn.clone()) : M.tubeOff;
    for (const s of [-1, 1]) {
      const g = xform(new THREE.CylinderGeometry(0.016, 0.016, 1.15, 8), f.p, 0, WALL_H - 0.1, s * 0.07, 0, 0, Math.PI / 2);
      if (on) { const m = new THREE.Mesh(g, mat); lv.group.add(m); } else put(mat, 0, g, false);
    }
    if (on) lv.lightSpots.push({ x: f.x, y: WALL_H - 0.25 + (f.p.y || 0), z: f.z, mat });
  }
  for (let z = -RZ + 10; z < RZ; z += 20) put(M.metal, 0, xform(new THREE.CylinderGeometry(0.06, 0.06, RX * 2, 10), P(0, z), 0, WALL_H - 0.18, 0, 0, 0, Math.PI / 2));
  for (let x = -RX + 6; x < RX; x += 26) put(M.metal, 0, xform(new THREE.CylinderGeometry(0.09, 0.09, RZ * 2, 10), P(x, 0), 0, WALL_H - 0.3, 0, Math.PI / 2));

  // ---------- 落書き ----------
  const gN = 3 + Math.floor(R() * 4);
  for (let i = 0; i < gN; i++) {
    const w = lv.walls[Math.floor(R() * lv.walls.length)];
    if (w.len < 4) continue;
    const t = (R() - 0.5) * (w.len - 4);
    const side = w.side || (R() < 0.5 ? 1 : -1);
    const mat = lv.mat(new THREE.MeshStandardMaterial({ map: graffitiTexture(GRAFFITI[Math.floor(R() * GRAFFITI.length)], R), transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const g = new THREE.PlaneGeometry(3.2, 1.6);
    const mesh = new THREE.Mesh(g, mat);
    if (w.horiz) { mesh.position.set(w.x + t, 1.7, w.z + side * 0.112); mesh.rotation.y = side > 0 ? 0 : Math.PI; }
    else { mesh.position.set(w.x + side * 0.112, 1.7, w.z + t); mesh.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2; }
    lv.group.add(mesh);
  }

  // ---------- 階段 ----------
  const signMat = (txt, bg, fg) => lv.mat(new THREE.MeshBasicMaterial({ map: signTexture(txt, bg, fg), color: new THREE.Color(1.6, 1.6, 1.6) }));
  lv.stairs.forEach((s, si) => {
    put(M.concrete, M.concreteScale, xform(new THREE.BoxGeometry(3.2, WALL_H, 3.2), P(s.x, s.z), 0, WALL_H / 2, 0));
    lv.phys.addBox(s.x, s.z, 1.6, 1.6, WALL_H);
    const face = (dir) => {
      const sz = dir > 0 ? -1 : 1; // 上り口は北(-z)
      const ry = sz < 0 ? Math.PI : 0;
      put(M.metal, 0, xform(new THREE.PlaneGeometry(1.2, 2.1), P(s.x, s.z + sz * 1.605, ry), 0, 1.05, 0));
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), dir > 0 ? signMat('↑ ' + (n + 1) + 'F', '#06200f', '#5dff8a') : signMat('↓ ' + (n - 1) + 'F', '#241004', '#ffae5d'));
      sign.position.set(s.x, 2.4, s.z + sz * 1.61); sign.rotation.y = ry; lv.group.add(sign);
      put(dir > 0 ? M.padUp : M.padDown, 0, xform(new THREE.PlaneGeometry(1.4, 0.9), P(s.x, s.z + sz * 2.3), 0, 0.008, 0, -Math.PI / 2), false);
      lv.pads.push({ x: s.x, z: s.z + sz * 2.3, dir, si });
    };
    if (n < TOP_FLOOR) face(1);
    if (n > 1) face(-1);
  });

  // ---------- 1F 脱出口 ----------
  if (n === 1) {
    const ex = EXIT_DOOR.x, ez = RZ - 0.1;
    put(M.steel, 0, xform(new THREE.BoxGeometry(1.7, 2.3, 0.06), P(ex, ez - 0.03), 0, 1.15, 0));
    put(M.dark, 0, xform(new THREE.BoxGeometry(1.9, 0.1, 0.12), P(ex, ez - 0.06), 0, 2.35, 0));
    put(M.dark, 0, xform(new THREE.BoxGeometry(0.5, 0.05, 0.08), P(ex + 0.5, ez - 0.1), 0, 1.05, 0));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), signMat('非常口', '#0a6a2a', '#ffffff'));
    sign.position.set(ex, 2.6, ez - 0.02); sign.rotation.y = Math.PI; lv.group.add(sign);
    const ledMat = lv.mat((ctx.hasKey ? M.ledGreen : M.ledRed).clone());
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.03), ledMat);
    led.position.set(ex + 0.5, 1.3, ez - 0.08); lv.group.add(led);
    lv.exit = { x: ex, z: RZ - 1.0, ledMat };
  }

  // ---------- 5F マスターキー / 充電ドック ----------
  if (n === TOP_FLOOR) {
    put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(1.4, 0.05, 0.7), P(KEY_POS.x, KEY_POS.z), 0, 0.76, 0));
    put(M.metal, M.metalScale, xform(new THREE.BoxGeometry(1.3, 0.72, 0.6), P(KEY_POS.x, KEY_POS.z), 0, 0.37, 0));
    lv.phys.addBox(KEY_POS.x, KEY_POS.z, 0.7, 0.35, 0.8);
    if (!ctx.hasKey) {
      const key = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 8, 20), M.gold);
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.012), M.gold); shaft.position.x = 0.08;
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.012), M.gold); tooth.position.set(0.12, -0.02, 0);
      key.add(ring, shaft, tooth);
      key.position.set(KEY_POS.x, 0.92, KEY_POS.z);
      lv.group.add(key);
      lv.key = { mesh: key, x: KEY_POS.x, z: KEY_POS.z };
    }
    for (const dx of DOCK_XS) {
      const x = dx, z = -RZ + 2.2;
      if (lv.stairCells.includes(lv.cellOf(x, z))) continue;
      if (Math.abs(x - KEY_POS.x) < 3) continue;
      put(M.dark, 0, xform(new THREE.BoxGeometry(1, 0.06, 1), P(x, z), 0, 0.03, 0));
      put(M.ledBlue, 0, xform(new THREE.BoxGeometry(0.9, 0.012, 0.03), P(x, z), 0, 0.065, 0.48), false);
      lv.docks.push({ x, z: z + 0.2 });
    }
  }

  // ---------- 確定・検証 ----------
  lv.phys.finalize();
  lv.nav = new Nav(lv.phys);
  const main = lv.pads[0];
  const reach = lv.nav.fieldAt(main.x, main.z);
  lv.reach = reach;
  const need = lv.pads.map((p) => ({ x: p.x, z: p.z }));
  if (n === 1) need.push(ENTRY, { x: lv.exit.x, z: lv.exit.z });
  if (n === TOP_FLOOR) need.push({ x: KEY_POS.x, z: KEY_POS.z + 1.2 });
  lv.stairs.forEach((_, si) => { if (n < TOP_FLOOR) need.push(lv.arrival(si, -1)); if (n > 1) need.push(lv.arrival(si, 1)); });
  const ok = (pt) => !lv.phys.collide(pt.x, pt.z, 0.3) && lv.nav.reachable(reach, pt.x, pt.z);
  for (const pt of need) if (!ok(pt)) { lv.valid = false; lv.why = 'unreachable ' + pt.x.toFixed(1) + ',' + pt.z.toFixed(1); break; }
  lv.lockers = lv.lockers.filter((l) => ok(l.exit));
  lv.tablets = lv.tablets.filter((t) => lv.nav.reachable(reach, t.x, t.z));
  if (lv.lockers.length < 3) { lv.valid = false; lv.why = 'lockers ' + lv.lockers.length; }

  // ---------- メモ ----------
  if (n >= 2 && n < TOP_FLOOR && ctx.codes[n]) {
    const code = ctx.codes[n];
    const spots = [];
    for (let tries = 0; tries < 400 && spots.length < 2; tries++) {
      const cell = cells[Math.floor(R() * cells.length)];
      if (spots.length) {
        const a = spots[0].cell;
        const md = Math.abs((a % cols) - (cell % cols)) + Math.abs(Math.floor(a / cols) - Math.floor(cell / cols));
        if (md < Math.max(3, Math.floor(rows / 3))) continue;
      }
      const cc = lv.cellCenter(cell);
      const x = cc.x + (R() * 2 - 1) * (roomW / 2 - 1.2), z = cc.z + (R() * 2 - 1) * (roomH / 2 - 1.2);
      if (lv.phys.collide(x, z, 0.5) || !lv.nav.reachable(reach, x, z)) continue;
      spots.push({ cell, x, z });
    }
    if (spots.length < 2) { lv.valid = false; lv.why = 'memo'; }
    const tx = memoTexture(code, n);
    const mat = lv.mat(new THREE.MeshStandardMaterial({ map: tx, emissiveMap: tx, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3 }));
    for (const s of spots) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), mat);
      m.rotation.set(-Math.PI / 2, 0, R() * 6); m.position.set(s.x, 0.01, s.z); m.receiveShadow = true;
      lv.group.add(m);
      lv.memos.push({ x: s.x, z: s.z });
    }
    lv.owned.push(tx);
  }

  batch.build(lv.group);
  return lv;
}
