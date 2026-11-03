import * as THREE from 'three';
import { Game } from './game.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { PostFX } from './postfx.js';
import { storage, fmtTime } from './util.js';
import { STORAGE_KEYS } from './config.js';
import { FreeMode } from './modes/free.js';
import { StoryMode, UNLOCK_KEY } from './modes/story.js';
import { RobotMode } from './modes/robot.js';

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
const randomSeed = () => (Math.random() * 1e9) >>> 0;

const app = {
  startFree(seed) { stop(); game.setMode(new FreeMode(game, app, seed ?? urlSeed ?? randomSeed())); game.mode.start(); },
  startStory(cont) { stop(); game.setMode(new StoryMode(game, app, cont)); game.mode.start(); },
  startRobot() { stop(); game.setMode(new RobotMode(game, app)); game.mode.start(); },
  showTitle,
};
function stop() {
  ui.clearSubtitles(); game.closeDoc(); ui.radar(false); ui.robotFace(false);
  fx.u.robo.value = 0; fx.u.caught.value = 0;
  if (game.state === 'monitor') game.exitMonitor();
  game.mapOpen = false; ui.e.map.classList.add('hide');
}

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
  if (game && game.state !== 'title') { stop(); document.exitPointerLock(); }
  if (game) game.state = 'menu';
  const best = storage.get(STORAGE_KEYS.best, null), un = storage.get(UNLOCK_KEY, {});
  const ends = ['normal', 'true', 'ura'].filter((k) => un[k]).length;
  ui.showHud(false);
  ui.overlay({
    title: 'お席へご案内します ―廃墟階―',
    body: '<p>閉店から10年。元ファミレスのビルで、給仕ロボットは今も“営業中”。</p>' +
      '<table class="keys">' +
      '<tr><th>マウス</th><td>視点</td><th>WASD</th><td>移動</td></tr>' +
      '<tr><th>Shift</th><td>ダッシュ（スタミナ）</td><th>C</th><td>しゃがむ（静か・ダクトを通れる）</td></tr>' +
      '<tr><th>E</th><td>調べる / 隠れる / 操作</td><th>F</th><td>ライト ON/OFF</td></tr>' +
      '<tr><th>M</th><td>マップ</td><th>Esc</th><td>一時停止</td></tr></table>' +
      '<p class="dim">足音は聞かれる。ライトは遠くからも見える。監視カメラに映ると呼ばれる。ロボットは段差を越えられない。ヘッドホン推奨。<br>' +
      (best != null ? 'フリー ベスト ' + fmtTime(best) + '　' : '') + 'エンディング ' + ends + ' / 3</p>',
    buttons: [
      ...(StoryMode.hasSave() ? [{ label: 'ストーリー：つづきから', primary: true, onClick: () => app.startStory(true) }] : []),
      { label: 'ストーリー：はじめから', primary: !StoryMode.hasSave(), onClick: () => app.startStory(false) },
      { label: 'フリーモード（自動生成）', onClick: () => app.startFree(null) },
      { label: un.robot ? 'ロボットモード' : 'ロボットモード（？？？）', disabled: !un.robot && !params.has('robot'), onClick: () => app.startRobot() },
    ],
    settings: true,
  });
}

function init() {
  game = new Game({ renderer, scene, camera, audio, ui, fx, settings });
  game.setMode(new FreeMode(game, app, urlSeed ?? randomSeed()));
  game.mode.newRun(); // タイトルの背景として生成
  game.state = 'menu';
  if (params.has('debug')) { window.game = game; window.app = app; }
  bindSettings();
  ui.loading('');
  showTitle();
  requestAnimationFrame(loop);
}

// ---------- 入力 ----------
// プレイ中のキー入力は見えないパスワード欄で受ける（IME がオンでも英字キーとして届く）
const sink = document.getElementById('keysink');
const focusSink = () => { if (document.activeElement !== sink) try { sink.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } };
sink.addEventListener('input', () => { sink.value = ''; });
// e.code が取れない環境向けに、文字から物理キーを推定する
const KEYMAP = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', e: 'KeyE', f: 'KeyF', m: 'KeyM', c: 'KeyC', ' ': 'Space', Shift: 'ShiftLeft', Escape: 'Escape' };
const codeOf = (e) => e.code || KEYMAP[e.key] || KEYMAP[(e.key || '').toLowerCase()] || '';
let imeWarnT = 0;
addEventListener('keydown', (e) => {
  if (!game) return;
  if ((e.key === 'Process' || e.keyCode === 229) && !codeOf(e)) {
    if (performance.now() - imeWarnT > 4000) { imeWarnT = performance.now(); ui.say('日本語入力（IME）をオフにしてください。キー操作が届いていません', 4); }
    return;
  }
  const code = codeOf(e);
  if (game.state === 'code') {
    if (e.key >= '0' && e.key <= '9') game.codeDigit(Number(e.key));
    else if (e.key === 'Backspace') game.codeDel();
    else if (e.key === 'Enter') game.codeSubmit(true);
    else if (e.key === 'Escape') game.codeCancel(false);
    e.preventDefault();
    return;
  }
  if (game.state === 'monitor') {
    if (code === 'KeyA' || code === 'ArrowLeft') game.cycleMonitor(-1);
    else if (code === 'KeyD' || code === 'ArrowRight') game.cycleMonitor(1);
    else if (code === 'KeyE') game.exitMonitor();
    return;
  }
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) e.preventDefault();
  game.keys[code] = true;
  if (e.repeat) return;
  if (code === 'KeyE') game.interact();
  else if (code === 'KeyF') game.toggleFlash();
  else if (code === 'KeyM') game.toggleMap();
});
addEventListener('keyup', (e) => { if (game) game.keys[codeOf(e)] = false; });
addEventListener('blur', () => { if (game) for (const k in game.keys) game.keys[k] = false; });
addEventListener('mousemove', (e) => {
  if (!game || !game.isLocked() || (game.state !== 'play' && game.state !== 'trans')) return;
  if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return; // ブラウザ由来の跳ね対策
  const k = 0.0022 * settings.sens;
  game.player.look(e.movementX * k, e.movementY * k);
});
document.addEventListener('pointerlockchange', () => { if (!game) return; if (game.isLocked()) focusSink(); game.onLockChange(); });
addEventListener('mousedown', () => { if (game && game.isLocked()) focusSink(); });
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
  if (game.state !== 'pause' && game.state !== 'menu') ui.updateSubtitles(dt);
  game.frame(dt);
}

setTimeout(init, 30);
