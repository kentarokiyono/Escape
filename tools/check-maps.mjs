// ストーリーマップの検証: 行長・必須要素・到達性（ロボット/プレイヤー）
// 使い方: node tools/check-maps.mjs
import { MAPS } from '../src/story/maps.js';

const WALK_BLOCK = new Set('#TtRBZCHMXQLmO'.split(''));
const STRUCT = { '.': 0, '_': 0.35, '+': 0.6, '=': 2.6, ',': -0.4 };
const SLOPE = '^v<>AV{}';
let bad = 0;
for (const [id, def] of Object.entries(MAPS)) {
  const G = def.grid, H = G.length, W = G[0].length;
  G.forEach((r, i) => { if (r.length !== W) { console.log(id, 'row', i, 'length', r.length); bad++; } });
  // 高さ: 構造文字はそのまま、その他は隣の最頻値（簡易）
  const h = G.map((row) => [...row].map((c) => (c in STRUCT ? STRUCT[c] : null)));
  for (let p = 0; p < 6; p++) for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (h[r][c] !== null || G[r][c] === '#' || SLOPE.includes(G[r][c])) continue;
    const n = [[0, 1], [1, 0], [0, -1], [-1, 0]].map(([dx, dy]) => h[r + dy]?.[c + dx]).filter((v) => v !== null && v !== undefined);
    if (n.length) h[r][c] = n.sort((a, b) => n.filter((x) => x === b).length - n.filter((x) => x === a).length)[0];
  }
  const start = (() => { for (let r = 0; r < H; r++) { const c = G[r].indexOf('@'); if (c >= 0) return [c, r]; } return null; })();
  const lifts = [];
  G.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'F' || ch === '9') lifts.push([c, r]); }));
  const from = start || lifts[0];
  // プレイヤー到達（扉は開いている前提、段差 0.45 まで、スロープ/階段は通行可、ダクト可）
  const seen = new Set([from.join()]), q = [from];
  while (q.length) {
    const [c, r] = q.shift();
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const nc = c + dx, nr = r + dy, ch = G[nr]?.[nc];
      if (!ch || WALK_BLOCK.has(ch) || seen.has(nc + ',' + nr)) continue;
      const a = h[r][c], b = h[nr][nc];
      const slope = SLOPE.includes(ch) || SLOPE.includes(G[r][c]);
      if (!slope && a !== null && b !== null && Math.abs(a - b) > 0.45) continue;
      seen.add(nc + ',' + nr); q.push([nc, nr]);
    }
  }
  const need = [];
  G.forEach((row, r) => [...row].forEach((ch, c) => { if ('UjxPmFK123456789bgqny'.includes(ch) || (def.marks && def.marks[ch])) need.push([ch, c, r]); }));
  for (const [ch, c, r] of need) {
    const ok = [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0]].some(([dx, dy]) => seen.has((c + dx) + ',' + (r + dy)));
    if (!ok) { console.log(id, 'unreachable', ch, 'at', c, r); bad++; }
  }
  console.log(id, W + 'x' + H, 'reachable tiles', seen.size, 'checked', need.length);
}
process.exit(bad ? 1 : 0);
