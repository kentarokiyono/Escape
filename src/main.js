import * as THREE from 'three';
import { Game, randomSeed } from './game.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { PostFX } from './postfx.js';
import { storage, fmtTime } from './util.js';
import { STORAGE_KEYS } from './config.js';

const settings = Object.assign({ sens: 1, vol: 0.8, quality: 'high' }, storage.get(STORAGE_KEYS.settings, {}));
const ui = new UI();
ui.loading('建物を生成中…');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 80);
camera.rotation.order = 'YXZ';
scene.add(camera);

const audio = new AudioSys();
audio.volume = settings.vol;
const fx = new PostFX(renderer, scene, camera);

let game;
const params = new URLSearchParams(location.search);
const urlSeed = params.has('seed') ? Number(params.get('seed')) >>> 0 : null;

function bindSettings() {
  const sens = document.getElementById('sens'), vol = document.getElementById('vol'), q = document.getElementById('quality');
  sens.value = settings.sens; vol.value = settings.vol; q.value = settings.quality;
  const save = () => storage.set(STORAGE_KEYS.settings, settings);
  for (const el of [sens, vol, q]) el.addEventListener('click', (e) => e.stopPropagation());
  sens.addEventListener('input', () => { settings.sens = Number(sens.value); save(); });
  vol.addEventListener('input', () => { settings.vol = Number(vol.value); audio.setVolume(settings.vol); save(); });
  q.addEventListener('change', () => { settings.quality = q.value; game.applyQuality(); save(); });
}

function showTitle() {
  const best = storage.get(STORAGE_KEYS.best, null);
  ui.showHud(false);
  ui.overlay({
    title: 'お席へご案内します ―廃墟階―',
    body: '<p>閉店から10年。元ファミレスの廃ビル。給仕ロボットは今も“営業中”。<br>' +
      '<b>5F のマスターキー</b>を取り、<b>1F の脱出口</b>から逃げろ。2F〜4F の上り階段は床の黄色いメモにある暗証番号が必要。</p>' +
      '<table class="keys">' +
      '<tr><th>マウス</th><td>視点</td><th>WASD</th><td>移動</td></tr>' +
      '<tr><th>Shift</th><td>ダッシュ（スタミナ）</td><th>C</th><td>しゃがむ（静か・見つかりにくい）</td></tr>' +
      '<tr><th>E</th><td>調べる / 隠れる / 階段 / 囮</td><th>F</th><td>ライト ON/OFF</td></tr>' +
      '<tr><th>M</th><td>マップ</td><th>Esc</th><td>一時停止</td></tr></table>' +
      '<p class="dim">足音は聞かれる。ライトは遠くからも見える。テーブルの陰はしゃがめば視線を切れる。ヘッドホン推奨。' +
      (best != null ? '<br>ベストタイム ' + fmtTime(best) : '') + '</p>',
    buttons: [
      { label: 'はじめる', primary: true, onClick: () => game.start(urlSeed ?? randomSeed()) },
    ],
    settings: true,
  });
}

function init() {
  game = new Game({ renderer, scene, camera, audio, ui, fx, settings });
  game.newRun(urlSeed ?? randomSeed());
  if (params.has('debug')) window.game = game;
  bindSettings();
  ui.loading('');
  showTitle();
  requestAnimationFrame(loop);
}

// ---------- 入力 ----------
addEventListener('keydown', (e) => {
  if (!game) return;
  if (game.state === 'code') {
    if (e.key >= '0' && e.key <= '9') game.codeDigit(Number(e.key));
    else if (e.key === 'Backspace') game.codeDel();
    else if (e.key === 'Enter') game.codeSubmit(true);
    else if (e.key === 'Escape') game.codeCancel(false);
    e.preventDefault();
    return;
  }
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  game.keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'KeyE') game.interact();
  else if (e.code === 'KeyF') game.toggleFlash();
  else if (e.code === 'KeyM') game.toggleMap();
});
addEventListener('keyup', (e) => { if (game) game.keys[e.code] = false; });
addEventListener('blur', () => { if (game) for (const k in game.keys) game.keys[k] = false; });
addEventListener('mousemove', (e) => {
  if (!game || !game.isLocked() || (game.state !== 'play' && game.state !== 'trans')) return;
  if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return; // ブラウザ由来の跳ね対策
  const k = 0.0022 * settings.sens;
  game.player.look(e.movementX * k, e.movementY * k);
});
document.addEventListener('pointerlockchange', () => game && game.onLockChange());
document.addEventListener('pointerlockerror', () => game && game.onLockError());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (game) game.applyQuality();
});

let last = performance.now();
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
  last = ts;
  game.frame(dt);
}

setTimeout(init, 30);
