// 当たり判定（バケット分割）と、視線/ナビ用グリッド
import { RX, RZ, GRID } from './config.js';

const B = 4;
const BW = Math.ceil((RX * 2) / B), BH = Math.ceil((RZ * 2) / B);
export const GW = Math.round((RX * 2) / GRID), GH = Math.round((RZ * 2) / GRID);
const WALL_IN = 0.1; // 外壁の内面までの厚み
const NAV_INFLATE = 0.36;

export class Physics {
  constructor() {
    this.list = [];
    this.buckets = Array.from({ length: BW * BH }, () => []);
    this.q = 0;
    this.height = new Float32Array(GW * GH); // 視線遮蔽用: セルを覆う障害物の最大高さ
    this.blocked = new Uint8Array(GW * GH);  // ナビ用: ロボット半径で膨張させた占有
  }

  _bucketRange(minX, minZ, maxX, maxZ) {
    const x0 = Math.max(0, Math.floor((minX + RX) / B)), x1 = Math.min(BW - 1, Math.floor((maxX + RX) / B));
    const z0 = Math.max(0, Math.floor((minZ + RZ) / B)), z1 = Math.min(BH - 1, Math.floor((maxZ + RZ) / B));
    return [x0, z0, x1, z1];
  }
  _insert(c) {
    const [x0, z0, x1, z1] = this._bucketRange(c.minX, c.minZ, c.maxX, c.maxZ);
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) this.buckets[j * BW + i].push(c);
    this.list.push(c);
    return c;
  }
  addBox(x, z, hw, hd, h) { return this._insert({ x, z, hw, hd, h, minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, q: 0 }); }
  addCircle(x, z, r, h) { return this._insert({ x, z, cr: r, h, minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, q: 0 }); }

  _each(minX, minZ, maxX, maxZ, fn) {
    const q = ++this.q;
    const [x0, z0, x1, z1] = this._bucketRange(minX, minZ, maxX, maxZ);
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      for (const c of this.buckets[j * BW + i]) {
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
    return !(x < -RX + WALL_IN + r || x > RX - WALL_IN - r || z < -RZ + WALL_IN + r || z > RZ - WALL_IN - r);
  }

  collide(x, z, r) {
    if (!this.inBounds(x, z, r)) return true;
    return this._each(x - r, z - r, x + r, z + r, (c) => Physics.hit(c, x, z, r));
  }

  // AABB が既存の障害物と重ならないか（配置用）
  boxFree(x, z, hw, hd) {
    if (x - hw < -RX + WALL_IN || x + hw > RX - WALL_IN || z - hd < -RZ + WALL_IN || z + hd > RZ - WALL_IN) return false;
    return !this._each(x - hw, z - hd, x + hw, z + hd, (c) =>
      c.minX < x + hw && c.maxX > x - hw && c.minZ < z + hd && c.maxZ > z - hd);
  }

  finalize() {
    const { height, blocked } = this;
    height.fill(0); blocked.fill(0);
    const half = GRID / 2;
    for (const c of this.list) {
      // 視線: セルの正方形が障害物と重なれば遮蔽（薄い壁を取りこぼさない）
      const i0 = Math.max(0, Math.floor((c.minX + RX) / GRID)), i1 = Math.min(GW - 1, Math.floor((c.maxX + RX) / GRID));
      const j0 = Math.max(0, Math.floor((c.minZ + RZ) / GRID)), j1 = Math.min(GH - 1, Math.floor((c.maxZ + RZ) / GRID));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (c.cr !== undefined) {
          const cx = -RX + (i + 0.5) * GRID, cz = -RZ + (j + 0.5) * GRID;
          const nx = Math.max(cx - half, Math.min(c.x, cx + half)), nz = Math.max(cz - half, Math.min(c.z, cz + half));
          if ((nx - c.x) ** 2 + (nz - c.z) ** 2 > c.cr * c.cr) continue;
        }
        const k = j * GW + i;
        if (c.h > height[k]) height[k] = c.h;
      }
      // ナビ: セル中心が膨張領域内なら通行不可
      const r = NAV_INFLATE;
      const a0 = Math.max(0, Math.floor((c.minX - r + RX) / GRID)), a1 = Math.min(GW - 1, Math.floor((c.maxX + r + RX) / GRID));
      const b0 = Math.max(0, Math.floor((c.minZ - r + RZ) / GRID)), b1 = Math.min(GH - 1, Math.floor((c.maxZ + r + RZ) / GRID));
      for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
        const cx = -RX + (i + 0.5) * GRID, cz = -RZ + (j + 0.5) * GRID;
        if (Physics.hit(c, cx, cz, r)) blocked[j * GW + i] = 1;
      }
    }
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const cx = -RX + (i + 0.5) * GRID, cz = -RZ + (j + 0.5) * GRID;
      if (!this.inBounds(cx, cz, NAV_INFLATE)) blocked[j * GW + i] = 1;
    }
  }

  heightAt(x, z) {
    const i = Math.floor((x + RX) / GRID), j = Math.floor((z + RZ) / GRID);
    if (i < 0 || j < 0 || i >= GW || j >= GH) return 99;
    return this.height[j * GW + i];
  }

  // 視線判定: 線分上に高さ thresh を超える障害物があれば遮られる。両端 0.35m は無視
  los(x1, z1, x2, z2, thresh) {
    const dx = x2 - x1, dz = z2 - z1, d = Math.hypot(dx, dz);
    if (d < 0.7) return true;
    const n = Math.ceil(d / 0.25);
    const s0 = Math.ceil((0.35 / d) * n), s1 = n - s0;
    for (let s = s0; s <= s1; s++) {
      const t = s / n;
      const i = Math.floor((x1 + dx * t + RX) / GRID), j = Math.floor((z1 + dz * t + RZ) / GRID);
      if (i < 0 || j < 0 || i >= GW || j >= GH) return false;
      if (this.height[j * GW + i] > thresh) return false;
    }
    return true;
  }
}
