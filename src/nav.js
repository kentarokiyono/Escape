// グリッド上のフローフィールド（目標セルからの BFS 距離）。目標ごとに LRU キャッシュ
import { ROBOT_STEP } from './physics.js';

export const INF = 65535;

export class Nav {
  constructor(phys) {
    this.phys = phys;
    this.GW = phys.GW; this.GH = phys.GH;
    this.blocked = phys.blocked; this.ground = phys.ground;
    this.cache = new Map();
    this.maxCache = 24;
    this.queue = new Int32Array(this.GW * this.GH);
  }
  reset() { this.cache.clear(); }
  idx(x, z) {
    const i = Math.max(0, Math.min(this.GW - 1, this.phys.gi(x)));
    const j = Math.max(0, Math.min(this.GH - 1, this.phys.gj(z)));
    return j * this.GW + i;
  }
  cx(k) { return this.phys.cellX(k % this.GW); }
  cz(k) { return this.phys.cellZ((k / this.GW) | 0); }
  _ok(a, b) { return !this.blocked[b] && Math.abs(this.ground[a] - this.ground[b]) <= ROBOT_STEP; }

  nearestFree(k, refY) {
    if (!this.blocked[k] && (refY === undefined || Math.abs(this.ground[k] - refY) < 0.5)) return k;
    const { GW, GH } = this, i0 = k % GW, j0 = (k / GW) | 0;
    for (let r = 1; r < 14; r++) {
      let best = -1, bd = 1e9;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
        const n = j * GW + i;
        if (this.blocked[n]) continue;
        const d = di * di + dj * dj + (refY === undefined ? 0 : Math.abs(this.ground[n] - refY) * 40);
        if (d < bd) { bd = d; best = n; }
      }
      if (best >= 0) return best;
    }
    return k;
  }

  field(target) {
    target = this.nearestFree(target);
    let f = this.cache.get(target);
    if (f) { this.cache.delete(target); this.cache.set(target, f); return f; }
    const { GW, GH } = this;
    f = new Uint16Array(GW * GH).fill(INF);
    const q = this.queue, last = GW * (GH - 1);
    let h = 0, t = 0;
    f[target] = 0; q[t++] = target;
    while (h < t) {
      const k = q[h++], d = f[k] + 1, i = k % GW;
      if (i > 0 && f[k - 1] === INF && this._ok(k, k - 1)) { f[k - 1] = d; q[t++] = k - 1; }
      if (i < GW - 1 && f[k + 1] === INF && this._ok(k, k + 1)) { f[k + 1] = d; q[t++] = k + 1; }
      if (k >= GW && f[k - GW] === INF && this._ok(k, k - GW)) { f[k - GW] = d; q[t++] = k - GW; }
      if (k < last && f[k + GW] === INF && this._ok(k, k + GW)) { f[k + GW] = d; q[t++] = k + GW; }
    }
    this.cache.set(target, f);
    if (this.cache.size > this.maxCache) this.cache.delete(this.cache.keys().next().value);
    return f;
  }
  fieldAt(x, z, y) { return this.field(this.nearestFree(this.idx(x, z), y)); }
  reachable(f, x, z, y) { return f[this.nearestFree(this.idx(x, z), y)] !== INF; }

  _step(k, f) {
    const { GW, GH } = this, i = k % GW, j = (k / GW) | 0;
    let best = -1, bv = f[k];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
      const n = nj * GW + ni;
      if (!this._ok(k, n)) continue;
      if (di && dj && (!this._ok(k, j * GW + ni) || !this._ok(k, nj * GW + i))) continue;
      if (f[n] < bv) { bv = f[n]; best = n; }
    }
    return best;
  }

  lineFree(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1, d = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(d / 0.2));
    let prev = this.idx(x1, z1);
    for (let s = 1; s <= n; s++) {
      const k = this.idx(x1 + (dx * s) / n, z1 + (dz * s) / n);
      if (k !== prev && !this._ok(prev, k)) return false;
      prev = k;
    }
    return true;
  }

  // 次に向かう地点。null なら目標セル内（直接向かってよい）か到達不能
  next(x, z, f, y) {
    let k = this.idx(x, z);
    if (this.blocked[k]) k = this.nearestFree(k, y);
    if (f[k] === INF || f[k] === 0) return null;
    let cur = k, pick = -1;
    for (let s = 0; s < 6; s++) {
      const n = this._step(cur, f);
      if (n < 0) break;
      cur = n;
      if (s === 0 || this.lineFree(x, z, this.cx(n), this.cz(n))) pick = n; else break;
      if (f[n] === 0) break;
    }
    return pick < 0 ? null : { x: this.cx(pick), z: this.cz(pick) };
  }

  randomFree(R, reach) {
    const n = this.GW * this.GH;
    for (let tries = 0; tries < 4000; tries++) {
      const k = Math.floor(R() * n);
      if (!this.blocked[k] && (!reach || reach[k] !== INF)) return { x: this.cx(k), z: this.cz(k), y: this.ground[k] };
    }
    return null;
  }
}
