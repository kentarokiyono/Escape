// 文字マップ（1文字 = 1m）からフロアを組み立てる
import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { Level, Builder, P, xform } from './level.js';

export const STRUCT = { '.': 0, '_': 0.35, '+': 0.6, '=': 2.6, ',': -0.4 };
const SLOPES = { '^': ['z', -1, true], 'v': ['z', 1, true], '<': ['x', -1, true], '>': ['x', 1, true], 'A': ['z', -1, false], 'V': ['z', 1, false], '{': ['x', -1, false], '}': ['x', 1, false] };
const FURN = 'TtRBZCHMXQLm';
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function hashStr(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

// 同じ文字の連結成分を矩形で返す
function components(G, test) {
  const H = G.length, W = G[0].length, seen = new Uint8Array(W * H), out = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const ch = G[r][c];
    if (seen[r * W + c] || !test(ch)) continue;
    const q = [[c, r]], cells = []; seen[r * W + c] = 1;
    while (q.length) {
      const [x, y] = q.pop(); cells.push([x, y]);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx] || G[ny][nx] !== ch) continue;
        seen[ny * W + nx] = 1; q.push([nx, ny]);
      }
    }
    let c0 = 99, c1 = -1, r0 = 99, r1 = -1;
    for (const [x, y] of cells) { c0 = Math.min(c0, x); c1 = Math.max(c1, x); r0 = Math.min(r0, y); r1 = Math.max(r1, y); }
    out.push({ ch, c0, c1, r0, r1, cells });
  }
  return out;
}
// 条件を満たすセルを矩形にまとめる（行ランを縦に結合）
function rects(G, test) {
  const H = G.length, W = G[0].length, out = [];
  let open = new Map();
  for (let r = 0; r <= H; r++) {
    const runs = [];
    if (r < H) {
      let s = -1;
      for (let c = 0; c <= W; c++) {
        const ok = c < W && test(c, r);
        if (ok && s < 0) s = c;
        if (!ok && s >= 0) { runs.push([s, c - 1]); s = -1; }
      }
    }
    const next = new Map();
    for (const [a, b] of runs) {
      const k = a + ',' + b;
      if (open.has(k)) { next.set(k, open.get(k)); open.delete(k); } else next.set(k, { c0: a, c1: b, r0: r });
    }
    for (const v of open.values()) out.push({ ...v, r1: r - 1 });
    open = next;
  }
  return out;
}

export function parseHeights(G) {
  const H = G.length, W = G[0].length;
  const h = Array.from({ length: H }, () => new Array(W).fill(null));
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const ch = G[r][c];
    if (ch in STRUCT) h[r][c] = STRUCT[ch];
    else if (ch === 'O') h[r][c] = -20;
  }
  const slopes = components(G, (ch) => ch in SLOPES).map((s) => {
    const [axis, dir, stairs] = SLOPES[s.ch];
    const at = (c, r) => (r >= 0 && r < H && c >= 0 && c < W && h[r][c] !== null && h[r][c] > -10 ? h[r][c] : 0);
    let hiEnd, loEnd;
    if (axis === 'z') { hiEnd = dir < 0 ? at(s.c0, s.r0 - 1) : at(s.c0, s.r1 + 1); loEnd = dir < 0 ? at(s.c0, s.r1 + 1) : at(s.c0, s.r0 - 1); }
    else { hiEnd = dir < 0 ? at(s.c0 - 1, s.r0) : at(s.c1 + 1, s.r0); loEnd = dir < 0 ? at(s.c1 + 1, s.r0) : at(s.c0 - 1, s.r0); }
    const n = axis === 'z' ? s.r1 - s.r0 + 1 : s.c1 - s.c0 + 1;
    for (const [c, r] of s.cells) {
      const t = axis === 'z' ? (r - s.r0 + 0.5) / n : (c - s.c0 + 0.5) / n; // min 側からの比率
      const hMin = dir < 0 ? hiEnd : loEnd, hMax = dir < 0 ? loEnd : hiEnd;
      h[r][c] = hMin + (hMax - hMin) * t;
    }
    return { ...s, axis, dir, stairs, h0: dir < 0 ? hiEnd : loEnd, h1: dir < 0 ? loEnd : hiEnd };
  });
  // 家具・印などは周囲の床の高さに合わせる
  for (let pass = 0; pass < 6; pass++) {
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (h[r][c] !== null || G[r][c] === '#') continue;
      const cnt = new Map();
      for (const [dx, dy] of DIRS) {
        const v = h[r + dy]?.[c + dx];
        if (v === null || v === undefined || v < -10 || G[r + dy][c + dx] in SLOPES) continue;
        cnt.set(v, (cnt.get(v) || 0) + 1);
      }
      let best = null, bc = 0;
      for (const [v, k] of cnt) if (k > bc) { bc = k; best = v; }
      if (best !== null) h[r][c] = best;
    }
  }
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (h[r][c] === null && G[r][c] !== '#') h[r][c] = 0;
  return { h, slopes };
}

// st: マップの保存状態 { taken:Set, doors:Set, power } / opts: { mode:'story'|'robot' }
export function buildMapLevel(id, def, M, st, opts = {}) {
  const G = def.grid, H = G.length, W = G[0].length, hx = W / 2, hz = H / 2;
  const lv = new Level({ hx, hz, wallH: def.wallH || 3, name: def.name, theme: def.theme, surface: def.theme === 'machine' ? 'concrete' : 'tile', gridOff: 0.25 });
  lv.mapId = id; lv.def = def; lv.triggers = []; lv.ups = []; lv.diaries = []; lv.keySpots = []; lv.npcSpawns = [];
  const R = mulberry32(hashStr(id));
  const b = new Builder(lv, M, R);
  const X = (c) => -hx + c + 0.5, Z = (r) => -hz + r + 0.5;
  const g = (c, r) => (r >= 0 && r < H && c >= 0 && c < W ? G[r][c] : '#');
  const { h, slopes } = parseHeights(G);
  lv.tileH = h; lv.grid = G;
  const WH = lv.wallH;
  lv.power = st.power ?? def.power ?? true;
  const wallDir = (c, r) => { for (const [dx, dy] of DIRS) if (g(c + dx, r + dy) === '#') return [dx, dy]; return null; };
  const awayRy = (c, r) => { const d = wallDir(c, r); return d ? Math.atan2(-d[0], -d[1]) : 0; };

  // ---------- 床 ----------
  const isFloorAt = (y) => (c, r) => g(c, r) !== '#' && !(g(c, r) in SLOPES) && g(c, r) !== 'O' && Math.abs(h[r][c] - y) < 0.01 && !'_+='.includes(g(c, r));
  b.floorRects(rects(G, isFloorAt(0)).map((q) => ({ x0: -hx + q.c0, x1: -hx + q.c1 + 1, z0: -hz + q.r0, z1: -hz + q.r1 + 1 })), 0, def.theme === 'machine' ? M.concrete : M.floor, def.theme === 'machine' ? 2 : M.floorScale);
  // 一段低い床（洗い場）
  const sunk = rects(G, (c, r) => g(c, r) !== '#' && Math.abs(h[r][c] + 0.4) < 0.01 && !(g(c, r) in SLOPES));
  for (const q of sunk) lv.phys.addRegion({ kind: 'plat', x0: -hx + q.c0, x1: -hx + q.c1 + 1, z0: -hz + q.r0, z1: -hz + q.r1 + 1, h: -0.4 });
  b.floorRects(sunk.map((q) => ({ x0: -hx + q.c0, x1: -hx + q.c1 + 1, z0: -hz + q.r0, z1: -hz + q.r1 + 1 })), -0.4, M.steel, M.steelScale);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (Math.abs(h[r][c] + 0.4) > 0.01 || g(c, r) in SLOPES) continue;
    for (const [dx, dy] of DIRS) {
      const n = h[r + dy]?.[c + dx];
      if (n === undefined || n <= -0.39 || g(c + dx, r + dy) in SLOPES) continue;
      const top = Math.min(n, 0);
      b.box(M.concrete, 0, X(c) + dx * 0.48, (top - 0.4) / 2, Z(r) + dy * 0.48, dx ? 0.04 : 1, top + 0.4, dy ? 0.04 : 1, 0, false);
    }
  }

  // ---------- 壁・台・穴・スロープ ----------
  for (const q of rects(G, (c, r) => g(c, r) === '#')) {
    const w = q.c1 - q.c0 + 1, d = q.r1 - q.r0 + 1;
    b.wall(-hx + q.c0 + w / 2, -hz + q.r0 + d / 2, w, d);
  }
  for (const [ch, mat, scale] of [['_', M.wood, M.woodScale], ['+', M.wood, M.woodScale], ['=', M.concrete, M.concreteScale]]) {
    for (const q of rects(G, (c, r) => g(c, r) === ch || (Math.abs(h[r][c] - STRUCT[ch]) < 0.01 && !(g(c, r) in SLOPES) && !'#.'.includes(g(c, r)) && !(g(c, r) in STRUCT)))) {
      const x0 = -hx + q.c0, x1 = -hx + q.c1 + 1, z0 = -hz + q.r0, z1 = -hz + q.r1 + 1;
      b.platform(x0, z0, x1, z1, STRUCT[ch], { mat, scale });
      if (ch === '=') b.put(M.wood, M.woodScale, xform(new THREE.BoxGeometry(x1 - x0, 0.04, z1 - z0), P((x0 + x1) / 2, (z0 + z1) / 2), 0, STRUCT[ch] + 0.02, 0), false);
    }
  }
  // 中二階の手すり
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (h[r][c] < 2 || g(c, r) === '#' || g(c, r) in SLOPES) continue;
    for (const [dx, dy] of DIRS) {
      const n = g(c + dx, r + dy);
      if (n === '#' || n in SLOPES || h[r + dy][c + dx] > 1.5) continue;
      const x = X(c) + dx * 0.47, z = Z(r) + dy * 0.47;
      if (dx) b.railing(x, z - 0.5, x, z + 0.5, h[r][c]); else b.railing(x - 0.5, z, x + 0.5, z, h[r][c]);
    }
  }
  for (const q of rects(G, (c, r) => g(c, r) === 'O')) b.hole(-hx + q.c0, -hz + q.r0, -hx + q.c1 + 1, -hz + q.r1 + 1);
  for (const s of slopes) b.ramp(-hx + s.c0, -hz + s.r0, -hx + s.c1 + 1, -hz + s.r1 + 1, s.axis, s.h0, s.h1, s.stairs);
  b.ceiling(WH);

  // ---------- 扉・ダクト ----------
  const lintelAt = (c, r) => { const y0 = h[r][c] + 2.25; if (WH > y0 + 0.05) b.lintel(X(c), Z(r), 1, 1, y0); };
  for (const comp of components(G, (ch) => ch === 'D' || ch === 'K' || ch === 'S')) {
    for (const [c, r] of comp.cells) lintelAt(c, r);
    if (comp.ch === 'D') continue;
    const horiz = g(comp.c0 - 1, comp.r0) === '#' || comp.c1 > comp.c0; // 左右が壁 → x 方向に広がる扉
    const n = horiz ? comp.c1 - comp.c0 + 1 : comp.r1 - comp.r0 + 1;
    const cx = (X(comp.c0) + X(comp.c1)) / 2, cz = (Z(comp.r0) + Z(comp.r1)) / 2;
    const conf = (def.doors || {})[comp.c0 + ',' + comp.r0] || {};
    const d = b.door(cx, cz, horiz ? 'x' : 'z', n, { type: comp.ch === 'K' ? 'card' : 'shutter', id: conf.id || (comp.ch === 'S' ? 'shutter' : 'door'), label: conf.label, y: h[comp.r0][comp.c0] });
    Object.assign(d, { need: conf.need || null, thumb: conf.thumb || null, locked: !!conf.locked });
    if (comp.ch === 'S') d.power = true;
    if ((st.doors && st.doors.has(d.id)) || (d.power && lv.power) || opts.mode === 'robot') { d.open = true; d.t = 1; d.col.on = false; d.mesh.visible = false; }
  }
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (g(c, r) !== 'd') continue;
    const x0 = -hx + c, z0 = -hz + r;
    const alongX = 'd'.includes(g(c - 1, r)) || 'd'.includes(g(c + 1, r)) || (g(c, r - 1) === '#' && g(c, r + 1) === '#');
    b.box(M.metal, M.metalScale, X(c), 0.86, Z(r), 1, 0.12, 1);
    b.put(M.dark, 0, xform(new THREE.PlaneGeometry(1, 1), P(X(c), Z(r)), 0, 0.01, 0, -Math.PI / 2), false);
    lv.phys.addBox(X(c), Z(r), 0.5, 0.5, 0.92, { mask: 'stand' });
    const sides = alongX ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
    let walled = 0;
    for (const [dx, dy] of sides) {
      const n = g(c + dx, r + dy);
      if (n === '#') { walled++; continue; }
      if (n === 'd') continue;
      b.box(M.metal, M.metalScale, X(c) + dx * 0.45, 0.4, Z(r) + dy * 0.45, dx ? 0.1 : 1, 0.8, dy ? 0.1 : 1);
      lv.phys.addBox(X(c) + dx * 0.45, Z(r) + dy * 0.45, dx ? 0.05 : 0.5, dy ? 0.05 : 0.5, 0.92);
    }
    if (walled === 2) b.wall(X(c), Z(r), 1, 1, { h: WH - 0.92, y0: 0.92, collide: false, record: false });
  }

  // ---------- 家具 ----------
  for (const comp of components(G, (ch) => FURN.includes(ch))) {
    const w = comp.c1 - comp.c0 + 1, d = comp.r1 - comp.r0 + 1, cx = (X(comp.c0) + X(comp.c1)) / 2, cz = (Z(comp.r0) + Z(comp.r1)) / 2;
    const y = h[comp.r0][comp.c0], rot = d > w, len = Math.max(w, d);
    switch (comp.ch) {
      case 'T': if (len >= 3) b.longTable(cx, cz, { rot, y, w: len - 0.4, tablet: false }); else b.tableRect(cx, cz, { rot, y, w: Math.max(1.3, len - 0.3), tablet: false }); break;
      case 't': b.tableRect(cx, cz, { rot, y, w: Math.max(1.3, len - 0.3) }); break;
      case 'R': b.tableRound(cx, cz, { y }); break;
      case 'B': b.booth(cx, cz, { rot, y }); break;
      case 'Z': b.lowTable(cx, cz, { rot, y }); break;
      case 'C': b.counter(cx, cz, { rot, y, w: len - 0.1, tablet: R() < 0.3 }); break;
      case 'H': b.shelf(cx, cz, { rot, y, w: len - 0.2 }); break;
      case 'M': b.cabinet(cx, cz, { rot, y, w: len - 0.1 }); break;
      case 'X': b.debris(cx, cz, { y, tall: len > 1 }); break;
      case 'Q': for (const [c, r] of comp.cells) b.pillar(X(c), Z(r)); break;
      case 'L': for (const [c, r] of comp.cells) {
        const wd = wallDir(c, r) || [0, -1];
        b.locker(X(c) + wd[0] * 0.08, Z(r) + wd[1] * 0.08, -wd[0], -wd[1], h[r][c]);
      } break;
      case 'm': {
        const [c, r] = comp.cells[0], ry = awayRy(c, r), f = [Math.sin(ry), Math.cos(ry)];
        b.monitor(X(c) + f[0], Z(r) + f[1], ry, h[r][c]);
      } break;
    }
  }

  // ---------- 設備・印 ----------
  const marks = def.marks || {}, lifts = def.lifts || {};
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const ch = G[r][c], x = X(c), z = Z(r), y = h[r][c];
    if (ch === '@') lv.markers['@'] = { x, z, y };
    else if (ch === 'r') lv.spawns.push({ x, z, sleep: false });
    else if (ch === 'z') lv.docks.push({ x, z });
    else if (ch === 'a') lv.npcSpawns.push({ x, z });
    else if (ch === 'k') { if (opts.mode === 'robot') lv.keySpots.push(b.item(x, z, y, { look: 'key', flat: true, id: 'npckey', name: '鍵' })); }
    else if (ch === 'j') {
      const did = id + ':' + c + ',' + r;
      lv.diaries.push(did);
      if (opts.mode !== 'robot' && !(st.taken && st.taken.has(did))) b.item(x, z, y, { look: 'paper', id: did, diary: true, name: '日誌の切れ端' });
    } else if (ch === 'c') {
      let sx = 0, sz = 0;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const n = g(c + dx, r + dy); if (n !== '#' && (dx || dy)) { sx += dx / Math.hypot(dx, dy); sz += dy / Math.hypot(dx, dy); } }
      b.camera(x, WH, z, Math.atan2(sx, sz), { name: 'CAM-' + (lv.cameras.length + 1), range: WH > 4 ? 18 : 13 });
    } else if (ch === 'P') {
      const conf = def.breaker || {};
      lv.breaker = b.breaker(x, z, awayRy(c, r), { y, id: conf.id, need: conf.need });
      lv.breaker.on = lv.power;
    } else if (ch === 'F' || (marks[ch] && marks[ch].kind === 'lift')) {
      const conf = ch === 'F' ? lifts.F || {} : marks[ch];
      const L = b.lift(x, z, awayRy(c, r), { id: conf.id, label: conf.label, noShaft: true });
      Object.assign(L, { to: conf.to || null, at: conf.at || null, need: conf.need || null });
      lv.markers[conf.id] = { x, z, y, yaw: awayRy(c, r) + Math.PI };
    } else if (ch === 'x') {
      const ry = awayRy(c, r);
      b.exitDoor(x + Math.sin(ry) * 0.4, z + Math.cos(ry) * 0.4, ry, false);
    } else if (ch === 'U') {
      if (!lv.ups.some((u) => Math.hypot(u.x - x, u.z - z) < 2.5)) {
        const u = { kind: 'up', x, z, y, r: 1.6, to: def.up };
        lv.ups.push(u); lv.interacts.push(u);
        b.sign('↑ 上階', '#06200f', '#5dff8a', x, 2.45, z, 0, 0.7, 0.26);
      }
      b.put(M.padUp, 0, xform(new THREE.PlaneGeometry(1, 1), P(x, z), 0, y + 0.008, 0, -Math.PI / 2), false);
    } else if (marks[ch]) {
      const m = marks[ch];
      if (m.kind === 'trigger') lv.triggers.push({ id: m.id, x, z, r: 1.6, done: st.taken && st.taken.has('trig:' + m.id) });
      else if (m.kind === 'robot') lv.spawns.push({ x, z, id: m.id, sleep: !!m.sleep });
      else if (m.kind === 'item') { if (!(st.taken && st.taken.has(m.id)) && opts.mode !== 'robot') b.item(x, z, y, { ...m }); }
      else if (m.kind === 'console') b.console(x, z, m.ry ?? awayRy(c, r), { id: m.id, name: m.name, y });
    }
  }
  if (!lv.markers['@']) lv.markers['@'] = { x: X(1), z: Z(1), y: 0 };

  // ---------- 照明・水たまり・落書き ----------
  for (let r = 2; r < H; r += 4) for (let c = 2; c < W; c += 4) {
    if (g(c, r) === '#' || g(c, r) === 'O') continue;
    b.fixture(X(c), Z(r), R() < 0.45, { y: WH });
  }
  for (let i = 0; i < 6; i++) {
    const c = 1 + Math.floor(R() * (W - 2)), r = 1 + Math.floor(R() * (H - 2));
    if (g(c, r) === '.' && h[r][c] === 0) b.puddle(X(c), Z(r), 0.5 + R(), 0.6 + R() * 0.6);
  }
  for (const gr of def.graffiti || []) {
    const wd = wallDir(gr.c, gr.r);
    if (!wd) continue;
    b.graffiti(gr.text, X(gr.c) + wd[0] * 0.48, h[gr.r][gr.c] + 1.7, Z(gr.r) + wd[1] * 0.48, Math.atan2(-wd[0], -wd[1]));
  }
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (g(c, r) === '.' && R() < 0.05) b.smallDebris(X(c) - 0.5, Z(r) - 0.5, X(c) + 0.5, Z(r) + 0.5, 2, h[r][c]);
  }

  lv.reachFrom = lv.markers['@'];
  b.finish();
  lv.finalize();
  return lv;
}
