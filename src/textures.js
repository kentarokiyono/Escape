// 手続き生成テクスチャ（カラー / 法線 / ラフネス）。起動時に1回だけ生成してキャッシュする。
import * as THREE from 'three';
import { mulberry32, hash2, smoothstep, lerp } from './util.js';

function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// タイル可能な fbm ノイズを N×N グリッドに焼く
function noiseGrid(N, period, oct, seed) {
  const R = mulberry32(seed), L = 256, lat = new Float32Array(L * L);
  for (let i = 0; i < lat.length; i++) lat[i] = R();
  const out = new Float32Array(N * N);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const p = period << o, off = o * 53;
    for (let y = 0; y < N; y++) {
      const fy = (y / N) * p, yi = Math.floor(fy), yf = fy - yi, sy = yf * yf * (3 - 2 * yf);
      const y0 = ((yi % p) + off) % L, y1 = (((yi + 1) % p) + off) % L;
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * p, xi = Math.floor(fx), xf = fx - xi, sx = xf * xf * (3 - 2 * xf);
        const x0 = ((xi % p) + off) % L, x1 = (((xi + 1) % p) + off) % L;
        const a = lat[y0 * L + x0], b = lat[y0 * L + x1], c = lat[y1 * L + x0], d = lat[y1 * L + x1];
        out[y * N + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      }
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function sample(g, N, u, v) {
  const fx = (((u % 1) + 1) % 1) * N, fy = (((v % 1) + 1) % 1) * N;
  const x0 = Math.floor(fx) % N, y0 = Math.floor(fy) % N, x1 = (x0 + 1) % N, y1 = (y0 + 1) % N;
  const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
  const a = g[y0 * N + x0], b = g[y0 * N + x1], c = g[y1 * N + x0], d = g[y1 * N + x1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

// fn(x, y, u, v, out) で out.r/g/b(0-255), out.h(0-1), out.ro(0-1) を書く
function makeSurface(W, H, fn, post) {
  const cc = canvas(W, H), hc = canvas(W, H), rc = canvas(W, H);
  const cx = cc.getContext('2d'), hx = hc.getContext('2d'), rx = rc.getContext('2d');
  const ci = cx.createImageData(W, H), hi = hx.createImageData(W, H), ri = rx.createImageData(W, H);
  const o = { r: 0, g: 0, b: 0, h: 0.5, ro: 0.9 };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    o.h = 0.5; o.ro = 0.9;
    fn(x, y, x / W, y / H, o);
    const i = (y * W + x) * 4;
    ci.data[i] = o.r; ci.data[i + 1] = o.g; ci.data[i + 2] = o.b; ci.data[i + 3] = 255;
    const hv = Math.max(0, Math.min(255, o.h * 255)), rv = Math.max(0, Math.min(255, o.ro * 255));
    hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = hv; hi.data[i + 3] = 255;
    ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = rv; ri.data[i + 3] = 255;
  }
  cx.putImageData(ci, 0, 0); hx.putImageData(hi, 0, 0); rx.putImageData(ri, 0, 0);
  if (post) post({ c: cx, h: hx, r: rx, W, H });
  return { color: cc, height: hc, rough: rc };
}

function normalFromHeight(hc, strength) {
  const W = hc.width, H = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, W, H).data;
  const nc = canvas(W, H), ctx = nc.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
  const at = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let nx = (at(x - 1, y) - at(x + 1, y)) * strength;
    let ny = (at(x, y + 1) - at(x, y - 1)) * strength;
    let nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * W + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return nc;
}

// ランダムウォークのひび
function cracks(ctxs, seed, count, len = 30, step = 14) {
  const R = mulberry32(seed);
  const { c, h, r, W, H } = ctxs;
  for (let i = 0; i < count; i++) {
    let x = R() * W, y = R() * H;
    const pts = [[x, y]];
    let a = R() * Math.PI * 2;
    for (let k = 0; k < len; k++) { a += (R() - 0.5) * 1.1; x += Math.cos(a) * step * R(); y += Math.sin(a) * step * R(); pts.push([x, y]); }
    const w = 0.8 + R() * 1.6;
    for (const [ctx, col, lw] of [[c, 'rgba(10,9,7,0.75)', w], [h, 'rgba(0,0,0,0.9)', w + 1], [r, 'rgba(255,255,255,0.6)', w]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.beginPath();
      pts.forEach(([px, py], j) => (j ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
    }
  }
}

function scratches(ctxs, seed, count, color = 'rgba(170,170,160,0.35)') {
  const R = mulberry32(seed);
  const { c, h, W, H } = ctxs;
  for (let i = 0; i < count; i++) {
    const x = R() * W, y = R() * H, a = R() * Math.PI, l = 10 + R() * 60;
    c.strokeStyle = color; c.lineWidth = 0.6 + R(); c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    h.strokeStyle = 'rgba(0,0,0,0.5)'; h.lineWidth = 1; h.beginPath(); h.moveTo(x, y); h.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); h.stroke();
  }
}

// ---------- 各サーフェス ----------
function floorSurface(seed) {
  const S = 1024, N = 256, T = S / 8;
  const grime = noiseGrid(N, 4, 5, seed + 1), wet = noiseGrid(N, 3, 4, seed + 2), fine = noiseGrid(N, 32, 2, seed + 3);
  return makeSurface(S, S, (x, y, u, v, o) => {
    const tx = x % T, ty = y % T, ix = (x / T) | 0, iy = (y / T) | 0;
    const g = sample(grime, N, u, v), w = sample(wet, N, u, v), f = sample(fine, N, u, v);
    let r, gg, b;
    if (tx < 3 || ty < 3) { r = 36; gg = 32; b = 28; o.h = 0.12; o.ro = 0.95; }
    else {
      const tint = 0.86 + hash2(ix, iy, seed) * 0.24;
      if ((ix + iy) & 1) { r = 128; gg = 120; b = 104; } else { r = 96; gg = 72; b = 60; }
      r *= tint; gg *= tint; b *= tint;
      o.h = 0.62 + (f - 0.5) * 0.14; o.ro = 0.62 + (f - 0.5) * 0.12;
      const e = Math.min(tx, ty, T - tx, T - ty);
      if (e < 7) o.h -= (7 - e) * 0.05;
    }
    const k = 1 - smoothstep(0.4, 0.8, g) * 0.62; r *= k; gg *= k; b *= k * 0.95;
    const wt = smoothstep(0.6, 0.7, w);
    if (wt > 0) { const kk = 1 - wt * 0.45; r *= kk; gg *= kk; b *= kk; o.ro = lerp(o.ro, 0.1, wt); }
    o.r = r; o.g = gg; o.b = b;
  }, (cx) => cracks(cx, seed + 9, 22));
}

function wallSurface(seed) {
  const S = 1024, N = 256;
  const grime = noiseGrid(N, 4, 5, seed), peel = noiseGrid(N, 6, 4, seed + 1), mold = noiseGrid(N, 8, 3, seed + 2), fine = noiseGrid(N, 48, 2, seed + 3);
  const streak = new Float32Array(S);
  for (let x = 0; x < S; x++) streak[x] = smoothstep(0.52, 0.85, sample(grime, N, x / S, 0.37)) * 2.4;
  return makeSurface(S, S, (x, y, u, v, o) => {
    const hy = (1 - v) * 4; // 実寸の高さ(m)。キャンバス下端が床
    const g = sample(grime, N, u, v), f = sample(fine, N, u, v);
    let r, gg, b;
    if (hy < 0.12) { r = 34; gg = 30; b = 26; o.h = 0.78; o.ro = 0.6; }
    else if (hy < 1.0) {
      r = 78; gg = 58; b = 42; o.h = 0.6 + (f - 0.5) * 0.06; o.ro = 0.55;
      const gx = (u * 8) % 1;
      if (gx < 0.012 || gx > 0.988) { r *= 0.5; gg *= 0.5; b *= 0.5; o.h = 0.3; }
      else if (gx < 0.04 || gx > 0.96 || hy < 0.2 || hy > 0.9) o.h = 0.5;
    } else if (hy < 1.06) {
      const t = (hy - 1) / 0.06; r = 64; gg = 48; b = 34; o.h = 0.6 + Math.sin(t * Math.PI) * 0.35; o.ro = 0.5;
    } else {
      const st = 0.965 + 0.035 * Math.sin(u * Math.PI * 2 * 40);
      r = 150 * st; gg = 143 * st; b = 126 * st; o.h = 0.55 + (f - 0.5) * 0.12; o.ro = 0.9;
      const p = sample(peel, N, u, v);
      if (p > 0.685) { r = 88; gg = 86; b = 80; o.h = 0.36 + (f - 0.5) * 0.2; o.ro = 0.95; }
      else if (p > 0.665) { r *= 1.08; gg *= 1.08; b *= 1.06; o.h = 0.78; }
      const m = sample(mold, N, u, v);
      if (hy < 1.7 && m > 0.66) { const k = smoothstep(0.66, 0.8, m) * (1 - (hy - 1.06) / 0.64); r *= 1 - k * 0.35; gg *= 1 - k * 0.28; b *= 1 - k * 0.4; }
      const sl = streak[x];
      if (hy <= 3 && hy > 3 - sl) { const k = (1 - (3 - hy) / sl) * 0.55; r *= 1 - k * 0.9; gg *= 1 - k; b *= 1 - k * 1.1; }
    }
    const k = 1 - smoothstep(0.45, 0.82, g) * 0.45 - (hy < 0.6 ? (0.6 - hy) * 0.35 : 0);
    o.r = r * k; o.g = gg * k; o.b = b * k;
  }, (cx) => cracks(cx, seed + 5, 10, 22, 12));
}

function ceilingSurface(seed) {
  const S = 512, N = 128, T = S / 4;
  const wet = noiseGrid(N, 3, 4, seed), fine = noiseGrid(N, 32, 2, seed + 1);
  return makeSurface(S, S, (x, y, u, v, o) => {
    const tx = x % T, ty = y % T, ix = (x / T) | 0, iy = (y / T) | 0;
    if (tx < 4 || ty < 4) { o.r = 72; o.g = 72; o.b = 70; o.h = 0.92; o.ro = 0.45; return; }
    const hs = hash2(ix, iy, seed);
    if (hs < 0.12) { o.r = o.g = o.b = 5; o.h = 0; o.ro = 1; return; }
    const f = sample(fine, N, u, v), w = sample(wet, N, u, v);
    let r = 118, g = 115, b = 106;
    const pore = f > 0.72 ? 0.8 : 1; r *= pore; g *= pore; b *= pore;
    const ring = smoothstep(0.6, 0.62, w) - smoothstep(0.64, 0.72, w);
    const inside = smoothstep(0.62, 0.7, w);
    r *= 1 - inside * 0.3 - ring * 0.4; g *= 1 - inside * 0.38 - ring * 0.5; b *= 1 - inside * 0.5 - ring * 0.6;
    if (hs < 0.25) { r *= 0.7; g *= 0.68; b *= 0.62; }
    o.r = r; o.g = g; o.b = b; o.h = 0.5 + f * 0.12; o.ro = 0.95;
  });
}

function paintedMetalSurface(seed) {
  const S = 512, N = 128;
  const rust = noiseGrid(N, 5, 4, seed), fine = noiseGrid(N, 40, 2, seed + 1);
  return makeSurface(S, S, (x, y, u, v, o) => {
    const rs = sample(rust, N, u, v), f = sample(fine, N, u, v);
    let r = 66, g = 78, b = 70; o.ro = 0.45 + f * 0.15; o.h = 0.55 + (f - 0.5) * 0.05;
    const k = smoothstep(0.6, 0.7, rs);
    if (k > 0) { r = lerp(r, 92 + f * 30, k); g = lerp(g, 50 + f * 15, k); b = lerp(b, 30, k); o.ro = lerp(o.ro, 0.95, k); o.h = lerp(o.h, 0.4 + f * 0.3, k); }
    const dk = 0.85 + (1 - v) * 0.15; o.r = r * dk; o.g = g * dk; o.b = b * dk;
  }, (cx) => scratches(cx, seed + 3, 120));
}

function steelSurface(seed) {
  const S = 512, N = 256;
  const brush = noiseGrid(N, 64, 2, seed), smudge = noiseGrid(N, 4, 4, seed + 1);
  return makeSurface(S, S, (x, y, u, v, o) => {
    const br = sample(brush, N, u * 0.04, v), sm = sample(smudge, N, u, v);
    const c = 138 + (br - 0.5) * 40 - smoothstep(0.5, 0.8, sm) * 40;
    o.r = c; o.g = c; o.b = c * 1.02; o.ro = 0.28 + (br - 0.5) * 0.1 + smoothstep(0.45, 0.8, sm) * 0.35; o.h = 0.5 + (br - 0.5) * 0.1;
  }, (cx) => scratches(cx, seed + 4, 160, 'rgba(210,210,210,0.25)'));
}

function woodSurface(seed) {
  const S = 512, N = 128;
  const warp = noiseGrid(N, 4, 3, seed), fine = noiseGrid(N, 64, 1, seed + 1), dirt = noiseGrid(N, 3, 3, seed + 2);
  return makeSurface(S, S, (x, y, u, v, o) => {
    const t = u * 18 + sample(warp, N, u, v) * 2;
    const ring = Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 2), 4);
    const f = sample(fine, N, u * 0.2, v);
    const d = 1 - smoothstep(0.5, 0.8, sample(dirt, N, u, v)) * 0.4;
    o.r = lerp(112, 94, ring) * (0.92 + f * 0.16) * d; o.g = lerp(80, 66, ring) * (0.92 + f * 0.16) * d; o.b = lerp(54, 44, ring) * d;
    o.h = 0.5 - ring * 0.08; o.ro = 0.5 + ring * 0.1 + (1 - d) * 0.6;
  }, (cx) => scratches(cx, seed + 5, 80, 'rgba(200,170,130,0.3)'));
}

function vinylSurface(seed) {
  const S = 256, N = 128;
  const fine = noiseGrid(N, 32, 2, seed), wear = noiseGrid(N, 4, 3, seed + 1);
  return makeSurface(S, S, (x, y, u, v, o) => {
    const f = sample(fine, N, u, v), w = smoothstep(0.55, 0.8, sample(wear, N, u, v));
    o.r = lerp(110, 72, w) * (0.9 + f * 0.2); o.g = lerp(32, 40, w); o.b = lerp(28, 34, w);
    o.h = 0.5 + f * 0.1; o.ro = 0.38 + w * 0.4;
  }, (cx) => cracks(cx, seed + 2, 14, 12, 8));
}

function concreteSurface(seed) {
  const S = 512, N = 128;
  const g = noiseGrid(N, 6, 5, seed), fine = noiseGrid(N, 64, 1, seed + 1);
  return makeSurface(S, S, (x, y, u, v, o) => {
    const n = sample(g, N, u, v), f = sample(fine, N, u, v);
    const k = 0.75 + n * 0.45; o.r = 92 * k; o.g = 90 * k; o.b = 85 * k;
    o.h = 0.5 + (n - 0.5) * 0.3; o.ro = 0.95;
    if (f > 0.8) { o.r *= 0.6; o.g *= 0.6; o.b *= 0.6; o.h -= 0.2; }
  }, (cx) => cracks(cx, seed + 7, 6, 18, 10));
}

function plasticSurface(seed) {
  const S = 256, N = 128;
  const g = noiseGrid(N, 4, 4, seed), fine = noiseGrid(N, 32, 2, seed + 1);
  return makeSurface(S, S, (x, y, u, v, o) => {
    const n = sample(g, N, u * 0.3, v), f = sample(fine, N, u, v);
    const dirt = smoothstep(0.5, 0.85, n) * (0.4 + v * 0.6);
    o.r = 188 * (1 - dirt * 0.45); o.g = 183 * (1 - dirt * 0.47); o.b = 170 * (1 - dirt * 0.52);
    o.h = 0.5 + f * 0.05; o.ro = 0.32 + dirt * 0.4;
  }, (cx) => scratches(cx, seed + 3, 40, 'rgba(120,115,100,0.35)'));
}

// ロッカー扉（ルーバー付き）
function lockerDoorSurface(seed, base) {
  const W = 256, H = 512;
  const cc = canvas(W, H), hc = canvas(W, H), rc = canvas(W, H);
  const c = cc.getContext('2d'), h = hc.getContext('2d'), r = rc.getContext('2d');
  c.drawImage(base.color, 0, 0, W, H); h.drawImage(base.height, 0, 0, W, H); r.drawImage(base.rough, 0, 0, W, H);
  const louvers = (y0) => {
    for (let i = 0; i < 7; i++) {
      const y = y0 + i * 14;
      c.fillStyle = 'rgba(0,0,0,0.85)'; c.fillRect(48, y, W - 96, 6);
      c.fillStyle = 'rgba(200,200,190,0.18)'; c.fillRect(48, y + 6, W - 96, 2);
      h.fillStyle = '#111'; h.fillRect(48, y, W - 96, 6);
      h.fillStyle = '#ddd'; h.fillRect(48, y + 6, W - 96, 4);
    }
  };
  louvers(40); louvers(H - 140);
  c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 4; c.strokeRect(8, 8, W - 16, H - 16);
  h.strokeStyle = '#222'; h.lineWidth = 4; h.strokeRect(8, 8, W - 16, H - 16);
  c.fillStyle = '#1a1a18'; c.fillRect(W - 46, H / 2 - 30, 14, 60);
  h.fillStyle = '#fff'; h.fillRect(W - 46, H / 2 - 30, 14, 60);
  c.fillStyle = '#c9c2a8'; c.fillRect(W / 2 - 26, 150, 52, 22);
  c.fillStyle = '#222'; c.font = 'bold 16px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(String(10 + Math.floor(mulberry32(seed)() * 89)), W / 2, 162);
  return { color: cc, height: hc, rough: rc };
}

// ---------- テクスチャ化 ----------
let maxAniso = 1;
function tex(cnv, srgb, repeat = true) {
  const t = new THREE.CanvasTexture(cnv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}
function pbr(surf, normalStrength, params = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex(surf.color, true),
    normalMap: tex(normalFromHeight(surf.height, normalStrength), false),
    roughnessMap: tex(surf.rough, false),
    roughness: 1, metalness: 0, ...params,
  });
}

// 共有マテリアル一式。scale はワールドUVの1タイルあたりのメートル
export function buildMaterials(renderer) {
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const metalSurf = paintedMetalSurface(41);
  const M = {
    floor: pbr(floorSurface(11), 3.0), floorScale: 4,
    wall: pbr(wallSurface(23), 2.5), wallScale: 4,
    ceiling: pbr(ceilingSurface(31), 2.0), ceilingScale: 2.4,
    metal: pbr(metalSurf, 2.0, { metalness: 0.35 }), metalScale: 1,
    steel: pbr(steelSurface(53), 1.0, { metalness: 0.85 }), steelScale: 1,
    wood: pbr(woodSurface(61), 1.5), woodScale: 1,
    vinyl: pbr(vinylSurface(71), 2.0), vinylScale: 0.5,
    concrete: pbr(concreteSurface(83), 2.5), concreteScale: 1,
    plastic: pbr(plasticSurface(97), 0.8),
    lockerDoor: pbr(lockerDoorSurface(5, metalSurf), 3.0, { metalness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: 0.7, metalness: 0.2 }),
    paper: new THREE.MeshStandardMaterial({ color: 0x9c968a, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.85 }),
    puddle: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.82, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    tubeOn: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.3, 2.1) }),
    tubeOff: new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.3 }),
    padUp: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.9, 0.3), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    padDown: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.35, 0.05), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.35, 0.18) }),
    ledBlue: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 2.4) }),
    ledRed: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.2, 0.15) }),
    ledGreen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.4, 0.5) }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffcf5a, emissive: 0xffaa22, emissiveIntensity: 1.6, metalness: 1, roughness: 0.25 }),
  };
  return M;
}

// ---------- 単発キャンバス ----------
export function faceTextures() {
  const mk = (text, color, glow, bg = '#020304') => {
    const c = canvas(256, 192), g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 256, 192);
    g.font = 'bold 50px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = glow; g.shadowBlur = 16; g.fillStyle = color; g.fillText(text, 128, 98);
    g.shadowBlur = 0; g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = 0; y < 192; y += 4) g.fillRect(0, y, 256, 2);
    const vg = g.createRadialGradient(128, 96, 40, 128, 96, 150);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.7)');
    g.fillStyle = vg; g.fillRect(0, 0, 256, 192);
    return tex(c, true, false);
  };
  return {
    normal: mk('(o ω o)', '#e8f6ff', '#7fd8ff'),
    search: mk('(o ω o )', '#fff2b0', '#ffd84a'),
    alert: mk('(◎ ω ◎)', '#fff2b0', '#ffd84a'),
    chase: mk('(● ω ●)', '#ff5a4a', '#ff2a1a'),
    lure: mk('(^ ω ^)', '#ffd7a0', '#ffaa33'),
    sleep: mk('(- ω -)', '#3b6a7a', '#113344'),
    caught: mk('(O ω O)', '#ffffff', '#ff0000', '#300000'),
  };
}

export function flashCookie() {
  const S = 256, c = canvas(S), g = c.getContext('2d'), img = g.createImageData(S, S);
  const N = 64, smudge = noiseGrid(N, 4, 3, 7);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2), r = Math.hypot(dx, dy);
    let I = Math.pow(Math.max(0, 1 - r), 1.2) * 0.55 + Math.exp(-r * r / 0.03) * 0.5 + Math.exp(-((r - 0.42) ** 2) / 0.003) * 0.18;
    I *= 0.85 + sample(smudge, N, x / S, y / S) * 0.3;
    const v = Math.min(255, I * 255), i = (y * S + x) * 4;
    img.data[i] = v; img.data[i + 1] = v * 0.97; img.data[i + 2] = v * 0.9; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, false, false);
}

export function graffitiTexture(txt, R) {
  const c = canvas(512, 256), g = c.getContext('2d');
  const red = R() < 0.55;
  const col = red ? 'rgba(150,22,18,0.9)' : 'rgba(220,220,210,0.75)';
  g.translate(256, 120); g.rotate((R() - 0.5) * 0.2);
  g.font = 'bold 100px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = col; g.fillText(txt, 0, 0);
  const w = Math.min(460, g.measureText(txt).width);
  g.strokeStyle = col;
  for (let i = 0; i < 10; i++) {
    const x = -w / 2 + R() * w; g.lineWidth = 2 + R() * 4;
    g.beginPath(); g.moveTo(x, 30); g.lineTo(x + (R() - 0.5) * 3, 40 + R() * 90); g.stroke();
  }
  return tex(c, true, false);
}

export function memoTexture(code, n) {
  const c = canvas(256, 180), g = c.getContext('2d');
  g.fillStyle = '#d6c35e'; g.fillRect(0, 0, 256, 180);
  const R = mulberry32(Number(code) + n);
  for (let i = 0; i < 400; i++) { g.fillStyle = 'rgba(80,70,20,' + R() * 0.15 + ')'; g.fillRect(R() * 256, R() * 180, 1 + R() * 3, 1 + R() * 3); }
  g.strokeStyle = 'rgba(90,80,30,0.35)'; g.beginPath(); g.moveTo(0, 90 + R() * 10); g.lineTo(256, 85 + R() * 10); g.stroke();
  g.fillStyle = '#222'; g.textAlign = 'center';
  g.font = '16px sans-serif'; g.fillText(n + 'F → ' + (n + 1) + 'F 階段コード', 128, 32);
  g.save(); g.translate(128, 105); g.rotate(-0.04); g.font = 'bold 58px monospace'; g.fillText(code, 0, 0); g.restore();
  g.font = '12px sans-serif'; g.fillStyle = '#5a4f20'; g.fillText('※忘れるな', 128, 160);
  return tex(c, true, false);
}

export function signTexture(text, bg, fg, w = 256, h = 96) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = fg; g.font = 'bold ' + Math.floor(h * 0.5) + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  return tex(c, true, false);
}
