import * as THREE from 'three';
import { Game } from './game.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { PostFX } from './postfx.js';
import { storage, fmtTime } from './util.js';
import { STORAGE_KEYS, DIFFICULTY, ROBOT_TYPES } from './config.js';
import { Progress, ACHIEVEMENTS, NOTE_TOTAL, newRun, todayKey, dailySeed } from './progress.js';
import { CHAPTERS } from './story/chapters.js';
import { NOTES } from './story/text.js';
import { CHAPTER_KEY } from './modes/story.js';
import { FreeMode } from './modes/free.js';
import { StoryMode, UNLOCK_KEY } from './modes/story.js';
import { RobotMode } from './modes/robot.js';
import { TouchControls, isTouch } from './touch.js';

// iPhone の Safari などは Pointer Lock 非対応。呼び出しで例外にならないよう空の関数で補う
if (!document.exitPointerLock) document.exitPointerLock = () => {};
if (!Element.prototype.requestPointerLock) Element.prototype.requestPointerLock = function () { return Promise.reject(new Error('pointer lock unsupported')); };
const TOUCH = isTouch();
const settings = Object.assign({ sens: 1, vol: 0.8, quality: TOUCH ? 'low' : 'high', diff: 'normal', hardcore: false }, storage.get(STORAGE_KEYS.settings, {}));
const ui = new UI();
// 想定外のエラーは画面にも出す（不具合報告用）
addEventListener('error', (e) => ui.say('エラー: ' + (e.message || e.error), 10));
addEventListener('unhandledrejection', (e) => { const m = e.reason && e.reason.message; if (m && !/pointer lock/i.test(m)) ui.say('エラー: ' + m, 10); });
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
  settings,
  startFree(seed) { prepare(); game.setMode(new FreeMode(game, app, seed ?? urlSeed ?? randomSeed())); game.mode.start(); },
  startDaily() { const k = todayKey(); prepare(); game.setMode(new FreeMode(game, app, dailySeed(k), { daily: k })); game.mode.start(); },
  startStory(cont) { prepare(); game.setMode(new StoryMode(game, app, cont)); game.mode.start(); },
  startChapter(id) { prepare(); game.setMode(new StoryMode(game, app, false, id)); game.mode.start(); },
  startRobot() { prepare(); game.setMode(new RobotMode(game, app)); game.mode.start(); },
  showTitle,
};
// モード開始前の共通処理（難易度・挑戦記録のリセット）
function prepare() {
  stop();
  if (TOUCH) TouchControls.enterFullscreen();
  game.diffKey = settings.diff in DIFFICULTY ? settings.diff : 'normal';
  game.diff = DIFFICULTY[game.diffKey];
  game.run = newRun();
}
function stop() {
  ui.clearSubtitles(); game.closeDoc(); ui.radar(false); ui.robotFace(false);
  fx.u.robo.value = 0; fx.u.caught.value = 0;
  if (game.state === 'monitor') game.exitMonitor();
  game.mapOpen = false; ui.e.map.classList.add('hide');
  ui.panel(null); game.throws.cancel();
}

function bindSettings() {
  const sens = document.getElementById('sens'), vol = document.getElementById('vol'), q = document.getElementById('quality');
  const df = document.getElementById('diff'), hc = document.getElementById('hardcore');
  sens.value = settings.sens; vol.value = settings.vol; q.value = settings.quality; df.value = settings.diff; hc.checked = !!settings.hardcore;
  const save = () => storage.set(STORAGE_KEYS.settings, settings);
  for (const el of [sens, vol, q, df, hc]) el.addEventListener('click', (e) => e.stopPropagation());
  df.addEventListener('change', () => { settings.diff = df.value; save(); }); // 次に始めたモードから反映
  hc.addEventListener('change', () => { settings.hardcore = hc.checked; save(); });
  sens.addEventListener('input', () => { settings.sens = Number(sens.value); save(); });
  vol.addEventListener('input', () => { settings.vol = Number(vol.value); audio.setVolume(settings.vol); save(); });
  q.addEventListener('change', () => { settings.quality = q.value; game.applyQuality(); save(); });
}

function showTitle() {
  if (game && game.state !== 'title') { stop(); document.exitPointerLock(); }
  if (game) game.state = 'menu';
  document.getElementById('ovBtns').classList.remove('chapters');
  const best = storage.get(STORAGE_KEYS.best, null), un = storage.get(UNLOCK_KEY, {});
  const ends = ['normal', 'true', 'ura'].filter((k) => un[k]).length;
  const chs = storage.get(CHAPTER_KEY, {}), today = todayKey(), dBest = Progress.daily[today];
  ui.showHud(false);
  ui.overlay({
    title: 'お席へご案内します ―廃墟階―',
    body: '<p>閉店から10年。元ファミレスのビルで、給仕ロボットは今も“営業中”。</p>' +
      (TOUCH ? '<p class="touchhelp">左側をドラッグ：移動　右側をドラッグ：視点<br>ボタン：調べる・走る・しゃがむ・ライト・マップ・投げる・停止</p>' : '') +
      '<table class="keys">' +
      '<tr><th>マウス</th><td>視点</td><th>WASD</th><td>移動</td></tr>' +
      '<tr><th>Shift</th><td>ダッシュ（スタミナ）</td><th>C</th><td>しゃがむ（静か・ダクトを通れる）</td></tr>' +
      '<tr><th>E</th><td>調べる / 隠れる / 操作</td><th>F</th><td>ライト ON/OFF</td></tr>' +
      '<tr><th>G 長押し</th><td>物を投げる（離すと投げる）</td><th>R</th><td>停止リモコン</td></tr>' +
      '<tr><th>M</th><td>マップ</td><th>V</th><td>センサー表示</td></tr></table>' +
      '<p class="dim">足音は聞かれる。ライトは遠くからも見える。監視カメラに映ると呼ばれる。ロボットは段差を越えられない。ヘッドホン推奨。<br>' +
      (best != null ? 'フリー ベスト ' + fmtTime(best) + '　' : '') + 'エンディング ' + ends + ' / 3　実績 ' + Progress.achCount + ' / ' + ACHIEVEMENTS.length + '</p>',
    buttons: [
      ...(StoryMode.hasSave() ? [{ label: 'ストーリー：つづきから', primary: true, onClick: () => app.startStory(true) }] : []),
      { label: 'ストーリー：はじめから', primary: !StoryMode.hasSave(), onClick: () => app.startStory(false) },
      ...(Object.keys(chs).length ? [{ label: '章を選ぶ', onClick: showChapters }] : []),
      { label: 'フリーモード（自動生成）', onClick: () => app.startFree(null) },
      { label: '今日の建物（' + today + '）' + (dBest != null ? ' 記録 ' + fmtTime(dBest) : ''), onClick: () => app.startDaily() },
      { label: un.robot ? 'ロボットモード' : 'ロボットモード（？？？）', disabled: !un.robot && !params.has('robot'), onClick: () => app.startRobot() },
      { label: '実績・図鑑', onClick: showRecords },
    ],
    settings: true,
  });
}

// 章セレクト（一度到達した章から、ランク挑戦として遊べる。保存と裏エンドの判定はしない）
function showChapters() {
  const chs = storage.get(CHAPTER_KEY, {});
  ui.overlay({
    title: '章を選ぶ',
    body: '<p class="dim">到達した章を、その章の始めから遊べる（進行は保存されない）。<br>ランクは目安時間と発見回数で決まる。</p>',
    buttons: [
      ...CHAPTERS.filter((c) => chs[c.id]).map((c) => {
        const r = Progress.ranks[c.id];
        return { label: c.no + '「' + c.title + '」' + (r ? '　ランク ' + r.rank + '（' + fmtTime(r.time) + '）' : ''), onClick: () => app.startChapter(c.id) };
      }),
      { label: '戻る', primary: true, onClick: showTitle },
    ],
  });
  document.getElementById('ovBtns').classList.add('chapters');
}

function showRecords() {
  document.getElementById('ovBtns').classList.remove('chapters');
  const ach = ACHIEVEMENTS.map(([id, name, desc]) => '<span class="' + (Progress.has(id) ? 'ok' : 'ng') + '">' + (Progress.has(id) ? '★ ' : '☆ ') + name + '</span>　<span class="dim">' + desc + '</span>').join('<br>');
  const robots = Object.entries(ROBOT_TYPES).map(([k, T]) => Progress.dex.robots.includes(k) ? '<span class="ok">■ ' + T.name + '</span>　<span class="dim">' + T.desc + '</span>' : '<span class="ng">□ ？？？（停止させて型番プレートを外す）</span>').join('<br>');
  const notes = NOTES.map((n, i) => Progress.dex.notes.includes(i) ? '<span class="ok">■ ' + n.title + '</span>' : '<span class="ng">□ ？？？</span>').join('<br>');
  const st = Progress.stats;
  ui.overlay({
    title: '実績・図鑑',
    body: '<p>実績 ' + Progress.achCount + ' / ' + ACHIEVEMENTS.length + '</p><div class="list">' + ach + '</div>' +
      '<p>ロボット図鑑 ' + Progress.dex.robots.length + ' / ' + Object.keys(ROBOT_TYPES).length + '</p><div class="list">' + robots + '</div>' +
      '<p>メモ ' + Progress.dex.notes.length + ' / ' + NOTE_TOTAL + '</p><div class="list">' + notes + '</div>' +
      '<p class="dim">累計: リモコン停止 ' + (st.stops || 0) + '台・電池切れ ' + (st.drains || 0) + '台・物音でおびき寄せ ' + (st.lures || 0) + '回</p>',
    buttons: [{ label: '戻る', primary: true, onClick: showTitle }],
  });
}

function init() {
  game = new Game({ renderer, scene, camera, audio, ui, fx, settings });
  let touch = null;
  if (TOUCH) { game.touch = true; touch = new TouchControls(game, settings); window.__touch = touch; }
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
const focusSink = () => { if (game && game.touch) return; // タッチ端末ではキーボードを出さない
  if (document.activeElement !== sink) try { sink.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } };
sink.addEventListener('input', () => { sink.value = ''; });
// e.code が取れない環境向けに、文字から物理キーを推定する
const KEYMAP = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', e: 'KeyE', f: 'KeyF', m: 'KeyM', c: 'KeyC', g: 'KeyG', r: 'KeyR', v: 'KeyV', ' ': 'Space', Shift: 'ShiftLeft', Escape: 'Escape' };
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
  if (game.state === 'panel') {
    if (code === 'Escape' || e.key === 'Escape') game.closePanel(false);
    else if (code === 'KeyE') game.closePanel(true);
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
  else if (code === 'KeyG') game.throws.start();
  else if (code === 'KeyR') game.useRemote();
  else if (code === 'KeyV') { game.sensors.on = !game.sensors.on; ui.say('センサー表示 ' + (game.sensors.on ? 'ON' : 'OFF'), 1.5); }
});
addEventListener('keyup', (e) => { if (!game) return; const c = codeOf(e); game.keys[c] = false; if (c === 'KeyG') game.throws.release(); });
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
  if (window.__touch) window.__touch.update();
}

setTimeout(init, 30);
