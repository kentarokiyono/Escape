// フロアのデータ構造と、フリー/ストーリー共通のビルダー
// 静的ジオメトリはマテリアル単位でマージして描画コールを減らす
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Physics } from './physics.js';
import { Nav } from './nav.js';
import { graffitiTexture, memoTexture, signTexture } from './textures.js';

const _m = new THREE.Matrix4(), _lm = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);

// ローカル変換 → 配置変換 の順にジオメトリへ焼き込む
export function xform(geo, p, lx = 0, ly = 0, lz = 0, lrx = 0, lry = 0, lrz = 0) {
  _e.set(lrx, lry, lrz); _q.setFromEuler(_e); _v.set(lx, ly, lz); _lm.compose(_v, _q, _one);
  _e.set(p.rx || 0, p.ry || 0, p.rz || 0); _q.setFromEuler(_e); _v.set(p.x, p.y || 0, p.z); _m.compose(_v, _q, _one);
  _m.multiply(_lm);
  geo.applyMatrix4(_m);
  return geo;
}
export const P = (x, z, ry = 0, y = 0, rx = 0, rz = 0) => ({ x, z, ry, y, rx, rz });

// 法線の支配軸でワールド座標から UV を作る（テクセル密度を揃える）
export function worldUV(geo, scale) {
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

// 凸多面体を四角形の面リストから作る（外向き法線は中心から判定）
function quadsGeometry(quads, center) {
  const pos = [], nor = [], uv = [], idx = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), mid = new THREE.Vector3();
  for (let q of quads) {
    a.fromArray(q[0]); b.fromArray(q[1]); c.fromArray(q[2]);
    n.subVectors(b, a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-10) { c.fromArray(q[3]); n.subVectors(b, a).cross(c.clone().sub(a)); if (n.lengthSq() < 1e-10) continue; }
    n.normalize();
    mid.set(0, 0, 0); for (const v of q) mid.add(a.fromArray(v)); mid.multiplyScalar(1 / q.length);
    if (n.dot(mid.sub(center)) < 0) { q = q.slice().reverse(); n.negate(); }
    const base = pos.length / 3;
    for (const v of q) { pos.push(...v); nor.push(n.x, n.y, n.z); uv.push(0, 0); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// 外形から穴の矩形を除いた矩形群
export function subtractRects(o, holes) {
  const xs = new Set([o.x0, o.x1]), zs = new Set([o.z0, o.z1]);
  for (const h of holes) {
    for (const x of [h.x0, h.x1]) if (x > o.x0 && x < o.x1) xs.add(x);
    for (const z of [h.z0, h.z1]) if (z > o.z0 && z < o.z1) zs.add(z);
  }
  const X = [...xs].sort((p, q) => p - q), Z = [...zs].sort((p, q) => p - q), out = [];
  for (let j = 0; j < Z.length - 1; j++) {
    let start = null;
    for (let i = 0; i < X.length; i++) {
      const inHole = i < X.length - 1 && holes.some((h) => {
        const cx = (X[i] + X[i + 1]) / 2, cz = (Z[j] + Z[j + 1]) / 2;
        return cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1;
      });
      if (i < X.length - 1 && !inHole) { if (start === null) start = X[i]; }
      else if (start !== null) { out.push({ x0: start, x1: X[i], z0: Z[j], z1: Z[j + 1] }); start = null; }
    }
  }
  return out;
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
  constructor({ hx, hz, wallH = 3, name = '', theme = 'hall', surface = 'tile', gridOff = 0 }) {
    Object.assign(this, { hx, hz, wallH, name, theme, surface });
    this.group = new THREE.Group();
    this.owned = [];
    this.phys = new Physics(hx, hz, gridOff); this.nav = null;
    this.lockers = []; this.tablets = []; this.pads = []; this.interacts = []; this.cameras = [];
    this.doors = []; this.lifts = []; this.lightSpots = []; this.puddles = []; this.docks = []; this.spawns = [];
    this.walls = []; this.memos = []; this.markers = {}; this.exit = null; this.key = null;
    this.power = true; this.valid = true; this.reach = null; this.reachFrom = null;
    this.VW = Math.ceil(hx); this.VH = Math.ceil(hz); // 踏破記録（2m 単位）
    this.visited = new Uint8Array(this.VW * this.VH);
  }
  groundAt(x, z) { return this.phys.groundAt(x, z); }
  visit(x, z, r = 5) {
    const i0 = Math.max(0, Math.floor((x - r + this.hx) / 2)), i1 = Math.min(this.VW - 1, Math.floor((x + r + this.hx) / 2));
    const j0 = Math.max(0, Math.floor((z - r + this.hz) / 2)), j1 = Math.min(this.VH - 1, Math.floor((z + r + this.hz) / 2));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.visited[j * this.VW + i] = 1;
  }
  seen(x, z) {
    const i = Math.floor((x + this.hx) / 2), j = Math.floor((z + this.hz) / 2);
    return i >= 0 && j >= 0 && i < this.VW && j < this.VH && this.visited[j * this.VW + i] === 1;
  }
  finalize() {
    this.phys.finalize();
    this.nav = new Nav(this.phys);
    this.updateReach();
  }
  updateReach() {
    if (this.reachFrom) this.reach = this.nav.fieldAt(this.reachFrom.x, this.reachFrom.z, this.groundAt(this.reachFrom.x, this.reachFrom.z));
  }
  // 扉の開閉などで障害物が変わったとき
  refresh() { this.phys.finalize(); this.nav.reset(); this.updateReach(); }
  mat(m) { this.owned.push(m); return m; }
  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.owned) { if (m.map) m.map.dispose(); m.dispose(); }
  }
}

// 共通ビルダー
export class Builder {
  constructor(lv, M, R) {
    this.lv = lv; this.M = M; this.R = R;
    this.batch = new Batch();
    this.tno = 1;
  }
  put(mat, scale, geo, cast = true) { if (scale) worldUV(geo, scale); this.batch.add(mat, geo, cast); return geo; }
  box(mat, scale, x, y, z, w, h, d, ry = 0, cast = true) { return this.put(mat, scale, xform(new THREE.BoxGeometry(w, h, d), P(x, z, ry), 0, y, 0), cast); }
  finish() { this.batch.build(this.lv.group); }

  // ---------- 構造 ----------
  floorRects(rects, y, mat = this.M.floor, scale = this.M.floorScale) {
    for (const r of rects) {
      const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0);
      this.put(mat, scale, xform(g, P((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2), 0, y, 0, -Math.PI / 2), false);
    }
  }
  ceiling(y = this.lv.wallH) {
    const { hx, hz } = this.lv;
    this.put(this.M.ceiling, this.M.ceilingScale, xform(new THREE.PlaneGeometry(hx * 2, hz * 2), P(0, 0), 0, y, 0, Math.PI / 2), false);
  }
  wall(x, z, w, d, o = {}) {
    const h = o.h ?? this.lv.wallH, y0 = o.y0 || 0;
    this.put(o.mat || this.M.wall, o.scale || this.M.wallScale, xform(new THREE.BoxGeometry(w, h, d), P(x, z), 0, y0 + h / 2, 0));
    if (o.collide !== false) this.lv.phys.addBox(x, z, w / 2, d / 2, h, { y0 });
    if (o.record !== false && h > 2) this.lv.walls.push({ x, z, w, d });
  }
  outerWalls() {
    const { hx, hz } = this.lv;
    const o = { collide: false, record: false };
    this.wall(0, -hz, hx * 2 + 0.2, 0.2, o); this.wall(0, hz, hx * 2 + 0.2, 0.2, o);
    this.wall(-hx, 0, 0.2, hz * 2, o); this.wall(hx, 0, 0.2, hz * 2, o);
  }
  lintel(x, z, w, d, y0) { this.wall(x, z, w, d, { h: this.lv.wallH - y0, y0, collide: false, record: false }); }

  // 台（小上がり・中二階など）。下は埋まっている
  platform(x0, z0, x1, z1, h, o = {}) {
    this.lv.phys.addRegion({ kind: 'plat', x0, z0, x1, z1, h });
    const mat = o.mat || this.M.wood, scale = o.scale || this.M.woodScale;
    this.put(mat, scale, xform(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), P((x0 + x1) / 2, (z0 + z1) / 2), 0, h / 2, 0));
  }
  // スロープ/階段。axis 方向に min→max で h0→h1
  ramp(x0, z0, x1, z1, axis, h0, h1, stairs) {
    this.lv.phys.addRegion({ kind: 'ramp', x0, z0, x1, z1, axis, h0, h1, stairs: !!stairs });
    const M = this.M;
    if (stairs) {
      const rise = Math.abs(h1 - h0), n = Math.max(2, Math.round(rise / 0.19));
      const len = axis === 'x' ? x1 - x0 : z1 - z0, step = len / n;
      for (let k = 0; k < n; k++) {
        const hk = Math.min(h0, h1) + (rise * (k + 1)) / n;
        const t = h1 > h0 ? k : n - 1 - k;
        const c = (axis === 'x' ? x0 : z0) + step * (t + 0.5);
        if (axis === 'x') this.box(M.concrete, M.concreteScale, c, hk / 2, (z0 + z1) / 2, step, hk, z1 - z0);
        else this.box(M.concrete, M.concreteScale, (x0 + x1) / 2, hk / 2, c, x1 - x0, hk, step);
      }
      return;
    }
    const y = (x, z) => (axis === 'x' ? (x === x0 ? h0 : h1) : (z === z0 ? h0 : h1));
    const q = [
      [[x0, y(x0, z0), z0], [x1, y(x1, z0), z0], [x1, y(x1, z1), z1], [x0, y(x0, z1), z1]],
      [[x0, 0, z0], [x0, y(x0, z0), z0], [x0, y(x0, z1), z1], [x0, 0, z1]],
      [[x1, 0, z0], [x1, 0, z1], [x1, y(x1, z1), z1], [x1, y(x1, z0), z0]],
      [[x0, 0, z0], [x1, 0, z0], [x1, y(x1, z0), z0], [x0, y(x0, z0), z0]],
      [[x0, 0, z1], [x0, y(x0, z1), z1], [x1, y(x1, z1), z1], [x1, 0, z1]],
    ];
    const center = new THREE.Vector3((x0 + x1) / 2, Math.max(h0, h1) / 3, (z0 + z1) / 2);
    this.put(M.concrete, M.concreteScale, quadsGeometry(q, center));
  }
  // 崩落した床
  hole(x0, z0, x1, z1) {
    this.lv.phys.addRegion({ kind: 'hole', x0, z0, x1, z1 });
    const M = this.M, d = 2.6, w = x1 - x0, l = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.box(M.concrete, M.concreteScale, cx, -d / 2, z0 + 0.05, w, d, 0.1);
    this.box(M.concrete, M.concreteScale, cx, -d / 2, z1 - 0.05, w, d, 0.1);
    this.box(M.concrete, M.concreteScale, x0 + 0.05, -d / 2, cz, 0.1, d, l);
    this.box(M.concrete, M.concreteScale, x1 - 0.05, -d / 2, cz, 0.1, d, l);
    this.put(M.dark, 0, xform(new THREE.PlaneGeometry(w, l), P(cx, cz), 0, -d, 0, -Math.PI / 2), false);
    // 縁の瓦礫と折れた鉄筋
    const R = this.R;
    for (let i = 0; i < 6; i++) {
      const s = 0.15 + R() * 0.3, side = Math.floor(R() * 4);
      const x = side < 2 ? x0 + R() * w : side === 2 ? x0 - 0.2 : x1 + 0.2, z = side >= 2 ? z0 + R() * l : side === 0 ? z0 - 0.2 : z1 + 0.2;
      this.box(M.concrete, 0, x, s * 0.3, z, s, s * 0.6, s * 1.2, R() * 3, false);
    }
    for (let i = 0; i < 4; i++) this.put(M.metal, 0, xform(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 5), P(x0 + R() * w, z0 + (R() < 0.5 ? 0 : l)), 0, -0.1, 0, R() - 0.5, 0, R() - 0.5), false);
  }
  railing(x0, z0, x1, z1, y) {
    const M = this.M, len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.put(M.steel, 0, xform(new THREE.BoxGeometry(0.05, 0.05, len), P(cx, cz, ry), 0, y + 1.0, 0));
    this.put(M.steel, 0, xform(new THREE.BoxGeometry(0.03, 0.03, len), P(cx, cz, ry), 0, y + 0.5, 0));
    const n = Math.max(1, Math.round(len));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.put(M.steel, 0, xform(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6), P(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t), 0, y + 0.5, 0));
    }
    const hw = Math.max(0.05, Math.abs(x1 - x0) / 2), hd = Math.max(0.05, Math.abs(z1 - z0) / 2);
    this.lv.phys.addBox(cx, cz, hw, hd, 1.05, { y0: y });
  }
  // しゃがみ専用ダクト（ロボット不可）。axis: 通路の向き
  duct(x0, z0, x1, z1, axis, sides = true) {
    const M = this.M, h = 0.8, w = x1 - x0, l = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.box(M.metal, M.metalScale, cx, h + 0.06, cz, w + 0.2, 0.12, l + 0.2);
    if (sides) {
      if (axis === 'z') { this.box(M.metal, M.metalScale, x0 - 0.05, h / 2, cz, 0.1, h, l); this.box(M.metal, M.metalScale, x1 + 0.05, h / 2, cz, 0.1, h, l); this.lv.phys.addBox(x0 - 0.05, cz, 0.05, l / 2, h + 0.12); this.lv.phys.addBox(x1 + 0.05, cz, 0.05, l / 2, h + 0.12); }
      else { this.box(M.metal, M.metalScale, cx, h / 2, z0 - 0.05, w, h, 0.1); this.box(M.metal, M.metalScale, cx, h / 2, z1 + 0.05, w, h, 0.1); this.lv.phys.addBox(cx, z0 - 0.05, w / 2, 0.05, h + 0.12); this.lv.phys.addBox(cx, z1 + 0.05, w / 2, 0.05, h + 0.12); }
    }
    this.put(M.dark, 0, xform(new THREE.PlaneGeometry(w, l), P(cx, cz), 0, 0.01, 0, -Math.PI / 2), false);
    this.lv.phys.addBox(cx, cz, w / 2, l / 2, h + 0.12, { mask: 'stand' });
  }

  // ---------- 家具 ----------
  locker(x, z, fx, fz, y = 0) {
    const ry = Math.atan2(fx, fz), p = P(x, z, ry, y), M = this.M;
    this.put(M.metal, M.metalScale, xform(new THREE.BoxGeometry(0.8, 2.2, 0.8), p, 0, 1.1, 0));
    this.put(M.lockerDoor, 0, xform(new THREE.PlaneGeometry(0.74, 2.1), p, 0, 1.1, 0.402));
    this.lv.phys.addBox(x, z, 0.4, 0.4, 2.2, { y0: y });
    const L = { x, z, y, fx, fz, ry, exit: { x: x + fx * 0.95, z: z + fz * 0.95 } };
    this.lv.lockers.push(L);
    return L;
  }
  tablet(x, z, y, p, lx, lz, reach, name) {
    this.put(this.M.dark, 0, xform(new THREE.BoxGeometry(0.26, 0.02, 0.18), p, lx, y + 0.01, lz), false);
    this.put(this.M.screen, 0, xform(new THREE.PlaneGeometry(0.22, 0.14), p, lx, y + 0.022, lz, -Math.PI / 2), false);
    this.lv.tablets.push({ x, z, y: p.y || 0, reach, name: name + (this.tno++) });
  }
  tableRect(x, z, o = {}) {
    const M = this.M, R = this.R, w = o.w ?? 1.3 + R() * 0.5, d = o.d ?? 0.9 + R() * 0.3, y = o.y || 0;
    const rot = !!o.rot, hw = rot ? d / 2 : w / 2, hd = rot ? w / 2 : d / 2, fallen = !!o.fallen;
    const p = P(x, z, rot ? Math.PI / 2 : 0, y + (fallen ? -0.1 : 0), 0, fallen ? 0.4 : 0);
    this.put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(w, 0.05, d), p, 0, 0.75, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.put(M.dark, 0, xform(new THREE.BoxGeometry(0.05, 0.72, 0.05), p, sx * (w / 2 - 0.08), 0.36, sz * (d / 2 - 0.08)));
    this.lv.phys.addBox(x, z, hw, hd, 0.78, { y0: y });
    if (!fallen && o.tablet !== false) this.tablet(x, z, 0.775, p, w / 2 - 0.3, 0, Math.max(hw, hd) + 1.0, 'テーブル');
  }
  tableRound(x, z, o = {}) {
    const M = this.M, y = o.y || 0, p = P(x, z, this.R() * 3, y);
    this.put(M.wood, M.woodScale, xform(new THREE.CylinderGeometry(0.8, 0.8, 0.05, 28), p, 0, 0.75, 0));
    this.put(M.dark, 0, xform(new THREE.CylinderGeometry(0.06, 0.06, 0.72, 10), p, 0, 0.37, 0));
    this.put(M.dark, 0, xform(new THREE.CylinderGeometry(0.38, 0.4, 0.04, 20), p, 0, 0.02, 0));
    this.lv.phys.addCircle(x, z, 0.8, 0.78, { y0: y });
    if (o.tablet !== false) this.tablet(x, z, 0.775, p, 0.35, 0, 1.75, 'テーブル');
  }
  booth(x, z, o = {}) {
    const M = this.M, rot = !!o.rot, y = o.y || 0, p = P(x, z, rot ? Math.PI / 2 : 0, y);
    for (const s of [-1, 1]) {
      this.put(M.vinyl, M.vinylScale, xform(new THREE.BoxGeometry(0.55, 0.45, 1.7), p, s * 1.1, 0.225, 0));
      this.put(M.vinyl, M.vinylScale, xform(new THREE.BoxGeometry(0.15, 0.7, 1.7), p, s * 1.33, 0.8, 0, 0, 0, s * 0.08));
    }
    this.put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(1.25, 0.05, 1.45), p, 0, 0.75, 0));
    this.put(M.dark, 0, xform(new THREE.BoxGeometry(0.12, 0.72, 0.12), p, 0, 0.36, 0));
    const sx = rot ? 0 : 1.1, sz = rot ? 1.1 : 0;
    this.lv.phys.addBox(x - sx, z - sz, rot ? 0.85 : 0.35, rot ? 0.35 : 0.85, 1.15, { y0: y });
    this.lv.phys.addBox(x + sx, z + sz, rot ? 0.85 : 0.35, rot ? 0.35 : 0.85, 1.15, { y0: y });
    this.lv.phys.addBox(x, z, rot ? 0.73 : 0.63, rot ? 0.63 : 0.73, 0.78, { y0: y });
    if (o.tablet !== false) this.tablet(x, z, 0.775, p, 0, 0.45, 1.9, 'テーブル');
  }
  // 座卓と座布団（小上がり用）
  lowTable(x, z, o = {}) {
    const M = this.M, y = o.y || 0, p = P(x, z, o.rot ? Math.PI / 2 : 0, y);
    this.put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(1.4, 0.05, 0.8), p, 0, 0.34, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.put(M.wood, 0, xform(new THREE.BoxGeometry(0.06, 0.32, 0.06), p, sx * 0.6, 0.16, sz * 0.32));
    for (const s of [-1, 1]) for (const t of [-0.35, 0.35]) this.put(M.vinyl, M.vinylScale, xform(new THREE.BoxGeometry(0.5, 0.07, 0.5), p, t, 0.035, s * 0.75, 0, this.R() * 0.4), false);
    this.lv.phys.addBox(x, z, o.rot ? 0.4 : 0.7, o.rot ? 0.7 : 0.4, 0.36, { y0: y });
  }
  chair(x, z, ry, down, y = 0) {
    const M = this.M, p = P(x, z, ry, y + (down ? 0.21 : 0), down ? Math.PI / 2 : 0);
    this.put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(0.42, 0.05, 0.42), p, 0, 0.45, 0));
    this.put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(0.42, 0.5, 0.04), p, 0, 0.72, -0.2));
    for (const a of [-1, 1]) for (const b of [-1, 1]) this.put(M.dark, 0, xform(new THREE.BoxGeometry(0.035, 0.45, 0.035), p, a * 0.18, 0.225, b * 0.18));
    this.lv.phys.addBox(x, z, 0.22, 0.22, 0.95, { y0: y });
  }
  longTable(x, z, o = {}) {
    const M = this.M, R = this.R, w = o.w ?? 2.6 + R() * 1.2, d = 0.9, rot = !!o.rot, y = o.y || 0;
    const p = P(x, z, rot ? Math.PI / 2 : 0, y);
    this.put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(w, 0.05, d), p, 0, 0.75, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.put(M.dark, 0, xform(new THREE.BoxGeometry(0.06, 0.72, 0.06), p, sx * (w / 2 - 0.1), 0.36, sz * (d / 2 - 0.1)));
    this.lv.phys.addBox(x, z, rot ? d / 2 : w / 2, rot ? w / 2 : d / 2, 0.78, { y0: y });
    if (o.chairs !== false) {
      const nC = Math.floor(w / 0.7);
      for (let i = 0; i < nC; i++) for (const s of [-1, 1]) {
        if (R() < 0.3) continue;
        const lx = -w / 2 + 0.45 + i * ((w - 0.9) / Math.max(1, nC - 1)), lz = s * (d / 2 + 0.32);
        this.chair(x + (rot ? lz : lx), z + (rot ? -lx : lz), (rot ? Math.PI / 2 : 0) + (s > 0 ? Math.PI : 0) + (R() - 0.5) * 0.4, R() < 0.2, y);
      }
    }
    if (o.tablet !== false) this.tablet(x, z, 0.775, p, 0, 0, Math.max(w, d) / 2 + 0.9, 'テーブル');
  }
  debris(x, z, o = {}) {
    const M = this.M, R = this.R, y = o.y || 0;
    let h = 0;
    const k = 2 + Math.floor(R() * (o.tall ? 4 : 2));
    for (let i = 0; i < k; i++) {
      const s = 0.5 + R() * 0.5, yy = i < 2 ? s / 2 : h + s / 2 - 0.05;
      this.put(i % 2 ? M.wood : M.concrete, i % 2 ? M.woodScale : M.concreteScale,
        xform(new THREE.BoxGeometry(s, s, s * (0.8 + R() * 0.4)), P(x + (R() - 0.5) * 0.6, z + (R() - 0.5) * 0.6, R() * 3, y), 0, yy, 0, 0, 0, (R() - 0.5) * 0.2));
      h = Math.max(h, yy + s / 2);
    }
    this.lv.phys.addBox(x, z, 0.75, 0.75, h, { y0: y });
  }
  counter(x, z, o = {}) {
    const M = this.M, R = this.R, w = o.w ?? 2.4 + R() * 1.4, d = 0.8, rot = !!o.rot, y = o.y || 0;
    const p = P(x, z, rot ? Math.PI / 2 : 0, y), hw = rot ? d / 2 : w / 2, hd = rot ? w / 2 : d / 2;
    this.put(M.steel, M.steelScale, xform(new THREE.BoxGeometry(w, 0.86, d), p, 0, 0.43, 0));
    this.put(M.steel, M.steelScale, xform(new THREE.BoxGeometry(w + 0.04, 0.04, d + 0.04), p, 0, 0.88, 0));
    if (R() < 0.5) this.put(M.dark, 0, xform(new THREE.BoxGeometry(0.5, 0.12, 0.4), p, -w / 4, 0.96, 0));
    this.lv.phys.addBox(x, z, hw, hd, 0.9, { y0: y });
    if (o.tablet) this.tablet(x, z, 0.9, p, w / 2 - 0.35, 0, Math.max(hw, hd) + 0.9, '厨房端末');
  }
  shelf(x, z, o = {}) {
    const M = this.M, R = this.R, w = o.w ?? 1.6, d = 0.5, rot = !!o.rot, y = o.y || 0;
    const p = P(x, z, rot ? Math.PI / 2 : 0, y);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.put(M.steel, 0, xform(new THREE.BoxGeometry(0.04, 1.8, 0.04), p, sx * (w / 2 - 0.02), 0.9, sz * (d / 2 - 0.02)));
    for (let i = 0; i < 4; i++) {
      this.put(M.steel, M.steelScale, xform(new THREE.BoxGeometry(w, 0.03, d), p, 0, 0.15 + i * 0.52, 0));
      for (let k = 0; k < 3; k++) if (R() < 0.6) {
        const s = 0.15 + R() * 0.2;
        this.put(R() < 0.5 ? M.metal : M.concrete, 0, xform(new THREE.BoxGeometry(s, s, s), p, -w / 2 + 0.3 + k * 0.5, 0.17 + i * 0.52 + s / 2, 0), false);
      }
    }
    this.lv.phys.addBox(x, z, rot ? d / 2 : w / 2, rot ? w / 2 : d / 2, 1.8, { y0: y });
  }
  cabinet(x, z, o = {}) {
    const M = this.M, R = this.R, rot = !!o.rot, w = o.w ?? 1.2, d = 0.8, y = o.y || 0, h = o.h ?? 2.0;
    const p = P(x, z, rot ? Math.PI / 2 : 0, y);
    this.put(M.metal, M.metalScale, xform(new THREE.BoxGeometry(w, h, d), p, 0, h / 2, 0));
    for (let i = 0; i < 6; i++) {
      const led = R() < 0.25 ? M.ledRed : M.ledGreen;
      for (const s of [-1, 1]) this.put(led, 0, xform(new THREE.BoxGeometry(0.03, 0.03, 0.01), p, -w / 2 + 0.2 + (i % 3) * 0.08, h - 0.4 - Math.floor(i / 3) * 0.08, s * (d / 2 + 0.006)), false);
    }
    this.lv.phys.addBox(x, z, rot ? d / 2 : w / 2, rot ? w / 2 : d / 2, h, { y0: y });
  }
  pillar(x, z, w = 0.8, d = 0.8) { this.wall(x, z, w, d, { mat: this.M.concrete, scale: this.M.concreteScale, record: false }); }
  pipeV(x, z) {
    this.put(this.M.metal, this.M.metalScale, xform(new THREE.CylinderGeometry(0.16, 0.16, this.lv.wallH, 14), P(x, z), 0, this.lv.wallH / 2, 0));
    this.lv.phys.addCircle(x, z, 0.16, this.lv.wallH);
  }
  smallDebris(x0, z0, x1, z1, k, y = 0) {
    const M = this.M, R = this.R;
    for (let i = 0; i < k; i++) {
      const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
      if (Math.abs(this.lv.groundAt(x, z) - y) > 0.01) continue;
      if (R() < 0.45) this.put(M.paper, 0, xform(new THREE.PlaneGeometry(0.21, 0.3), P(x, z, R() * 6, y), 0, 0.004, 0, -Math.PI / 2), false);
      else { const s = 0.08 + R() * 0.25; this.put(R() < 0.5 ? M.concrete : M.wood, 0, xform(new THREE.BoxGeometry(s, s * 0.6, s * 1.3), P(x, z, R() * 6, y), 0, s * 0.3, 0), false); }
    }
  }
  puddle(x, z, r, sx) {
    const g = new THREE.CircleGeometry(r, 24); g.scale(sx, 1, 1);
    this.put(this.M.puddle, 0, xform(g, P(x, z, this.R() * 3), 0, 0.006, 0, -Math.PI / 2), false);
    this.lv.puddles.push({ x, z, r: r * Math.max(sx, 1) });
  }

  // ---------- 照明 ----------
  fixture(x, z, live, o = {}) {
    const M = this.M, R = this.R, H = o.y ?? this.lv.wallH;
    const hang = !live && R() < 0.15;
    const p = P(x, z, o.rot ?? (R() < 0.5 ? 0 : Math.PI / 2), hang ? -0.35 : 0, 0, hang ? 0.35 : 0);
    this.put(M.metal, 0, xform(new THREE.BoxGeometry(1.25, 0.07, 0.3), p, 0, H - 0.04, 0), true);
    const mat = live ? this.lv.mat(M.tubeOn.clone()) : M.tubeOff;
    for (const s of [-1, 1]) {
      const g = xform(new THREE.CylinderGeometry(0.016, 0.016, 1.15, 8), p, 0, H - 0.1, s * 0.07, 0, 0, Math.PI / 2);
      if (live) this.lv.group.add(new THREE.Mesh(g, mat)); else this.put(mat, 0, g, false);
    }
    if (live) this.lv.lightSpots.push({ x, y: H - 0.25, z, mat, off: 0, v: 1, mode: R() < 0.25 ? 'dead' : 'live' });
  }
  graffiti(text, x, y, z, ry) {
    const mat = this.lv.mat(new THREE.MeshStandardMaterial({ map: graffitiTexture(text, this.R), transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), mat);
    m.position.set(x, y, z); m.rotation.y = ry; this.lv.group.add(m);
  }
  sign(text, bg, fg, x, y, z, ry, w = 0.9, h = 0.34) {
    const mat = this.lv.mat(new THREE.MeshBasicMaterial({ map: signTexture(text, bg, fg), color: new THREE.Color(1.6, 1.6, 1.6) }));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z); m.rotation.y = ry; this.lv.group.add(m);
    return m;
  }

  // ---------- ギミック ----------
  // 壁付けの配電盤。(x,z) は操作位置、ry は壁から部屋へ向く向き
  breaker(x, z, ry, o = {}) {
    const M = this.M, y = o.y || 0, fx = Math.sin(ry), fz = Math.cos(ry);
    const bx = x - fx * 0.55, bz = z - fz * 0.55;
    const p = P(bx, bz, ry, y);
    this.put(M.metal, M.metalScale, xform(new THREE.BoxGeometry(0.7, 0.9, 0.18), p, 0, 1.45, 0));
    this.put(M.dark, 0, xform(new THREE.BoxGeometry(0.6, 0.06, 0.02), p, 0, 1.75, 0.1));
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), M.steel);
    lever.position.set(bx + fx * 0.14, y + 1.35, bz + fz * 0.14); lever.rotation.set(0, ry, 0);
    lever.castShadow = true; this.lv.group.add(lever);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.02), this.lv.mat(M.ledRed.clone()));
    led.position.set(bx + fx * 0.1 + Math.cos(ry) * 0.22, y + 1.75, bz + fz * 0.1 - Math.sin(ry) * 0.22); led.rotation.y = ry;
    this.lv.group.add(led);
    this.sign('配電盤', '#202020', '#e0d070', bx + fx * 0.095, y + 2.05, bz + fz * 0.095, ry, 0.5, 0.18);
    const it = { kind: 'breaker', x, z, y, r: 1.3, lever, led, ry, need: o.need || null, id: o.id || 'breaker' };
    this.lv.interacts.push(it);
    return it;
  }
  // 監視カメラ（天井際）。yaw はレンズの向き
  camera(x, y, z, yaw, o = {}) {
    const M = this.M, g = new THREE.Group(), head = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.06), M.dark); arm.position.y = 0.12; g.add(arm);
    g.add(head);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.34), M.plastic); head.add(body);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 14), M.dark); lens.rotation.x = Math.PI / 2; lens.position.z = 0.18; head.add(lens);
    const ledMat = this.lv.mat(M.ledRed.clone());
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), ledMat); led.position.set(0.05, 0.05, 0.17); head.add(led);
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    g.position.set(x, y - 0.25, z); this.lv.group.add(g);
    const cam = { x, y: y - 0.3, z, yaw0: yaw, yaw, pitch: o.pitch ?? -0.5, sweep: o.sweep ?? 0.6, phase: this.R() * 6, head, ledMat, spotT: 0, cd: 0, range: o.range ?? 13, name: o.name || 'CAM' };
    head.rotation.set(-cam.pitch, yaw, 0, 'YXZ');
    this.lv.cameras.push(cam);
    return cam;
  }
  // 動く扉。type 'card'（カードキー）/ 'shutter'（電源）。axis: 扉面の向き（'x' なら x 方向に広がる）
  door(x, z, axis, w, o = {}) {
    const M = this.M, type = o.type || 'card', h = 2.25, y = o.y || 0;
    const mat = type === 'shutter' ? M.steel : M.metal;
    const geo = type === 'shutter'
      ? new THREE.BoxGeometry(axis === 'x' ? w : 0.08, h, axis === 'x' ? 0.08 : w)
      : new THREE.BoxGeometry(axis === 'x' ? w : 0.06, h, axis === 'x' ? 0.06 : w);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z); mesh.castShadow = true; mesh.receiveShadow = true;
    this.lv.group.add(mesh);
    if (type === 'shutter') {
      for (let i = 0; i < 10; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? w : 0.1, 0.02, axis === 'x' ? 0.1 : w), M.dark);
        s.position.set(0, -h / 2 + 0.2 + i * 0.21, 0); mesh.add(s);
      }
    }
    const col = this.lv.phys.addBox(x, z, axis === 'x' ? w / 2 : 0.1, axis === 'x' ? 0.1 : w / 2, h, { y0: y });
    const d = { type, x, z, y, axis, w, h, mesh, col, open: false, t: 0, id: o.id || type, label: o.label || '' };
    if (type === 'card') {
      const ledMat = this.lv.mat(M.ledRed.clone());
      for (const s of [-1, 1]) {
        const rd = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.03), ledMat);
        const off = w / 2 + 0.2;
        if (axis === 'x') rd.position.set(x + off, y + 1.2, z + s * 0.12); else rd.position.set(x + s * 0.12, y + 1.2, z + off);
        this.lv.group.add(rd);
      }
      d.ledMat = ledMat;
      this.lv.interacts.push({ kind: 'door', door: d, x, z, y, r: 1.6 });
    } else this.lv.interacts.push({ kind: 'shutter', door: d, x, z, y, r: 1.6 });
    this.lv.doors.push(d);
    return d;
  }
  // 配膳リフト / エレベーター。(x,z) は乗り口前、ry は乗り口が向く向き
  lift(x, z, ry, o = {}) {
    const M = this.M, fx = Math.sin(ry), fz = Math.cos(ry), y = o.y || 0;
    const cx = x - fx * 1.6, cz = z - fz * 1.6, s = o.size ?? 2.0;
    const p = P(cx, cz, ry, y);
    if (!o.noShaft) { // 文字マップでは壁でシャフトを描くので不要
      this.put(M.concrete, M.concreteScale, xform(new THREE.BoxGeometry(s + 0.4, this.lv.wallH, s + 0.4), p, 0, this.lv.wallH / 2, 0));
      this.lv.phys.addBox(cx, cz, (s + 0.4) / 2, (s + 0.4) / 2, this.lv.wallH, { y0: y });
    }
    const face = o.noShaft ? 1.6 - 0.52 : (s + 0.4) / 2; // 扉面の位置
    this.put(M.steel, M.steelScale, xform(new THREE.BoxGeometry(s * 0.8, 2.1, 0.05), p, 0, 1.05, face + 0.02));
    this.put(M.dark, 0, xform(new THREE.BoxGeometry(0.02, 2.1, 0.06), p, 0, 1.05, face + 0.03));
    const panelMat = this.lv.mat(M.ledRed.clone());
    const pn = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.03), panelMat);
    pn.position.set(cx + fx * (face + 0.03) + Math.cos(ry) * (s * 0.5), y + 1.25, cz + fz * (face + 0.03) - Math.sin(ry) * (s * 0.5));
    pn.rotation.y = ry; this.lv.group.add(pn);
    this.sign(o.label || '配膳リフト', '#1c1c1c', '#d8d8d8', cx + fx * (face + 0.03), y + 2.35, cz + fz * (face + 0.03), ry, 0.9, 0.24);
    const it = { kind: 'lift', id: o.id || 'lift', x, z, y, r: 1.4, ry, panelMat, label: o.label || '配膳リフト', dir: o.dir || 0 };
    this.lv.lifts.push(it); this.lv.interacts.push(it);
    return it;
  }
  exitDoor(x, z, ry, hasKey) {
    const M = this.M, fx = Math.sin(ry), fz = Math.cos(ry), wx = x - fx * 0.9, wz = z - fz * 0.9;
    this.put(M.steel, 0, xform(new THREE.BoxGeometry(1.7, 2.3, 0.06), P(wx, wz, ry), 0, 1.15, 0));
    this.put(M.dark, 0, xform(new THREE.BoxGeometry(1.9, 0.1, 0.12), P(wx, wz, ry), 0, 2.35, 0));
    this.put(M.dark, 0, xform(new THREE.BoxGeometry(0.5, 0.05, 0.08), P(wx, wz, ry), 0.5, 1.05, 0.05));
    this.sign('非常口', '#0a6a2a', '#ffffff', wx + fx * 0.05, 2.6, wz + fz * 0.05, ry);
    const ledMat = this.lv.mat((hasKey ? M.ledGreen : M.ledRed).clone());
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.03), ledMat);
    led.position.set(wx + fx * 0.06 + Math.cos(ry) * 0.5, 1.3, wz + fz * 0.06 - Math.sin(ry) * 0.5); led.rotation.y = ry;
    this.lv.group.add(led);
    const it = { kind: 'exit', x, z, y: 0, r: 1.6, ledMat };
    this.lv.exit = it; this.lv.interacts.push(it);
    return it;
  }
  // 拾えるもの（鍵・カード・日誌・録音機など）
  item(x, z, y, o) {
    const M = this.M, g = new THREE.Group();
    let mesh;
    if (o.look === 'key') {
      mesh = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 8, 20), M.gold);
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.012), M.gold); shaft.position.x = 0.08;
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.012), M.gold); tooth.position.set(0.12, -0.02, 0);
      mesh.add(ring, shaft, tooth); mesh.position.y = 0.95;
    } else if (o.look === 'card') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.005, 0.054), this.lv.mat(new THREE.MeshStandardMaterial({ color: 0x3a6fd8, emissive: 0x2244aa, emissiveIntensity: 1.5, roughness: 0.4 })));
      mesh.position.y = 0.02;
    } else if (o.look === 'recorder') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.08), M.dark);
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, 0.02), M.ledRed); l.position.set(0.04, 0.025, 0); mesh.add(l);
      mesh.position.y = 0.02;
    } else {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.3), this.lv.mat(new THREE.MeshStandardMaterial({ color: 0xd8d0b8, emissive: 0xfff0d0, emissiveIntensity: 0.18, roughness: 0.9, side: THREE.DoubleSide })));
      mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = this.R() * 6; mesh.position.y = 0.012;
    }
    g.add(mesh); g.position.set(x, y + (o.onTable ? 0.76 : 0), z);
    this.lv.group.add(g);
    const it = { kind: 'item', x, z, y, r: 1.3, mesh: g, spin: o.look === 'key', ...o };
    this.lv.interacts.push(it);
    return it;
  }
  memo(code, n, x, z, y = 0) {
    const tx = memoTexture(code, n);
    const mat = this.lv.mat(new THREE.MeshStandardMaterial({ map: tx, emissiveMap: tx, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3 }));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), mat);
    m.rotation.set(-Math.PI / 2, 0, this.R() * 6); m.position.set(x, y + 0.01, z); m.receiveShadow = true;
    this.lv.group.add(m);
    this.lv.memos.push({ x, z });
    this.lv.interacts.push({ kind: 'memo', x, z, y, r: 1.3 });
  }
  // 監視モニター卓
  monitor(x, z, ry, y = 0) {
    const M = this.M, fx = Math.sin(ry), fz = Math.cos(ry), cx = x - fx * 0.8, cz = z - fz * 0.8, p = P(cx, cz, ry, y);
    this.put(M.metal, M.metalScale, xform(new THREE.BoxGeometry(2.0, 0.8, 0.8), p, 0, 0.4, 0));
    for (let i = 0; i < 3; i++) {
      this.put(M.dark, 0, xform(new THREE.BoxGeometry(0.6, 0.45, 0.08), p, -0.65 + i * 0.65, 1.15, -0.2));
      this.put(M.screen, 0, xform(new THREE.PlaneGeometry(0.54, 0.38), p, -0.65 + i * 0.65, 1.15, -0.155), false);
    }
    this.lv.phys.addBox(cx, cz, Math.abs(fz) > 0.5 ? 1.0 : 0.4, Math.abs(fz) > 0.5 ? 0.4 : 1.0, 1.4, { y0: y });
    const it = { kind: 'monitor', x, z, y, r: 1.4 };
    this.lv.interacts.push(it);
    return it;
  }
  // サーバー室の停止コンソール
  console(x, z, ry, o = {}) {
    const M = this.M, fx = Math.sin(ry), fz = Math.cos(ry), cx = x - fx * 0.7, cz = z - fz * 0.7, p = P(cx, cz, ry, o.y || 0);
    this.put(M.steel, M.steelScale, xform(new THREE.BoxGeometry(1.4, 1.0, 0.6), p, 0, 0.5, 0));
    const btnMat = this.lv.mat(M.ledRed.clone());
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 16), btnMat);
    b.position.set(cx + fx * 0.15, (o.y || 0) + 1.02, cz + fz * 0.15); this.lv.group.add(b);
    this.lv.phys.addBox(cx, cz, Math.abs(fz) > 0.5 ? 0.7 : 0.3, Math.abs(fz) > 0.5 ? 0.3 : 0.7, 1.0, { y0: o.y || 0 });
    const it = { kind: 'item', id: o.id, name: o.name, x, z, y: o.y || 0, r: 1.4, keep: true, btnMat };
    this.lv.interacts.push(it);
    return it;
  }
}
