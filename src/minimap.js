// 踏破した部屋だけを描く簡易マップ（M で開閉）
import { RX, RZ, TOP_FLOOR } from './config.js';

export function drawMap(cv, g) {
  const lv = g.level, st = g.floorState[g.floor], p = g.player;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = Math.floor(cv.clientWidth * dpr), H = Math.floor(cv.clientHeight * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const c = cv.getContext('2d');
  c.clearRect(0, 0, W, H);
  c.fillStyle = 'rgba(8,10,9,0.88)'; c.fillRect(0, 0, W, H);
  const pad = 40 * dpr, s = Math.min((W - pad * 2) / (RX * 2), (H - pad * 2.6) / (RZ * 2));
  const ox = W / 2, oy = H / 2 + 10 * dpr;
  const X = (x) => ox + x * s, Y = (z) => oy + z * s;
  const seen = st.visited;

  for (let i = 0; i < lv.total; i++) {
    if (!seen.has(i)) continue;
    const cc = lv.cellCenter(i);
    c.fillStyle = 'rgba(70,80,72,0.55)';
    c.fillRect(X(cc.x - lv.roomW / 2), Y(cc.z - lv.roomH / 2), lv.roomW * s, lv.roomH * s);
  }
  c.strokeStyle = '#a8b0a4'; c.lineWidth = 2 * dpr; c.lineCap = 'square';
  for (const w of lv.walls) {
    if (w.side) {
      // 外壁は踏破区間だけ
      c.beginPath();
      const n = w.horiz ? lv.cols : lv.rows;
      for (let k = 0; k < n; k++) {
        const x = w.horiz ? -RX + (k + 0.5) * lv.roomW : w.x + w.side, z = w.horiz ? w.z + w.side : -RZ + (k + 0.5) * lv.roomH;
        if (!seen.has(lv.cellOf(x, z))) continue;
        if (w.horiz) { c.moveTo(X(-RX + k * lv.roomW), Y(w.z)); c.lineTo(X(-RX + (k + 1) * lv.roomW), Y(w.z)); }
        else { c.moveTo(X(w.x), Y(-RZ + k * lv.roomH)); c.lineTo(X(w.x), Y(-RZ + (k + 1) * lv.roomH)); }
      }
      c.stroke();
      continue;
    }
    const a = w.horiz ? lv.cellOf(w.x, w.z - 0.5) : lv.cellOf(w.x - 0.5, w.z);
    const b = w.horiz ? lv.cellOf(w.x, w.z + 0.5) : lv.cellOf(w.x + 0.5, w.z);
    if (!seen.has(a) && !seen.has(b)) continue;
    c.beginPath();
    if (w.horiz) { c.moveTo(X(w.x - w.len / 2), Y(w.z)); c.lineTo(X(w.x + w.len / 2), Y(w.z)); }
    else { c.moveTo(X(w.x), Y(w.z - w.len / 2)); c.lineTo(X(w.x), Y(w.z + w.len / 2)); }
    c.stroke();
  }
  const dot = (x, z, col, r = 3) => { c.fillStyle = col; c.beginPath(); c.arc(X(x), Y(z), r * dpr, 0, 7); c.fill(); };
  for (const l of lv.lockers) if (seen.has(lv.cellOf(l.x, l.z))) { c.fillStyle = '#6aa0c8'; c.fillRect(X(l.x) - 2 * dpr, Y(l.z) - 2 * dpr, 4 * dpr, 4 * dpr); }
  for (const m of lv.memos) if (seen.has(lv.cellOf(m.x, m.z))) dot(m.x, m.z, '#e8d060', 3.5);
  lv.stairs.forEach((sp) => {
    if (!seen.has(lv.cellOf(sp.x, sp.z))) return;
    c.fillStyle = '#2a8a4a'; c.fillRect(X(sp.x - 1.6), Y(sp.z - 1.6), 3.2 * s, 3.2 * s);
    c.fillStyle = '#dfffe8'; c.font = 'bold ' + 11 * dpr + 'px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('階段', X(sp.x), Y(sp.z));
  });
  if (lv.exit) { c.fillStyle = g.hasKey ? '#4f4' : '#f55'; c.fillRect(X(lv.exit.x - 1), Y(RZ) - 3 * dpr, 2 * s, 6 * dpr); }
  if (lv.key && seen.has(lv.cellOf(lv.key.x, lv.key.z))) dot(lv.key.x, lv.key.z, '#ffcf5a', 5);

  // プレイヤー
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), a = Math.atan2(fz, fx);
  c.save(); c.translate(X(p.x), Y(p.z)); c.rotate(a);
  c.fillStyle = '#fff'; c.beginPath(); c.moveTo(9 * dpr, 0); c.lineTo(-6 * dpr, 5 * dpr); c.lineTo(-3 * dpr, 0); c.lineTo(-6 * dpr, -5 * dpr); c.closePath(); c.fill();
  c.restore();

  c.fillStyle = '#ddd'; c.font = 15 * dpr + 'px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillText(lv.cfg.name + '　（踏破した部屋のみ表示 / M で閉じる）', 16 * dpr, 12 * dpr);
  c.font = 12 * dpr + 'px sans-serif'; c.fillStyle = '#9a9';
  c.fillText('■ロッカー　●メモ　■階段' + (g.floor === 1 ? '　━脱出口' : '') + (g.floor === TOP_FLOOR ? '　●鍵' : ''), 16 * dpr, 34 * dpr);
}
