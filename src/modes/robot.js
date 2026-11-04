// ロボットモード: プレイヤーは給仕ロボット。鍵を探して脱出しようとする客を全員「ご案内」する
import { MAPS } from '../story/maps.js';
import { buildMapLevel } from '../mapbuild.js';
import { Npc } from '../npc.js';
import { storage, fmtTime } from '../util.js';
import { newGear } from '../game.js';
import { Progress } from '../progress.js';

const BEST_KEY = 'escape.robotBest';
const NPC_COUNT = 4;

export class RobotMode {
  constructor(g, app) {
    this.g = g; this.app = app;
    this.pings = []; this.caught = 0; this.escaped = 0; this.over = false;
    this.camerasOff = true;
    this.radar = g.ui.e.radar.getContext('2d');
  }
  start() {
    const g = this.g, def = MAPS['1F'];
    Object.assign(g, { alarm: false, flashOn: false, time: 0, spotted: 0, decoyCd: 0, fear: 0 });
    g.gear = newGear();
    const lv = buildMapLevel('1F', def, g.M, { power: true }, { mode: 'robot' });
    const dock = lv.docks[0] || lv.markers['@'];
    g.setLevel(lv, { x: dock.x, z: dock.z + 0.8, yaw: Math.PI });
    const p = g.player;
    Object.assign(p, { robot: true, eyeOverride: 1.35, speedMul: 1.1 });
    // 客ごとに、出現位置から遠い鍵を割り当てる
    const keys = lv.keySpots.slice(), spawns = lv.npcSpawns.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < NPC_COUNT; i++) {
      const s = spawns[i % spawns.length];
      keys.sort((a, b) => Math.hypot(b.x - s.x, b.z - s.z) - Math.hypot(a.x - s.x, a.z - s.z));
      const k = keys.length > 1 ? keys.splice(Math.floor(Math.random() * Math.min(2, keys.length)), 1)[0] : keys[0];
      g.npcs.push(new Npc(g, s.x + (i >= spawns.length ? 0.8 : 0), s.z, k, i));
    }
    g.fx.u.robo.value = 0.55;
    g.ui.radar(true);
    g.ui.subtitles([['FR-002', 'ホールスタッフ、起動。'], ['FR-002', '本日のお客様は ' + NPC_COUNT + ' 名です。お一人も、お帰しにならないように。']]);
    g.begin();
  }
  dispose() {
    const g = this.g, p = g.player;
    Object.assign(p, { robot: false, eyeOverride: 0, speedMul: 1 });
    g.fx.u.robo.value = 0;
    g.ui.radar(false);
  }
  get exposure() { return 1.9; }
  get ambient() { return 1.3; }
  has() { return false; }
  hasExitKey() { return false; }
  ping(x, z, s) { this.pings.push({ x, z, s, t: 1.6 }); }

  update(dt) {
    const g = this.g, p = g.player;
    if (this.over) return;
    for (const n of g.npcs) {
      if (n.active && n.state !== 'hide' && Math.hypot(n.x - p.x, n.z - p.z) < 1.0 && Math.abs(n.gy - p.gy) < 0.6) this.catchNpc(n);
    }
    this.fearOverride = 0;
    this.drawRadar(dt);
  }
  catchNpc(n) {
    const g = this.g;
    n.catch(); this.caught++;
    g.audio.jingle(n.x, n.z, false, 0.14);
    g.ui.say('お客様をお席へご案内しました（残り ' + this.remaining + ' 名）');
    if (this.remaining === 0) this.finish(true);
  }
  get remaining() { return this.g.npcs.filter((n) => n.active).length; }
  onNpcKey(n) {
    this.g.audio.pa();
    this.g.ui.say('【館内放送】お客様がマスターキーをお持ちです。出口付近のスタッフは警戒してください');
    this.ping(n.x, n.z, 2);
  }
  onNpcExit(n) {
    this.g.audio.pa();
    this.g.ui.say('【館内放送】脱出口が操作されています。至急、待合へ向かってください', 4);
    this.ping(n.x, n.z, 2);
  }
  onNpcEscape() { this.escaped++; this.finish(false); }

  interactText(it) {
    if (it.kind === 'openLocker') return '[E] ロッカーを開ける';
    if (it.kind === 'monitor') return '[E] 監視モニターを見る';
    if (it.kind === 'breaker' || it.kind === 'item' || it.kind === 'exit' || it.kind === 'tablet' || it.kind === 'up' || it.kind === 'lift') return null;
    return undefined;
  }
  use(it) {
    const g = this.g;
    if (it.kind === 'openLocker') {
      const L = it.o;
      g.audio.locker(true);
      const n = g.npcs.find((x) => x.locker === L && x.state === 'hide');
      if (n) { n.x = L.exit.x; n.z = L.exit.z; this.catchNpc(n); }
      else g.ui.say('空だ');
      return true;
    }
    return false;
  }

  drawRadar(dt) {
    const c = this.radar, W = c.canvas.width, p = this.g.player, R = W / 2 - 8, range = 26;
    c.clearRect(0, 0, W, W);
    c.fillStyle = 'rgba(0,20,18,0.55)'; c.beginPath(); c.arc(W / 2, W / 2, R, 0, 7); c.fill();
    c.strokeStyle = 'rgba(120,255,230,0.35)'; c.lineWidth = 1;
    for (const k of [0.33, 0.66, 1]) { c.beginPath(); c.arc(W / 2, W / 2, R * k, 0, 7); c.stroke(); }
    c.fillStyle = '#bff'; c.font = '11px monospace'; c.textAlign = 'center'; c.fillText('足音', W / 2, 14);
    for (const q of this.pings) {
      q.t -= dt;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > range) continue;
      // プレイヤー前方を上に
      const a = Math.atan2(dx, dz) - (p.yaw + Math.PI), rr = (d / range) * R;
      const x = W / 2 + Math.sin(a) * rr, y = W / 2 - Math.cos(a) * rr;
      c.fillStyle = 'rgba(160,255,240,' + Math.max(0, q.t / 1.6) * (0.4 + q.s * 0.3) + ')';
      c.beginPath(); c.arc(x, y, 3 + q.s * 3, 0, 7); c.fill();
    }
    this.pings = this.pings.filter((q) => q.t > 0);
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(W / 2, W / 2 - 7); c.lineTo(W / 2 - 5, W / 2 + 5); c.lineTo(W / 2 + 5, W / 2 + 5); c.fill();
  }

  hud() {
    const g = this.g, p = g.player;
    const withKey = g.npcs.filter((n) => n.active && n.hasKey).length;
    return {
      floor: 'ロボットモード<small>' + fmtTime(g.time) + '</small>',
      obj: '目標: <b>お客様を全員ご案内する</b>（残り ' + this.remaining + ' / ' + g.npcs.length + '）',
      code: withKey ? '<span class="warn">鍵を持った客 ' + withKey + ' 名 → 脱出口（待合の南）へ向かっている</span>' : '客は鍵を探している',
      sub: 'Shift: 加速　E: ロッカーを開ける / 監視モニター　足音はレーダーに表示',
      stamina: p.stamina, exhausted: p.exhausted,
    };
  }
  finish(win) {
    const g = this.g;
    this.over = true; g.state = 'win';
    document.exitPointerLock(); g.ui.showHud(false); g.ui.radar(false);
    let best = storage.get(BEST_KEY, null), isBest = false;
    if (win && (best == null || g.time < best)) { best = g.time; isBest = true; storage.set(BEST_KEY, best); }
    if (win) { Progress.unlock('robot_win'); if (g.diffKey === 'hard') Progress.unlock('diff_hard'); }
    g.ui.overlay({
      title: win ? '本日の営業は終了しました' : 'お客様がお帰りになりました',
      body: win
        ? '<p>お客様 ' + g.npcs.length + ' 名を、全員お席へご案内しました。</p><table class="stats"><tr><th>時間</th><td>' + fmtTime(g.time) + '</td></tr><tr><th>ベスト</th><td>' + fmtTime(best) + '</td></tr></table>' + (isBest ? '<p class="best">ベストタイム更新</p>' : '')
        : '<p>鍵を持ったお客様が、脱出口から外へ出ていきました。</p><p class="dim">ご案内できたお客様: ' + this.caught + ' 名</p>',
      buttons: [{ label: 'もう一度', primary: true, onClick: () => this.app.startRobot() }, { label: 'タイトルへ', onClick: () => this.app.showTitle() }],
      settings: true,
    });
  }
  gameOver() {}
  pauseInfo() {
    return {
      body: '<p>ロボットモード　残り ' + this.remaining + ' 名　経過 ' + fmtTime(this.g.time) + '</p>',
      buttons: [{ label: 'やり直す', onClick: () => this.app.startRobot() }, { label: 'タイトルへ', onClick: () => this.app.showTitle() }],
    };
  }
}
