// 踏破した場所だけを描く簡易マップ（M で開閉）。フリー/ストーリー共通（視線グリッドから描画）
const cache = new WeakMap();

function baseImage(lv) {
  let c = cache.get(lv);
  if (c) return c;
  const ph = lv.phys, W = ph.GW, H = ph.GH;
  c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, gr = ph.ground[k], top = ph.top[k], o = k * 4;
    let col;
    if (gr < -5) col = [40, 6, 6];
    else if (top - gr > 1.5) col = [150, 156, 146];
    else if (top - gr > 0.3) col = [78, 84, 78];
    else if (gr > 2) col = [70, 66, 92];
    else if (gr > 0.2) col = [82, 70, 52];
    else if (gr < -0.2) col = [36, 50, 58];
    else col = [44, 48, 45];
    img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  cache.set(lv, c);
  return c;
}

export function drawMap(cv, game) {
  const lv = game.level, p = game.player, ph = lv.phys;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = Math.floor(cv.clientWidth * dpr), H = Math.floor(cv.clientHeight * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const c = cv.getContext('2d');
  c.clearRect(0, 0, W, H);
  c.fillStyle = 'rgba(8,10,9,0.9)'; c.fillRect(0, 0, W, H);
  const pad = 40 * dpr, s = Math.min((W - pad * 2) / (lv.hx * 2), (H - pad * 2.6) / (lv.hz * 2));
  const ox = W / 2, oy = H / 2 + 12 * dpr;
  const X = (x) => ox + x * s, Y = (z) => oy + z * s;
  // 踏破マスクで切り抜いた下地
  const base = baseImage(lv);
  const mask = document.createElement('canvas'); mask.width = base.width; mask.height = base.height;
  const mg = mask.getContext('2d');
  mg.drawImage(base, 0, 0);
  mg.globalCompositeOperation = 'destination-in';
  mg.fillStyle = '#fff';
  const cw = base.width / lv.VW, ch = base.height / lv.VH;
  for (let j = 0; j < lv.VH; j++) for (let i = 0; i < lv.VW; i++) if (lv.visited[j * lv.VW + i]) mg.fillRect(i * cw, j * ch, cw, ch);
  c.imageSmoothingEnabled = false;
  c.drawImage(mask, X(-lv.hx), Y(-lv.hz), lv.hx * 2 * s, lv.hz * 2 * s);

  const seen = (x, z) => lv.seen(x, z);
  const dot = (x, z, col, r = 3) => { c.fillStyle = col; c.beginPath(); c.arc(X(x), Y(z), r * dpr, 0, 7); c.fill(); };
  const sq = (x, z, col, r = 2.5) => { c.fillStyle = col; c.fillRect(X(x) - r * dpr, Y(z) - r * dpr, r * 2 * dpr, r * 2 * dpr); };
  for (const l of lv.lockers) if (seen(l.x, l.z)) sq(l.x, l.z, '#6aa0c8', 2);
  for (const it of lv.interacts) {
    if (it.gone || !seen(it.x, it.z)) continue;
    if (it.kind === 'item' || it.kind === 'memo') dot(it.x, it.z, '#e8d060', 3.5);
    else if (it.kind === 'breaker') sq(it.x, it.z, '#f0a040', 3.5);
    else if (it.kind === 'lift') sq(it.x, it.z, '#b080ff', 4);
    else if (it.kind === 'up') sq(it.x, it.z, '#3ad070', 5);
    else if (it.kind === 'exit') sq(it.x, it.z, game.mode.hasExitKey?.() ? '#4f4' : '#f55', 5);
    else if (it.kind === 'monitor') sq(it.x, it.z, '#80c0ff', 3.5);
    else if (it.kind === 'door' || it.kind === 'shutter') sq(it.x, it.z, it.door.open ? '#556' : '#c55', 3);
  }
  for (const pd of lv.pads) if (seen(pd.x, pd.z)) sq(pd.x, pd.z, pd.dir > 0 ? '#3ad070' : '#e08030', 4);
  for (const cam of lv.cameras) if (seen(cam.x, cam.z)) dot(cam.x, cam.z, lv.power ? '#ff5050' : '#555', 2.5);

  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), a = Math.atan2(fz, fx);
  c.save(); c.translate(X(p.x), Y(p.z)); c.rotate(a);
  c.fillStyle = '#fff'; c.beginPath(); c.moveTo(9 * dpr, 0); c.lineTo(-6 * dpr, 5 * dpr); c.lineTo(-3 * dpr, 0); c.lineTo(-6 * dpr, -5 * dpr); c.closePath(); c.fill();
  c.restore();

  c.fillStyle = '#ddd'; c.font = 15 * dpr + 'px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillText(lv.name + '　（踏破した場所のみ / M で閉じる）', 16 * dpr, 12 * dpr);
  c.font = 12 * dpr + 'px sans-serif'; c.fillStyle = '#9a9';
  c.fillText('■ロッカー ●拾える物 ■配電盤 ■階段 ■リフト ■監視モニター ■施錠扉 ●カメラ　茶:段差 紫:中二階 暗赤:穴', 16 * dpr, 34 * dpr);
  void ph;
}
