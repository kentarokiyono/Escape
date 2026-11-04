// フリーモードのフロア自動生成
import * as THREE from 'three';
import { RX, RZ, FLOORS, ENTRY, EXIT_DOOR, KEY_POS, DOCK_XS, TOP_FLOOR } from './config.js';
import { mulberry32 } from './util.js';
import { Level, Builder, subtractRects, P, xform } from './level.js';
import { makePuzzle } from './puzzles.js';

const GRAFFITI = ['逃ゲロ', '帰レ', 'マダ営業中', '(o ω o)', '鍵ハ上', '見テル', '番号忘レルナ', 'オ席ヘ', '静カニ'];

class FreeLevel extends Level {
  constructor(n) {
    const cfg = FLOORS[n];
    super({ hx: RX, hz: RZ, wallH: cfg.wallH || 3, name: cfg.name, theme: cfg.theme, surface: cfg.theme === 'machine' ? 'concrete' : 'tile' });
    this.n = n; this.cfg = cfg;
    this.cols = cfg.cols; this.rows = cfg.rows;
    this.roomW = (RX * 2) / cfg.cols; this.roomH = (RZ * 2) / cfg.rows;
    this.reserved = new Set(); this.stairs = [];
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
  arrival(si, dir) {
    const s = this.stairs[si];
    return dir > 0 ? { x: s.x, z: s.z + 3.5, yaw: Math.PI } : { x: s.x, z: s.z - 3.5, yaw: 0 };
  }
}

// 階段・リフトのセル（試行ごとに変えない）
function pickCells(lv, ctx) {
  const n = lv.n;
  if (n === 1) lv.reserved.add(lv.cellOf(ENTRY.x, ENTRY.z));
  if (n === TOP_FLOOR) lv.reserved.add(lv.cellOf(KEY_POS.x, KEY_POS.z));
  const nearest = (w) => {
    let best = -1, bd = 1e9;
    for (let i = 0; i < lv.total; i++) {
      if (lv.reserved.has(i)) continue;
      const c = lv.cellCenter(i), d = Math.hypot(c.x - w.x, c.z - w.z);
      if (d < bd) { bd = d; best = i; }
    }
    lv.reserved.add(best);
    return best;
  };
  if (ctx.lift) lv.liftCell = nearest(ctx.lift);
  lv.stairCells = ctx.stairsWorld.map(nearest);
  lv.stairs = lv.stairCells.map((c) => lv.cellCenter(c));
}

export function buildFreeLevel(n, ctx) {
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
  const M = ctx.M, lv = new FreeLevel(n);
  const R = mulberry32((ctx.seed ^ Math.imul(n, 7919) ^ Math.imul(salt + 1, 104729)) >>> 0);
  const RH = mulberry32((ctx.seed ^ Math.imul(n, 31337)) >>> 0); // 穴は試行で変えない（上下階で一致させる）
  const b = new Builder(lv, M, R);
  const cfg = lv.cfg, { cols, rows, roomW, roomH } = lv, H = lv.wallH;
  pickCells(lv, ctx);
  lv.power = ctx.power;
  const keepOut = []; // 小物を置かない矩形
  const free = (x, z, hw, hd) => !keepOut.some((k) => x + hw > k.x0 && x - hw < k.x1 && z + hd > k.z0 && z - hd < k.z1);

  // ---------- 崩落穴 ----------
  const holes = [];
  if (n >= 2) {
    const k = 1 + Math.floor(RH() * 2);
    for (let t = 0; t < 40 && holes.length < k; t++) {
      const c = Math.floor(RH() * lv.total);
      if (lv.reserved.has(c)) continue;
      const cc = lv.cellCenter(c), w = 2.5 + RH() * 1.5, d = 2.5 + RH() * 1.5;
      const ax = roomW / 2 - w / 2 - 2.2, az = roomH / 2 - d / 2 - 2.2;
      if (ax < 0 || az < 0) continue;
      const x = cc.x + (RH() * 2 - 1) * ax, z = cc.z + (RH() * 2 - 1) * az;
      const h = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
      if (holes.some((o) => h.x0 < o.x1 + 3 && h.x1 > o.x0 - 3 && h.z0 < o.z1 + 3 && h.z1 > o.z0 - 3)) continue;
      holes.push(h);
    }
  }
  for (const h of holes) { b.hole(h.x0, h.z0, h.x1, h.z1); keepOut.push({ x0: h.x0 - 1, x1: h.x1 + 1, z0: h.z0 - 1, z1: h.z1 + 1 }); }
  lv.holes = holes;

  // ---------- 床・天井・外壁 ----------
  const floorMat = cfg.theme === 'machine' ? M.concrete : M.floor;
  b.floorRects(subtractRects({ x0: -RX, z0: -RZ, x1: RX, z1: RZ }, holes), 0, floorMat, cfg.theme === 'machine' ? 2 : M.floorScale);
  b.ceiling(H);
  b.outerWalls();
  lv.walls.push({ x: 0, z: -RZ + 0.1, w: RX * 2, d: 0, side: 1 }, { x: 0, z: RZ - 0.1, w: RX * 2, d: 0, side: -1 });

  // ---------- 部屋の接続（壁・扉・ダクト） ----------
  const edges = [];
  for (let r = 0; r < rows; r++) for (let c = 1; c < cols; c++) edges.push({ a: r * cols + c - 1, b: r * cols + c, vert: true, c, r, on: !cfg.maze });
  for (let r = 1; r < rows; r++) for (let c = 0; c < cols; c++) edges.push({ a: (r - 1) * cols + c, b: r * cols + c, vert: false, c, r, on: !cfg.maze });
  if (cfg.maze) {
    const seen = new Uint8Array(lv.total), stack = [lv.stairCells[0]];
    seen[stack[0]] = 1;
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const opts = edges.filter((e) => (e.a === cur || e.b === cur) && !seen[e.a === cur ? e.b : e.a]);
      if (!opts.length) { stack.pop(); continue; }
      const e = opts[Math.floor(R() * opts.length)];
      e.on = true;
      const nx = e.a === cur ? e.b : e.a;
      seen[nx] = 1; stack.push(nx);
    }
    for (const e of edges) if (!e.on && R() < 0.14) e.on = true;
  }
  let ductBudget = Math.round(lv.total * (cfg.maze ? 0.08 : 0.05)) + 1;
  lv.doorsList = [];
  for (const e of edges) {
    const open = e.on && R() < cfg.open;
    const vert = e.vert;
    const wpos = vert ? -RX + e.c * roomW : -RZ + e.r * roomH;
    const s0 = vert ? -RZ + e.r * roomH : -RX + e.c * roomW, len = vert ? roomH : roomW, s1 = s0 + len;
    const at = (s, t) => (vert ? [wpos, s, t] : [s, wpos, t]);
    if (open) { lv.doorsList.push({ a: e.a, b: e.b, x: vert ? wpos : (s0 + s1) / 2, z: vert ? (s0 + s1) / 2 : wpos, w: len, vert }); continue; }
    const seg = (a, c) => {
      if (c - a < 0.1) return;
      // 一部の壁にダクト（しゃがみ通路）を通す
      if (ductBudget > 0 && c - a > 3.5 && R() < 0.18) {
        ductBudget--;
        const m = a + 1.5 + R() * (c - a - 3);
        seg(a, m - 0.5); seg(m + 0.5, c);
        const [x, z] = at(m);
        b.lintel(x, z, vert ? 0.2 : 1.0, vert ? 1.0 : 0.2, 0.92);
        if (vert) b.duct(x - 0.7, z - 0.4, x + 0.7, z + 0.4, 'x'); else b.duct(x - 0.4, z - 0.7, x + 0.4, z + 0.7, 'z');
        keepOut.push({ x0: x - 2, x1: x + 2, z0: z - 2, z1: z + 2 });
        return;
      }
      const [x, z] = at((a + c) / 2);
      b.wall(x, z, vert ? 0.2 : c - a, vert ? c - a : 0.2);
    };
    if (!e.on) { seg(s0, s1); continue; }
    const gw = Math.min(cfg.door, len - 3), g = s0 + 1.5 + gw / 2 + R() * (len - 3 - gw);
    seg(s0, g - gw / 2); seg(g + gw / 2, s1);
    const [x, z] = at(g);
    b.lintel(x, z, vert ? 0.2 : gw, vert ? gw : 0.2, gw > 2.6 ? 2.6 : 2.25);
    lv.doorsList.push({ a: e.a, b: e.b, x, z, w: gw, vert });
  }
  const doorsOf = Array.from({ length: lv.total }, () => []);
  for (const d of lv.doorsList) { doorsOf[d.a].push(d); doorsOf[d.b].push(d); }
  const nearDoor = (cell, x, z, hw, hd, th = 1.3) => {
    for (const d of doorsOf[cell]) {
      const ex = d.vert ? 0 : d.w / 2, ez = d.vert ? d.w / 2 : 0;
      if (Math.hypot(Math.max(Math.abs(d.x - x) - hw - ex, 0), Math.max(Math.abs(d.z - z) - hd - ez, 0)) < th) return true;
    }
    return false;
  };
  const tryPlace = (cell, hw, hd, margin = 0.55, attempts = 14) => {
    const cc = lv.cellCenter(cell), ax = roomW / 2 - hw - 0.7, az = roomH / 2 - hd - 0.7;
    if (ax < 0 || az < 0) return null;
    for (let a = 0; a < attempts; a++) {
      const x = cc.x + (R() * 2 - 1) * ax, z = cc.z + (R() * 2 - 1) * az;
      if (nearDoor(cell, x, z, hw, hd) || !free(x, z, hw + margin, hd + margin)) continue;
      if (!lv.phys.boxFree(x, z, hw + margin, hd + margin)) continue;
      return { x, z };
    }
    return null;
  };
  const cells = [];
  for (let i = 0; i < lv.total; i++) if (!lv.reserved.has(i)) cells.push(i);

  // ---------- 1F 中二階 ----------
  if (n === 1) {
    const opts = [];
    for (let r = 0; r < rows; r++) if (!lv.reserved.has(r * cols)) opts.push(r);
    const r = opts[Math.floor(R() * opts.length)], z0 = -RZ + r * roomH + 1.2, z1 = -RZ + (r + 1) * roomH - 1.2;
    const x0 = -RX + 0.1, x1 = -RX + 6, MH = 2.6;
    b.platform(x0, z0, x1, z1, MH, { mat: M.concrete, scale: M.concreteScale });
    b.put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(x1 - x0, 0.04, z1 - z0), P((x0 + x1) / 2, (z0 + z1) / 2), 0, MH + 0.02, 0), false);
    const sz0 = z1 - 2.2, sz1 = z1 - 0.8; // 階段（人のみ）
    b.ramp(x1, sz0, x1 + 4.4, sz1, 'x', MH, 0, true);
    b.railing(x1 - 0.05, z0, x1 - 0.05, sz0, MH);
    b.railing(x0, z0 + 0.05, x1, z0 + 0.05, MH);
    b.railing(x0, z1 - 0.05, x1, z1 - 0.05, MH);
    keepOut.push({ x0: x0 - 1, x1: x1 + 6, z0: z0 - 1.2, z1: z1 + 1.2 });
    b.tableRect((x0 + x1) / 2 + 0.5, (z0 + z1) / 2 - 2, { y: MH, rot: true, tablet: false });
    b.locker(x0 + 0.53, z0 + 1.5, 1, 0, MH);
    b.camera(x1 - 0.3, H, (z0 + z1) / 2 + 3, Math.PI / 2, { pitch: -0.55 });
    lv.mezz = { x0, z0, x1, z1, h: MH };
  }

  // ---------- 小上がり / 厨房の台 / ステージ ----------
  for (const cell of cells) {
    const roll = R();
    if ((cfg.theme === 'hall' || cfg.theme === 'private') && roll < 0.12) {
      const w = 4 + R() * 2, d = 3 + R(), q = tryPlace(cell, w / 2, d / 2, 0.8);
      if (!q) continue;
      b.platform(q.x - w / 2, q.z - d / 2, q.x + w / 2, q.z + d / 2, 0.35);
      b.lowTable(q.x - w / 4, q.z, { y: 0.35, rot: true });
      if (w > 5) b.lowTable(q.x + w / 4, q.z, { y: 0.35, rot: true });
      keepOut.push({ x0: q.x - w / 2 - 0.8, x1: q.x + w / 2 + 0.8, z0: q.z - d / 2 - 0.8, z1: q.z + d / 2 + 0.8 });
    } else if (cfg.theme === 'kitchen' && roll < 0.14) {
      const w = 4.5, d = 3.5, q = tryPlace(cell, w / 2 + 1.1, d / 2, 0.8);
      if (!q) continue;
      const x0 = q.x - w / 2, x1 = q.x + w / 2, z0 = q.z - d / 2, z1 = q.z + d / 2;
      b.platform(x0, z0, x1, z1, 0.45, { mat: M.steel, scale: M.steelScale });
      b.ramp(x1, z0 + 0.8, x1 + 2.0, z1 - 0.8, 'x', 0.45, 0); // ワゴン用スロープ
      b.counter(q.x - 0.5, z0 + 0.6, { y: 0.45, w: 3 });
      keepOut.push({ x0: x0 - 0.8, x1: x1 + 2.8, z0: z0 - 0.8, z1: z1 + 0.8 });
    } else if (cfg.theme === 'banquet' && roll < 0.1) {
      const w = 5, d = 3, q = tryPlace(cell, w / 2, d / 2 + 1.4, 0.6);
      if (!q) continue;
      b.platform(q.x - w / 2, q.z - d / 2, q.x + w / 2, q.z + d / 2, 0.6, { mat: M.wood });
      b.ramp(q.x - 0.7, q.z + d / 2, q.x + 0.7, q.z + d / 2 + 1.2, 'z', 0.6, 0, true);
      keepOut.push({ x0: q.x - w / 2 - 0.8, x1: q.x + w / 2 + 0.8, z0: q.z - d / 2 - 0.8, z1: q.z + d / 2 + 2 });
    }
  }

  // ---------- 階段室 ----------
  lv.stairs.forEach((s, si) => {
    b.box(M.concrete, M.concreteScale, s.x, H / 2, s.z, 3.2, H, 3.2);
    lv.phys.addBox(s.x, s.z, 1.6, 1.6, H);
    const face = (dir) => {
      const sz = dir > 0 ? -1 : 1, ry = sz < 0 ? Math.PI : 0;
      const pad = { x: s.x, z: s.z + sz * 2.3, dir, si };
      if (dir > 0 && (ctx.lock === 'power' || ctx.lock === 'card')) {
        pad.door = b.door(s.x, s.z + sz * 1.66, 'x', 1.3, { type: ctx.lock === 'power' ? 'shutter' : 'card', noInteract: true });
        pad.door.power = ctx.lock === 'power';
        if (pad.door.power && ctx.power) { pad.door.open = true; pad.door.t = 1; pad.door.col.on = false; }
      } else b.put(M.metal, 0, xform(new THREE.PlaneGeometry(1.2, 2.1), P(s.x, s.z + sz * 1.605, ry), 0, 1.05, 0));
      b.sign(dir > 0 ? '↑ ' + (n + 1) + 'F' : '↓ ' + (n - 1) + 'F', dir > 0 ? '#06200f' : '#241004', dir > 0 ? '#5dff8a' : '#ffae5d', s.x, 2.45, s.z + sz * 1.61, ry);
      b.put(dir > 0 ? M.padUp : M.padDown, 0, xform(new THREE.PlaneGeometry(1.4, 0.9), P(s.x, s.z + sz * 2.3), 0, 0.008, 0, -Math.PI / 2), false);
      lv.pads.push(pad);
    };
    if (n < TOP_FLOOR) face(1);
    if (n > 1) face(-1);
  });
  // カードキー式・シャッター式の扉は階段室の判定に任せる
  lv.interacts = lv.interacts.filter((it) => !(it.door && lv.pads.some((p) => p.door === it.door)));

  // ---------- 配膳リフト ----------
  if (ctx.lift) {
    const c = lv.cellCenter(lv.liftCell);
    b.lift(c.x, c.z + 1.2, 0, { id: 'lift', dir: ctx.lift.dir });
    keepOut.push({ x0: c.x - 2.5, x1: c.x + 2.5, z0: c.z - 2.5, z1: c.z + 3.5 });
  }

  // ---------- ロッカー ----------
  const shuffled = cells.slice().sort(() => R() - 0.5);
  const lockerTarget = Math.max(5, Math.ceil(cells.length * 0.22));
  for (const cell of shuffled) {
    if (lv.lockers.length >= lockerTarget) break;
    const cc = lv.cellCenter(cell);
    const sx = R() < 0.5 ? -1 : 1, sz = R() < 0.5 ? -1 : 1;
    const ex = cc.x + sx * roomW / 2, ez = cc.z + sz * roomH / 2;
    const alongX = R() < 0.5, count = R() < 0.4 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      let x, z, fx, fz;
      if (alongX) { x = ex - sx * 0.53; z = ez - sz * (0.95 + k * 0.82); fx = -sx; fz = 0; }
      else { z = ez - sz * 0.53; x = ex - sx * (0.95 + k * 0.82); fx = 0; fz = -sz; }
      if (nearDoor(cell, x, z, 0.4, 0.4, 0.5) || nearDoor(cell, x + fx * 0.9, z + fz * 0.9, 0.3, 0.3, 0.3)) break;
      if (!free(x, z, 0.4, 0.4) || !lv.phys.boxFree(x, z, 0.39, 0.39) || !lv.phys.boxFree(x + fx * 0.9, z + fz * 0.9, 0.35, 0.35)) break;
      b.locker(x, z, fx, fz);
    }
  }

  // ---------- 配電盤・監視カメラ ----------
  for (let t = 0; t < 60; t++) {
    const west = R() < 0.5, cell = Math.floor(R() * rows) * cols + (west ? 0 : cols - 1);
    if (lv.reserved.has(cell)) continue;
    const cc = lv.cellCenter(cell), x = west ? -RX + 0.65 : RX - 0.65, z = cc.z + (R() - 0.5) * (roomH - 4);
    if (!free(x, z, 0.6, 0.6) || !lv.phys.boxFree(x, z, 0.5, 0.5)) continue;
    lv.breaker = b.breaker(x, z, west ? Math.PI / 2 : -Math.PI / 2);
    keepOut.push({ x0: x - 1.4, x1: x + 1.4, z0: z - 1.4, z1: z + 1.4 });
    break;
  }
  const nCam = 2 + Math.floor(R() * 3);
  for (let i = 0; i < nCam; i++) {
    const cell = cells[Math.floor(R() * cells.length)], cc = lv.cellCenter(cell);
    const sx = R() < 0.5 ? -1 : 1, sz = R() < 0.5 ? -1 : 1;
    const x = cc.x + sx * (roomW / 2 - 0.4), z = cc.z + sz * (roomH / 2 - 0.4);
    b.camera(x, H, z, Math.atan2(cc.x - x, cc.z - z), { name: 'CAM' + (i + 1) });
  }

  // ---------- 小物 ----------
  for (const cell of cells) {
    const r = R();
    const place = (fn, hw, hd, o = {}) => { const q = tryPlace(cell, hw, hd); if (q) fn.call(b, q.x, q.z, o); return q; };
    switch (cfg.theme) {
      case 'hall':
        if (r < 0.5) {
          const rot = R() < 0.5; place(b.tableRect, rot ? 0.55 : 0.9, rot ? 0.9 : 0.55, { rot, fallen: R() < 0.22 });
          if (R() < 0.6) { const r2 = R() < 0.5; place(b.tableRect, r2 ? 0.55 : 0.9, r2 ? 0.9 : 0.55, { rot: r2 }); }
          if (R() < 0.5) place(b.tableRound, 0.8, 0.8);
        } else if (r < 0.7) { const rot = R() < 0.5; place(b.booth, rot ? 0.85 : 1.45, rot ? 1.45 : 0.85, { rot }); }
        else if (r < 0.82) place(b.debris, 0.8, 0.8);
        break;
      case 'private':
        if (r < 0.62) { const rot = R() < 0.5; place(b.booth, rot ? 0.85 : 1.45, rot ? 1.45 : 0.85, { rot }); }
        else if (r < 0.76) { const rot = R() < 0.5; place(b.tableRect, rot ? 0.55 : 0.9, rot ? 0.9 : 0.55, { rot }); }
        else if (r < 0.88) place(b.debris, 0.8, 0.8);
        break;
      case 'banquet':
        if (r < 0.5) { const rot = R() < 0.5, w = 2.6 + R() * 1.2; place(b.longTable, rot ? 1.0 : w / 2, rot ? w / 2 : 1.0, { rot, w }); }
        else if (r < 0.72) place(b.debris, 0.8, 0.8, { tall: true });
        else if (r < 0.82) place(b.tableRound, 0.8, 0.8);
        break;
      case 'kitchen': {
        const rot = R() < 0.5, w = 2.4 + R() * 1.4;
        if (r < 0.6) place(b.counter, rot ? 0.4 : w / 2, rot ? w / 2 : 0.4, { rot, w, tablet: R() < 0.5 });
        if (R() < 0.5) { const r2 = R() < 0.5; place(b.shelf, r2 ? 0.25 : 0.8, r2 ? 0.8 : 0.25, { rot: r2 }); }
        if (R() < 0.2) place(b.debris, 0.8, 0.8);
        break;
      }
      case 'machine': {
        const k = 3 + Math.floor(R() * 4);
        for (let i = 0; i < k; i++) {
          const rot = R() < 0.5, q = tryPlace(cell, rot ? 0.4 : 0.6, rot ? 0.6 : 0.4, 0.7);
          if (q) { b.cabinet(q.x, q.z, { rot }); if (R() < 0.35) lv.tablets.push({ x: q.x, z: q.z, y: 0, reach: 1.5, name: '制御端末' + (b.tno++) }); }
        }
        if (R() < 0.6) { const q = tryPlace(cell, 0.2, 0.2, 0.4); if (q) b.pipeV(q.x, q.z); }
        if (R() < 0.4) place(b.debris, 0.8, 0.8, { tall: true });
        break;
      }
    }
    const cc = lv.cellCenter(cell);
    b.smallDebris(cc.x - roomW / 2 + 0.8, cc.z - roomH / 2 + 0.8, cc.x + roomW / 2 - 0.8, cc.z + roomH / 2 - 0.8, 2 + Math.floor(R() * 5));
  }

  // ---------- 水たまり ----------
  const nP = 8 + Math.floor(R() * 6);
  for (let i = 0; i < nP; i++) {
    const x = -RX + 2 + R() * (RX * 2 - 4), z = -RZ + 2 + R() * (RZ * 2 - 4);
    if (lv.groundAt(x, z) !== 0) continue;
    b.puddle(x, z, 0.6 + R() * 1.4, 0.6 + R() * 0.8);
  }

  // ---------- 天井設備 ----------
  for (let i = 0; i < lv.total; i++) {
    const cc = lv.cellCenter(i), k = Math.max(1, Math.round((roomW * roomH) / 70));
    for (let j = 0; j < k; j++) {
      const x = cc.x + (R() * 2 - 1) * (roomW / 2 - 1.2), z = cc.z + (R() * 2 - 1) * (roomH / 2 - 1.2);
      b.fixture(x, z, !lv.reserved.has(i) && R() < 0.3);
    }
  }
  for (let z = -RZ + 10; z < RZ; z += 20) b.put(M.metal, 0, xform(new THREE.CylinderGeometry(0.06, 0.06, RX * 2, 10), P(0, z), 0, H - 0.18, 0, 0, 0, Math.PI / 2));
  for (let x = -RX + 6; x < RX; x += 26) b.put(M.metal, 0, xform(new THREE.CylinderGeometry(0.09, 0.09, RZ * 2, 10), P(x, 0), 0, H - 0.3, 0, Math.PI / 2));

  // ---------- 落書き ----------
  const gN = 3 + Math.floor(R() * 4);
  for (let i = 0; i < gN; i++) {
    const w = lv.walls[Math.floor(R() * lv.walls.length)];
    const horiz = w.w >= w.d, len = Math.max(w.w, w.d);
    if (len < 4) continue;
    const t = (R() - 0.5) * (len - 4), side = w.side || (R() < 0.5 ? 1 : -1), txt = GRAFFITI[Math.floor(R() * GRAFFITI.length)];
    if (horiz) b.graffiti(txt, w.x + t, 1.7, w.z + side * (w.side ? 0.012 : 0.112), side > 0 ? 0 : Math.PI);
    else b.graffiti(txt, w.x + side * 0.112, 1.7, w.z + t, side > 0 ? Math.PI / 2 : -Math.PI / 2);
  }

  // ---------- 1F 脱出口 / 5F マスターキー・ドック ----------
  if (n === 1) b.exitDoor(EXIT_DOOR.x, RZ - 1.0, Math.PI, ctx.hasKey);
  if (n === TOP_FLOOR) {
    b.box(M.wood, M.woodScale, KEY_POS.x, 0.76, KEY_POS.z, 1.4, 0.05, 0.7);
    b.box(M.metal, M.metalScale, KEY_POS.x, 0.37, KEY_POS.z, 1.3, 0.72, 0.6);
    lv.phys.addBox(KEY_POS.x, KEY_POS.z, 0.7, 0.35, 0.8);
    if (!ctx.hasKey) { lv.key = b.item(KEY_POS.x, KEY_POS.z, 0, { look: 'key', id: 'master', name: 'マスターキー' }); lv.key.r = 1.6; }
    for (const x of DOCK_XS) {
      const z = -RZ + 2.2;
      if (lv.stairCells.includes(lv.cellOf(x, z)) || Math.abs(x - KEY_POS.x) < 3) continue;
      b.box(M.dark, 0, x, 0.03, z, 1, 0.06, 1);
      b.box(M.ledBlue, 0, x, 0.065, z + 0.48, 0.9, 0.012, 0.03, 0, false);
      lv.docks.push({ x, z: z + 0.2 });
    }
  }

  // ---------- 確定・検証 ----------
  lv.reachFrom = lv.pads[0];
  lv.finalize();
  const reach = lv.reach;
  const ok = (pt) => !lv.phys.collide(pt.x, pt.z, 0.3) && lv.nav.reachable(reach, pt.x, pt.z, 0);
  const need = lv.pads.map((p) => ({ x: p.x, z: p.z }));
  if (n === 1) need.push(ENTRY, { x: lv.exit.x, z: lv.exit.z });
  if (n === TOP_FLOOR) need.push({ x: KEY_POS.x, z: KEY_POS.z + 1.2 });
  if (lv.breaker) need.push(lv.breaker); else { lv.valid = false; lv.why = 'breaker'; }
  for (const l of lv.lifts) need.push(l);
  lv.stairs.forEach((_, si) => { if (n < TOP_FLOOR) need.push(lv.arrival(si, -1)); if (n > 1) need.push(lv.arrival(si, 1)); });
  for (const pt of need) if (!ok(pt)) { lv.valid = false; lv.why = 'unreachable ' + pt.x.toFixed(1) + ',' + pt.z.toFixed(1); break; }
  lv.lockers = lv.lockers.filter((l) => ok(l.exit));
  lv.tablets = lv.tablets.filter((t) => lv.nav.reachable(reach, t.x, t.z, t.y));
  if (lv.lockers.length < 3) { lv.valid = false; lv.why = 'lockers ' + lv.lockers.length; }

  // ---------- 暗証番号メモ / カードキー ----------
  const spotFor = (count, minSep) => {
    const spots = [];
    for (let tries = 0; tries < 400 && spots.length < count; tries++) {
      const cell = cells[Math.floor(R() * cells.length)];
      if (spots.length) {
        const a = spots[0].cell;
        if (Math.abs((a % cols) - (cell % cols)) + Math.abs(Math.floor(a / cols) - Math.floor(cell / cols)) < minSep) continue;
      }
      const cc = lv.cellCenter(cell);
      const x = cc.x + (R() * 2 - 1) * (roomW / 2 - 1.2), z = cc.z + (R() * 2 - 1) * (roomH / 2 - 1.2);
      if (lv.groundAt(x, z) !== 0 || lv.phys.collide(x, z, 0.5) || !lv.nav.reachable(reach, x, z, 0)) continue;
      spots.push({ cell, x, z });
    }
    return spots;
  };
  if (ctx.lock === 'code') {
    const spots = spotFor(2, Math.max(3, Math.floor(rows / 3)));
    if (spots.length < 2) { lv.valid = false; lv.why = 'memo'; }
    lv.puzzle = makePuzzle(ctx.codes[n], n, mulberry32((ctx.seed ^ Math.imul(n, 977)) >>> 0));
    for (const s of spots) b.memo(lv.puzzle, s.x, s.z);
  } else if (ctx.lock === 'card' && !ctx.hasCard) {
    const spots = spotFor(1, 0);
    if (!spots.length) { lv.valid = false; lv.why = 'card'; }
    for (const s of spots) lv.card = b.item(s.x, s.z, 0, { look: 'card', id: 'card' + n, name: 'カードキー（' + n + 'F 階段）' });
  }

  // ---------- 装備・資料・充電ドック ----------
  const taken = ctx.taken || new Set();
  const gearAt = (id, o) => {
    if (taken.has(id)) return;
    const sp = spotFor(1, 0)[0];
    if (sp) b.item(sp.x, sp.z, 0, { ...o, id });
  };
  if (n === 1 && !taken.has('remote')) {
    // リモコンは 1F の開始地点の近く
    for (let t = 0; t < 200; t++) {
      const x = ENTRY.x + (R() * 2 - 1) * 9, z = ENTRY.z - 1 - R() * 9;
      if (lv.groundAt(x, z) !== 0 || lv.phys.collide(x, z, 0.5) || !lv.nav.reachable(reach, x, z, 0)) continue;
      b.item(x, z, 0, { look: 'remote', gear: 'remote', id: 'remote', name: '停止リモコン' });
      break;
    }
  }
  for (let k = 0; k < 2; k++) gearAt('f' + n + ':b' + k, { look: 'cell', gear: 'cell', name: '電池' });
  for (let k = 0; k < 3; k++) gearAt('f' + n + ':g' + k, { look: 'plate', gear: 'throw', name: R() < 0.5 ? '割れていない皿' : '空き缶' });
  if (n <= 3) gearAt('f' + n + ':q', { look: 'doc', gear: 'doc', docType: ['vision', 'hearing', 'battery'][n - 1], name: 'FR-002 技術資料' });
  if (ctx.note != null) gearAt('f' + n + ':n', { look: 'paper', gear: 'note', note: ctx.note, name: '古いメモ' });
  for (let k = 0; k < (n === TOP_FLOOR ? 1 : 3); k++) {
    const sp = spotFor(1, 0)[0];
    if (sp && lv.phys.boxFree(sp.x, sp.z, 0.6, 0.7)) { b.charger(sp.x, sp.z, 0); lv.phys.addBox(sp.x, sp.z - 0.5, 0.3, 0.1, 0.6); }
  }

  b.finish();
  return lv;
}
