// 当たり判定（バケット分割）・床の高さ（台/スロープ/穴）・視線/ナビ用グリッド
import { GRID } from './config.js';

const B = 4;
const WALL_IN = 0.1;            // 外壁の内面までの厚み
export const ROBOT_STEP = 0.16; // ロボットが越えられる段差（スロープのみ通れる）
export const PLAYER_STEP = 0.45;
export const HOLE = -20;
const NAV_INFLATE = 0.36;
const BODY = { player: 1.75, crouch: 1.05, robot: 1.6 };

export class Physics {
  // off: ナビ/視線グリッドの原点ずらし（1m タイルの扉中央にセル中心を合わせる）
  constructor(hx, hz, off = 0) {
    this.hx = hx; this.hz = hz; this.off = off;
    this.BW = Math.ceil((hx * 2) / B); this.BH = Math.ceil((hz * 2) / B);
    this.GW = Math.round((hx * 2) / GRID); this.GH = Math.round((hz * 2) / GRID);
    this.list = []; this.regions = [];
    this.buckets = Array.from({ length: this.BW * this.BH }, () => []);
    this.rbuckets = Array.from({ length: this.BW * this.BH }, () => []);
    this.q = 0;
    const n = this.GW * this.GH;
    this.top = new Float32Array(n);     // 視線遮蔽: セルを覆う物の上端（絶対高さ）
    this.ground = new Float32Array(n);  // 歩ける面の高さ
    this.blocked = new Uint8Array(n);   // ナビ: ロボット半径で膨張させた占有
  }

  _range(minX, minZ, maxX, maxZ) {
    const { hx, hz, BW, BH } = this;
    return [Math.max(0, Math.floor((minX + hx) / B)), Math.max(0, Math.floor((minZ + hz) / B)),
      Math.min(BW - 1, Math.floor((maxX + hx) / B)), Math.min(BH - 1, Math.floor((maxZ + hz) / B))];
  }
  _insert(arr, c) {
    const [x0, z0, x1, z1] = this._range(c.minX, c.minZ, c.maxX, c.maxZ);
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) arr[j * this.BW + i].push(c);
    return c;
  }
  // mask: 'all' / 'stand'(立った人とロボットを止める=ダクト) / 'robot'(ロボットのみ)
  addBox(x, z, hw, hd, h, o = {}) {
    const y0 = o.y0 || 0;
    const c = { x, z, hw, hd, y0, top: y0 + h, mask: o.mask || 'all', on: true, minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, q: 0 };
    this.list.push(c); return this._insert(this.buckets, c);
  }
  addCircle(x, z, r, h, o = {}) {
    const y0 = o.y0 || 0;
    const c = { x, z, cr: r, y0, top: y0 + h, mask: o.mask || 'all', on: true, minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, q: 0 };
    this.list.push(c); return this._insert(this.buckets, c);
  }
  // 床の高さ領域。kind: 'plat'(h) / 'ramp'(axis 'x'|'z', h0→h1 を min→max 方向に) / 'hole'
  addRegion(r) {
    r.minX = r.x0; r.maxX = r.x1; r.minZ = r.z0; r.maxZ = r.z1;
    this.regions.push(r);
    return this._insert(this.rbuckets, r);
  }

  groundAt(x, z) {
    const i = Math.floor((x + this.hx) / B), j = Math.floor((z + this.hz) / B);
    if (i < 0 || j < 0 || i >= this.BW || j >= this.BH) return 0;
    let g = null, hole = false;
    for (const r of this.rbuckets[j * this.BW + i]) {
      if (x < r.x0 || x >= r.x1 || z < r.z0 || z >= r.z1) continue;
      if (r.kind === 'hole') { hole = true; continue; }
      let v;
      if (r.kind === 'plat') v = r.h;
      else {
        const t = r.axis === 'x' ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0);
        v = r.h0 + (r.h1 - r.h0) * t;
      }
      g = g === null ? v : Math.max(g, v);
    }
    if (hole && (g === null || g <= 0)) return HOLE;
    return g ?? 0;
  }
  // 体の周囲で一番高い/低い床
  groundSpan(x, z, r) {
    let hi = -1e9, lo = 1e9;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const g = this.groundAt(x + dx, z + dz);
      if (g > hi) hi = g; if (g < lo) lo = g;
    }
    return [lo, hi];
  }

  _each(minX, minZ, maxX, maxZ, fn) {
    const q = ++this.q;
    const [x0, z0, x1, z1] = this._range(minX, minZ, maxX, maxZ);
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      for (const c of this.buckets[j * this.BW + i]) {
        if (c.q === q) continue;
        c.q = q;
        if (fn(c)) return true;
      }
    }
    return false;
  }
  static hit(c, x, z, r) {
    if (c.cr !== undefined) return (x - c.x) ** 2 + (z - c.z) ** 2 < (c.cr + r) ** 2;
    const cx = Math.max(c.minX, Math.min(x, c.maxX)), cz = Math.max(c.minZ, Math.min(z, c.maxZ));
    return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
  }
  inBounds(x, z, r) {
    return !(x < -this.hx + WALL_IN + r || x > this.hx - WALL_IN - r || z < -this.hz + WALL_IN + r || z > this.hz - WALL_IN - r);
  }

  // o: { robot, crouch, y(足元) }
  collide(x, z, r, o = {}) {
    if (!this.inBounds(x, z, r)) return true;
    const y = o.y ?? 0, body = o.robot ? BODY.robot : o.crouch ? BODY.crouch : BODY.player;
    return this._each(x - r, z - r, x + r, z + r, (c) => {
      if (!c.on) return false;
      if (c.mask === 'robot' && !o.robot) return false;
      if (c.mask === 'stand' && !o.robot && o.crouch) return false;
      if (c.mask !== 'stand' && (c.top <= y + 0.05 || c.y0 >= y + body)) return false;
      return Physics.hit(c, x, z, r);
    });
  }
  // ダクト（しゃがみ通路）の中か
  inCrawl(x, z) {
    return this._each(x - 0.01, z - 0.01, x + 0.01, z + 0.01, (c) => c.on && c.mask === 'stand' && Physics.hit(c, x, z, 0.01));
  }
  // 移動可否（障害物＋段差）。y は現在の足元
  canMove(x, z, r, o) {
    if (this.collide(x, z, r, o)) return false;
    const [lo, hi] = this.groundSpan(x, z, r * 0.7);
    if (hi - o.y > (o.robot ? ROBOT_STEP : PLAYER_STEP)) return false;
    if (o.robot && lo < o.y - ROBOT_STEP) return false; // ロボットは段差・穴へ降りない
    return true;
  }

  // AABB が既存の障害物・段差・穴と重ならないか（配置用）
  boxFree(x, z, hw, hd, y = 0) {
    if (x - hw < -this.hx + WALL_IN || x + hw > this.hx - WALL_IN || z - hd < -this.hz + WALL_IN || z + hd > this.hz - WALL_IN) return false;
    for (const [dx, dz] of [[0, 0], [hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd]]) if (Math.abs(this.groundAt(x + dx, z + dz) - y) > 0.01) return false;
    return !this._each(x - hw, z - hd, x + hw, z + hd, (c) =>
      c.on && c.minX < x + hw && c.maxX > x - hw && c.minZ < z + hd && c.maxZ > z - hd);
  }

  cellX(i) { return -this.hx + this.off + (i + 0.5) * GRID; }
  cellZ(j) { return -this.hz + this.off + (j + 0.5) * GRID; }
  gi(x) { return Math.floor((x + this.hx - this.off) / GRID); }
  gj(z) { return Math.floor((z + this.hz - this.off) / GRID); }

  finalize() {
    const { top, ground, blocked, GW, GH } = this;
    blocked.fill(0);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k = j * GW + i, cx = this.cellX(i), cz = this.cellZ(j);
      const g = this.groundAt(cx, cz);
      ground[k] = g; top[k] = g;
      if (g <= HOLE + 1 || !this.inBounds(cx, cz, NAV_INFLATE)) blocked[k] = 1;
    }
    const half = GRID / 2;
    for (const c of this.list) {
      if (!c.on) continue;
      const i0 = Math.max(0, this.gi(c.minX)), i1 = Math.min(GW - 1, this.gi(c.maxX));
      const j0 = Math.max(0, this.gj(c.minZ)), j1 = Math.min(GH - 1, this.gj(c.maxZ));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (c.cr !== undefined) {
          const cx = this.cellX(i), cz = this.cellZ(j);
          const nx = Math.max(cx - half, Math.min(c.x, cx + half)), nz = Math.max(cz - half, Math.min(c.z, cz + half));
          if ((nx - c.x) ** 2 + (nz - c.z) ** 2 > c.cr * c.cr) continue;
        }
        const k = j * GW + i;
        if (c.top > top[k]) top[k] = c.top;
      }
      const r = NAV_INFLATE;
      const a0 = Math.max(0, this.gi(c.minX - r)), a1 = Math.min(GW - 1, this.gi(c.maxX + r));
      const b0 = Math.max(0, this.gj(c.minZ - r)), b1 = Math.min(GH - 1, this.gj(c.maxZ + r));
      for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
        const k = j * GW + i;
        if (c.mask !== 'stand' && (c.top <= ground[k] + 0.05 || c.y0 >= ground[k] + BODY.robot)) continue;
        if (Physics.hit(c, this.cellX(i), this.cellZ(j), r)) blocked[k] = 1;
      }
    }
  }

  idx(x, z) {
    const i = this.gi(x), j = this.gj(z);
    if (i < 0 || j < 0 || i >= this.GW || j >= this.GH) return -1;
    return j * this.GW + i;
  }
  topAt(x, z) { const k = this.idx(x, z); return k < 0 ? 99 : this.top[k]; }

  // 3D 視線: 線分上の遮蔽物の上端が線の高さを超えたら遮られる。両端 0.35m は無視
  los(x1, y1, z1, x2, y2, z2) {
    const dx = x2 - x1, dz = z2 - z1, d = Math.hypot(dx, dz);
    if (d < 0.7) return Math.abs(y2 - y1) < 2;
    const n = Math.ceil(d / 0.25);
    const s0 = Math.ceil((0.35 / d) * n), s1 = n - s0;
    for (let s = s0; s <= s1; s++) {
      const t = s / n, k = this.idx(x1 + dx * t, z1 + dz * t);
      if (k < 0) return false;
      if (this.top[k] > y1 + (y2 - y1) * t) return false;
    }
    return true;
  }
}
