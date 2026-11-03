// グリッド上のフローフィールド（目標セルからの BFS 距離）。目標ごとに LRU キャッシュ
import { RX, RZ, GRID } from './config.js';
import { GW, GH } from './physics.js';

export const INF = 65535;

export class Nav {
  constructor(phys) {
    this.blocked = phys.blocked;
    this.cache = new Map();
    this.maxCache = 24;
    this.queue = new Int32Array(GW * GH);
  }
  idx(x, z) {
    const i = Math.max(0, Math.min(GW - 1, Math.floor((x + RX) / GRID)));
    const j = Math.max(0, Math.min(GH - 1, Math.floor((z + RZ) / GRID)));
    return j * GW + i;
  }
  cx(k) { return -RX + ((k % GW) + 0.5) * GRID; }
  cz(k) { return -RZ + (((k / GW) | 0) + 0.5) * GRID; }

  nearestFree(k) {
    if (!this.blocked[k]) return k;
    const i0 = k % GW, j0 = (k / GW) | 0;
    for (let r = 1; r < 12; r++) {
      let best = -1, bd = 1e9;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
        const n = j * GW + i;
        if (this.blocked[n]) continue;
        const d = di * di + dj * dj;
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
    f = new Uint16Array(GW * GH).fill(INF);
    const q = this.queue, b = this.blocked, last = GW * (GH - 1);
    let h = 0, t = 0;
    f[target] = 0; q[t++] = target;
    while (h < t) {
      const k = q[h++], d = f[k] + 1, i = k % GW;
      if (i > 0 && !b[k - 1] && f[k - 1] === INF) { f[k - 1] = d; q[t++] = k - 1; }
      if (i < GW - 1 && !b[k + 1] && f[k + 1] === INF) { f[k + 1] = d; q[t++] = k + 1; }
      if (k >= GW && !b[k - GW] && f[k - GW] === INF) { f[k - GW] = d; q[t++] = k - GW; }
      if (k < last && !b[k + GW] && f[k + GW] === INF) { f[k + GW] = d; q[t++] = k + GW; }
    }
    this.cache.set(target, f);
    if (this.cache.size > this.maxCache) this.cache.delete(this.cache.keys().next().value);
    return f;
  }
  fieldAt(x, z) { return this.field(this.idx(x, z)); }

  reachable(f, x, z) { return f[this.nearestFree(this.idx(x, z))] !== INF; }

  _step(k, f) {
    const i = k % GW, j = (k / GW) | 0, b = this.blocked;
    let best = -1, bv = f[k];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
      const n = nj * GW + ni;
      if (b[n]) continue;
      if (di && dj && (b[j * GW + ni] || b[nj * GW + i])) continue;
      if (f[n] < bv) { bv = f[n]; best = n; }
    }
    return best;
  }

  lineFree(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1, d = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(d / 0.2));
    for (let s = 1; s <= n; s++) {
      if (this.blocked[this.idx(x1 + (dx * s) / n, z1 + (dz * s) / n)]) return false;
    }
    return true;
  }

  // 次に向かう地点。null なら目標セル内（直接向かってよい）か到達不能
  next(x, z, f) {
    let k = this.idx(x, z);
    if (this.blocked[k]) k = this.nearestFree(k);
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
    for (let tries = 0; tries < 4000; tries++) {
      const k = Math.floor(R() * GW * GH);
      if (!this.blocked[k] && (!reach || reach[k] !== INF)) return { x: this.cx(k), z: this.cz(k) };
    }
    return null;
  }
}
