// フリーモード: 自動生成の5階建て。5Fのマスターキーを取り1Fから脱出
import { ENTRY, KEY_POS, TOP_FLOOR, STORAGE_KEYS, FLOORS } from '../config.js';
import { buildFreeLevel } from '../gen.js';
import { mulberry32, storage, fmtTime } from '../util.js';
import { newGear } from '../game.js';
import { Progress, judgeEscape } from '../progress.js';
import { PUZZLE_NAME } from '../puzzles.js';

const LOCK_NAME = { code: '暗証番号（床の黄色いメモ）', power: 'シャッター（配電盤で電源を入れる）', card: 'カードキー（フロアのどこかに落ちている）' };

export class FreeMode {
  // opts.daily: 今日の建物（日付文字列）
  constructor(g, app, seed, opts = {}) {
    this.g = g; this.app = app; this.seed = seed >>> 0; this.daily = opts.daily || null;
    this.best = storage.get(STORAGE_KEYS.best, null);
  }
  start() { this.newRun(); this.g.begin(); }

  newRun() {
    const g = this.g, R = mulberry32(this.seed ^ 0x9e3779b9);
    this.codes = {}; this.locks = {};
    for (let n = 2; n < TOP_FLOOR; n++) {
      this.codes[n] = String(Math.floor(R() * 10000)).padStart(4, '0');
      this.locks[n] = ['code', 'power', 'card'][Math.floor(R() * 3)];
    }
    const randPos = () => {
      for (;;) {
        const x = -30 + R() * 60, z = -62 + R() * 124;
        if (Math.hypot(x - ENTRY.x, z - ENTRY.z) > 25 && Math.hypot(x - KEY_POS.x, z - KEY_POS.z) > 25) return { x, z };
      }
    };
    const p1 = randPos(); let p2;
    do { p2 = randPos(); } while (Math.hypot(p2.x - p1.x, p2.z - p1.z) < 50);
    this.stairsWorld = [p1, p2];
    this.liftPair = 2 + Math.floor(R() * 2); // liftPair ⇔ liftPair+1 をつなぐ配膳リフト
    this.liftWorld = randPos();
    this.fs = {};
    this.hasKey = false;
    g.gear = newGear();
    // 図鑑のメモ: 未収集のものを優先して各階に1枚
    const pool = [...Array(8).keys()].sort((a, b) => (Progress.dex.notes.includes(a) - Progress.dex.notes.includes(b)) || (R() - 0.5));
    this.notes = { 1: pool[0], 2: pool[1], 3: pool[2], 4: pool[3], 5: pool[4] };
    Object.assign(g, { alarm: false, flashOn: true, time: 0, spotted: 0, decoyCd: 0, fear: 0 });
    g.player.reset(ENTRY.x, ENTRY.z, 0);
    this.loadFloor(1, null);
  }
  st(n) {
    return this.fs[n] || (this.fs[n] = {
      count: 1, interval: Math.max(25, 55 - 5 * n), max: 2 + n, timer: 0,
      unlocked: false, known: false, alarm: false, hasCard: false, doorOpen: false, taken: new Set(), sys: null,
      power: this.locks[n] !== 'power',
    });
  }
  hasExitKey() { return this.hasKey; }
  has() { return false; }

  loadFloor(n, arr) {
    const g = this.g, st = this.st(n);
    this.floor = n;
    const lift = n === this.liftPair ? { ...this.liftWorld, dir: 1 } : n === this.liftPair + 1 ? { ...this.liftWorld, dir: -1 } : null;
    const lv = buildFreeLevel(n, {
      seed: this.seed, stairsWorld: this.stairsWorld, codes: this.codes, hasKey: this.hasKey, M: g.M,
      lock: n >= 2 && n < TOP_FLOOR ? this.locks[n] : null, power: st.power, lift, hasCard: st.hasCard,
      taken: st.taken, note: this.notes[n],
    });
    if (st.sys) lv.sys = { ...st.sys };
    this.puzzle = lv.puzzle || null;
    let pos = { x: ENTRY.x, z: ENTRY.z, yaw: 0 };
    if (arr && arr.si !== undefined) pos = lv.arrival(arr.si, arr.dir);
    else if (arr && arr.lift && lv.lifts[0]) pos = { x: lv.lifts[0].x, z: lv.lifts[0].z, yaw: Math.PI };
    else if (arr && arr.fall) {
      const k = lv.nav.nearestFree(lv.nav.idx(arr.fall.x, arr.fall.z));
      pos = { x: lv.nav.cx(k), z: lv.nav.cz(k), yaw: g.player.yaw };
    }
    g.setLevel(lv, pos);
    for (const pd of lv.pads) if (pd.door && pd.door.type === 'card' && st.doorOpen) g.openDoor(pd.door, true);
    if (this.hasKey && !st.alarm) { st.alarm = true; st.interval = Math.min(st.interval, 20); st.max += 1; }
    for (let i = 0; i < st.count; i++) g.spawnRobotFar(15);
    if (n === TOP_FLOOR) for (const d of lv.docks) g.addRobot(d.x, d.z, { sleep: !this.hasKey, heading: 0 });
    if (arr && arr.fall) { const p = g.player; p.gy += 2.8; p.falling = true; p.vy = -2; }
    if (arr && arr.lift) g.noiseAt(pos.x, pos.z, 20);
    const lock = this.locks[n];
    let info = '';
    if (lock && n < TOP_FLOOR) info = '／上り階段: ' + LOCK_NAME[lock];
    if (!lv.power) info += '／停電中';
    g.ui.say((arr ? '→ ' : '') + FLOORS[n].name + info, 4);
  }

  update(dt) {
    const g = this.g, st = this.st(this.floor);
    st.timer += dt * (g.player.hidden ? 3 : 1);
    if (st.count < st.max && st.timer >= st.interval * g.diff.spawn) { st.timer = 0; st.count++; g.spawnRobotFar(15, false); }
  }

  interactText(it) {
    switch (it.kind) {
      case 'exit': return this.hasKey ? '[E] マスターキーで脱出口を開ける' : '脱出口：施錠されている（マスターキーが必要）';
      case 'item': if (it.gear) return undefined; return it.id === 'master' ? '[E] マスターキーを取る' : '[E] ' + it.name + 'を拾う';
      case 'memo': return '[E] 落ちているメモを読む';
      case 'pad': {
        const tf = this.floor + it.dir;
        let need = '';
        if (it.dir > 0 && this.locks[this.floor]) {
          const st = this.st(this.floor), lock = this.locks[this.floor];
          if (lock === 'code' && !st.unlocked) need = '暗証番号が必要';
          else if (lock === 'power' && !it.door.open) need = 'シャッターが下りている';
          else if (lock === 'card' && !it.door.open) need = st.hasCard ? '' : 'カードキーが必要';
          if (lock === 'card' && !it.door.open && st.hasCard) return '[E] カードキーで階段室を開ける';
        }
        return '[E] 階段を' + (it.dir > 0 ? '上る' : '下りる') + '（' + tf + 'F）' + (need ? ' <span class="warn">' + need + '</span>' : '');
      }
    }
    return undefined;
  }

  use(it) {
    const g = this.g, st = this.st(this.floor);
    switch (it.kind) {
      case 'exit':
        if (this.hasKey) this.win(); else { g.audio.locked(); g.ui.say('鍵がかかっている。マスターキーは5Fにある'); }
        return true;
      case 'item':
        if (it.o.gear) return false;
        it.o.gone = true; it.o.mesh.visible = false;
        if (it.id === 'master') this.takeKey();
        else { st.hasCard = true; g.audio.pickup(); g.ui.note('入手: ' + it.name); }
        return true;
      case 'memo':
        if (!st.known) { st.known = true; g.audio.pickup(); }
        g.showDoc(it.o.puz.title, it.o.puz.body);
        return true;
      case 'pad': this.usePad(it.o); return true;
    }
    return false;
  }

  usePad(pad) {
    const g = this.g, n = this.floor, st = this.st(n), lock = this.locks[n];
    if (pad.dir > 0 && lock) {
      if (lock === 'code' && !st.unlocked) {
        g.openCode(n + 'F → ' + (n + 1) + 'F　暗証番号（テンキー / Enter / Esc）', (c) => c === this.codes[n], () => {
          st.unlocked = true;
          if (this.puzzle) { Progress.add('code_' + this.puzzle.kind); if (['bin', 'receipt', 'hex'].every((k) => Progress.stats['code_' + k])) Progress.unlock('codes3'); }
          this.climb(pad);
        });
        return;
      }
      if (lock === 'power' && !pad.door.open) { g.audio.locked(); g.ui.say('シャッターが下りている。配電盤で電源を入れる必要がある'); return; }
      if (lock === 'card' && !pad.door.open) {
        if (st.hasCard) { g.audio.unlock(); g.openDoor(pad.door); st.doorOpen = true; }
        else { g.audio.locked(); g.ui.say('カードキー式の扉だ。このフロアのどこかにカードが落ちているはず'); }
        return;
      }
    }
    this.climb(pad);
  }
  climb(pad) {
    const g = this.g;
    g.transition(() => this.loadFloor(this.floor + pad.dir, { si: pad.si, dir: pad.dir }), 650, () => g.audio.stairs());
  }

  onPickup(it) { this.st(this.floor).taken.add(it.id); }
  onSys(sys) { this.st(this.floor).sys = { ...sys }; }
  onRobotStopped() { const st = this.st(this.floor); st.count = Math.max(0, st.count - 1); st.max = Math.max(1, st.max - 1); }
  onPower(on) {
    const g = this.g;
    this.st(this.floor).power = on;
    g.ui.say(on ? '電源が入った。照明・監視カメラ・シャッターが動き出す' : '電源を切った。監視カメラが止まり、照明が落ちる');
    if (on) g.audio.pa();
  }
  onLift(L) {
    const g = this.g;
    if (!g.sysOn('lift')) { g.audio.locked(); g.ui.say(g.level.power ? 'リフトの系統が OFF。配電盤で電気を回す（定格 30A を超えないように）' : 'リフトは電源が落ちていて動かない'); return; }
    g.noiseAt(L.x, L.z, 18);
    g.transition(() => this.loadFloor(this.floor + L.dir, { lift: true }), 3200, () => g.audio.liftRide(3));
  }
  onFall(x, z) {
    const g = this.g;
    if (this.floor <= 1) return;
    g.ui.say('床が抜けた！');
    g.transition(() => this.loadFloor(this.floor - 1, { fall: { x, z } }), 500);
  }

  takeKey() {
    const g = this.g, st = this.st(this.floor);
    this.hasKey = true; g.alarm = true;
    g.audio.pickup();
    setTimeout(() => { g.audio.pa(); g.audio.jingle(KEY_POS.x, KEY_POS.z - 2, true, 0.16); }, 400);
    g.ui.say('【警報】マスターキーが持ち出されました。全スタッフは確保に向かってください', 4.5);
    st.interval = 10; st.max += 3; st.alarm = true;
    for (const r of g.robots) {
      if (r.state === 'sleep') r.enter('search', { x: KEY_POS.x, z: KEY_POS.z + 1.5 });
      else r.setLook(r.state);
    }
  }

  hud() {
    const g = this.g, p = g.player, st = this.st(this.floor), lock = this.locks[this.floor];
    const active = g.robots.filter((r) => r.state !== 'sleep').length;
    let code = '';
    if (lock && this.floor < TOP_FLOOR) {
      if (lock === 'code') code = st.unlocked ? '上り階段: 解除済み' : '上り階段コード: ' + (st.known && this.puzzle ? '<b class="code">' + this.puzzle.short + '</b>（' + PUZZLE_NAME[this.puzzle.kind] + '・解読して入力）' : '<span class="warn">未発見（床の黄色いメモ）</span>');
      else if (lock === 'power') code = '上り階段: ' + (g.sysOn('shutter') ? 'シャッター開放' : '<span class="warn">シャッター（配電盤で電源とシャッター系統を ON）</span>');
      else code = '上り階段: ' + (st.hasCard ? 'カードキー所持' : '<span class="warn">カードキーが必要</span>');
    }
    return {
      floor: FLOORS[this.floor].name + '<small>' + fmtTime(g.time) + '</small>',
      obj: this.hasKey ? '目標: <b>1F の脱出口へ</b>' : '目標: <b>5F のマスターキーを取る</b>',
      code,
      sub: '稼働スタッフ ' + active + '　ライト ' + (g.flashOn ? 'ON' : '<span class="warn">OFF</span>') + '　電源 ' + (g.level.power ? g.load() + '/30A' : '<span class="warn">OFF</span>') +
        '　タブレット ' + (g.decoyCd > 0 ? Math.ceil(g.decoyCd) + 's' : '可') +
        (p.crawl ? '　<span class="dim">ダクト内</span>' : p.crouch ? '　<span class="dim">しゃがみ</span>' : '') +
        (p.hidden ? '<br><span class="warn">隠れている…増援が3倍速で迫る</span>' : ''),
      stamina: p.stamina, exhausted: p.exhausted,
    };
  }

  statsHtml() {
    const g = this.g;
    return '<table class="stats"><tr><th>経過時間</th><td>' + fmtTime(g.time) + '</td></tr>' +
      '<tr><th>到達階</th><td>' + Math.max(...Object.keys(this.fs).map(Number)) + 'F</td></tr>' +
      '<tr><th>発見された回数</th><td>' + g.spotted + '</td></tr>' +
      '<tr><th>ベスト</th><td>' + (this.best != null ? fmtTime(this.best) : '—') + '</td></tr>' +
      '<tr><th>建物番号</th><td>' + this.seed + '</td></tr></table>';
  }
  endButtons() {
    return [
      { label: '同じ建物で再挑戦', primary: true, onClick: () => this.daily ? this.app.startDaily() : this.app.startFree(this.seed) },
      { label: '新しい建物で挑戦', onClick: () => this.app.startFree(null) },
      { label: 'タイトルへ', onClick: () => this.app.showTitle() },
    ];
  }
  gameOver() {
    const g = this.g;
    document.exitPointerLock(); g.ui.showHud(false);
    g.ui.overlay({ title: 'ご利用ありがとうございました', body: '<p>またのお越しをお待ちしております〜♪</p>' + this.statsHtml(), buttons: this.endButtons(), settings: true });
  }
  win() {
    const g = this.g;
    g.state = 'win';
    const isBest = this.best == null || g.time < this.best;
    if (isBest) { this.best = g.time; storage.set(STORAGE_KEYS.best, g.time); }
    judgeEscape(g, { free: true });
    if (g.time < 480) Progress.unlock('speed_free');
    let dailyBest = false;
    if (this.daily) { Progress.unlock('daily'); dailyBest = Progress.dailyResult(this.daily, g.time); }
    g.audio.unlock(); document.exitPointerLock(); g.ui.showHud(false);
    g.ui.overlay({
      title: 'ビルから抜け出した…',
      body: '<p>しかし駐車場にも、小さな白い影が並んでいた</p>' + this.statsHtml() + (isBest ? '<p class="best">ベストタイム更新</p>' : '') +
        (this.daily ? '<p class="best">今日の建物（' + this.daily + '）' + (dailyBest ? 'の記録を更新' : 'の記録 ' + fmtTime(Progress.daily[this.daily])) + '</p>' : ''),
      buttons: this.endButtons(), settings: true,
    });
  }
  pauseInfo() {
    return {
      body: '<p>' + (this.daily ? '今日の建物（' + this.daily + '）' : 'フリーモード') + '　' + FLOORS[this.floor].name + '　経過 ' + fmtTime(this.g.time) + '</p>',
      buttons: [{ label: '最初からやり直す', onClick: () => this.app.startFree(this.seed) }, { label: 'タイトルへ', onClick: () => this.app.showTitle() }],
    };
  }
}
